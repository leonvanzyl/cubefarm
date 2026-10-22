// Cloud agents' machines (docs/cloud.md): one Upstash Box per agent, behind the same MachineProvider as the local
// folders (server/machines.ts). A Box is created and set up the first time its agent needs it (tools, the pinned CLIs,
// git and the office's helper programs), keeps its clone and worktree between tasks, pauses when idle and is deleted,
// with its unpushed work saved to leftovers first, when its agent leaves. Housekeeping never wakes a paused Box.

import fs from 'node:fs/promises';
import path from 'node:path';
import { HOME_DIR } from './config.ts';
import { boxLabels, boxName, machineOfBox, redact } from './cloud.ts';
import { BOX_HELPERS } from './boxHelpers.ts';
import { sweepStrayClis } from './boxCli.ts';
import {
  BOX_BIN,
  BOX_LEFTOVERS,
  BOX_TMUX_CONF,
  boxDeskDir,
  boxLinkedDir,
  depsOutcome,
  depsScript,
  leftoversScript,
  linkedReposScript,
  prepareDeskScript,
  releaseScript,
  setupScript,
  signInCheckScript,
  signInOutcome,
  signOutScript,
  sq,
  sweepScript,
  TMUX_CONF,
  worktreesScript,
  type BoxVersions,
} from './boxScripts.ts';
import type { BoxApi, BoxInfo } from './box.ts';
import type { MachineProvider } from './machines.ts';
import type { DeskBase } from './workspace.ts';
import type { DepsCallbacks, DepsOutcome } from './deps.ts';
import type { BoxSize, CloudMachineState } from '../shared/types.ts';

/** Bump when setupScript changes in a way existing Boxes need. */
const SETUP_REV = 2;
const SETUP_TIMEOUT_MS = 20 * 60_000;
const LIVE: BoxInfo['status'][] = ['running', 'idle', 'creating'];

export interface BoxMachinesDeps {
  api: () => BoxApi | null;
  office: () => string;
  size: () => BoxSize;
  versions: BoxVersions;
  /** Who the Box's commits are by (the manager's git identity). */
  git: () => Promise<{ name: string; email: string }>;
  /** GitHub's token for a command that clones or fetches (as its environment only). */
  githubEnv: () => Promise<Record<string, string>>;
  /** A machine's Box changed state (for its agent's card). */
  state: (machine: string, s: CloudMachineState) => void;
  /** Values to scrub from any output the office shows. */
  secrets: () => string[];
  log: (line: string) => void;
}

/** The last lines of a failed command, cleaned for the manager. */
function failure(what: string, output: string, secrets: string[]) {
  const tail = redact(output, secrets)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-3)
    .join(' · ');
  return new Error(`${what}${tail ? `: ${tail.slice(0, 400)}` : ''}`);
}

const stamp = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

export class BoxMachines implements MachineProvider {
  private ids = new Map<string, string>(); // machine -> Box id
  private ready = new Map<string, Promise<string>>(); // machine -> its Box, set up (once per office run)
  private states = new Map<string, CloudMachineState>();

  constructor(private deps: BoxMachinesDeps) {}

  private api(): BoxApi {
    const api = this.deps.api();
    if (!api) throw new Error('Cloud agents need your Upstash Box API key: Settings → Cloud agents.');
    return api;
  }

  private setState(machine: string, s: CloudMachineState) {
    if (this.states.get(machine) === s) return;
    this.states.set(machine, s);
    this.deps.state(machine, s);
  }

  /** The office's connection to a cloud agent's CLI dropped (false) or came back (true). */
  connection(machine: string, up: boolean) {
    this.setState(machine, up ? 'ready' : 'disconnected');
  }

  /** How a machine's Box is doing ('none' before it has one). */
  stateOf(machine: string): CloudMachineState {
    return this.states.get(machine) ?? (this.ids.has(machine) ? 'ready' : 'none');
  }

  /** The machine's Box id, looked up on the account once (null: it has none). */
  async boxId(machine: string): Promise<string | null> {
    const known = this.ids.get(machine);
    if (known) return known;
    const api = this.deps.api();
    if (!api) return null;
    const office = this.deps.office();
    const found = (await api.list()).find((b) => b.status !== 'deleted' && machineOfBox(b, office) === machine);
    if (found) this.ids.set(machine, found.id);
    return found?.id ?? null;
  }

  /** Its Box when it's running right now, else null (housekeeping leaves paused Boxes asleep). */
  private async running(machine: string): Promise<string | null> {
    const id = this.ids.get(machine) ?? (await this.boxId(machine).catch(() => null));
    if (!id) return null;
    const info = await this.deps.api()?.get(id).catch(() => null);
    if (!info) {
      if (info === null) this.ids.delete(machine);
      return null;
    }
    if (info.status === 'paused') this.setState(machine, 'paused');
    return LIVE.includes(info.status) ? id : null;
  }

  /** The machine's Box, created, running and set up: the first time takes a few minutes. */
  ensure(machine: string, note?: (text: string) => void): Promise<string> {
    let p = this.ready.get(machine);
    if (!p) {
      p = this.bringUp(machine, note).catch((err) => {
        this.ready.delete(machine);
        this.setState(machine, 'error');
        throw err;
      });
      this.ready.set(machine, p);
      return p;
    }
    // Set up earlier this run: just make sure it's awake.
    return p.then(async (id) => {
      const info = await this.api().get(id);
      if (!info) {
        this.ready.delete(machine);
        this.ids.delete(machine);
        return this.ensure(machine, note);
      }
      if (info.status === 'paused') {
        note?.('Waking their cloud machine…');
        await this.api().resume(id);
      }
      this.setState(machine, 'ready');
      return id;
    });
  }

  private async bringUp(machine: string, note?: (text: string) => void): Promise<string> {
    const api = this.api();
    let id = await this.boxId(machine);
    if (id) {
      const info = await api.get(id);
      if (!info) {
        this.ids.delete(machine);
        id = null;
      } else if (info.status === 'paused') {
        note?.('Waking their cloud machine…');
        await api.resume(id);
      }
    }
    if (!id) {
      this.setState(machine, 'creating');
      note?.('Creating their cloud machine (an Upstash Box)…');
      const office = this.deps.office();
      const box = await api.create({ name: boxName(office, machine), labels: boxLabels(office, machine), size: this.deps.size() });
      id = box.id;
      this.ids.set(machine, id);
    }
    this.setState(machine, 'setting-up');
    const git = await this.deps.git();
    const setup = await api.run(id, setupScript({ versions: this.deps.versions, rev: SETUP_REV, gitName: git.name, gitEmail: git.email }), { timeoutMs: SETUP_TIMEOUT_MS });
    if (setup.code !== 0 || !setup.output.includes('CUBEFARM_SETUP_OK')) throw failure("Couldn't set up the cloud machine", setup.output, this.deps.secrets());
    for (const [name, source] of Object.entries(BOX_HELPERS)) await api.write(id, `${BOX_BIN}/${name}`, source);
    await api.write(id, BOX_TMUX_CONF, TMUX_CONF);
    this.setState(machine, 'ready');
    return id;
  }

  // ---------- MachineProvider ----------

  deskDir(_machine: string, fullName: string): string {
    return boxDeskDir(fullName);
  }

  async prepareDesk(machine: string, fullName: string, base: DeskBase, branch: string, note?: (text: string) => void): Promise<string> {
    const api = this.api();
    const id = await this.ensure(machine, note);
    const r = await api.run(id, prepareDeskScript(fullName, base, branch), { env: await this.deps.githubEnv(), timeoutMs: 15 * 60_000 });
    const lines = r.output.trim().split('\n');
    if (r.code !== 0) throw failure(`Couldn't set up the desk in ${fullName}'s cloud machine`, r.output, this.deps.secrets());
    for (const l of lines.slice(0, -1)) if (/stale git lock|rebuilt/.test(l)) note?.(l.trim());
    await api.run(id, `node ${sq(`${BOX_BIN}/seed-claude.cjs`)} ${sq(boxDeskDir(fullName))}`);
    return boxDeskDir(fullName);
  }

  /** Fresh read-only copies of the floor's linked repos; their paths in the Box (never fails the task). */
  async linkRepos(machine: string, fullNames: string[], note?: (text: string) => void): Promise<string[]> {
    if (!fullNames.length) return [];
    const id = await this.ensure(machine);
    const r = await this.api().run(id, linkedReposScript(fullNames), { env: await this.deps.githubEnv(), timeoutMs: 10 * 60_000 });
    for (const l of r.output.split('\n')) if (l.startsWith('⚠')) note?.(l.trim());
    return fullNames.map(boxLinkedDir);
  }

  env(): Record<string, string> {
    return {};
  }

  async release(machine: string, fullName: string, port: number): Promise<void> {
    const id = await this.running(machine);
    if (id) await this.api().run(id, releaseScript(port, fullName), { timeoutMs: 60_000 }).catch(() => undefined);
  }

  async trimDesk(): Promise<null> {
    return null; // a Box keeps its node_modules: its disk is its own, and trimming would wake it
  }

  async sweep(machine: string, fullName: string, keep: string[]): Promise<number> {
    const id = await this.running(machine);
    if (!id) return 0;
    const r = await this.api().run(id, sweepScript(fullName, keep), { timeoutMs: 60_000 });
    return r.output.split('\n').filter((l) => l.startsWith('SWEPT ')).length;
  }

  async remove(machine: string): Promise<{ removed: boolean; patches: string[] }> {
    const api = this.deps.api();
    const id = api ? await this.boxId(machine).catch(() => null) : null;
    if (!api || !id) return { removed: !!api, patches: [] }; // without the key it can't be deleted yet: the next sweep tries
    const patches: string[] = [];
    try {
      const info = await api.get(id);
      if (info?.status === 'paused') await api.resume(id);
      if (info) {
        const repos = (await api.run(id, worktreesScript())).output.split('\n').map((l) => l.trim()).filter((l) => /^[\w.-]+\/[\w.-]+$/.test(l));
        for (const fullName of repos) {
          const r = await api.run(id, leftoversScript(fullName));
          if (!r.output.includes('SAVED')) continue;
          const data = await api.read(id, BOX_LEFTOVERS, { base64: true });
          if (data) patches.push(await this.saveLeftovers(fullName, machine, Buffer.from(data, 'base64')));
        }
      }
    } catch (err) {
      // Its work couldn't be saved: keep the Box for the next sweep rather than lose it.
      this.deps.log(`could not save the leftovers of cloud machine ${machine}: ${(err as Error).message}`);
      return { removed: false, patches };
    }
    await api.remove(id);
    this.ids.delete(machine);
    this.ready.delete(machine);
    this.states.delete(machine);
    return { removed: true, patches };
  }

  async list(): Promise<string[]> {
    const api = this.deps.api();
    if (!api) return [];
    const office = this.deps.office();
    const out: string[] = [];
    for (const b of await api.list()) {
      const m = b.status === 'deleted' ? null : machineOfBox(b, office);
      if (!m) continue;
      this.ids.set(m, b.id);
      if (b.status === 'paused' && !this.states.has(m)) this.states.set(m, 'paused');
      out.push(m);
    }
    return out;
  }

  /** A Box's desk can't be looked at without waking it: it's taken to be there (a session started in a missing one fails). */
  async exists(): Promise<boolean> {
    return true;
  }

  async installDeps(machine: string, fullName: string, cb: DepsCallbacks): Promise<DepsOutcome> {
    try {
      const id = await this.ensure(machine);
      const api = this.api();
      // No credentials of any kind in an install's environment.
      const look = await api.run(id, depsScript(fullName, false), { timeoutMs: 60_000 });
      const first = depsOutcome(look.output, look.code);
      if (first === 'failed') throw new Error("couldn't look at the desk's package.json");
      if (first === 'none') return 'none';
      if (first === 'agent') {
        cb.log(['No package-lock.json; leaving the dependencies to the agent.']);
        return 'agent';
      }
      if (first === 'skipped') {
        cb.log(['Dependencies unchanged since the last install; skipping it.']);
        return 'skipped';
      }
      cb.log(['Installing dependencies in the cloud machine…', '$ npm ci']);
      cb.installing();
      const r = await api.run(id, depsScript(fullName), { timeoutMs: 20 * 60_000 });
      const outcome = depsOutcome(r.output, r.code);
      if (outcome === 'installed') cb.log(['Dependencies installed.']);
      else cb.log([`⚠ Could not install the dependencies (${redact(r.output, this.deps.secrets()).trim().split('\n').slice(-2, -1)[0]?.slice(0, 300) ?? 'npm ci failed'}); the agent will run npm install itself.`]);
      return outcome === 'installed' ? 'installed' : 'failed';
    } catch (err) {
      cb.log([`⚠ Could not install the dependencies (${(err as Error).message.split('\n')[0].slice(0, 300)}); the agent will run npm install itself.`]);
      return 'failed';
    }
  }

  /** Stop CLIs in a running Box that no record names (a paused Box has none: its tmux went with the pause). */
  async sweepStrays(machine: string, keepTokens: string[]): Promise<number> {
    const id = await Promise.race([this.running(machine), new Promise<null>((r) => setTimeout(() => r(null), 20_000))]);
    return id ? sweepStrayClis(this.api(), id, keepTokens) : 0;
  }

  /**
   * Is the Box's own CLI signed in (its login in the Box user's home)? Run with no credentials of any kind, so only that
   * login counts. Wakes the Box. Throws when Upstash can't say.
   */
  async signedIn(machine: string, cli: 'claude' | 'codex'): Promise<boolean> {
    const id = await this.ensure(machine);
    const r = await this.api().run(id, signInCheckScript(cli), { timeoutMs: 60_000 });
    const out = signInOutcome(r.output);
    if (out === null) throw new Error(`Couldn't ask ${cli === 'claude' ? 'Claude Code' : 'Codex'} in the cloud machine whether it's signed in.`);
    return out;
  }

  /** Forget a login its CLI's servers turned away (an expired one), so it reads as signed out until it's signed in again. */
  async signOut(machine: string, cli: 'claude' | 'codex'): Promise<void> {
    const id = await this.ensure(machine);
    await this.api().run(id, signOutScript(cli), { timeoutMs: 60_000 });
  }

  /** Pause a machine's Box (an idle cloud agent); it wakes for their next task. */
  async pause(machine: string): Promise<void> {
    const id = await this.running(machine);
    if (!id) return;
    await this.api().pause(id);
    this.setState(machine, 'paused');
  }

  private async saveLeftovers(fullName: string, machine: string, data: Buffer): Promise<string> {
    const dir = path.join(HOME_DIR, 'leftovers', fullName.replace('/', '__'));
    await fs.mkdir(dir, { recursive: true });
    const base = `machine-${machine}-${stamp(new Date())}`;
    let file = path.join(dir, `${base}.patch`);
    for (let n = 2; await fs.stat(file).then(() => true, () => false); n++) file = path.join(dir, `${base}-${n}.patch`);
    await fs.writeFile(file, data);
    return file;
  }
}
