// Upstash Box (docs/cloud.md): the office's only door to the Box SDK. Everything else talks to a BoxApi, so the demo
// (server/demo.ts) and the tests can stand in for Upstash. Credentials never go into a Box's creation options or its
// files: they travel only as the environment of one command (run, session).

import { Box, BoxError } from '@upstash/box';
import type { BoxSize } from '../shared/types.ts';

export type BoxState = 'creating' | 'idle' | 'running' | 'paused' | 'error' | 'deleted';

export interface BoxInfo {
  id: string;
  name: string;
  labels: string[];
  status: BoxState;
}

export interface BoxRun {
  code: number;
  output: string;
}

/** A command held open in a Box (a terminal). It ends when the command exits or the connection drops. */
export interface BoxSession {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
  /** The command's exit code, or -1 when the connection dropped first. */
  done: Promise<number>;
}

export interface BoxSessionOptions {
  cmd: string;
  env?: Record<string, string>;
  tty?: boolean;
  cols?: number;
  rows?: number;
  onData: (data: string) => void;
}

export interface BoxFile {
  name: string;
  size: number;
  modified: number;
}

export interface BoxApi {
  /** Every Box on the account (they all count towards the plan's limit); the office's carry the `cubefarm` label. */
  list(): Promise<BoxInfo[]>;
  create(o: { name: string; labels: string[]; size: BoxSize }): Promise<BoxInfo>;
  /** null: there's no such Box any more. */
  get(id: string): Promise<BoxInfo | null>;
  resume(id: string): Promise<void>;
  pause(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Run a bash script to the end. `env` is that command's environment only. */
  run(id: string, script: string, o?: { env?: Record<string, string>; timeoutMs?: number }): Promise<BoxRun>;
  /** A file's contents (base64 when asked), from `offset`; null when it isn't there. */
  read(id: string, file: string, o?: { offset?: number; length?: number; base64?: boolean }): Promise<string | null>;
  write(id: string, file: string, content: string): Promise<void>;
  files(id: string, dir: string): Promise<BoxFile[]>;
  session(id: string, o: BoxSessionOptions): Promise<BoxSession>;
  /** Start the Box's own Chromium (it starts with a first tab) for Playwright to attach to; false when it has none. */
  browser(id: string): Promise<boolean>;
}

/** What went wrong talking to Upstash, worded for the manager. */
export class CloudError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'limit' | 'gone' | 'other',
  ) {
    super(message);
  }
}

/** Upstash's own error, as one the manager can act on. */
export function cloudError(err: unknown, what: string): CloudError {
  if (err instanceof CloudError) return err;
  const status = err instanceof BoxError ? err.statusCode : undefined;
  const text = (err as Error)?.message ?? String(err);
  if (status === 401 || status === 403 || /unauthori[sz]ed|invalid api key|forbidden/i.test(text)) {
    return new CloudError('Upstash turned the Box API key away. Copy it again from console.upstash.com → Box → API Keys.', 'auth');
  }
  if (status === 402 || status === 429 || /limit|quota|concurrent|exceed/i.test(text)) {
    return new CloudError(`Upstash refused to ${what}: your plan's Box limit or usage is used up (${text.slice(0, 160)}).`, 'limit');
  }
  if (status === 404 || /not found/i.test(text)) return new CloudError(`That Box is gone (${text.slice(0, 120)}).`, 'gone');
  return new CloudError(`Couldn't ${what} on Upstash: ${text.slice(0, 200)}`, 'other');
}

const STATES: BoxState[] = ['creating', 'idle', 'running', 'paused', 'error', 'deleted'];
const state = (s: unknown): BoxState => (STATES.includes(s as BoxState) ? (s as BoxState) : 'error');

/** Each command's output, decoded across chunks (a character can be split between two). */
function decoder(onText: (text: string) => void) {
  const d = new TextDecoder('utf-8');
  return (bytes: Uint8Array) => {
    const text = d.decode(bytes, { stream: true });
    if (text) onText(text);
  };
}

/** The real Upstash account behind an API key. */
export function upstashBoxes(apiKey: string): BoxApi {
  const conn = { apiKey, enableTelemetry: false };
  const boxes = new Map<string, Box>();
  const box = async (id: string) => {
    let b = boxes.get(id);
    if (!b) {
      b = await Box.get(id, { ...conn, timeout: 60_000 });
      boxes.set(id, b);
    }
    return b;
  };
  const guard = async <T>(what: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      throw cloudError(err, what);
    }
  };
  const openSession = async (id: string, o: BoxSessionOptions): Promise<BoxSession> => {
    const b = await box(id);
    const onData = decoder(o.onData);
    const handle = await b.exec.session({
      cmd: o.cmd,
      tty: o.tty,
      cols: o.cols,
      rows: o.rows,
      env: Object.entries(o.env ?? {}).map(([k, v]) => `${k}=${v}`),
      onStdout: onData,
      onStderr: onData,
    });
    return {
      write: (data) => handle.write(data),
      resize: (cols, rows) => handle.resize(rows, cols),
      close: () => handle.close(),
      done: handle.wait().catch(() => -1),
    };
  };
  return {
    list: () => guard('list your Boxes', async () => (await Box.list(conn)).map((d) => ({ id: d.id, name: d.name ?? '', labels: d.labels ?? [], status: state(d.status) }))),
    create: (o) =>
      guard('create a Box', async () => {
        const b = await Box.create({ ...conn, name: o.name, labels: o.labels, size: o.size, runtime: 'node', browser: true, timeout: 300_000 });
        boxes.set(b.id, b);
        return { id: b.id, name: o.name, labels: o.labels, status: 'running' };
      }),
    get: async (id) => {
      try {
        const b = await box(id);
        const { status } = await b.getStatus();
        return { id, name: '', labels: [], status: state(status) };
      } catch (err) {
        const e = cloudError(err, 'look up a Box');
        if (e.kind === 'gone') {
          boxes.delete(id);
          return null;
        }
        throw e;
      }
    },
    resume: (id) => guard('resume a Box', async () => (await box(id)).resume()),
    pause: (id) => guard('pause a Box', async () => (await box(id)).pause()),
    remove: (id) =>
      guard('delete a Box', async () => {
        await Box.delete({ ...conn, boxIds: id });
        boxes.delete(id);
      }),
    run: (id, script, o = {}) =>
      guard('run a command in a Box', async () => {
        let output = '';
        const s = await openSession(id, { cmd: script, env: o.env, onData: (t) => (output += t) });
        const timer = setTimeout(() => s.close(), o.timeoutMs ?? 600_000);
        try {
          return { code: await s.done, output };
        } finally {
          clearTimeout(timer);
        }
      }),
    read: async (id, file, o = {}) => {
      try {
        const b = await box(id);
        return await b.files.read(file, { ...(o.base64 ? { encoding: 'base64' as const } : {}), ...(o.offset ? { offset: o.offset } : {}), ...(o.length ? { length: o.length } : {}) });
      } catch (err) {
        const e = cloudError(err, 'read a file in a Box');
        if (e.kind === 'gone' || /no such file|does not exist|ENOENT/i.test((err as Error).message ?? '')) return null;
        throw e;
      }
    },
    write: (id, file, content) => guard('write a file in a Box', async () => (await box(id)).files.write({ path: file, content })),
    files: async (id, dir) => {
      try {
        const list = await (await box(id)).files.list(dir);
        return list.filter((f) => !f.is_dir).map((f) => ({ name: f.name, size: f.size, modified: Date.parse(f.mod_time) || 0 }));
      } catch {
        return [];
      }
    },
    session: (id, o) => guard('open a terminal in a Box', () => openSession(id, o)),
    browser: async (id) => {
      try {
        const b = await box(id);
        if ((await b.browser.listTabs()).length) return true;
        await b.browser.tab.create('about:blank', { timeout: 30_000 });
        return true;
      } catch {
        return false;
      }
    },
  };
}
