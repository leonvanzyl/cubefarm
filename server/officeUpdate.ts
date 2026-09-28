import fs from 'node:fs/promises';
import path from 'node:path';
import { HOME_DIR } from './config.ts';
import { git } from './exec.ts';
import type { OfficeUpdateState } from '../shared/types.ts';

// The office updating itself (#37). The server only decides when: it drains (starts nothing new, lets running
// sessions finish) and then hands the update to the launcher (scripts/office.mjs), which pulls, installs, builds and
// restarts it. Contract with the launcher:
//   server → launcher  { type: 'office:update', from: '<full HEAD sha>' }   once drained
//   launcher → server  { type: 'office:shutdown' }                          run shutdown(), then exit 0
//   <SWARM_HOME>/last-update.json = { from, to, ok, error?, installed, built, at }, read and deleted on startup

/** Sessions still running this long after draining started are stopped, and the update goes ahead. */
export const DRAIN_TIMEOUT_MS = 20 * 60_000;
/** Later: ask again after this long, or sooner when a newer commit lands. */
export const POSTPONE_MS = 2 * 60 * 60_000;

/** Started by the launcher: an IPC channel and SWARM_LAUNCHER=1. Anything else (tsx, the demo, QA) only reports. */
export function underLauncher(proc: { send?: unknown; env: Record<string, string | undefined> } = process): boolean {
  return typeof proc.send === 'function' && proc.env.SWARM_LAUNCHER === '1';
}

export interface DrainInput {
  now: number;
  behind: number; // commits the office's folder can fast-forward by (0: nothing to update)
  launcher: boolean;
  autoUpdate: boolean;
  requested: boolean; // the manager pressed Update now
  postponedUntil: number | null; // the manager pressed Later
  postponedBehind: number; // how far behind it was then: a newer commit ends the postponement
  failed: string | null; // the last update's error
  failedBehind: number | null; // how far behind it was after that failure: only a newer commit retries on its own
  drainingSince: number | null;
  sent: boolean; // handed to the launcher
  running: number; // sessions still running
}

export interface DrainDecision {
  state: OfficeUpdateState;
  drainingSince: number | null;
  /** Hand the update to the launcher now: nothing is running, or the drain timed out (`timedOut`). */
  send: boolean;
  timedOut: boolean;
}

/**
 * Where the office's own update stands and what to do about it. Draining (start nothing new, let running sessions
 * finish) happens when there is an update, a launcher, and either autoUpdate is on or the manager pressed Update now.
 * Later holds an automatic update back for POSTPONE_MS or until a newer commit lands ('waiting'); a failed update is
 * only retried automatically for a newer commit.
 */
export function drainDecision(s: DrainInput): DrainDecision {
  const idle = (state: OfficeUpdateState): DrainDecision => ({ state, drainingSince: null, send: false, timedOut: false });
  if (s.sent) return { state: 'updating', drainingSince: s.drainingSince, send: false, timedOut: false };
  if (s.behind <= 0) return idle('none');
  if (!s.launcher) return idle(s.failed ? 'failed' : 'available');
  const postponed = s.postponedUntil !== null && s.now < s.postponedUntil && s.behind <= s.postponedBehind;
  const failedHold = s.failed !== null && s.behind <= (s.failedBehind ?? Infinity);
  const due = s.requested || (s.autoUpdate && !postponed && !failedHold);
  if (!due) return idle(s.failed ? 'failed' : s.autoUpdate && postponed ? 'waiting' : 'available');
  const since = s.drainingSince ?? s.now;
  const timedOut = s.running > 0 && s.now - since >= DRAIN_TIMEOUT_MS;
  return { state: 'draining', drainingSince: since, send: s.running === 0 || timedOut, timedOut };
}

/** What the launcher leaves behind after an update. */
export interface LastUpdate {
  from: string;
  to: string;
  ok: boolean;
  error?: string;
  installed: boolean;
  built: boolean;
  at: number;
}

/** Parse last-update.json; null when it isn't one. */
export function parseLastUpdate(raw: string): LastUpdate | null {
  try {
    const u = JSON.parse(raw) as Partial<LastUpdate>;
    if (!u || typeof u.from !== 'string' || typeof u.ok !== 'boolean') return null;
    return {
      from: u.from,
      to: typeof u.to === 'string' ? u.to : '',
      ok: u.ok,
      error: typeof u.error === 'string' ? u.error : undefined,
      installed: !!u.installed,
      built: !!u.built,
      at: Number(u.at) || Date.now(),
    };
  } catch {
    return null;
  }
}

/** Read and delete <home>/last-update.json, so its phone message is posted once. */
export async function takeLastUpdate(home: string): Promise<LastUpdate | null> {
  const file = path.join(home, 'last-update.json');
  const raw = await fs.readFile(file, 'utf8').catch(() => null);
  if (raw === null) return null;
  await fs.rm(file, { force: true, maxRetries: 3 }).catch(() => undefined);
  return parseLastUpdate(raw);
}

/** The phone message for an update: "Updated the office from abc1234 to def5678 (3 commits)" or why it failed. */
export function lastUpdateMessage(u: LastUpdate, commits: number | null): string {
  if (!u.ok) return `⚠️ Update failed and was rolled back: ${u.error || 'unknown error'}`;
  const n = commits === null ? '' : ` (${commits} commit${commits === 1 ? '' : 's'})`;
  return `⬆️ Updated the office from ${u.from.slice(0, 7)} to ${u.to.slice(0, 7)}${n}`;
}

// ---------- the running office ----------

/** The running office's own checkout and its launcher. The demo fakes it. */
export interface OfficeHost {
  launcher: boolean;
  /** Full sha of the commit the office runs, or null when it doesn't run from a git checkout (e.g. installed from npm). */
  head(): Promise<string | null>;
  /** Is this floor checkout the office's own folder? Syncing it would restart the office mid-work, so it's only reported. */
  isOwnFolder(dir: string): boolean;
  /** Commits between two shas of the office's folder, or null when git can't tell. */
  commitsBetween(from: string, to: string): Promise<number | null>;
  /** Read and delete the result the launcher left from the last update. */
  takeLastUpdate(): Promise<LastUpdate | null>;
  /** Hand the drained office to the launcher, which restarts it (resolves null). The demo resolves with a fake result. */
  update(from: string): Promise<LastUpdate | null>;
}

const OFFICE_DIR = path.resolve(import.meta.dirname, '..');
const isSamePath = (a: string, b: string) => (process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));

export const realOffice: OfficeHost = {
  launcher: underLauncher(),
  head: () => git(['rev-parse', 'HEAD'], { cwd: OFFICE_DIR }).catch(() => null),
  isOwnFolder: (dir) => isSamePath(dir, OFFICE_DIR),
  commitsBetween: (from, to) =>
    git(['rev-list', '--count', `${from}..${to}`], { cwd: OFFICE_DIR })
      .then(Number)
      .catch(() => null),
  takeLastUpdate: () => takeLastUpdate(HOME_DIR),
  async update(from) {
    if (!underLauncher()) throw new Error('The office was not started by the launcher');
    await new Promise<void>((resolve, reject) => process.send!({ type: 'office:update', from }, undefined, {}, (err) => (err ? reject(err) : resolve())));
    return null;
  },
};
