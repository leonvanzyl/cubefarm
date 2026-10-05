import { describe, expect, it } from 'vitest';
import { createStepTracker } from '../../ui/footstepRules';
import { GALLOP, cadence, headAim, newJoints, rig, wagRate, wagWidth, type RigInput } from './dogRig';
import { HEAR, clawLevel, mayVoice, pantDue, pawDown, tapDue } from './dogSound';

const input = (over: Partial<RigInput> = {}): RigInput => ({
  pose: 'stand',
  speed: 0,
  happy: 0.5,
  wiggle: 0,
  phase: 0,
  t: 0,
  panting: false,
  carrying: false,
  lookYaw: 0,
  lookPitch: 0,
  looking: false,
  ...over,
});

describe("the dog's rig", () => {
  it('trots on diagonal pairs and gallops front pair then rear pair', () => {
    const j = newJoints();
    rig(input({ speed: 1.8, phase: 1 }), j);
    expect(j.fl).toBeCloseTo(j.rr);
    expect(j.fr).toBeCloseTo(j.rl);
    expect(j.fl).toBeCloseTo(-j.fr);
    expect(Math.abs(j.fl)).toBeGreaterThan(0.1);
    rig(input({ speed: GALLOP + 1, phase: 1 }), j);
    expect(Math.sign(j.fl)).toBe(Math.sign(j.fr));
    expect(Math.sign(j.rl)).toBe(-Math.sign(j.fl));
    expect(j.earBack).toBeGreaterThan(0.5); // ears stream back
    expect(j.tongue).toBe(1);
  });

  it('strides quicker the faster it goes', () => {
    expect(cadence(0)).toBe(0);
    expect(cadence(1.9)).toBeGreaterThan(cadence(1.1));
    expect(cadence(3.8)).toBeGreaterThan(cadence(1.9));
  });

  it('sits with its front up and rear legs folded, lies down low, sleeps chin on paws', () => {
    const j = newJoints();
    rig(input({ pose: 'sit' }), j);
    expect(j.pitch).toBeGreaterThan(0.3);
    expect(j.rl).toBeGreaterThan(1);
    const sit = j.drop;
    rig(input({ pose: 'lie' }), j);
    expect(j.drop).toBeGreaterThan(sit);
    expect(j.fl).toBeGreaterThan(1);
    rig(input({ pose: 'sleep' }), j);
    expect(j.headPitch).toBeLessThan(-0.3);
    expect(j.tailYaw).toBeCloseTo(0.6); // curled round, still
    // a pose only shows standing still: walking, the legs walk
    rig(input({ pose: 'sit', speed: 1.5, phase: 1 }), j);
    expect(j.pitch).toBe(0);
  });

  it('wags harder and higher the happier it is', () => {
    expect(wagWidth(1)).toBeGreaterThan(wagWidth(0) * 3);
    expect(wagRate(1)).toBeGreaterThan(wagRate(0) * 3);
    const j = newJoints();
    let calm = 0;
    let glad = 0;
    for (let t = 0; t < 3; t += 0.01) {
      calm = Math.max(calm, Math.abs(rig(input({ happy: 0.1, t }), j).tailYaw));
      glad = Math.max(glad, Math.abs(rig(input({ happy: 1, t }), j).tailYaw));
    }
    expect(glad).toBeGreaterThan(calm * 2);
    expect(rig(input({ happy: 1 }), j).tailLift).toBeGreaterThan(rig(input({ happy: 0 }), j).tailLift);
  });

  it('wiggles after a pet, then stops', () => {
    const j = newJoints();
    let most = 0;
    for (let t = 0; t < 1; t += 0.01) most = Math.max(most, Math.abs(rig(input({ wiggle: 1, t }), j).sway));
    expect(most).toBeGreaterThan(0.15);
    expect(rig(input({ wiggle: 0, t: 0.3 }), j).sway).toBe(0);
  });

  it('turns its head towards what it looks at, within reason', () => {
    // facing east (+x), a ball to its left (north, -z) and up
    const a = headAim(0, 1, 1, -1);
    expect(a.yaw).toBeGreaterThan(0.5);
    expect(a.pitch).toBeGreaterThan(0.3);
    const behind = headAim(0, -3, 0, 0.1);
    expect(Math.abs(behind.yaw)).toBeLessThanOrEqual(1);
  });
});

describe("the dog's sounds", () => {
  it('woofs at most every so often', () => {
    expect(mayVoice(0, 0.5)).toBe(false);
    expect(mayVoice(0, 1.3)).toBe(true);
  });

  it('taps its claws on hard floors, four paws a stride, but not on rugs or far away', () => {
    expect(clawLevel('rug')).toBe(0);
    expect(clawLevel('wood')).toBeGreaterThan(0);
    expect(clawLevel('lobby')).toBeGreaterThan(clawLevel('wood'));
    const t = createStepTracker();
    let paws = 0;
    for (let phase = 0; phase < Math.PI * 2 * 3; phase += 0.05) if (pawDown(t, phase, true)) paws++;
    expect(paws).toBeGreaterThanOrEqual(11);
    expect(paws).toBeLessThanOrEqual(13);
    expect(tapDue(true, 'wood', 2, 0, 1)).toBe(true);
    expect(tapDue(true, 'rug', 2, 0, 1)).toBe(false);
    expect(tapDue(true, 'wood', HEAR + 1, 0, 1)).toBe(false);
    expect(tapDue(true, 'wood', 2, 1, 1.05)).toBe(false);
  });

  it('pants on a beat while out of breath, only close by', () => {
    expect(pantDue(true, 3, 0, 0.5)).toBe(true);
    expect(pantDue(true, 3, 0.4, 0.5)).toBe(false);
    expect(pantDue(false, 3, 0, 5)).toBe(false);
    expect(pantDue(true, HEAR + 1, 0, 5)).toBe(false);
  });
});
