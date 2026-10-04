import { describe, expect, it } from 'vitest';
import { WALL_H } from '../layout';
import { BLASTER } from './darts';
import { BURST_GAP_MS, PERSON_HUSH_STEPS, QUIET_SPEED, dartImpact, dartSurface, heardSurface, landingSpeed, nextBurst, reloadCues, thwipVoice } from './blasterSounds';

describe('dartSurface', () => {
  const fixed = { fixed: true, normalY: 0, y: 1.2 };

  it('tells walls and boards from furniture by height', () => {
    expect(dartSurface({ ...fixed, halfHeight: WALL_H / 2 })).toBe('wall');
    expect(dartSurface({ ...fixed, halfHeight: 3.45 / 2 })).toBe('wall'); // the kanban board
    expect(dartSurface({ ...fixed, halfHeight: 0.78 / 2 })).toBe('furniture'); // a desk
    expect(dartSurface({ ...fixed, halfHeight: null })).toBe('wall');
  });

  it('knows the floor from a desk top', () => {
    expect(dartSurface({ fixed: true, halfHeight: 0.5, normalY: 1, y: 0 })).toBe('floor');
    expect(dartSurface({ fixed: true, halfHeight: 0.39, normalY: 1, y: 0.78 })).toBe('furniture');
  });

  it('tells balls from other moving things', () => {
    const moving = { fixed: false, halfHeight: null, normalY: 0, y: 1 };
    expect(dartSurface({ ...moving, tag: { toy: 'beach-ball' } })).toBe('ball');
    expect(dartSurface({ ...moving, tag: { toy: 'blaster-blue' } })).toBe('toy');
    expect(dartSurface({ ...moving, tag: { toy: 'dart' } })).toBe('toy');
    expect(dartSurface({ ...moving, tag: { toy: 'roomba' } })).toBe('toy');
    expect(dartSurface({ ...moving, tag: undefined })).toBe('toy');
    expect(dartSurface({ ...moving, tag: { seat: 'ada' } })).toBe('person');
  });
});

describe('dartImpact', () => {
  it('gives each surface its own sound', () => {
    expect(dartImpact('stick', 'wall', 18)?.sound).toBe('thwock');
    expect(dartImpact('stick', 'furniture', 18)?.sound).toBe('tock');
    expect(dartImpact('glance', 'furniture', 18)?.sound).toBe('tick');
    expect(dartImpact('glance', 'wall', 18)?.sound).toBe('tick');
    expect(dartImpact('glance', 'ball', 18)?.sound).toBe('bonk');
    expect(dartImpact('land', 'floor', 3)?.sound).toBe('patter');
    expect(dartImpact('land', 'furniture', 3)?.sound).toBe('tick');
  });

  it('is louder for harder hits, within 0.25 to 1', () => {
    const soft = dartImpact('land', 'floor', 1)!.gain;
    const hard = dartImpact('land', 'floor', 3)!.gain;
    expect(hard).toBeGreaterThan(soft);
    expect(dartImpact('stick', 'wall', 50)!.gain).toBe(1);
    expect(dartImpact('land', 'floor', QUIET_SPEED)!.gain).toBe(0.25);
  });

  it('stays quiet for gentle touches', () => {
    expect(dartImpact('land', 'floor', QUIET_SPEED / 2)).toBeNull();
    expect(dartImpact('land', 'floor', NaN)).toBeNull();
  });

  it('leaves people to say boop themselves', () => {
    expect(dartImpact('glance', 'person', 18)).toBeNull();
  });

  it("doesn't tick on the chair right after reaching someone", () => {
    expect(heardSurface('furniture', 1, 'wall')).toBe('person');
    expect(heardSurface(null, PERSON_HUSH_STEPS, 'furniture')).toBe('person');
    expect(heardSurface('furniture', PERSON_HUSH_STEPS + 1, 'wall')).toBe('furniture');
    expect(heardSurface(null, Infinity, 'furniture')).toBe('furniture');
  });
});

describe('landingSpeed', () => {
  it('hears a falling body stop', () => {
    expect(landingSpeed(-3, 0.9)).toBe(3);
    expect(landingSpeed(-3, -0.5)).toBe(3);
  });

  it('ignores free fall, rising and resting', () => {
    expect(landingSpeed(-3, -3.16)).toBeNull(); // one step of gravity
    expect(landingSpeed(2, 1.8)).toBeNull();
    expect(landingSpeed(-0.1, 0)).toBeNull();
  });
});

describe('thwips', () => {
  it('varies each shot a little', () => {
    const lo = thwipVoice(0, 0).pitch;
    const hi = thwipVoice(0, 1).pitch;
    expect(lo).toBeLessThan(1);
    expect(hi).toBeGreaterThan(1);
    expect(hi - lo).toBeLessThan(0.2);
  });

  it('never repeats the same note shot after shot in a burst', () => {
    expect(thwipVoice(1, 0.5).pitch).not.toBe(thwipVoice(2, 0.5).pitch);
  });

  it('softens a long burst, but not below 70%', () => {
    expect(thwipVoice(5, 0.5).gain).toBeLessThan(thwipVoice(0, 0.5).gain);
    expect(thwipVoice(BLASTER.mag * 3, 0.5).gain).toBe(0.7);
  });

  it('counts a burst while shots keep coming', () => {
    expect(nextBurst(0, BLASTER.gapMs)).toBe(1);
    expect(nextBurst(4, BLASTER.gapMs)).toBe(5);
    expect(nextBurst(4, BURST_GAP_MS + 1)).toBe(0);
  });
});

describe('reloadCues', () => {
  it('fits mag out, mag in and the click inside the reload, in order', () => {
    const c = reloadCues(BLASTER.reloadMs);
    expect(c.magOut).toBeGreaterThanOrEqual(0);
    expect(c.magIn).toBeGreaterThan(c.magOut);
    expect(c.ready).toBeGreaterThanOrEqual(c.magIn);
    expect(c.ready).toBeLessThan(BLASTER.reloadMs / 1000);
  });
});
