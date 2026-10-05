import fs from 'node:fs/promises';
import path from 'node:path';
import xtermHeadless from '@xterm/headless';
import xtermSerialize from '@xterm/addon-serialize';
import type { WebSocket } from 'ws';
import type { TermClientMessage, TermServerMessage } from '../shared/types.ts';

// An agent's terminal: a headless xterm that mirrors everything its CLI printed, so a browser that opens it late (or
// reconnects) gets the same screen and scrollback, plus the viewers watching it live. The CLI itself is bound as the
// sink: keystrokes and resizes from viewers go to whichever CLI process is running in it right now.

const { Terminal } = xtermHeadless;
const { SerializeAddon } = xtermSerialize;

export const TERM_COLS = 120;
export const TERM_ROWS = 32;
const SCROLLBACK = 5000;
/** A viewer this far behind stops getting output and is sent a fresh snapshot once it catches up. */
const STALE_BYTES = 4 * 1024 * 1024;
/** The mouse encodings (SGR, SGR pixels) the serialize addon doesn't restore on its own. */
const MOUSE_ENCODINGS = [1006, 1016];

/** Where a terminal's keystrokes and size go: the running CLI. */
export interface TerminalSink {
  write(data: string): void;
  resize(cols: number, rows: number): void;
}

const clamp = (n: unknown, lo: number, hi: number, dflt: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt;
};

export class AgentTerminal {
  cols = TERM_COLS;
  rows = TERM_ROWS;
  /** Output arrived since the last save. */
  dirty = false;
  /** When output last arrived (the watchdog's sign of life for CLIs that only report a turn's end). */
  outputAt = 0;
  /**
   * Closes a CLI left waiting at its prompt after its task, settling once it has exited (set by the runtime that left
   * it there; null while a CLI drives a session).
   */
  releaseIdle: (() => Promise<void>) | null = null;
  /** Something the manager typed at that waiting prompt: the office takes it on as a follow-up (true) or refuses. */
  onIdlePrompt: ((text: string) => boolean) | null = null;
  /** Keys a viewer typed, after they went to the CLI (the runtime watches for Esc interrupting a turn). */
  onInput: ((data: string) => void) | null = null;
  private term = new Terminal({ cols: TERM_COLS, rows: TERM_ROWS, scrollback: SCROLLBACK, allowProposedApi: true, scrollOnEraseInDisplay: true });
  private ser = new SerializeAddon();
  private viewers = new Map<WebSocket, { stale: boolean; queued: string[] | null }>();
  private sink: TerminalSink | null = null;
  private mouseEncoding: number | null = null;
  private resync: NodeJS.Timeout | null = null;

  constructor() {
    this.term.loadAddon(this.ser);
    const decset = (on: boolean) => (params: (number | number[])[]) => {
      for (const p of params) if (typeof p === 'number' && MOUSE_ENCODINGS.includes(p)) this.mouseEncoding = on ? p : null;
      return false; // xterm still switches the mode itself
    };
    this.term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, decset(true));
    this.term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, decset(false));
  }

  /** Output from the CLI (or a note from the office): into the mirror and out to everyone watching. */
  write(data: string) {
    if (!data) return;
    this.term.write(data);
    this.dirty = true;
    this.outputAt = Date.now();
    this.send({ t: 'data', data });
  }

  /** A dim line from the office itself, e.g. between sessions. */
  note(text: string) {
    this.write(`\r\n\x1b[2m${text}\x1b[0m\r\n`);
  }

  get live() {
    return this.sink !== null;
  }

  /** The CLI asked for application cursor keys: arrows are sent as ESC O A… rather than ESC [ A… */
  get appCursor() {
    return this.term.modes.applicationCursorKeysMode;
  }

  /** The running CLI, or null when it exits. */
  bind(sink: TerminalSink | null) {
    this.sink = sink;
    sink?.resize(this.cols, this.rows);
    this.send({ t: 'live', live: sink !== null });
  }

  resize(cols: number, rows: number) {
    const c = clamp(cols, 20, 400, this.cols);
    const r = clamp(rows, 5, 200, this.rows);
    if (c === this.cols && r === this.rows) return;
    this.cols = c;
    this.rows = r;
    this.term.resize(c, r);
    this.sink?.resize(c, r);
  }

  /** Everything a fresh terminal needs to show the same screen: scrollback, colours, cursor and modes. */
  snapshot(): string {
    return this.ser.serialize({ scrollback: SCROLLBACK }) + (this.mouseEncoding ? `\x1b[?${this.mouseEncoding}h` : '');
  }

  /** The visible rows as plain text, for spotting prompts the CLI is waiting on. */
  screen(): string {
    const b = this.term.buffer.active;
    const rows: string[] = [];
    for (let i = b.viewportY; i < b.viewportY + this.rows; i++) rows.push(b.getLine(i)?.translateToString(true) ?? '');
    return rows.join('\n');
  }

  /** Written to disk so a restarted office still shows what each agent did. */
  /** Resolves once everything written so far is parsed (xterm parses asynchronously). */
  flush(): Promise<void> {
    return new Promise((resolve) => this.term.write('', resolve));
  }

  async save(file: string) {
    this.dirty = false;
    await this.flush();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(`${file}.tmp`, this.snapshot());
    await fs.rename(`${file}.tmp`, file);
  }

  async load(file: string) {
    const data = await fs.readFile(file, 'utf8').catch(() => '');
    if (!data) return;
    this.term.write(data);
    this.note('(the office restarted)');
    this.dirty = false;
  }

  // ---------- viewers ----------

  attach(ws: WebSocket) {
    // xterm parses writes asynchronously: snapshot once everything written so far is parsed, and hold back what
    // arrives meanwhile so it follows the snapshot instead of going missing.
    const viewer = { stale: false, queued: [] as string[] | null };
    this.viewers.set(ws, viewer);
    this.term.write('', () => {
      const queued = viewer.queued ?? [];
      viewer.queued = null;
      this.sendTo(ws, { t: 'snapshot', data: this.snapshot(), cols: this.cols, rows: this.rows, live: this.live });
      for (const json of queued) if (ws.readyState === ws.OPEN) ws.send(json);
    });
    ws.on('message', (raw) => {
      let msg: TermClientMessage;
      try {
        msg = JSON.parse(String(raw)) as TermClientMessage;
      } catch {
        return;
      }
      if (msg.t === 'input' && typeof msg.data === 'string') {
        const data = msg.data.slice(0, 64 * 1024);
        this.sink?.write(data);
        this.onInput?.(data);
      } else if (msg.t === 'resize') {
        this.resize(msg.cols, msg.rows);
        for (const other of this.viewers.keys()) if (other !== ws) this.sendTo(other, { t: 'size', cols: this.cols, rows: this.rows });
      }
    });
    ws.on('close', () => this.viewers.delete(ws));
  }

  dispose() {
    for (const ws of this.viewers.keys()) ws.close();
    this.viewers.clear();
    if (this.resync) clearTimeout(this.resync);
    this.sink = null;
    this.term.dispose();
  }

  private send(msg: TermServerMessage) {
    if (this.viewers.size === 0) return;
    const json = JSON.stringify(msg);
    for (const [ws, v] of this.viewers) {
      if (ws.readyState !== ws.OPEN || v.stale) continue;
      if (v.queued) {
        v.queued.push(json);
        continue;
      }
      if (ws.bufferedAmount > STALE_BYTES) {
        v.stale = true;
        this.scheduleResync();
        continue;
      }
      ws.send(json);
    }
  }

  private sendTo(ws: WebSocket, msg: TermServerMessage) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  /** Viewers that fell behind get a fresh snapshot once their socket has drained, instead of an ever-growing backlog. */
  private scheduleResync() {
    if (this.resync) return;
    this.resync = setTimeout(() => {
      this.resync = null;
      let waiting = false;
      for (const [ws, v] of this.viewers) {
        if (!v.stale) continue;
        if (ws.bufferedAmount > STALE_BYTES / 4) {
          waiting = true;
          continue;
        }
        v.stale = false;
        this.sendTo(ws, { t: 'snapshot', data: this.snapshot(), cols: this.cols, rows: this.rows, live: this.live });
      }
      if (waiting) this.scheduleResync();
    }, 1000);
  }
}
