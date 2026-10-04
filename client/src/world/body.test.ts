import { describe, expect, it } from 'vitest';
import { SIT_SECONDS, angleDelta, gait, newBodyState, stepBody, type BodyState, type BodyTarget } from './body';

const target = (over: Partial<BodyTarget> = {}): BodyTarget => ({ mode: 'walking', x: 4, z: 0, heading: 0, speed: 1.1, gesture: 'none', teleport: 0, ...over });

function seatedAt(): BodyState {
  const s = newBodyState();
  Object.assign(s, { seatX: 0, seatZ: 0, seatHeading: 0, standX: 0.6, standZ: -0.1 });
  return stepBody(s, null, 0.016);
}

const run = (s: BodyState, t: BodyTarget | null, seconds: number, dt = 1 / 60) => {
  for (let i = 0; i < seconds / dt; i++) stepBody(s, t, dt);
  return s;
};

describe('angleDelta', () => {
  it('takes the short way round', () => {
    expect(angleDelta(0, 0.5)).toBeCloseTo(0.5);
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(angleDelta(-3, 3)).toBeCloseTo(6 - 2 * Math.PI);
  });
});

describe('stepBody', () => {
  it('stays put in the chair with no target', () => {
    const s = run(seatedAt(), null, 2);
    expect(s).toMatchObject({ stage: 'seated', sit: 1, x: 0, z: 0, speed: 0 });
  });

  it('rises to the standing spot in about the transition time', () => {
    const s = seatedAt();
    run(s, target({ x: 0.6, z: -0.1 }), SIT_SECONDS - 0.1);
    expect(s.stage).toBe('rising');
    run(s, target({ x: 0.6, z: -0.1 }), 0.2);
    expect(s.stage).toBe('up');
    expect(s.sit).toBe(0);
    expect(s.x).toBeCloseTo(0.6);
  });

  it('walks to the target, facing the way it goes, then stops', () => {
    const s = seatedAt();
    const t = target({ x: 4, z: -0.1, heading: 1 });
    run(s, t, 1.5);
    expect(s.speed).toBeGreaterThan(0.5);
    expect(Math.abs(angleDelta(s.heading, -Math.PI / 2))).toBeLessThan(0.1); // heading +X
    run(s, t, 6);
    expect(s.x).toBeCloseTo(4, 1);
    expect(s.speed).toBe(0);
    expect(s.heading).toBeCloseTo(1, 1);
  });

  it('never walks faster than asked', () => {
    const s = seatedAt();
    let top = 0;
    for (let i = 0; i < 400; i++) top = Math.max(top, stepBody(s, target({ x: 20, speed: 2.5 }), 1 / 60).speed);
    expect(top).toBeLessThanOrEqual(2.5);
    expect(top).toBeGreaterThan(2.4);
  });

  it('walks back to the standing spot and sits down when the target goes away', () => {
    const s = seatedAt();
    run(s, target({ x: 3, z: 2 }), 6);
    expect(s.stage).toBe('up');
    run(s, null, 8);
    expect(s).toMatchObject({ stage: 'seated', sit: 1, x: 0, z: 0, heading: 0 });
  });

  it('turns round mid-transition without jumping', () => {
    const s = seatedAt();
    run(s, target(), 0.3);
    const sit = s.sit;
    stepBody(s, null, 1 / 60);
    stepBody(s, null, 1 / 60);
    expect(s.stage).toBe('sitting');
    expect(Math.abs(s.sit - sit)).toBeLessThan(0.05);
  });

  it('keeps the heading within one turn', () => {
    const s = seatedAt();
    run(s, target({ x: 0, z: 3, heading: 3 }), 5);
    run(s, target({ x: 0, z: 3, heading: -3 }), 2);
    expect(Math.abs(s.heading)).toBeLessThanOrEqual(Math.PI);
    expect(s.heading).toBeCloseTo(-3, 1);
  });

  it('teleports when asked', () => {
    const s = seatedAt();
    stepBody(s, target({ mode: 'standing', x: 5, z: 5, heading: 2, teleport: 1 }), 1 / 60);
    expect(s).toMatchObject({ stage: 'up', sit: 0, x: 5, z: 5, heading: 2 });
  });

  it('advances the walk cycle only while moving', () => {
    const s = seatedAt();
    run(s, target({ x: 0.6, z: -0.1 }), 2);
    const phase = s.phase;
    run(s, target({ x: 0.6, z: -0.1 }), 1);
    expect(s.phase).toBe(phase);
  });
});

describe('gait', () => {
  it('takes longer, quicker steps when hurrying', () => {
    const walk = gait(1.1, { stride: 0, cadence: 0, bob: 0, lean: 0 });
    const run = gait(2.5, { stride: 0, cadence: 0, bob: 0, lean: 0 });
    expect(run.stride).toBeGreaterThan(walk.stride);
    expect(run.cadence).toBeGreaterThan(walk.cadence);
    expect(run.lean).toBeGreaterThan(walk.lean);
    expect(walk.cadence).toBeGreaterThan(1.5);
    expect(walk.cadence).toBeLessThan(2.5);
  });

  it('stands still at zero speed', () => {
    expect(gait(0, { stride: 0, cadence: 0, bob: 0, lean: 0 }).cadence).toBe(0);
  });
});
