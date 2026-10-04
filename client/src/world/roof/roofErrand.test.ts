import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '../errands.ts';
import { errandNamed } from '../errands.ts';
import { isHidden } from '../people.ts';
import { CABIN } from '../socials.ts';
import { endVisit, ROOF_BREAK, roofVisit, roofVisits, startVisit } from './roofBreaks.ts';
import { rideUp } from './roofErrand.ts';

// A roof break seen from downstairs: into the elevator, out of sight while up top, then back out of it. The elevator's
// ding and the store (which needs a browser) are stubbed.
vi.mock('../../ui/sfx', () => ({ ding: vi.fn() }));
vi.mock('../../store', () => ({ useStore: { subscribe: vi.fn(), getState: vi.fn() } }));

const me = (arrived: boolean, dt = 0.1): Me => ({ id: 'kai', x: CABIN.x, z: CABIN.z, heading: 0, arrived, dt, player: { x: 0, z: 0 } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  for (const v of roofVisits(0)) endVisit(v.id);
  vi.useRealTimers();
});

describe('a roof break, downstairs', () => {
  it('walks into the cabin, rides up out of sight, and comes back out after its time up there', () => {
    const script = rideUp('kai', 'break');
    expect(script.tick(me(false))).toMatchObject({ do: 'walk', x: CABIN.x, z: CABIN.z, heading: 0 });
    expect(script.tick(me(true)).do).toBe('stand'); // in, turned to the doors
    expect(roofVisit('kai')).toBeNull();
    for (let i = 0; i < 10; i++) script.tick(me(true)); // the doors close on them
    const v = roofVisit('kai')!;
    expect(v).toMatchObject({ kind: 'break' });
    expect(v.arrive).toBe(Date.now() + ROOF_BREAK.ride * 1000);
    expect(isHidden('kai')).toBe(true);
    // while they're up there they stay out of sight
    vi.setSystemTime(v.leave);
    expect(script.tick(me(true)).do).toBe('stand');
    expect(isHidden('kai')).toBe(true);
    // the ride back down: out of the cabin, then home (the errand director walks them)
    vi.setSystemTime(v.leave + ROOF_BREAK.ride * 1000);
    expect(script.tick(me(true)).do).toBe('stand');
    expect(isHidden('kai')).toBe(false);
    expect(roofVisit('kai')).toBeNull();
    let last = 'stand';
    for (let i = 0; i < 20 && last !== 'done'; i++) last = script.tick(me(true)).do;
    expect(last).toBe('done');
  });

  it('steps back out if the roof filled up while they walked over', () => {
    startVisit({ id: 'a', kind: 'break', chair: 0, arrive: Date.now(), leave: Date.now() + 60_000 });
    startVisit({ id: 'b', kind: 'break', chair: 1, arrive: Date.now(), leave: Date.now() + 60_000 });
    const script = rideUp('kai', 'break');
    script.tick(me(true));
    let act = 'stand';
    for (let i = 0; i < 10 && act === 'stand'; i++) act = script.tick(me(true)).do;
    expect(act).toBe('done');
    expect(isHidden('kai')).toBe(false);
  });

  it('is in sight again however it ends', () => {
    const script = rideUp('kai', 'call');
    script.tick(me(true));
    for (let i = 0; i < 10; i++) script.tick(me(true));
    expect(isHidden('kai')).toBe(true);
    expect(roofVisit('kai')?.kind).toBe('call');
    script.end();
    expect(isHidden('kai')).toBe(false);
    expect(roofVisit('kai')).not.toBeNull(); // up top it carries on: follow them and they're there
  });

  it('is an errand for the team on office floors and for the CEO in the lobby, rarely', () => {
    const team = errandNamed('roof')!;
    const ceo = errandNamed('roof-call')!;
    const restless = { statusFor: 100, seatedFor: 100, restless: 30 };
    expect(team.when({ id: 'kai', role: 'dev', status: 'idle' }, { ...restless, floor: 'office' })).toBe(true);
    expect(team.when({ id: 'kai', role: 'dev', status: 'working' }, { ...restless, floor: 'office' })).toBe(false);
    expect(team.when({ id: 'kai', role: 'dev', status: 'idle' }, { ...restless, seatedFor: 5, floor: 'office' })).toBe(false);
    expect(team.when({ id: 'boss', role: 'ceo', status: 'idle' }, { ...restless, floor: 'lobby' })).toBe(false);
    expect(ceo.when({ id: 'boss', role: 'ceo', status: 'idle' }, { ...restless, floor: 'lobby' })).toBe(true);
    expect(team.spot).toEqual(['elevator']);
    expect(team.weight).toBeLessThan(0.5);
  });
});
