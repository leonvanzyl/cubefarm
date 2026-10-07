import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogLine, RepoView, ServerEvent } from '../shared/types.ts';
import { agentPatch, FLUSH_MS, Outbox, type Agent, type Tab } from './outbox.ts';

const agent = (id: string, patch: Partial<Agent> = {}): Agent =>
  ({ id, name: id, repoId: 'r1', role: 'agent', status: 'working', currentTool: null, activity: null, desk: 0, color: '#fff', ...patch }) as Agent;
const line = (id: number, kind: LogLine['kind'] = 'tool'): LogLine => ({ id, t: id, kind, text: `line ${id}` });

/** A tab that keeps what it's sent, parsed. */
function tab() {
  const got: ServerEvent[] = [];
  const t: Tab & { got: ServerEvent[] } = { OPEN: 1, readyState: 1, send: (m: string) => void got.push(JSON.parse(m)), got };
  return t;
}

const people = [
  { id: 'ken', floor: 1 },
  { id: 'ada', floor: 1 },
  { id: 'grace', floor: 2 },
];
const buffers: Record<string, LogLine[]> = { ken: [line(1), line(2)], ada: [line(3, 'text')], grace: [line(4), line(5, 'result')] };

function outbox() {
  return new Outbox({ agents: () => people, log: (id) => buffers[id] ?? [] });
}
const watch = (t: Tab, o: Outbox, floor: number, agents: string[] = [], workers = false) => o.receive(t, JSON.stringify({ type: 'lines', floor, agents, workers }));

afterEach(() => vi.useRealTimers());

describe('agent patches', () => {
  it('carry only what changed, or everything for someone never sent', () => {
    const before = agent('ken', { currentTool: 'Read' });
    expect(agentPatch(undefined, before)).toEqual(before);
    expect(agentPatch(before, { ...before, currentTool: 'Edit', activity: { kind: 'edit', detail: 'a.ts' } })).toEqual({ id: 'ken', currentTool: 'Edit', activity: { kind: 'edit', detail: 'a.ts' } });
    expect(agentPatch(before, { ...before, activity: null })).toBeNull();
    expect(agentPatch({ ...before, activity: { kind: 'read', detail: 'x' } }, { ...before, activity: { kind: 'read', detail: 'x' } })).toBeNull();
  });

  it('go out together a few times a second, the latest of each agent only', () => {
    vi.useFakeTimers();
    const o = outbox();
    const t = tab();
    o.add(t);
    o.seed([agent('ken'), agent('ada')]);
    for (const tool of ['Read', 'Grep', 'Edit']) o.agent(agent('ken', { currentTool: tool }));
    o.agent(agent('ada', { status: 'idle' }));
    expect(t.got).toEqual([]);
    vi.advanceTimersByTime(FLUSH_MS);
    expect(t.got).toEqual([{ type: 'agents', agents: [{ id: 'ken', currentTool: 'Edit' }, { id: 'ada', status: 'idle' }] }]);
    // nothing new: nothing sent
    o.agent(agent('ada', { status: 'idle' }));
    vi.advanceTimersByTime(FLUSH_MS);
    expect(t.got).toHaveLength(1);
  });

  it('build on a full agent event, and forget a removed agent', () => {
    const o = outbox();
    const t = tab();
    o.add(t);
    o.broadcast({ type: 'agent', agent: agent('new') });
    o.agent(agent('new', { currentTool: 'Bash' }));
    o.flush();
    expect(t.got[1]).toEqual({ type: 'agents', agents: [{ id: 'new', currentTool: 'Bash' }] });
    o.agent(agent('new', { currentTool: 'Read' }));
    o.broadcast({ type: 'agentRemoved', agentId: 'new' });
    o.flush();
    expect(t.got.map((e) => e.type)).toEqual(['agent', 'agents', 'agentRemoved']);
  });
});

describe('floor patches', () => {
  it("carry only the parts of a floor that changed: a sync that found nothing new is just its time", () => {
    const o = outbox();
    const t = tab();
    o.add(t);
    const floor = { id: 'acme/app', floor: 1, issues: [{ number: 1 }], pulls: [{ number: 2 }], lastSync: 1 } as unknown as RepoView;
    o.seed([], [floor]);
    o.repo({ ...floor, lastSync: 2 });
    o.repo({ ...floor, lastSync: 3 });
    o.flush();
    o.repo({ ...floor, lastSync: 4, pulls: [] });
    o.flush();
    expect(t.got).toEqual([
      { type: 'repos', repos: [{ id: 'acme/app', lastSync: 3 }] },
      { type: 'repos', repos: [{ id: 'acme/app', lastSync: 4, pulls: [] }] },
    ]);
    o.repo({ ...floor, lastSync: 5 });
    o.broadcast({ type: 'repoRemoved', repoId: 'acme/app' });
    o.flush();
    expect(t.got.at(-1)).toEqual({ type: 'repoRemoved', repoId: 'acme/app' });
  });
});

describe('terminal lines', () => {
  it('go only to tabs that show them: their floor, an open panel, or the workers list (latest line only)', () => {
    const o = outbox();
    const [floor1, panel, list, lobby] = [tab(), tab(), tab(), tab()];
    for (const t of [floor1, panel, list, lobby]) o.add(t);
    watch(floor1, o, 1);
    watch(panel, o, 0, ['grace']);
    watch(list, o, 0, [], true);
    watch(lobby, o, 0);
    for (const t of [floor1, panel, list, lobby]) t.got.length = 0;

    o.log('ken', [line(10), line(11, 'result')]);
    o.log('grace', [line(12, 'text')]);
    o.flush();
    expect(floor1.got).toEqual([{ type: 'logs', tails: { ken: [line(10), line(11, 'result')] } }]);
    expect(panel.got).toEqual([{ type: 'logs', tails: { grace: [line(12, 'text')] } }]);
    expect(list.got).toEqual([{ type: 'latest', lines: { ken: line(10), grace: line(12, 'text') } }]);
    expect(lobby.got).toEqual([]);
  });

  it('catch a tab up when it starts showing someone', () => {
    const o = outbox();
    const t = tab();
    o.add(t);
    watch(t, o, 1);
    expect(t.got).toEqual([{ type: 'logs', catchUp: true, tails: { ken: buffers.ken, ada: buffers.ada } }]);
    watch(t, o, 1, ['grace'], true);
    expect(t.got.slice(1)).toEqual([
      { type: 'logs', catchUp: true, tails: { grace: buffers.grace } },
      { type: 'latest', lines: { ken: line(2), ada: line(3, 'text'), grace: line(4) } },
    ]);
    // the same watch again, or something that isn't one: nothing
    watch(t, o, 1, ['grace'], true);
    o.receive(t, 'not json');
    expect(t.got).toHaveLength(3);
  });

  it("are batched with the agents' changes, and the office updates signs first", () => {
    vi.useFakeTimers();
    const seen: string[][] = [];
    const o = new Outbox({ agents: () => people, log: () => [], beforeFlush: (ids) => void seen.push(ids) });
    const t = tab();
    o.add(t);
    watch(t, o, 1);
    t.got.length = 0;
    const before = o.stats.messages;
    o.log('ken', [line(20)]);
    o.log('ken', [line(21)]);
    vi.advanceTimersByTime(FLUSH_MS);
    expect(seen).toEqual([['ken']]);
    expect(t.got).toEqual([{ type: 'logs', tails: { ken: [line(20), line(21)] } }]);
    expect(o.stats.messages - before).toBe(1);
  });
});
