import { describe, expect, it } from 'vitest';
import { ROOMBA } from './roombaBrain';
import { BUMP_GAP, HUM_FAR, bumpAllowed, humFor, humReach, type Hum } from './roombaSound';

const hum = (): Hum => ({ level: -1, pitch: -1 });

describe('humFor', () => {
  it('is off while charging, parked or waiting', () => {
    expect(humFor('charging', 'idle', 0, hum()).level).toBe(0);
    expect(humFor('cleaning', 'wait', 0, hum()).level).toBe(0);
    expect(humFor('returning', 'wait', 0, hum()).level).toBe(0);
  });

  it('rises in level and pitch with speed', () => {
    const slow = { ...humFor('cleaning', 'drive', ROOMBA.speed * 0.3, hum()) };
    const fast = humFor('cleaning', 'drive', ROOMBA.speed, hum());
    expect(slow.level).toBeGreaterThan(0);
    expect(fast.level).toBeGreaterThan(slow.level);
    expect(fast.pitch).toBeGreaterThan(slow.pitch);
    expect(fast.level).toBeLessThanOrEqual(1);
    expect(fast.pitch).toBe(1);
  });

  it('changes a little while turning on the spot, and hums for a spin even on the dock', () => {
    const drive = { ...humFor('cleaning', 'drive', ROOMBA.speed, hum()) };
    const turn = humFor('cleaning', 'turn', 0, hum());
    expect(turn.level).toBeGreaterThan(0);
    expect(turn.pitch).not.toBe(drive.pitch);
    expect(humFor('charging', 'spin', 0, hum()).level).toBeGreaterThan(0);
  });

  it('writes into the object it was given', () => {
    const out = hum();
    expect(humFor('cleaning', 'drive', 0.2, out)).toBe(out);
  });
});

describe('humReach', () => {
  it('is full close by, fades out and is off from HUM_FAR', () => {
    expect(humReach(0)).toBe(1);
    expect(humReach(2)).toBe(1);
    expect(humReach(5)).toBeGreaterThan(0);
    expect(humReach(5)).toBeLessThan(humReach(4));
    expect(humReach(HUM_FAR)).toBe(0);
    expect(humReach(20)).toBe(0);
  });
});

describe('bumpAllowed', () => {
  it('rate-limits bonks', () => {
    expect(bumpAllowed(-Infinity, 0)).toBe(true);
    expect(bumpAllowed(10, 10 + BUMP_GAP / 2)).toBe(false);
    expect(bumpAllowed(10, 10 + BUMP_GAP)).toBe(true);
  });
});
