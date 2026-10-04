import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { depsCurrent, INSTALL_TIMEOUT_MS, killTree, readDeps, writeMarker } from './deps.ts';
import { git } from './exec.ts';
import * as workspace from './workspace.ts';

// A floor's app, run for the preview monitor: checked out in its own worktree (never the floor's main checkout,
// which for floor 1 is the folder the live office runs from), installed, started, and watched until its port answers.

export const PREVIEW_SLUG = 'preview';
export const PREVIEW_BRANCH = 'swarm-preview';
/** Scratch folder inside the preview worktree, offered to commands and env as {tmp}; excluded from git status. */
export const PREVIEW_TMP = '.preview-tmp';
const START_TIMEOUT_MS = 3 * 60_000;

export interface PreviewJob {
  fullName: string;
  defaultBranch: string;
  pr: number | null;
  port: number;
  command: string | null;
  env: Record<string, string>;
  /** "<floor> app · <ref>", for the demo's placeholder page. */
  title: string;
}

export interface PreviewCallbacks {
  status(status: 'preparing' | 'installing' | 'starting' | 'running'): void;
  commit(sha: string): void;
  log(lines: string[]): void;
  /** The run ended by itself: failed to start, or the app exited. unconfigured: there was nothing to run. */
  failed(message: string, unconfigured?: boolean): void;
}

export interface PreviewHandle {
  /** Stop the app (and anything it started). Safe to call in any phase. */
  stop(): Promise<void>;
}

export interface PreviewBackend {
  start(job: PreviewJob, cb: PreviewCallbacks): PreviewHandle;
  /** Whether there is something to run with no command set (a package.json in the floor's checkout). */
  hasDefault(fullName: string): Promise<boolean>;
}

/** Replace {port} and {tmp}. */
export const fillPlaceholders = (s: string, port: number, tmp: string) => s.replaceAll('{port}', String(port)).replaceAll('{tmp}', tmp);

/**
 * The environment a preview runs with: the office's, minus Claude credentials and config (same rule as the agents,
 * with no exceptions) and minus the office's own SWARM_* settings, so an app that is itself an office never
 * inherits the live office's home or port. Then the floor's env, then PORT.
 */
export function previewEnv(extra: Record<string, string>, port: number, tmp: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || /^(ANTHROPIC_|CLAUDE|SWARM_)/i.test(k)) continue;
    env[k] = v;
  }
  env.BROWSER = 'none'; // dev servers that open a browser tab on start shouldn't
  for (const [k, v] of Object.entries(extra)) env[k] = fillPlaceholders(v, port, tmp);
  env.PORT = String(port);
  return env;
}

/** Whether something accepts TCP connections on the port (IPv4 or IPv6 loopback). */
export async function portOpen(port: number): Promise<boolean> {
  const probe = (host: string) =>
    new Promise<boolean>((resolve) => {
      const sock = net.connect({ port, host });
      const done = (ok: boolean) => {
        sock.destroy();
        resolve(ok);
      };
      sock.setTimeout(800, () => done(false));
      sock.once('connect', () => done(true));
      sock.once('error', () => done(false));
    });
  const [v4, v6] = await Promise.all([probe('127.0.0.1'), probe('::1')]);
  return v4 || v6;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readJson(file: string): Promise<{ scripts?: Record<string, string> } | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** npm run dev, else start, else preview. Vite ignores PORT, so it is told the port when the script is plain vite. */
export function defaultCommand(pkg: { scripts?: Record<string, string> } | null): string | null {
  const scripts = pkg?.scripts ?? {};
  const name = ['dev', 'start', 'preview'].find((s) => typeof scripts[s] === 'string' && scripts[s].trim());
  if (!name) return null;
  const script = scripts[name];
  const vite = /^\s*vite(\s|$)/.test(script) && !/--port\b/.test(script);
  return `npm run ${name}${vite ? ' -- --port {port} --strictPort' : ''}`;
}

class Stopped extends Error {}

/** One run of a floor's app, from checkout to a listening port. */
class RealPreview implements PreviewHandle {
  private child: ChildProcess | null = null;
  private stopped = false;
  private partial = '';

  constructor(
    private job: PreviewJob,
    private cb: PreviewCallbacks,
  ) {
    void this.run().catch((err) => {
      if (this.stopped || err instanceof Stopped) return;
      this.stopped = true;
      if (this.child) void killTree(this.child);
      this.cb.failed((err as Error).message);
    });
  }

  async stop() {
    this.stopped = true;
    if (this.child) await killTree(this.child);
  }

  private check() {
    if (this.stopped) throw new Stopped();
  }

  private async run() {
    const { job, cb } = this;
    cb.status('preparing');
    const wt = await workspace.prepareDesk(job.fullName, { defaultBranch: job.defaultBranch, pr: job.pr ?? undefined }, PREVIEW_SLUG, PREVIEW_BRANCH);
    this.check();
    await workspace.ensureLocalExcludes(job.fullName).catch(() => undefined);
    cb.commit(await git(['rev-parse', '--short', 'HEAD'], { cwd: wt }).catch(() => ''));
    const tmp = path.join(wt, PREVIEW_TMP);
    await fs.mkdir(tmp, { recursive: true });

    const pkg = await readJson(path.join(wt, 'package.json'));
    const command = job.command ?? defaultCommand(pkg);
    if (!command) {
      this.stopped = true;
      cb.failed(
        pkg
          ? 'package.json has no dev, start or preview script. Set a preview command for this floor.'
          : 'Nothing to run: this floor has no preview command and no package.json.',
        true,
      );
      return;
    }
    const env = previewEnv(job.env, job.port, tmp);

    if (pkg) {
      cb.status('installing');
      await this.install(wt, env);
      this.check();
    }

    cb.status('starting');
    const cmd = fillPlaceholders(command, job.port, tmp);
    cb.log([`$ ${cmd}`]);
    const exited = this.spawn(cmd, wt, env);
    const deadline = Date.now() + START_TIMEOUT_MS;
    let exitCode: number | null | undefined;
    void exited.then((code) => (exitCode = code));
    while (!(await portOpen(job.port))) {
      this.check();
      if (exitCode !== undefined) throw new Error(`The app exited (code ${exitCode}) before it listened on port ${job.port}.`);
      if (Date.now() > deadline) throw new Error(`The app did not listen on port ${job.port} within 3 minutes. Does the command use PORT or {port}?`);
      await sleep(700);
    }
    this.check();
    cb.status('running');
    const code = await exited;
    // Some launchers exit while the server they started keeps serving: it's only over once the port closes.
    while (!this.stopped && (await portOpen(job.port))) await sleep(3000);
    if (this.stopped) return;
    this.stopped = true;
    cb.failed(`The app stopped (exit code ${code}).`);
  }

  /** npm ci (or npm install without a lockfile), skipped when package.json and the lockfile haven't changed. */
  private async install(wt: string, env: Record<string, string>) {
    const deps = await readDeps(wt);
    if (depsCurrent(deps)) {
      this.cb.log(['Dependencies unchanged since the last install; skipping it.']);
      return;
    }
    const cmd = deps.lock !== null ? 'npm ci' : 'npm install';
    this.cb.log([`$ ${cmd}`]);
    const code = await Promise.race([this.spawn(cmd, wt, env), sleep(INSTALL_TIMEOUT_MS).then(() => 'timeout' as const)]);
    this.check();
    if (code === 'timeout') {
      if (this.child) await killTree(this.child);
      throw new Error(`${cmd} took longer than ${INSTALL_TIMEOUT_MS / 60_000} minutes.`);
    }
    if (code !== 0) throw new Error(`${cmd} failed (code ${code}).`);
    this.child = null;
    await writeMarker(wt, deps.hash);
  }

  /** Run a command line through the platform shell; resolves with its exit code. */
  private spawn(cmd: string, cwd: string, env: Record<string, string>): Promise<number | null> {
    this.check();
    const child = spawn(cmd, { cwd, env, shell: true, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    const onData = (buf: Buffer) => {
      const text = this.partial + buf.toString().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
      const lines = text.split(/\r?\n|\r/);
      this.partial = lines.pop() ?? '';
      const out = lines.filter((l) => l.trim());
      if (out.length) this.cb.log(out);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    return new Promise((resolve) => {
      child.once('error', (err) => {
        this.cb.log([err.message]);
        resolve(-1);
      });
      child.once('close', (code) => {
        if (this.partial.trim()) this.cb.log([this.partial]);
        this.partial = '';
        resolve(code);
      });
    });
  }
}

export const realPreviews: PreviewBackend = {
  start: (job, cb) => new RealPreview(job, cb),
  hasDefault: async (fullName) =>
    fs
      .access(path.join(workspace.mainDir(fullName), 'package.json'))
      .then(() => true)
      .catch(() => false),
};
