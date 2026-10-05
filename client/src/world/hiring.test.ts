import { describe, expect, it } from 'vitest';
import type { HireRequestView } from '../../../shared/types';
import type { Act, Me } from './errands';
import {
  CLOSE_ENOUGH,
  DOOR_SIDESTEP,
  FRONT_DOOR,
  GREET_RANGE,
  SHAKE_GAP,
  STOP_PATIENCE,
  WAVE_BACK,
  chairFront,
  declinedRoute,
  greetSpot,
  hiredRoute,
  leave,
  newlyHired,
  planTour,
  reactionFor,
  stepOut,
  syncCandidates,
  tourScript,
  waverFor,
  type Lobby,
  type TourStop,
} from './hiring';
import { HALF_W, SIDE_OPENINGS, WAITING, sideDoorway } from './layout';
import { CABIN } from './socials';
import { findPath, spot, standable, walkways } from './walkways';

const EMPTY: Lobby = { list: [], outside: 0 };
const req = (id: string, createdAt: number, over: Partial<HireRequestView> = {}) =>
  ({ id, kind: 'hire', status: 'pending', createdAt, agentId: null, repoId: 'o/r', ...over }) as HireRequestView;

describe('the waiting room', () => {
  it('seats pending hires oldest first, one per chair, and counts the rest as waiting outside', () => {
    const reqs = Array.from({ length: 8 }, (_, i) => req(`r${i}`, 100 - i)); // r7 is the oldest
    const l = syncCandidates(EMPTY, reqs);
    expect(WAITING.seats).toHaveLength(6);
    expect(l.list.map((c) => c.id)).toEqual(['r7', 'r6', 'r5', 'r4', 'r3', 'r2']);
    expect(l.list.map((c) => c.seat)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(l.list.every((c) => c.phase === 'waiting')).toBe(true);
    expect(l.outside).toBe(2);
  });

  it('leaves out let-go proposals and decisions it never saw waiting', () => {
    const l = syncCandidates(EMPTY, [req('a', 1, { kind: 'let-go' }), req('b', 2, { status: 'approved' }), req('c', 3, { status: 'rejected' }), req('d', 4)]);
    expect(l.list.map((c) => c.id)).toEqual(['d']);
    expect(l.outside).toBe(0);
  });

  it('keeps everyone in their chair as others come and go, and changes nothing when nothing changed', () => {
    const a = req('a', 1);
    const b = req('b', 2);
    const c = req('c', 3);
    const one = syncCandidates(EMPTY, [a, b, c]);
    expect(syncCandidates(one, [a, b, c])).toBe(one);
    // a's proposal vanishes (pruned): they go at once; b and c stay put, and a newcomer takes the free chair
    const two = syncCandidates(one, [b, c, req('d', 4)]);
    expect(two.list.map((x) => [x.id, x.seat])).toEqual([
      ['b', 1],
      ['c', 2],
      ['d', 0],
    ]);
  });

  it('a decision makes them react and leave, keeping their chair until they have walked out', () => {
    const reqs = Array.from({ length: 7 }, (_, i) => req(`r${i}`, i)); // r6 waits outside
    const one = syncCandidates(EMPTY, reqs);
    expect(one.outside).toBe(1);
    const decided = reqs.map((r) => (r.id === 'r0' ? { ...r, status: 'approved' as const } : r.id === 'r1' ? { ...r, status: 'rejected' as const } : r));
    const two = syncCandidates(one, decided);
    expect(two.list.find((c) => c.id === 'r0')).toEqual({ id: 'r0', seat: 0, phase: 'hired' });
    expect(two.list.find((c) => c.id === 'r1')).toEqual({ id: 'r1', seat: 1, phase: 'declined' });
    expect(two.outside).toBe(1); // their chairs aren't free yet
    // still leaving, whatever the proposal says now (even pruned)
    const three = syncCandidates(two, decided.filter((r) => r.id !== 'r0'));
    expect(three.list.find((c) => c.id === 'r0')?.phase).toBe('hired');
    // r0 is out of the building: r6 comes in from outside and sits in the free chair
    const four = syncCandidates(leave(three, 'r0'), decided);
    expect(four.list.find((c) => c.id === 'r6')).toEqual({ id: 'r6', seat: 0, phase: 'waiting' });
    expect(four.outside).toBe(0);
    expect(leave(four, 'nobody')).toBe(four);
  });

  it('knows who was just hired, so their floor can welcome them', () => {
    const before = [req('a', 1), req('b', 2), req('c', 3, { status: 'approved', agentId: 'old' })];
    const after = [
      { ...before[0], status: 'approved' as const, agentId: 'ada' },
      { ...before[1], status: 'rejected' as const },
      before[2],
      req('d', 4, { status: 'approved', agentId: 'auto', kind: 'hire' }), // never pending here: an auto-approval seen late
    ];
    expect(newlyHired(before, after)).toEqual([{ agentId: 'ada', repoId: 'o/r' }]);
    expect(newlyHired(before, [{ ...before[0], kind: 'let-go', status: 'approved', agentId: 'x' }])).toEqual([]);
  });
});

describe('taking the decision', () => {
  const lobby = walkways('lobby');
  const open = (x: number, z: number) => standable(lobby, x, z);

  it('hired: a handshake with the manager close by, a cheer when they decided from afar; declined: a nod', () => {
    expect(reactionFor('hired', true).gesture).toBe('shake');
    expect(reactionFor('hired', false).gesture).toBe('cheer');
    expect(reactionFor('declined', true).gesture).toBe('nod');
    expect(reactionFor('declined', false).gesture).toBe('nod');
  });

  it('a hired candidate walks up to a manager nearby to shake hands, a step away from them', () => {
    const front = chairFront(2);
    const manager = { x: front.x - 2.5, z: front.z + 1.5 };
    const g = greetSpot(2, manager, open);
    expect(g.near).toBe(true);
    expect(Math.hypot(g.at.x - manager.x, g.at.z - manager.z)).toBeCloseTo(SHAKE_GAP);
    expect(open(g.at.x, g.at.z)).toBe(true);
    // furniture right by the manager: a little further along
    const further = greetSpot(2, manager, (x, z) => Math.hypot(x - manager.x, z - manager.z) > SHAKE_GAP + 0.1);
    expect(Math.hypot(further.at.x - manager.x, further.at.z - manager.z)).toBeCloseTo(SHAKE_GAP + 0.25);
    // far away (the phone, from across the lobby): they stay by their chair
    expect(greetSpot(2, { x: front.x - GREET_RANGE - 1, z: front.z }, open)).toEqual({ at: front, near: false });
    // nowhere to stand: by their chair, still facing the manager
    expect(greetSpot(2, manager, () => false)).toEqual({ at: front, near: true });
  });

  it('every chair leads out: hired into the elevator, declined out of the front door and down the patio', () => {
    const door = sideDoorway('lobby', 'east');
    expect(FRONT_DOOR.inside.z).toBe(SIDE_OPENINGS.lobby.east.door);
    expect(FRONT_DOOR.outside.x).toBeGreaterThan(door.maxX);
    expect(standable(lobby, FRONT_DOOR.inside.x, FRONT_DOOR.inside.z)).toBe(true);
    WAITING.seats.forEach((_, seat) => {
      const from = chairFront(seat);
      const up = hiredRoute(lobby, from);
      expect(up, `seat ${seat}`).not.toBeNull();
      expect(up!.at(-1)).toEqual(CABIN);
      expect(up!.at(-2)).toEqual({ x: spot(lobby, 'elevator')!.x, z: spot(lobby, 'elevator')!.z });
      const out = declinedRoute(lobby, from);
      expect(out, `seat ${seat}`).not.toBeNull();
      expect(out!.slice(-3)).toEqual([FRONT_DOOR.inside, FRONT_DOOR.outside, FRONT_DOOR.away]);
      expect(out!.at(-1)!.x).toBeGreaterThan(HALF_W); // out of the building
    });
  });
});

describe('the welcome tour', () => {
  const office = walkways('office');
  const lift = spot(office, 'elevator')!;

  it('takes in the whiteboard, the coffee machine and the gong in one loop from the elevator', () => {
    const stops = planTour(office, lift);
    expect(stops.map((s) => s.what).sort()).toEqual(['coffee machine', 'gong', 'whiteboard']);
    expect(stops[0].what).toBe('coffee machine'); // nearest to the elevator
    expect(stops.find((s) => s.what === 'whiteboard')!.spot.id).toMatch(/^board-/);
    // each leg can be walked, and so can the last stop to every desk
    let here = { x: lift.x, z: lift.z };
    for (const s of stops) {
      expect(findPath(office, here, s.spot), s.what).not.toBeNull();
      here = s.spot;
    }
    for (const home of office.homes) expect(findPath(office, here, home), home.id).not.toBeNull();
  });

  it('steps out of the elevator round you when you rode up together, straight out otherwise', () => {
    const coffee = spot(office, 'coffee')!;
    expect(stepOut(lift, { x: 0, z: -5 }, coffee)).toEqual({ x: lift.x, z: lift.z });
    expect(stepOut(lift, { x: lift.x + 0.4, z: lift.z - 0.6 }, coffee)).toEqual({ x: lift.x - DOOR_SIDESTEP, z: lift.z });
    expect(stepOut(lift, { x: lift.x - 0.4, z: lift.z - 0.6 }, coffee)).toEqual({ x: lift.x + DOOR_SIDESTEP, z: lift.z });
    // dead ahead: the side the tour heads for (the coffee machine is east)
    expect(stepOut(lift, { x: lift.x, z: lift.z - 0.6 }, coffee)).toEqual({ x: lift.x + DOOR_SIDESTEP, z: lift.z });
    for (const side of [-1, 1]) expect(standable(office, lift.x + side * DOOR_SIDESTEP, lift.z)).toBe(true);
  });

  it('leaves out stops a floor lacks', () => {
    const bare = { ...office, spots: office.spots.filter((s) => s.id !== 'gong') };
    expect(planTour(bare, lift).map((s) => s.what)).not.toContain('gong');
  });

  /** Runs a tour script with someone who gets wherever they're sent at once; returns what they did each step. */
  function run(stops: TourStop[], waves: boolean) {
    const arrived: string[] = [];
    const progress: (string | null)[] = [];
    const sc = tourScript(stops, {
      arrive: (stop) => {
        arrived.push(stop.what);
        return waves ? { x: 0, z: 0 } : null;
      },
      progress: (s) => progress.push(s?.what ?? null),
    });
    const me: Me = { id: 'ada', x: 0, z: 11, heading: 0, arrived: false, dt: 0.1, player: { x: 0, z: 0 } };
    const acts: Act[] = [];
    for (let i = 0; i < 400; i++) {
      const a = sc.tick(me);
      acts.push(a);
      if (a.do === 'done') break;
      if (a.do === 'walk') {
        // the walk takes a frame, then they're there
        me.arrived = me.x === a.x && me.z === a.z;
        me.x = a.x;
        me.z = a.z;
      }
    }
    sc.end();
    return { acts, arrived, progress };
  }

  it('walks to each stop, has a moment there, waves back at the teammate who waved, and then heads for their desk', () => {
    const stops = planTour(office, lift);
    const { acts, arrived, progress } = run(stops, true);
    expect(acts.at(-1)!.do).toBe('done');
    expect(arrived).toEqual(stops.map((s) => s.what));
    expect(progress).toEqual([...stops.map((s) => s.what), null, null]); // the last null: end()
    for (const s of stops) {
      const at = acts.filter((a) => a.do === 'stand' && a.x === s.spot.x && a.z === s.spot.z);
      expect(at.filter((a) => a.gesture === s.gesture).length * 0.1).toBeCloseTo(s.seconds, 0);
      expect(at.filter((a) => a.gesture === 'wave').length * 0.1).toBeCloseTo(WAVE_BACK, 0);
    }
    // nobody waved: no waving back
    expect(run(stops, false).acts.some((a) => a.gesture === 'wave')).toBe(false);
  });

  it("doesn't count arriving at the last stop as arriving at the next, and skips a stop it can't reach", () => {
    const stops = planTour(office, lift);
    const sc = tourScript(stops, { arrive: () => null, progress: () => undefined });
    const me: Me = { id: 'ada', x: stops[0].spot.x, z: stops[0].spot.z, heading: 0, arrived: true, dt: 0.1, player: { x: 0, z: 0 } };
    // standing on stop 0 with "arrived" left over from somewhere else: the first tick only asks to walk
    expect(sc.tick(me).do).toBe('walk');
    expect(sc.tick(me).do).toBe('stand'); // now it counts
    // stuck on the way to stop 1: after STOP_PATIENCE it moves on to stop 2
    me.arrived = false;
    let a = sc.tick(me);
    while (a.do === 'stand') a = sc.tick(me);
    expect(a).toMatchObject({ do: 'walk', x: stops[1].spot.x, z: stops[1].spot.z });
    for (let t = 0; t < STOP_PATIENCE + 1; t += 0.1) a = sc.tick(me);
    expect(a).toMatchObject({ do: 'walk', x: stops[2].spot.x, z: stops[2].spot.z });
  });

  it('has its moment from close by when someone is using the stop', () => {
    const stops = planTour(office, lift);
    const sc = tourScript(stops, { arrive: () => null, progress: () => undefined });
    const s0 = stops[0].spot;
    const me: Me = { id: 'ada', x: s0.x - 1, z: s0.z, heading: 0, arrived: false, dt: 0.1, player: { x: 0, z: 0 } };
    let a = sc.tick(me);
    for (let t = 0; t < CLOSE_ENOUGH.s - 0.3; t += 0.1) a = sc.tick(me);
    expect(a.do).toBe('walk'); // not yet: they may still get there
    for (let t = 0; t < 0.6; t += 0.1) a = sc.tick(me);
    expect(a).toMatchObject({ do: 'stand', x: s0.x - 1, z: s0.z, gesture: stops[0].gesture });
    // held up further away, they keep trying
    const far = tourScript(stops, { arrive: () => null, progress: () => undefined });
    const me2: Me = { ...me, x: s0.x - 3 };
    for (let t = 0; t < 5; t += 0.1) a = far.tick(me2);
    expect(a.do).toBe('walk');
  });

  it('the teammate who waves is the nearest one seated, never the new hire', () => {
    const seated = [
      { id: 'ada', x: 0, z: 0 },
      { id: 'grace', x: 3, z: 0 },
      { id: 'linus', x: 9, z: 0 },
    ];
    expect(waverFor('ada', { x: 0.5, z: 0 }, seated)?.id).toBe('grace');
    expect(waverFor('ada', { x: 0, z: 0 }, [])).toBeNull();
  });
});
