import type { Backend } from './backend.ts';
import { PORT } from './config.ts';
import { HttpError } from './httpError.ts';
import { PREVIEW_SLUG, portOpen, type PreviewHandle } from './previewRunner.ts';
import type { PreviewConfig, PreviewStatus, PreviewView, PullInfo } from '../shared/types.ts';

// One preview per floor: the floor's app, run from its own worktree on a port reserved for the floor.
// Only the config is persisted; after a restart every preview reads 'stopped'.

/** What the previews need to know about a floor. */
export interface PreviewFloor {
  id: string;
  fullName: string;
  defaultBranch: string;
  floor: number;
  preview: PreviewConfig;
}

interface Run {
  status: PreviewStatus;
  port: number | null; // the port of the current or last run
  ref: string | null;
  pr: number | null;
  commit: string | null;
  startedAt: number | null;
  error: string | null;
  log: string[];
  handle: PreviewHandle | null;
  gen: number; // bumped by every start / stop; callbacks from older runs are ignored
}

const PREVIEW_BASE_PORT = 6300;
const LOG_KEEP = 200;
const LOG_VIEW = 40;
const ACTIVE: PreviewStatus[] = ['preparing', 'installing', 'starting', 'running'];

/** Never the office itself, the other office port, or the agents' range. */
const forbidden = (p: number) => p === PORT || p === 4317 || p === 5317 || (p >= 5200 && p <= 5899);

export const DEFAULT_PREVIEW: PreviewConfig = { command: null, env: {} };

/** Check a previewCommand / previewEnv patch; throws 400 on bad input. undefined: not in the patch. */
export function parsePreviewPatch(command: unknown, env: unknown): Partial<PreviewConfig> {
  const out: Partial<PreviewConfig> = {};
  if (command !== undefined) {
    if (command !== null && typeof command !== 'string') throw new HttpError(400, 'previewCommand must be a string or null');
    const c = (command ?? '').trim();
    if (c.length > 2000) throw new HttpError(400, 'previewCommand is too long');
    out.command = c || null;
  }
  if (env !== undefined) {
    if (env === null) out.env = {};
    else {
      if (typeof env !== 'object' || Array.isArray(env)) throw new HttpError(400, 'previewEnv must be an object of string values');
      const entries = Object.entries(env as Record<string, unknown>);
      if (entries.length > 50) throw new HttpError(400, 'previewEnv has too many variables');
      for (const [k, v] of entries) {
        if (typeof v !== 'string') throw new HttpError(400, `previewEnv.${k} must be a string`);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new HttpError(400, `"${k}" is not a valid environment variable name`);
        if (/^(ANTHROPIC_|CLAUDE)/i.test(k)) throw new HttpError(400, `${k} can't be set on a preview: Claude credentials never reach the apps the office runs`);
        if (v.length > 4000) throw new HttpError(400, `previewEnv.${k} is too long`);
      }
      out.env = Object.fromEntries(entries) as Record<string, string>;
    }
  }
  return out;
}

export class Previews {
  private runs = new Map<string, Run>();
  private hasDefault = new Map<string, boolean>(); // floor id -> package.json in its checkout
  private emitTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private backend: Backend,
    private hooks: { emit(repoId: string): void; pulls(repoId: string): PullInfo[] },
  ) {}

  private run(id: string): Run {
    let r = this.runs.get(id);
    if (!r) {
      r = { status: 'stopped', port: null, ref: null, pr: null, commit: null, startedAt: null, error: null, log: [], handle: null, gen: 0 };
      this.runs.set(id, r);
    }
    return r;
  }

  /** The floor's reserved port: 6300 + floor, moved up by 100 while it clashes with the office or another preview. */
  portFor(f: PreviewFloor): number {
    const active = this.runs.get(f.id);
    if (active?.port && ACTIVE.includes(active.status)) return active.port;
    const taken = new Set([...this.runs.entries()].filter(([id, r]) => id !== f.id && r.port && ACTIVE.includes(r.status)).map(([, r]) => r.port!));
    let p = PREVIEW_BASE_PORT + f.floor;
    while (forbidden(p) || taken.has(p)) p += 100;
    return p;
  }

  view(f: PreviewFloor): PreviewView {
    const r = this.runs.get(f.id);
    let status: PreviewStatus = r?.status ?? 'stopped';
    if (status === 'stopped' && !f.preview.command && this.hasDefault.get(f.id) === false) status = 'unconfigured';
    const port = r?.port ?? this.portFor(f);
    return {
      status,
      port,
      url: status === 'running' ? `http://localhost:${port}/` : null,
      ref: r?.ref ?? null,
      pr: r?.pr ?? null,
      commit: r?.commit ?? null,
      startedAt: r?.startedAt ?? null,
      error: r?.error ?? null,
      logTail: (r?.log ?? []).slice(-LOG_VIEW),
    };
  }

  /** The floor's preview is being set up or running: its worktree is in use. */
  active(f: PreviewFloor): boolean {
    return ACTIVE.includes(this.runs.get(f.id)?.status ?? 'stopped');
  }

  /** Re-check whether a floor without a command has a package.json to fall back on. */
  async refreshDefault(f: PreviewFloor) {
    const has = await this.backend.previews.hasDefault(f.fullName).catch(() => true);
    if (this.hasDefault.get(f.id) === has) return;
    this.hasDefault.set(f.id, has);
    this.hooks.emit(f.id);
  }

  /** Start the floor's preview on the default branch or an open PR, replacing whatever it is running now. */
  async start(f: PreviewFloor, title: string, pr?: number | null): Promise<PreviewView> {
    if (pr !== undefined && pr !== null && (!Number.isInteger(pr) || pr <= 0)) throw new HttpError(400, `Invalid pull request number: ${pr}`);
    if (pr) await this.checkOpen(f, pr);
    const r = this.run(f.id);
    const gen = ++r.gen;
    await this.halt(f, r);
    if (gen !== r.gen) return this.view(f); // another start or a stop came in meanwhile

    const port = this.portFor(f);
    const ref = pr ? `PR #${pr}` : f.defaultBranch;
    Object.assign(r, { port, ref, pr: pr ?? null, commit: null, startedAt: Date.now(), error: null, log: [] });
    if (await portOpen(port)) {
      if (gen !== r.gen) return this.view(f);
      Object.assign(r, { status: 'error', error: `Port ${port} is already in use by another program. The office won't stop it; free the port and try again.` });
      this.hooks.emit(f.id);
      throw new HttpError(409, r.error!);
    }
    if (gen !== r.gen) return this.view(f);
    r.status = 'preparing';
    this.hooks.emit(f.id);

    const live = () => gen === r.gen;
    r.handle = this.backend.previews.start(
      { fullName: f.fullName, defaultBranch: f.defaultBranch, pr: pr ?? null, port, command: f.preview.command, env: { ...f.preview.env }, title: `${title} · ${ref}` },
      {
        status: (s) => {
          if (!live()) return;
          r.status = s;
          this.hooks.emit(f.id);
        },
        commit: (sha) => {
          if (!live()) return;
          r.commit = sha || null;
          this.hooks.emit(f.id);
        },
        log: (lines) => {
          if (!live()) return;
          r.log.push(...lines.map((l) => l.slice(0, 500)));
          if (r.log.length > LOG_KEEP) r.log.splice(0, r.log.length - LOG_KEEP);
          this.emitSoon(f.id);
        },
        failed: (message, unconfigured) => {
          if (!live()) return;
          r.handle = null;
          Object.assign(r, { status: unconfigured ? 'unconfigured' : 'error', error: message });
          if (unconfigured) this.hasDefault.set(f.id, false);
          this.hooks.emit(f.id);
          // Anything the app left behind in its worktree or on its port goes too.
          void this.backend.releaseDesk(f.fullName, PREVIEW_SLUG, port).catch(() => undefined);
        },
      },
    );
    return this.view(f);
  }

  /** Stop the floor's preview and free its port. */
  async stop(f: PreviewFloor): Promise<PreviewView> {
    const r = this.run(f.id);
    r.gen++;
    await this.halt(f, r);
    Object.assign(r, { status: 'stopped', error: null, startedAt: null });
    this.hooks.emit(f.id);
    return this.view(f);
  }

  /** The floor is leaving the building: stop its preview and remove the preview worktree. */
  async remove(f: PreviewFloor) {
    const main = this.backend.mainDir(f.fullName); // now: the floor points away from its folder before the preview stops
    const r = this.runs.get(f.id);
    if (r) {
      r.gen++;
      await this.halt(f, r);
    }
    this.runs.delete(f.id);
    this.hasDefault.delete(f.id);
    clearTimeout(this.emitTimers.get(f.id));
    await this.backend.removeDesk(f.fullName, PREVIEW_SLUG, main).catch(() => undefined);
  }

  /** Server shutdown: stop every running preview. */
  async stopAll(floors: PreviewFloor[]) {
    await Promise.all(
      floors.map((f) => {
        const r = this.runs.get(f.id);
        if (!r) return;
        r.gen++;
        return this.halt(f, r);
      }),
    );
  }

  /** Server start: nothing is running yet, so anything alive in a preview worktree or on a preview port is an orphan. */
  async clearOrphans(floors: PreviewFloor[]) {
    await Promise.all(floors.map((f) => this.backend.releaseDesk(f.fullName, PREVIEW_SLUG, this.portFor(f)).catch(() => undefined)));
  }

  private async halt(f: PreviewFloor, r: Run) {
    const handle = r.handle;
    r.handle = null;
    if (!handle) return;
    await handle.stop().catch(() => undefined);
    if (!r.port) return;
    await this.backend.releaseDesk(f.fullName, PREVIEW_SLUG, r.port).catch(() => undefined);
    // Windows can take a moment to let go of a killed process's socket.
    for (let i = 0; i < 20 && (await portOpen(r.port)); i++) await new Promise((res) => setTimeout(res, 250));
  }

  private async checkOpen(f: PreviewFloor, pr: number) {
    const known = this.hooks.pulls(f.id).find((p) => p.number === pr);
    const state = known?.state ?? (await this.backend.prDetails(f.fullName, pr).then((d) => d.state).catch(() => null));
    if (!state) throw new HttpError(404, `${f.fullName} has no pull request #${pr}`);
    if (state !== 'OPEN') throw new HttpError(400, `Pull request #${pr} is ${state.toLowerCase()}, not open`);
  }

  /** Log lines arrive in bursts (npm install); send them at most once a second. */
  private emitSoon(id: string) {
    if (this.emitTimers.has(id)) return;
    this.emitTimers.set(
      id,
      setTimeout(() => {
        this.emitTimers.delete(id);
        if (this.runs.has(id)) this.hooks.emit(id);
      }, 1000),
    );
  }
}
