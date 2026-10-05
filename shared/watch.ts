import type { LogLine, Watch } from './types.ts';

// Which terminal lines a tab gets (#228). With a big company most of the office's traffic was every agent's log, sent
// to every tab. Now each tab says what it shows: the floor it's on (the desk monitors and the hover card read the
// agents there), the agents whose panel is open, and whether the workers list is out (it shows only each agent's
// latest line). The office sends every line for those and only the latest line for the list. Shared by the client,
// which reports its watch, and the server, which routes by it.

export type { Watch };

/** A tab that hasn't said yet gets no lines. */
export const NO_WATCH: Watch = { floor: -1, agents: [], workers: false };

/** Lines a newly watched agent's catch-up carries: the whole buffer for an open panel, enough for a desk monitor. */
export const PANEL_TAIL = 600;
export const FLOOR_TAIL = 150;

/** The kinds of line the workers list shows as someone's latest. */
const LISTED: LogLine['kind'][] = ['tool', 'text', 'thinking', 'error', 'done', 'manager'];

/** The latest line worth showing in the workers list, looking back at most `lookBack` lines; null when there's none. */
export function latestListed(lines: readonly LogLine[], lookBack = lines.length): LogLine | null {
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - lookBack); i--) {
    const l = lines[i];
    if (LISTED.includes(l.kind) && l.text.trim()) return l;
  }
  return null;
}

/** Whether a tab gets every line of an agent on floor `agentFloor` (null: on no floor). */
export function seesAll(w: Watch, agentId: string, agentFloor: number | null): boolean {
  return w.agents.includes(agentId) || (agentFloor !== null && agentFloor === w.floor);
}

/** A tab's 'lines' message (its watch), checked; null when it isn't one. At most 20 open panels are honoured. */
export function parseWatch(raw: unknown): Watch | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (m.type !== 'lines' || !Number.isInteger(m.floor) || !Array.isArray(m.agents)) return null;
  const agents = m.agents.filter((a): a is string => typeof a === 'string' && a.length > 0 && a.length <= 64).slice(0, 20);
  return { floor: m.floor as number, agents, workers: m.workers === true };
}

export const sameWatch = (a: Watch, b: Watch) => a.floor === b.floor && a.workers === b.workers && a.agents.length === b.agents.length && a.agents.every((x, i) => x === b.agents[i]);

/**
 * What a tab needs when its watch changes from `prev` to `next`: the agents it newly gets every line of (with how many
 * lines of their buffer to send), and whether it now needs everyone's latest line for the workers list.
 */
export function catchUp(prev: Watch, next: Watch, agents: readonly { id: string; floor: number | null }[]): { tails: [string, number][]; latest: boolean } {
  const tails: [string, number][] = [];
  for (const a of agents) {
    // a panel shows the whole buffer, even for someone whose monitor (a shorter tail) was already in view
    if (next.agents.includes(a.id) && !prev.agents.includes(a.id)) tails.push([a.id, PANEL_TAIL]);
    else if (seesAll(next, a.id, a.floor) && !seesAll(prev, a.id, a.floor)) tails.push([a.id, FLOOR_TAIL]);
  }
  return { tails, latest: next.workers && !prev.workers };
}
