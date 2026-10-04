import type { Backend } from './backend.ts';
import { PORT, PR_PREVIEW_IDLE_MS, PREVIEW_PORT } from './config.ts';
import { HttpError } from './httpError.ts';
import { PREVIEW_BRANCH, PREVIEW_SLUG, portOpen, type PreviewHandle, type PreviewJob } from './previewRunner.ts';
import { closedPrs, expired, freeSlot, MAX_PR_PREVIEWS, onScreen, pickEviction, prBranch, prKey, prPortCandidates, prSlug, WATCH_MS, type PrRunInfo } from './prTheatre.ts';
import { SyncProxies } from './syncProxy.ts';
import type { PreviewConfig, PreviewStatus, PreviewView, PrPreviewView, PullInfo } from '../shared/types.ts';

// One preview per floor: the floor's app, run from its own worktree on a port reserved for the floor. Beside them, the
// PR theatre: up to MAX_PR_PREVIEWS open PRs at once, each from a slot worktree of its own on its slot's ports.
// Only the config is persisted; after a restart every preview reads 'stopped' and the PR previews are gone.

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

/** A PR preview: which floor and slot it runs in, and when a viewer last had it on screen. */
interface PrRun extends Run {
  repoId: string;
  fullName: string;
  pr: number;
  slot: number;
  startedAt: number;
  viewedAt: number;
}

const LOG_KEEP = 200;
const LOG_VIEW = 40;
const ACTIVE: PreviewStatus[] = ['preparing', 'installing', 'starting', 'running'];

/** Never the office itself, the other office port, or the agents' range. */
const forbidden = (p: number) => p === PORT || p === 4317 || p === 5317 || (p >= 5200 && p <= 5899);

const deskKey = (repoId: string, slot: number) => `${repoId}|${slot}`;

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
  private prRuns = new Map<string, PrRun>(); // prKey(repoId, pr)
  private watches = new Map<string, { key: string | null; at: number }>(); // viewer id -> the PR preview on its screen
  private shown = new Set<string>(); // the PR previews the clients were last told are on screen
  private cleaning = new Map<string, Promise<void>>(); // deskKey -> a PR preview's stop and worktree removal
  private hasDefault = new Map<string, boolean>(); // floor id -> package.json in its checkout
  private emitTimers = new Map<string, NodeJS.Timeout>();
  private sync = new SyncProxies();

  constructor(
    private backend: Backend,
    private hooks: {
      emit(repoId: string): void;
      pulls(repoId: string): PullInfo[];
      emitPr(view: PrPreviewView): void;
      prRemoved(repoId: string, pr: number): void;
      /** Something the manager should hear about (a toast). */
      note(text: string): void;
    },
  ) {}

  private run(id: string): Run {
    let r = this.runs.get(id);
    if (!r) {
      r = { status: 'stopped', port: null, ref: null, pr: null, commit: null, startedAt: null, error: null, log: [], handle: null, gen: 0 };
      this.runs.set(id, r);
    }
    return r;
  }

  /** Ports held by previews being set up or running, other than `except`'s. */
  private takenPorts(except?: Run): Set<number> {
    return new Set([...this.runs.values(), ...this.prRuns.values()].filter((r) => r !== except && r.port && ACTIVE.includes(r.status)).map((r) => r.port!));
  }

  /** The floor's reserved port: 6300 + floor, moved up by 100 while it clashes with the office or another preview. */
  portFor(f: PreviewFloor): number {
    const active = this.runs.get(f.id);
    if (active?.port && ACTIVE.includes(active.status)) return active.port;
    const taken = this.takenPorts(active);
    let p = PREVIEW_PORT + f.floor;
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
    await this.halt(f.fullName, r, PREVIEW_SLUG);
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

    this.launch(r, gen, { ...this.job(f, pr ?? null, port, `${title} · ${ref}`), slug: PREVIEW_SLUG, branch: PREVIEW_BRANCH }, {
      emit: () => this.hooks.emit(f.id),
      emitSoon: () => this.emitSoon(f.id, () => this.runs.has(f.id) && this.hooks.emit(f.id)),
      unconfigured: () => this.hasDefault.set(f.id, false),
    });
    return this.view(f);
  }

  /** Stop the floor's preview and free its port. */
  async stop(f: PreviewFloor): Promise<PreviewView> {
    const r = this.run(f.id);
    r.gen++;
    await this.halt(f.fullName, r, PREVIEW_SLUG);
    Object.assign(r, { status: 'stopped', error: null, startedAt: null });
    this.hooks.emit(f.id);
    return this.view(f);
  }

  /** The floor is leaving the building: stop its previews and remove their worktrees. */
  async remove(f: PreviewFloor) {
    const main = this.backend.mainDir(f.fullName); // now: the floor points away from its folder before the preview stops
    const r = this.runs.get(f.id);
    if (r) {
      r.gen++;
      await this.halt(f.fullName, r, PREVIEW_SLUG);
    }
    this.runs.delete(f.id);
    this.hasDefault.delete(f.id);
    clearTimeout(this.emitTimers.get(f.id));
    const prs = [...this.prRuns.values()].filter((x) => x.repoId === f.id);
    await Promise.all([this.backend.removeDesk(f.fullName, PREVIEW_SLUG, main).catch(() => undefined), ...prs.map((x) => this.endPr(x, main))]);
  }

  /** Server shutdown: stop every preview, and clear the PR previews' worktrees away (what's left goes at the next start). */
  async stopAll(floors: PreviewFloor[]) {
    const prs = Promise.all([...this.prRuns.values()].map((r) => this.endPr(r)));
    await Promise.all([
      ...floors.map((f) => {
        const r = this.runs.get(f.id);
        if (!r) return;
        r.gen++;
        return this.halt(f.fullName, r, PREVIEW_SLUG);
      }),
      Promise.race([prs, new Promise((res) => setTimeout(res, 10_000))]),
    ]);
    await this.sync.closeAll();
  }

  /**
   * Server start: nothing is running yet, so anything alive in a preview worktree or on a preview port is an orphan,
   * and a PR preview's worktree is left over from a hard stop.
   */
  async clearOrphans(floors: PreviewFloor[]) {
    const slots = Array.from({ length: MAX_PR_PREVIEWS }, (_, i) => i + 1);
    await Promise.all(
      floors.flatMap((f) => [
        this.backend.releaseDesk(f.fullName, PREVIEW_SLUG, this.portFor(f)).catch(() => undefined),
        ...slots.map(async (slot) => {
          await this.backend.releaseDesk(f.fullName, prSlug(slot), prPortCandidates(PREVIEW_PORT, slot)[0]).catch(() => undefined);
          void this.clean(f.id, slot, () => this.backend.removeDesk(f.fullName, prSlug(slot)));
        }),
      ]),
    );
  }

  // ---------- the PR theatre ----------

  prViews(): PrPreviewView[] {
    return [...this.prRuns.values()].map((r) => this.prView(r));
  }

  /** The worktrees this floor's PR previews are using, for the desk sweep to keep. */
  prSlugs(f: PreviewFloor): string[] {
    return [...this.prRuns.values()].filter((r) => r.repoId === f.id).map((r) => prSlug(r.slot));
  }

  /**
   * Run an open PR's head beside the floor's main preview. One that's already up is kept (restart: run it again from
   * the PR's latest head). With every slot taken, the one nobody has watched the longest stops first.
   */
  async startPr(f: PreviewFloor, pr: number, title: string, restart = false): Promise<PrPreviewView> {
    if (!Number.isInteger(pr) || pr <= 0) throw new HttpError(400, `Invalid pull request number: ${pr}`);
    await this.checkOpen(f, pr);
    const key = prKey(f.id, pr);
    const known = this.prRuns.get(key);
    if (known && ACTIVE.includes(known.status) && !restart) {
      known.viewedAt = Date.now();
      this.emitPr(known);
      return this.prView(known);
    }
    let r = known;
    if (!r) {
      const slot = this.makeRoom(f);
      const now = Date.now();
      r = { status: 'stopped', port: null, ref: `PR #${pr}`, pr, commit: null, startedAt: now, error: null, log: [], handle: null, gen: 0, repoId: f.id, fullName: f.fullName, slot, viewedAt: now };
      this.prRuns.set(key, r);
    }
    const run = r;
    const gen = ++run.gen;
    Object.assign(run, { status: 'preparing', commit: null, startedAt: Date.now(), viewedAt: Date.now(), error: null, log: [] });
    this.emitPr(run);
    await this.halt(f.fullName, run, prSlug(run.slot));
    await this.cleaning.get(deskKey(f.id, run.slot)); // the slot's last PR preview may still be clearing out
    if (gen !== run.gen) return this.prView(run);
    const port = await this.prPort(run);
    if (gen !== run.gen) return this.prView(run);
    if (!port) {
      Object.assign(run, { status: 'error', error: `No free port for PR #${pr}'s preview: every port in its range (from ${prPortCandidates(PREVIEW_PORT, run.slot)[0]}) is in use.` });
      this.emitPr(run);
      throw new HttpError(409, run.error!);
    }
    run.port = port;
    this.emitPr(run);
    this.launch(run, gen, { ...this.job(f, pr, port, `${title} · PR #${pr}`), slug: prSlug(run.slot), branch: prBranch(run.slot) }, {
      emit: () => this.emitPr(run),
      emitSoon: () => this.emitSoon(`pr:${key}`, () => this.emitPr(run)),
    });
    return this.prView(run);
  }

  /** Stop a PR preview and clear its worktree away. */
  async stopPr(f: PreviewFloor, pr: number) {
    const r = this.prRuns.get(prKey(f.id, pr));
    if (r) await this.endPr(r);
  }

  /** A viewer says which PR preview it has on screen (null: none). One on screen never stops for being idle. */
  watch(viewer: string, repoId: string | null, pr: number | null) {
    const key = repoId && pr ? prKey(repoId, pr) : null;
    const now = Date.now();
    this.watches.set(viewer, { key, at: now });
    const watched = key ? this.prRuns.get(key) : undefined;
    if (watched) watched.viewedAt = now;
    this.tellScreen(watched);
  }

  /** Every few seconds: forget viewers that went quiet, and stop PR previews nobody has watched for the idle time. */
  sweepPrs(now = Date.now()) {
    for (const [viewer, w] of this.watches) if (now - w.at > WATCH_MS) this.watches.delete(viewer);
    for (const key of expired(this.prInfos(), this.screen(now), now, PR_PREVIEW_IDLE_MS)) {
      const r = this.prRuns.get(key)!;
      console.log(`PR theatre: PR #${r.pr} of ${r.fullName} stopped after ${+(PR_PREVIEW_IDLE_MS / 60_000).toFixed(2)} minutes off screen`);
      void this.endPr(r);
    }
    this.tellScreen();
  }

  /** The floor's PRs as the office knows them now: previews of PRs that merged or closed stop. */
  pullsChanged(f: PreviewFloor, pulls: Pick<PullInfo, 'number' | 'state'>[]) {
    for (const key of closedPrs(this.prInfos(), f.id, pulls)) {
      const r = this.prRuns.get(key)!;
      const state = pulls.find((p) => p.number === r.pr)?.state;
      this.hooks.note(`PR #${r.pr}'s preview stopped: the PR ${state === 'MERGED' ? 'was merged' : 'was closed'}.`);
      void this.endPr(r);
    }
  }

  /** A sync proxy (compare mode's synced scrolling) in front of the floor's running app (pr null) or a running PR preview. */
  async syncUrl(f: PreviewFloor, pr: number | null): Promise<string> {
    const r = pr ? this.prRuns.get(prKey(f.id, pr)) : this.runs.get(f.id);
    if (!r?.port || r.status !== 'running') throw new HttpError(409, `${pr ? `PR #${pr}'s preview` : "The floor's app"} isn't running`);
    return `http://localhost:${await this.sync.open(r.port)}`;
  }

  private prView(r: PrRun): PrPreviewView {
    const port = r.port ?? prPortCandidates(PREVIEW_PORT, r.slot)[0];
    return {
      repoId: r.repoId,
      pr: r.pr,
      status: r.status,
      port,
      url: r.status === 'running' ? `http://localhost:${port}/` : null,
      commit: r.commit,
      startedAt: r.startedAt,
      viewedAt: r.viewedAt,
      watched: this.shown.has(prKey(r.repoId, r.pr)),
      error: r.error,
      logTail: r.log.slice(-LOG_VIEW),
    };
  }

  private emitPr(r: PrRun) {
    if (this.prRuns.get(prKey(r.repoId, r.pr)) === r) this.hooks.emitPr(this.prView(r));
  }

  private screen(now = Date.now()) {
    return onScreen(this.watches.values(), now);
  }

  /** Tell the clients about PR previews that came on or went off screen (and `also`, whose viewing time moved). */
  private tellScreen(also?: PrRun) {
    const before = this.shown;
    this.shown = this.screen();
    for (const [k, r] of this.prRuns) if (r === also || before.has(k) !== this.shown.has(k)) this.emitPr(r);
  }

  private prInfos(): PrRunInfo[] {
    return [...this.prRuns.entries()].map(([key, r]) => ({ key, repoId: r.repoId, pr: r.pr, slot: r.slot, active: ACTIVE.includes(r.status), viewedAt: r.viewedAt }));
  }

  /** A slot for a new PR preview, stopping the one nobody has watched the longest when they're all taken. */
  private makeRoom(f: PreviewFloor): number {
    const free = freeSlot([...this.prRuns.values()]);
    if (free) return free;
    const key = pickEviction(this.prInfos(), this.screen());
    if (!key) throw new HttpError(409, `${MAX_PR_PREVIEWS} PR previews are on screen already, the most that run at once. Close one of them first.`);
    const old = this.prRuns.get(key)!;
    this.hooks.note(`PR #${old.pr}'s preview stopped to make room: at most ${MAX_PR_PREVIEWS} PR previews run at once.`);
    // The same floor takes its worktree over as it is (so the install can be skipped); another floor's is cleared away.
    void this.endPr(old, undefined, old.repoId !== f.id);
    return old.slot;
  }

  /** A PR preview is done: it leaves the theatre now, then its app stops and its worktree goes (unless it's handed on). */
  private endPr(r: PrRun, main?: string, removeWorktree = true): Promise<void> {
    const key = prKey(r.repoId, r.pr);
    if (this.prRuns.get(key) === r) {
      this.prRuns.delete(key);
      this.hooks.prRemoved(r.repoId, r.pr);
    }
    r.gen++;
    clearTimeout(this.emitTimers.get(`pr:${key}`));
    this.emitTimers.delete(`pr:${key}`);
    return this.clean(r.repoId, r.slot, async () => {
      await this.halt(r.fullName, r, prSlug(r.slot));
      if (removeWorktree) await this.backend.removeDesk(r.fullName, prSlug(r.slot), main);
    });
  }

  /** Run `work` on a floor's slot after whatever is already clearing it; a new PR preview in that slot waits for both. */
  private clean(repoId: string, slot: number, work: () => Promise<unknown>): Promise<void> {
    const k = deskKey(repoId, slot);
    const p = (this.cleaning.get(k) ?? Promise.resolve()).then(work).then(
      () => undefined,
      () => undefined,
    );
    this.cleaning.set(k, p);
    void p.then(() => {
      if (this.cleaning.get(k) === p) this.cleaning.delete(k);
    });
    return p;
  }

  /** A free port in the slot's range: not the office's, not another preview's, and nothing else listening on it. */
  private async prPort(r: PrRun): Promise<number | null> {
    const taken = this.takenPorts(r);
    for (const p of prPortCandidates(PREVIEW_PORT, r.slot)) {
      if (forbidden(p) || taken.has(p)) continue;
      if (!(await portOpen(p))) return p;
    }
    return null;
  }

  // ---------- running a preview ----------

  private job(f: PreviewFloor, pr: number | null, port: number, title: string): Omit<PreviewJob, 'slug' | 'branch'> {
    return { fullName: f.fullName, defaultBranch: f.defaultBranch, pr, port, command: f.preview.command, env: { ...f.preview.env }, title };
  }

  /** Start a run's job; callbacks from an older run of it (an earlier start, or a stop since) are ignored. */
  private launch(r: Run, gen: number, job: PreviewJob, on: { emit(): void; emitSoon(): void; unconfigured?(): void }) {
    const live = () => gen === r.gen;
    r.handle = this.backend.previews.start(job, {
      status: (s) => {
        if (!live()) return;
        r.status = s;
        on.emit();
      },
      commit: (sha) => {
        if (!live()) return;
        r.commit = sha || null;
        on.emit();
      },
      log: (lines) => {
        if (!live()) return;
        r.log.push(...lines.map((l) => l.slice(0, 500)));
        if (r.log.length > LOG_KEEP) r.log.splice(0, r.log.length - LOG_KEEP);
        on.emitSoon();
      },
      failed: (message, unconfigured) => {
        if (!live()) return;
        r.handle = null;
        Object.assign(r, { status: unconfigured ? 'unconfigured' : 'error', error: message });
        if (unconfigured) on.unconfigured?.();
        on.emit();
        // Anything the app left behind in its worktree or on its port goes too.
        void this.backend.releaseDesk(job.fullName, job.slug, job.port).catch(() => undefined);
      },
    });
  }

  private async halt(fullName: string, r: Run, slug: string) {
    const handle = r.handle;
    r.handle = null;
    if (!handle) return;
    await handle.stop().catch(() => undefined);
    if (!r.port) return;
    void this.sync.close(r.port);
    await this.backend.releaseDesk(fullName, slug, r.port).catch(() => undefined);
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
  private emitSoon(key: string, emit: () => void) {
    if (this.emitTimers.has(key)) return;
    this.emitTimers.set(
      key,
      setTimeout(() => {
        this.emitTimers.delete(key);
        emit();
      }, 1000),
    );
  }
}
