import type { AgentPatch, AgentView, LogLine, RepoPatch, RepoView, ServerEvent } from '../shared/types.ts';
import { catchUp, latestListed, NO_WATCH, parseWatch, sameWatch, seesAll, type Watch } from '../shared/watch.ts';

// What the office sends its tabs over /ws, made to scale (#228). Most events go out as they happen, but those that come
// many times a second with a big company are batched on one short tick: agents' changes (their tool, their activity)
// and floors' (every sync and merge resends a floor's issues and PRs) go out as patches of just the fields that
// changed, and terminal lines go only to the tabs that show them (shared/watch.ts): every line for agents on the tab's
// floor or with their panel open, the latest one for the workers list, nothing otherwise.

export type Agent = Omit<AgentView, 'log'>;

/** A connected tab: the websocket's send and readyState are all it needs. */
export interface Tab {
  readonly OPEN: number;
  readonly readyState: number;
  send(data: string): void;
}

export interface OutboxHost {
  /** Everyone in the office, with the floor their desk is on (0: the lobby; null: no floor). */
  agents(): { id: string; floor: number | null }[];
  /** An agent's terminal buffer, for catching a tab up. */
  log(agentId: string): readonly LogLine[];
  /** Just before a batch goes out, with the agents that have new lines (the office updates their activity signs). */
  beforeFlush?(agentIds: string[]): void;
}

/** How often batched changes go out: at most four times a second per agent. */
export const FLUSH_MS = 250;

const same = (a: unknown, b: unknown) => a === b || (typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));

type Patch<T> = Partial<T> & { id: string };

/** The fields of `next` that differ from `sent`, with the id; null when nothing changed. Every field when `sent` is missing. */
export function patchOf<T extends { id: string }>(sent: T | undefined, next: T): Patch<T> | null {
  if (!sent) return { ...next };
  const patch = { id: next.id } as Patch<T>;
  let changed = false;
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (same(sent[key], next[key])) continue;
    patch[key] = next[key];
    changed = true;
  }
  return changed ? patch : null;
}

export const agentPatch = (sent: Agent | undefined, next: Agent): AgentPatch | null => patchOf(sent, next);

/** Views of one kind (agents, floors): what every tab was last sent of each, and the newer ones waiting for the tick. */
class Patches<T extends { id: string }> {
  private sent = new Map<string, T>();
  private queued = new Map<string, T>();

  /** Every tab has this one (sent in full, or in its snapshot). */
  have(view: T) {
    this.sent.set(view.id, view);
    this.queued.delete(view.id);
  }

  drop(id: string) {
    this.sent.delete(id);
    this.queued.delete(id);
  }

  queue(view: T) {
    this.queued.set(view.id, view);
  }

  /** The queued changes as patches on what was sent, which they then become. */
  take(): Patch<T>[] {
    const out: Patch<T>[] = [];
    for (const [id, view] of this.queued) {
      const patch = patchOf(this.sent.get(id), view);
      this.sent.set(id, view);
      if (patch) out.push(patch);
    }
    this.queued.clear();
    return out;
  }
}

export class Outbox {
  private tabs = new Map<Tab, Watch>();
  private agents = new Patches<Agent>();
  private repos = new Patches<RepoView>();
  private lines = new Map<string, LogLine[]>();
  private timer: NodeJS.Timeout | null = null;
  /** Bytes and messages sent, for the scale test and the benchmark. */
  readonly stats = { bytes: 0, messages: 0 };

  constructor(
    private host: OutboxHost,
    private flushMs = FLUSH_MS,
  ) {}

  /** What every tab already has (the office at start, before any tab connects): later changes are patches on it. */
  seed(agents: Agent[], repos: RepoView[] = []) {
    for (const a of agents) this.agents.have(a);
    for (const r of repos) this.repos.have(r);
  }

  add(tab: Tab) {
    this.tabs.set(tab, NO_WATCH);
  }

  remove(tab: Tab) {
    this.tabs.delete(tab);
  }

  get size() {
    return this.tabs.size;
  }

  /** A message from a tab: a new watch ('lines') catches it up on the agents it now shows. Anything else is ignored. */
  receive(tab: Tab, raw: string) {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const next = parseWatch(msg);
    const prev = this.tabs.get(tab);
    if (next && prev && !sameWatch(prev, next)) this.watch(tab, prev, next);
  }

  /** The tab was sent a fresh snapshot (it has no lines now): catch it up again on what it shows. */
  resync(tab: Tab) {
    const w = this.tabs.get(tab);
    if (w) this.watch(tab, NO_WATCH, w);
  }

  private watch(tab: Tab, prev: Watch, next: Watch) {
    this.tabs.set(tab, next);
    const { tails, latest } = catchUp(prev, next, this.host.agents());
    if (tails.length) this.send(tab, { type: 'logs', catchUp: true, tails: Object.fromEntries(tails.map(([id, n]) => [id, this.host.log(id).slice(-n)])) });
    if (latest) {
      const lines: Record<string, LogLine> = {};
      for (const a of this.host.agents()) {
        const l = latestListed(this.host.log(a.id), 80);
        if (l) lines[a.id] = l;
      }
      if (Object.keys(lines).length) this.send(tab, { type: 'latest', lines });
    }
  }

  /** Sends to every tab now. An agent or floor sent in full is remembered; a removed one forgotten. */
  broadcast(ev: ServerEvent) {
    if (ev.type === 'agent') this.agents.have(ev.agent);
    if (ev.type === 'repo') this.repos.have(ev.repo);
    if (ev.type === 'agentRemoved') {
      this.agents.drop(ev.agentId);
      this.lines.delete(ev.agentId);
    }
    if (ev.type === 'repoRemoved') this.repos.drop(ev.repoId);
    if (!this.tabs.size) return;
    const msg = JSON.stringify(ev);
    for (const tab of this.tabs.keys()) this.write(tab, msg);
  }

  /** An agent changed: the change goes out with the next batch. */
  agent(view: Agent) {
    this.agents.queue(view);
    this.soon();
  }

  /** A floor changed (a sync, a merge, its settings): the change goes out with the next batch. */
  repo(view: RepoView) {
    this.repos.queue(view);
    this.soon();
  }

  /** New terminal lines: they go out with the next batch, to the tabs that show them. */
  log(agentId: string, lines: LogLine[]) {
    if (!lines.length) return;
    const q = this.lines.get(agentId);
    if (q) q.push(...lines);
    else this.lines.set(agentId, [...lines]);
    this.soon();
  }

  /** Sends what's queued now (the tick does this; tests and shutdown may call it). */
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const lines = this.lines;
    this.lines = new Map();
    if (lines.size) this.host.beforeFlush?.([...lines.keys()]);

    const agents: AgentPatch[] = this.agents.take();
    if (agents.length) this.broadcast({ type: 'agents', agents });
    const repos: RepoPatch[] = this.repos.take();
    if (repos.length) this.broadcast({ type: 'repos', repos });

    if (!lines.size || !this.tabs.size) return;
    const floors = new Map(this.host.agents().map((a) => [a.id, a.floor]));
    for (const [tab, w] of this.tabs) {
      const tails: Record<string, LogLine[]> = {};
      const latest: Record<string, LogLine> = {};
      let anyTail = false;
      let anyLatest = false;
      for (const [id, batch] of lines) {
        if (seesAll(w, id, floors.get(id) ?? null)) {
          tails[id] = batch;
          anyTail = true;
        } else if (w.workers) {
          const l = latestListed(batch);
          if (l) {
            latest[id] = l;
            anyLatest = true;
          }
        }
      }
      if (anyTail) this.send(tab, { type: 'logs', tails });
      if (anyLatest) this.send(tab, { type: 'latest', lines: latest });
    }
  }

  /** Stops the tick (the office is shutting down). */
  close() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private soon() {
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.flushMs);
  }

  private send(tab: Tab, ev: ServerEvent) {
    this.write(tab, JSON.stringify(ev));
  }

  private write(tab: Tab, msg: string) {
    if (tab.readyState !== tab.OPEN) return;
    tab.send(msg);
    this.stats.bytes += Buffer.byteLength(msg);
    this.stats.messages++;
  }
}
