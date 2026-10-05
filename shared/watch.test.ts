import { describe, expect, it } from 'vitest';
import type { LogLine } from './types.ts';
import { catchUp, FLOOR_TAIL, latestListed, NO_WATCH, PANEL_TAIL, parseWatch, sameWatch, seesAll, type Watch } from './watch.ts';

const line = (id: number, kind: LogLine['kind'], text = `line ${id}`): LogLine => ({ id, t: id * 1000, kind, text });
const watch = (floor: number, agents: string[] = [], workers = false): Watch => ({ floor, agents, workers });

describe("a tab's watch", () => {
  it('gets every line of the agents on its floor and of those whose panel is open', () => {
    const w = watch(3, ['ada']);
    expect(seesAll(w, 'ken', 3)).toBe(true);
    expect(seesAll(w, 'ada', 7)).toBe(true);
    expect(seesAll(w, 'ken', 4)).toBe(false);
    expect(seesAll(w, 'ken', null)).toBe(false);
    expect(seesAll(NO_WATCH, 'ken', 3)).toBe(false);
  });

  it('lists the latest tool call, reply or thought, not the results or system lines after it', () => {
    const lines = [line(1, 'tool'), line(2, 'text'), line(3, 'result'), line(4, 'system'), line(5, 'text', '   ')];
    expect(latestListed(lines)?.id).toBe(2);
    expect(latestListed(lines, 3)).toBeNull();
    expect(latestListed([])).toBeNull();
  });

  it('only takes well-formed watch messages', () => {
    expect(parseWatch({ type: 'lines', floor: 2, agents: ['a', 7, ''], workers: true })).toEqual(watch(2, ['a'], true));
    expect(parseWatch({ type: 'lines', floor: 0, agents: [] })).toEqual(watch(0));
    expect(parseWatch({ type: 'lines', floor: 1.5, agents: [] })).toBeNull();
    expect(parseWatch({ type: 'hello' })).toBeNull();
    expect(parseWatch({ type: 'watch', f: 2 })).toBeNull(); // presence's watch (shared/presence.ts), not this one
    expect(parseWatch('lines')).toBeNull();
    expect(parseWatch({ type: 'lines', floor: 1, agents: Array.from({ length: 50 }, (_, i) => `a${i}`) })?.agents).toHaveLength(20);
    expect(sameWatch(watch(1, ['a']), watch(1, ['a']))).toBe(true);
    expect(sameWatch(watch(1, ['a']), watch(1, ['b']))).toBe(false);
  });

  it('catches a tab up on what it newly shows: a floor, a panel, the workers list', () => {
    const people = [
      { id: 'ken', floor: 1 },
      { id: 'ada', floor: 1 },
      { id: 'grace', floor: 2 },
      { id: 'ceo', floor: 0 },
    ];
    expect(catchUp(NO_WATCH, watch(1), people)).toEqual({ tails: [['ken', FLOOR_TAIL], ['ada', FLOOR_TAIL]], latest: false });
    // up to floor 2: only grace is new
    expect(catchUp(watch(1), watch(2), people).tails).toEqual([['grace', FLOOR_TAIL]]);
    // Ken's terminal opens on his floor: the panel wants his whole buffer
    expect(catchUp(watch(1), watch(1, ['ken']), people).tails).toEqual([['ken', PANEL_TAIL]]);
    expect(catchUp(watch(1, ['ken']), watch(1), people).tails).toEqual([]);
    expect(catchUp(watch(1), watch(1, [], true), people)).toEqual({ tails: [], latest: true });
    expect(catchUp(watch(1, [], true), watch(1, [], true), people).latest).toBe(false);
  });
});
