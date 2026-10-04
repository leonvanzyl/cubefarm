// The office journal on disk, for the time-lapse replay (docs/how-it-works.md, "Time-lapse"). What Swarm.broadcast
// sends is slimmed and scrubbed (shared/journal.ts) and kept in <SWARM_HOME>/journal/<day>/<start>.ndjson
// (demo-journal for the demo): one newline-delimited JSON file per keyframe, a new one every 10 minutes (sooner past
// 2 MB, and at midnight). The file being written lives in memory and is rewritten whole (temp file + rename) every
// 30 seconds, so a crash costs at most that much and never leaves half a file. Days older than a week go, and the
// oldest files once the journal passes 200 MB: at startup and on the office's housekeeping timer.
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  dayKey,
  frameKeys,
  isFrame,
  journalEvent,
  KEEP_DAYS,
  KEYFRAME_MS,
  marksOf,
  MAX_BYTES,
  MAX_RANGE_MS,
  parseLines,
  recorded,
  selectLines,
  toPrune,
  type JournalChunk,
  type JournalDayView,
  type JournalFrame,
  type JournalLine,
  type JournalMark,
  type SegmentFile,
} from '../shared/journal.ts';
import type { ServerEvent } from '../shared/types.ts';
import { HttpError } from './httpError.ts';

export const FLUSH_MS = 30_000;
/** A file this big starts a new one (with its own keyframe) before its 10 minutes are up. */
export const SEGMENT_BYTES = 2 * 1024 * 1024;

export interface JournalOptions {
  dir: string;
  /** The office as a keyframe, already slimmed (journalFrame). */
  frame: () => JournalFrame;
  /** Values that must never reach the disk (the ElevenLabs key, secret-looking environment variables). */
  secrets: () => readonly string[];
  now?: () => number;
  flushMs?: number;
  keyframeMs?: number;
  segmentBytes?: number;
  keepDays?: number;
  maxBytes?: number;
}

interface Segment {
  day: string;
  start: number;
  file: string;
  lines: string[];
  bytes: number;
  events: number;
  dirty: boolean;
}

interface DiskSegment extends SegmentFile {
  file: string;
}

interface Summary {
  from: number;
  to: number;
  marks: JournalMark[];
}

const DAY_DIR = /^\d{4}-\d{2}-\d{2}$/;
const SEGMENT_FILE = /^(\d{10,16})\.ndjson$/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Environment values that look like secrets (by their variable's name), to scrub out of anything journaled. */
export function envSecrets(env: Record<string, string | undefined>): string[] {
  return Object.entries(env)
    .filter(([k, v]) => !!v && v.length >= 8 && /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION/i.test(k))
    .map(([, v]) => v!);
}

/** GET /api/journal/events' query: whole epoch milliseconds, from before to, at most a day apart, not in the future. */
export function parseRange(q: Record<string, unknown>, now: number): { from: number; to: number; seek: boolean } {
  const num = (v: unknown, name: string) => {
    const n = typeof v === 'string' && /^\d{1,16}$/.test(v) ? Number(v) : NaN;
    if (!Number.isSafeInteger(n)) throw new HttpError(400, `${name} must be a time in epoch milliseconds`);
    return n;
  };
  const from = num(q.from, 'from');
  const to = num(q.to, 'to');
  if (from >= to) throw new HttpError(400, 'from must be before to');
  if (to - from > MAX_RANGE_MS) throw new HttpError(400, 'Ask for at most 24 hours at a time');
  if (from > now + 60_000) throw new HttpError(400, 'from is in the future');
  return { from, to, seek: q.seek === '1' || q.seek === 'true' };
}

/** Writes `data` to `file` through a temp file and a rename; Windows may briefly refuse the rename (EPERM/EBUSY). */
async function writeAtomic(file: string, data: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, data);
  for (let i = 0; ; i++) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i >= 4 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
      await sleep(50 * (i + 1));
    }
  }
}

/** A file's span and timeline marks. Agents' lines are most of a file and never make a mark, so they aren't parsed. */
export function summarize(raw: string): Summary {
  const rows = raw.split('\n').filter((l) => l.trim());
  const time = (l: string | undefined) => Number(/^\{"t":(\d+)/.exec(l ?? '')?.[1] ?? 0);
  const lines = parseLines(rows.filter((l) => !l.includes('"e":{"type":"agent')).join('\n'));
  return { from: time(rows[0]), to: time(rows[rows.length - 1]), marks: marksOf(lines) };
}

export class Journal {
  private cur: Segment | null = null;
  private last = new Map<string, string>(); // what was last recorded about each repo, agent, QA record…
  private writing: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private summaries = new Map<string, Summary>(); // `${file}|${bytes}` -> a closed file's span and marks
  private readonly now: () => number;
  /** Lines and bytes recorded since the office started, and files written (how busy the journal is). */
  readonly stats = { lines: 0, bytes: 0, writes: 0, skipped: 0 };

  constructor(private opts: JournalOptions) {
    this.now = opts.now ?? Date.now;
  }

  /** Prunes, then starts the first file with a keyframe of the office as it starts. */
  async start() {
    await this.prune(true).catch((err) => console.warn('could not prune the journal', err));
    this.open(true);
    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), this.opts.flushMs ?? FLUSH_MS);
      this.timer.unref?.();
    }
  }

  /** Writes what's pending and stops the timer (the office is stopping). */
  async close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.cur?.dirty) this.flush(this.cur);
    await this.writing;
  }

  /** Swarm.broadcast's events: the ones that change the office's look are recorded, once each change. */
  record(ev: ServerEvent) {
    if (!this.cur) return;
    // The journal is a bystander: nothing in it may break what the office is broadcasting.
    try {
      const e = journalEvent(ev, this.opts.secrets());
      if (!e) return;
      const now = this.now();
      this.rotate(now);
      const line = recorded(this.last, e);
      if (!line) {
        this.stats.skipped++;
        return;
      }
      this.push(this.cur, { t: now, e: line });
      this.cur.events++;
    } catch (err) {
      console.warn('could not journal an event', err);
    }
  }

  /** The timer: a new file when this one's time is up, and a write when something changed. */
  tick() {
    if (!this.cur) return;
    try {
      this.rotate(this.now());
    } catch (err) {
      console.warn('could not start a new journal file', err);
    }
    if (this.cur.dirty) this.flush(this.cur);
  }

  private push(seg: Segment, line: JournalLine) {
    const json = JSON.stringify(line);
    const bytes = Buffer.byteLength(json) + 1;
    seg.lines.push(json);
    seg.bytes += bytes;
    seg.dirty = true;
    this.stats.lines++;
    this.stats.bytes += bytes;
  }

  /** Starts a new file when this one has had its 10 minutes (or its 2 MB) of events, or the day changed. */
  private rotate(now: number) {
    const c = this.cur;
    if (!c) return;
    const full = c.events > 0 && (now - c.start >= (this.opts.keyframeMs ?? KEYFRAME_MS) || c.bytes >= (this.opts.segmentBytes ?? SEGMENT_BYTES));
    if (full || dayKey(now) !== c.day) this.open(false, now);
  }

  private open(boot: boolean, at = this.now()) {
    const prev = this.cur;
    if (prev?.dirty) this.flush(prev);
    const start = prev && at <= prev.start ? prev.start + 1 : at;
    const day = dayKey(start);
    const frame = this.opts.frame();
    const seg: Segment = { day, start, file: path.join(this.opts.dir, day, `${start}.ndjson`), lines: [], bytes: 0, events: 0, dirty: false };
    this.push(seg, boot ? { t: start, k: frame, boot: true } : { t: start, k: frame });
    this.last = frameKeys(frame);
    this.cur = seg;
  }

  private flush(seg: Segment) {
    seg.dirty = false;
    const data = `${seg.lines.join('\n')}\n`;
    this.stats.writes++;
    this.writing = this.writing.then(() => writeAtomic(seg.file, data)).catch((err) => console.warn('could not write the journal', err));
  }

  // ---------- files ----------

  /** Every closed file on disk (the one being written is in memory), oldest first. */
  private async files(withTmp = false): Promise<{ segments: DiskSegment[]; tmp: string[]; days: string[] }> {
    const segments: DiskSegment[] = [];
    const tmp: string[] = [];
    let days: string[] = [];
    try {
      days = (await fs.readdir(this.opts.dir)).filter((d) => DAY_DIR.test(d));
    } catch {
      return { segments, tmp, days };
    }
    for (const day of days) {
      const dir = path.join(this.opts.dir, day);
      let names: string[] = [];
      try {
        names = await fs.readdir(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        const file = path.join(dir, name);
        if (withTmp && name.endsWith('.tmp')) tmp.push(file);
        const m = SEGMENT_FILE.exec(name);
        if (!m || file === this.cur?.file) continue;
        const st = await fs.stat(file).catch(() => null);
        if (st?.isFile()) segments.push({ day, start: Number(m[1]), bytes: st.size, file });
      }
    }
    segments.sort((a, b) => a.start - b.start);
    return { segments, tmp, days };
  }

  /** Deletes days past the limit and the oldest files past the size cap; `boot` also clears temp files a crash left. */
  async prune(boot = false) {
    const { segments, tmp, days } = await this.files(boot);
    const current = this.cur ? [{ day: this.cur.day, start: this.cur.start, bytes: this.cur.bytes, file: this.cur.file }] : [];
    const gone = toPrune([...segments, ...current], this.now(), { keepDays: this.opts.keepDays ?? KEEP_DAYS, maxBytes: this.opts.maxBytes ?? MAX_BYTES, keep: this.cur?.start });
    for (const f of [...gone.map((g) => g.file), ...tmp]) await fs.rm(f, { force: true, maxRetries: 3 }).catch(() => undefined);
    for (const g of gone) for (const k of this.summaries.keys()) if (k.startsWith(`${g.file}|`)) this.summaries.delete(k);
    // Days left empty go too.
    for (const day of days) {
      const dir = path.join(this.opts.dir, day);
      const left = await fs.readdir(dir).catch(() => null);
      if (left && left.length === 0) await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
    }
    return gone.length;
  }

  private readRaw(f: DiskSegment): Promise<string> {
    return fs.readFile(f.file, 'utf8').catch(() => '');
  }

  private currentRaw(): string {
    return this.cur ? this.cur.lines.join('\n') : '';
  }

  /** The recorded days, oldest first, each with its span, size and timeline marks. */
  async days(): Promise<JournalDayView[]> {
    const { segments } = await this.files();
    const byDay = new Map<string, JournalDayView>();
    const add = (day: string, bytes: number, s: Summary) => {
      if (!s.from) return;
      const d = byDay.get(day) ?? { day, from: s.from, to: s.to, bytes: 0, marks: [] };
      d.from = Math.min(d.from, s.from);
      d.to = Math.max(d.to, s.to);
      d.bytes += bytes;
      d.marks.push(...s.marks);
      byDay.set(day, d);
    };
    for (const f of segments) {
      const key = `${f.file}|${f.bytes}`;
      let s = this.summaries.get(key);
      if (!s) {
        s = summarize(await this.readRaw(f));
        this.summaries.set(key, s);
      }
      add(f.day, f.bytes, s);
    }
    if (this.cur) add(this.cur.day, this.cur.bytes, summarize(this.currentRaw()));
    const out = [...byDay.values()].sort((a, b) => a.from - b.from);
    for (const d of out) d.marks.sort((a, b) => a.t - b.t);
    return out;
  }

  /** The lines for [from, to) (see JournalChunk); 404 when nothing was recorded by then. */
  async read(from: number, to: number, seek: boolean): Promise<JournalChunk> {
    const { segments } = await this.files();
    const starts = [...segments.map((s) => s.start), ...(this.cur ? [this.cur.start] : [])];
    if (!starts.length) throw new HttpError(404, 'Nothing has been recorded yet');
    if (to <= starts[0]) throw new HttpError(404, `Nothing was recorded before ${new Date(starts[0]).toLocaleString()}`);
    // Only the files that can hold [from, to): from the one `from` falls in, up to the first that starts after `to`.
    let first = 0;
    for (let i = 0; i < starts.length; i++) if (starts[i] <= from) first = i;
    const files: JournalLine[][] = [];
    for (let i = first; i < starts.length; i++) {
      const seg = segments[i];
      files.push(parseLines(seg ? await this.readRaw(seg) : this.currentRaw()));
      if (starts[i] >= to) break;
    }
    return selectLines(files.filter((f) => f.length && isFrame(f[0])), from, to, seek);
  }

  /** Writes a whole day (the demo's sample day), replacing what that day had; files split at its keyframes. */
  async writeDay(lines: JournalLine[]) {
    if (!lines.length || !isFrame(lines[0])) throw new Error('a day starts with a keyframe');
    const day = dayKey(lines[0].t);
    if (day === this.cur?.day) throw new HttpError(409, 'Today is being recorded: a sample day must be another day');
    const dir = path.join(this.opts.dir, day);
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
    for (const k of this.summaries.keys()) if (k.startsWith(`${dir}${path.sep}`)) this.summaries.delete(k);
    let chunk: JournalLine[] = [];
    const write = async () => {
      if (chunk.length) await writeAtomic(path.join(dir, `${chunk[0].t}.ndjson`), `${chunk.map((l) => JSON.stringify(l)).join('\n')}\n`);
    };
    for (const l of lines) {
      if (isFrame(l) && chunk.length) {
        await write();
        chunk = [];
      }
      chunk.push(l);
    }
    await write();
    return day;
  }

  /** Whether any day other than today has been recorded. */
  async hasPastDays(): Promise<boolean> {
    const { segments } = await this.files();
    const today = dayKey(this.now());
    return segments.some((s) => s.day < today);
  }
}
