// A cloud agent's CLI (docs/cloud.md): it runs under a tmux server of its own in the agent's Upstash Box, so it keeps
// working when the office's connection drops or the office closes. BoxPty is its terminal as the terminal runtime sees
// one (ptyClient.ts's Pty): a TTY exec session attached to that tmux, reattached after a dropped connection. The CLI's
// hooks can't reach the office, so they append to the session's events file in the Box (boxHelpers.ts); BoxPty reads it
// from the byte offset the office last handled and hands each event on, which also replays what happened while the
// office was away. The CLI's exit is an event too (the launcher's CubefarmExit): only that, or tmux being gone, ends it.

import { BOX_ENV } from './cloud.ts';
import { sq, tmuxAlive, tmuxAttach, tmuxKill, tmuxList, tmuxSocket, tmuxStart } from './boxScripts.ts';
import type { BoxApi, BoxSession } from './box.ts';
import type { Pty } from './ptyClient.ts';
import type { AgentCli } from '../shared/types.ts';

/** What the office keeps about a cloud agent's live CLI, with the agent (state.json), so it can pick it up again. */
export interface BoxCliRecord {
  boxId: string;
  token: string;
  cli: AgentCli;
  /** The session's folder in the Box. */
  dir: string;
  /** Bytes of its events file the office has handled. */
  offset: number;
  /**
   * Where the last turn's end starts in the file: a restart reads again from here, so a finished turn whose task the
   * office hadn't wrapped up yet (it was saving, or it crashed) finishes then.
   */
  turnAt?: number;
  resumeId: string | null;
  /** An office session was driving it (not waiting at its prompt). */
  busy: boolean;
}

/** Where a session's CLI runs when it's a cloud agent's (SessionOptions.box). */
export interface BoxTarget {
  api: BoxApi;
  boxId: string;
  /** The CLI's credentials, as its environment only. */
  env: Record<string, string>;
  /** Claude Code reads an API key through this (null: it signs in with its subscription token). */
  apiKeyHelper: string | null;
  /** The Box has a browser for Playwright to attach to. */
  browser: boolean;
  /** The live CLI's record changed (null: the CLI is gone): saved with the agent. */
  record(rec: BoxCliRecord | null): void;
  /** The office's connection to the CLI dropped (false) or is back (true). */
  connection?(up: boolean): void;
}

/** Playwright MCP attaches to the Box's own Chromium here. */
export const BOX_CDP = 'http://127.0.0.1:9222';

// ---------- the events file ----------

export const TURN_ENDS = ['Stop', 'StopFailure', 'TurnComplete'];

/** Splits an events file into whole JSON lines, counting the bytes handled (lines are ASCII, so bytes are characters). */
export class EventLines {
  private rest = '';

  /** turnAt: where the last turn end seen starts (see BoxCliRecord.turnAt). */
  constructor(
    public offset = 0,
    public turnAt = offset,
  ) {}

  push(text: string): Record<string, unknown>[] {
    const parts = (this.rest + text).split('\n');
    this.rest = parts.pop() ?? '';
    const out: Record<string, unknown>[] = [];
    for (const line of parts) {
      const at = this.offset;
      this.offset += line.length + 1;
      if (!line.trim()) continue;
      try {
        const v = JSON.parse(line) as unknown;
        if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
        if (TURN_ENDS.includes(String((v as Record<string, unknown>).hook_event_name))) this.turnAt = at;
        out.push(v as Record<string, unknown>);
      } catch {
        // a line cut short by a full disk: skip it
      }
    }
    return out;
  }
}

/** The events end with a finished turn (one after the last prompt it was given), or with the CLI's exit. */
export function finishedTurn(events: Record<string, unknown>[]): boolean {
  let last = -1;
  events.forEach((e, i) => {
    if (e.hook_event_name === 'UserPromptSubmit') last = i;
  });
  return events.slice(last + 1).some((e) => TURN_ENDS.includes(String(e.hook_event_name)) || e.hook_event_name === 'CubefarmExit');
}

/** The CLI's exit code, when the events hold its exit. */
export function exitCode(events: Record<string, unknown>[]): number | null {
  const exit = events.filter((e) => e.hook_event_name === 'CubefarmExit').pop();
  return exit ? Number(exit.code) || 0 : null;
}

/** Waits after a dropped connection: 1, 2, 4… seconds, at most 30. */
export const backoff = (tries: number) => Math.min(30_000, 1000 * 2 ** Math.min(tries, 5));

// ---------- when the office is ready for events ----------

let ready!: () => void;
const hooksOpen = new Promise<void>((resolve) => (ready = resolve));

/** The office follows its sessions again after starting: events that waited for it come in (as ptyClient's hooksReady). */
export function boxHooksReady() {
  ready();
}

// ---------- the terminal ----------

export interface BoxPtyOptions {
  api: BoxApi;
  boxId: string;
  token: string;
  cols: number;
  rows: number;
  /** A new CLI's environment, credentials included. */
  env?: Record<string, string>;
  /** Where to start reading its events file. */
  offset: number;
  /** Each event the CLI reported, in order (not its exit). */
  event(body: Record<string, unknown>): void;
  /** The handled offset or the session's meta changed: save it with the agent. */
  save(offset: number, turnAt: number, meta: unknown): void;
  /** The CLI is gone for good. */
  gone(): void;
  /** The office's connection to it dropped (false) or is back (true). */
  connection?(up: boolean): void;
}

const eventsFile = (dir: string) => `${dir}/events.jsonl`;

export class BoxPty implements Pty {
  readonly pid = 0;
  private term: BoxSession | null = null;
  private tail: BoxSession | null = null;
  private lines: EventLines;
  private dataCbs: ((data: string) => void)[] = [];
  private exitCbs: ((code: number) => void)[] = [];
  private stopped = false; // detached or killed: nothing more happens
  private exited = false;
  private meta: unknown = null;
  private termTries = 0;
  private tailTries = 0;
  private cols: number;
  private rows: number;

  constructor(
    private o: BoxPtyOptions,
    private dir: string,
  ) {
    this.lines = new EventLines(o.offset);
    this.cols = o.cols;
    this.rows = o.rows;
  }

  /** Start the CLI (new) or attach to the one running (attach); its events are read once the office is ready. */
  async open(mode: 'new' | 'attach'): Promise<void> {
    if (mode === 'new') await this.openTerm('new');
    else void this.openTerm('attach').catch(() => this.termEnded(null));
    void this.readEvents();
  }

  /** A CLI that's gone: hand on the events it left (read already), then its exit, once the office is ready. */
  replay(events: Record<string, unknown>[], at: { offset: number; turnAt: number }) {
    void hooksOpen.then(() => {
      if (this.stopped) return;
      for (const e of events) if (e.hook_event_name !== 'CubefarmExit') this.o.event(e);
      this.lines = new EventLines(at.offset, at.turnAt);
      this.o.save(at.offset, at.turnAt, this.meta);
      // Its session finishes on its own a few seconds after a finished turn; the exit follows that.
      setTimeout(() => this.fireExit(exitCode(events) ?? (finishedTurn(events) ? 0 : -1)), 6000);
    });
  }

  private async openTerm(mode: 'new' | 'attach') {
    const s = await this.o.api.session(this.o.boxId, {
      cmd: mode === 'new' ? tmuxStart(this.o.token, this.cols, this.rows) : tmuxAttach(this.o.token),
      env: mode === 'new' ? { ...BOX_ENV, ...this.o.env } : BOX_ENV,
      tty: true,
      cols: this.cols,
      rows: this.rows,
      onData: (d) => {
        if (!this.stopped) for (const cb of this.dataCbs) cb(d);
      },
    });
    if (this.stopped) return s.close();
    this.term = s;
    if (this.termTries) this.o.connection?.(true);
    this.termTries = 0;
    void s.done.then(() => this.termEnded(s));
  }

  /** The terminal's connection ended: the CLI exited, or the line dropped and it carries on in the Box. */
  private async termEnded(s: BoxSession | null) {
    if (this.stopped || this.exited || (s && this.term !== s)) return;
    this.term = null;
    let alive: boolean | null = null;
    try {
      alive = (await this.o.api.run(this.o.boxId, tmuxAlive(this.o.token), { timeoutMs: 30_000 })).output.includes('ALIVE');
    } catch {
      alive = null; // Upstash can't be reached: try again
    }
    if (this.stopped || this.exited) return;
    if (alive === false) {
      // Its exit event is on its way through the events file; a Box that paused or restarted never sends one.
      setTimeout(() => this.fireExit(-1), 15_000);
      return;
    }
    this.o.connection?.(false);
    setTimeout(() => {
      if (this.stopped || this.exited) return;
      this.openTerm('attach').catch(() => this.termEnded(null));
    }, backoff(this.termTries++));
  }

  private async readEvents() {
    await hooksOpen;
    while (!this.stopped && !this.exited) {
      const from = this.lines.offset;
      this.lines = new EventLines(from, this.lines.turnAt); // a line cut short by the drop is read again whole
      try {
        const s = await this.o.api.session(this.o.boxId, {
          cmd: `exec tail -c +${from + 1} -F ${sq(eventsFile(this.dir))} 2>/dev/null`,
          env: BOX_ENV,
          onData: (text) => this.handle(text),
        });
        this.tail = s;
        this.tailTries = 0;
        await s.done;
      } catch {
        // Upstash can't be reached: try again
      }
      this.tail = null;
      if (this.stopped || this.exited) return;
      await new Promise((r) => setTimeout(r, backoff(this.tailTries++)));
    }
  }

  private handle(text: string) {
    if (this.stopped || this.exited) return;
    let exit: number | null = null;
    for (const e of this.lines.push(text)) {
      if (e.hook_event_name === 'CubefarmExit') exit = Number(e.code) || 0;
      else this.o.event(e);
    }
    this.o.save(this.lines.offset, this.lines.turnAt, this.meta);
    if (exit !== null) this.fireExit(exit);
  }

  private fireExit(code: number) {
    if (this.exited || this.stopped) return;
    this.exited = true;
    this.close();
    this.o.gone();
    for (const cb of this.exitCbs) cb(code);
  }

  private close() {
    this.term?.close();
    this.tail?.close();
    this.term = null;
    this.tail = null;
  }

  write(data: string) {
    this.term?.write(data);
  }

  resize(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.term?.resize(cols, rows);
  }

  /** Stop the CLI and its tmux for good. */
  kill() {
    if (this.stopped) return;
    const wasRunning = !this.exited;
    this.stopped = true;
    this.close();
    void this.o.api.run(this.o.boxId, tmuxKill(this.o.token), { timeoutMs: 60_000 }).catch(() => undefined);
    this.o.gone();
    if (wasRunning) for (const cb of this.exitCbs) cb(-1);
  }

  /** The office is closing: let go of the CLI, which carries on in the Box. */
  detach() {
    this.stopped = true;
    this.close();
  }

  setMeta(meta: unknown) {
    this.meta = meta;
    if (!this.stopped && !this.exited) this.o.save(this.lines.offset, this.lines.turnAt, meta);
  }

  onData(cb: (data: string) => void) {
    this.dataCbs.push(cb);
  }

  onExit(cb: (code: number) => void) {
    this.exitCbs.push(cb);
  }
}

// ---------- picking CLIs up after a restart ----------

export interface BoxCliLook {
  /** Its tmux is still running in the Box. */
  alive: boolean;
  /** Events from the record's last turn end on (read when it isn't alive). */
  events: Record<string, unknown>[];
  /** Where reading carries on after those events. */
  offset: number;
  turnAt: number;
}

/** Where a picked-up CLI's events are read again from: its last turn end, which may not have been wrapped up. */
export const readFrom = (rec: BoxCliRecord) => Math.min(rec.turnAt ?? rec.offset, rec.offset);

/** How a recorded CLI is doing: alive in its Box, or gone (with what it reported since its last turn end). */
export async function lookAtBoxCli(api: BoxApi, rec: BoxCliRecord): Promise<BoxCliLook> {
  const from = readFrom(rec);
  const info = await api.get(rec.boxId);
  if (!info) return { alive: false, events: [], offset: from, turnAt: from };
  if (info.status === 'paused') await api.resume(rec.boxId);
  else if ((await api.run(rec.boxId, tmuxAlive(rec.token), { timeoutMs: 30_000 })).output.includes('ALIVE')) return { alive: true, events: [], offset: from, turnAt: from };
  // Gone (a paused Box loses its tmux): what it left in its events file.
  const lines = new EventLines(from);
  const events: Record<string, unknown>[] = [];
  for (let at = from; ; ) {
    const chunk = await api.read(rec.boxId, eventsFile(rec.dir), { offset: at, length: 4 * 1024 * 1024 });
    if (!chunk) break;
    events.push(...lines.push(chunk));
    at += chunk.length;
    if (chunk.length < 4 * 1024 * 1024) break;
  }
  return { alive: false, events, offset: lines.offset, turnAt: lines.turnAt };
}

/** Stop the office's tmux servers in a Box that no record names (a CLI started just before a crash). */
export async function sweepStrayClis(api: BoxApi, boxId: string, keepTokens: string[]): Promise<number> {
  const keep = new Set(keepTokens.map(tmuxSocket));
  const running = (await api.run(boxId, tmuxList(), { timeoutMs: 30_000 })).output.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('cf-'));
  let n = 0;
  for (const socket of running) {
    if (keep.has(socket)) continue;
    await api.run(boxId, `tmux -L ${sq(socket)} kill-server >/dev/null 2>&1; true`, { timeoutMs: 30_000 }).catch(() => undefined);
    n++;
  }
  return n;
}
