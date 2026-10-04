import { afterEach, describe, expect, it } from 'vitest';
import type { AgentStatus } from '../../../shared/types';
import { admit, choose, errandNamed, headingFor, mayContinue, wanted, type ErrandAgent, type ErrandState, type Me } from './errands';
import { closeGathering, gathering, nearestFreeSpot, openGathering } from './gathering';
import { PRESENTER, semicircle } from './ritualSchedule';
import { spot, walkways } from './walkways';

const office = walkways('office');
const g = () => errandNamed('gathering')!;
const agent = (id: string, status: AgentStatus = 'idle', role = 'dev'): ErrandAgent => ({ id, status, role });
const at = (desk: string, over: Partial<ErrandState> = {}): ErrandState => ({ floor: 'office', statusFor: 100, seatedFor: 0, restless: 30, home: spot(office, desk)!, ...over });
const me = (id: string): Me => ({ id, x: 0, z: 0, heading: 0, arrived: true, dt: 0.1, player: { x: 0, z: 0 } });

/** Sends `a` the way the director would: place, then claim, then the script. */
function join(a: ErrandAgent, desk: string) {
  const s = g().place!(a, at(desk));
  if (!s || !g().claim!(a.id)) return null;
  return { spot: s, script: g().script!(a, 'office')! };
}

const open = () => openGathering({ name: 'standup', floor: 'office', spots: semicircle(PRESENTER, 4), welcome: (a) => a.role !== 'ceo' });

afterEach(() => {
  const cur = gathering();
  if (cur) closeGathering(cur);
});

describe('a gathering', () => {
  it('nobody wants to go while none is open', () => {
    expect(g().when(agent('a'), at('desk-0'))).toBe(false);
  });

  it('calls free people, never busy ones, the unwelcome or anyone on another floor kind', () => {
    open();
    expect(g().when(agent('a'), at('desk-0'))).toBe(true);
    expect(g().when(agent('a', 'done'), at('desk-0'))).toBe(true);
    for (const s of ['working', 'preparing', 'error'] as const) expect(g().when(agent('a', s), at('desk-0')), s).toBe(false);
    expect(g().when(agent('ceo', 'idle', 'ceo'), at('desk-0'))).toBe(false);
    expect(g().when(agent('a'), at('desk-0', { floor: 'lobby' }))).toBe(false);
  });

  it('wins over whatever else someone fancied, but is an idle errand: the walker cap holds and work calls them back', () => {
    open();
    const want = wanted([errandNamed('stretch')!, g()], agent('a'), at('desk-0', { seatedFor: 99 }));
    expect(want.map((e) => e.name)).toEqual(['stretch', 'gathering']);
    expect(choose(want, 0.01)?.name).toBe('gathering');
    expect(g().work).toBeFalsy();
    expect(mayContinue('working', g())).toBe(false);
    const queued = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, queue: [{ name: 'gathering', at: i }] }));
    expect(admit(queued, 2).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('gives everyone a spot of their own, nearest their desk, until they run out', () => {
    open();
    const spots = semicircle(PRESENTER, 4);
    const a = join(agent('a'), 'desk-0');
    const b = join(agent('b'), 'desk-0');
    expect(a && b).toBeTruthy();
    expect(a!.spot.id).not.toBe(b!.spot.id);
    join(agent('c'), 'desk-3');
    join(agent('d'), 'desk-3');
    expect(gathering()!.seats.size).toBe(4);
    expect(g().when(agent('e'), at('desk-0'))).toBe(false);
    expect(g().place!(agent('e'), at('desk-0'))).toBeNull();
    expect(new Set(gathering()!.seats.values())).toEqual(new Set([0, 1, 2, 3]));
    expect(spots.map((s) => s.id)).toContain(a!.spot.id);
  });

  it('a spot taken meanwhile is not given twice', () => {
    open();
    g().place!(agent('a'), at('desk-0'));
    g().place!(agent('b'), at('desk-0')); // the same spot looks free to both
    expect(g().claim!('a')).toBe(true);
    expect(g().claim!('b')).toBe(false);
  });

  it('they stand at their spot facing the middle doing what the gathering does, then go back when it closes', () => {
    const cur = open();
    const a = join(agent('a'), 'desk-0')!;
    let act = a.script.tick(me('a'));
    expect(act.do).toBe('stand');
    expect(act.heading).toBeCloseTo(headingFor(a.spot.facing));
    expect(cur.there.has('a')).toBe(true);
    cur.gesture = 'clap';
    expect(a.script.tick(me('a')).gesture).toBe('clap');
    cur.gestureOf = (id) => (id === 'a' ? 'nod' : null);
    expect(a.script.tick(me('a')).gesture).toBe('nod');
    closeGathering(cur);
    act = a.script.tick(me('a'));
    expect(act.do).toBe('done');
    a.script.end();
    expect(cur.seats.size).toBe(0);
  });

  it('nobody comes twice, and nobody new once it has started', () => {
    const cur = open();
    const a = join(agent('a'), 'desk-0')!;
    a.script.end(); // called back to work
    expect(g().when(agent('a'), at('desk-0'))).toBe(false);
    expect(g().when(agent('b'), at('desk-0'))).toBe(true);
    cur.open = false;
    expect(g().when(agent('b'), at('desk-0'))).toBe(false);
  });

  it('the nearest free spot', () => {
    const spots = [
      { x: 0, z: 0 },
      { x: 5, z: 0 },
      { x: 10, z: 0 },
    ];
    expect(nearestFreeSpot(spots, [], { x: 9, z: 0 })).toBe(2);
    expect(nearestFreeSpot(spots, [2], { x: 9, z: 0 })).toBe(1);
    expect(nearestFreeSpot(spots, [0, 1, 2], { x: 9, z: 0 })).toBeNull();
  });
});
