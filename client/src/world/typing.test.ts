import { describe, expect, it } from 'vitest';
import { CEO_DESK, EAST_DESKS, MAX_DESKS, deskPosition } from './layout';
import {
  KEYBOARD_OFFSET,
  assignSlots,
  burstLevel,
  handLift,
  inBurst,
  keyboardSpot,
  mouseDip,
  nearestK,
  nextKeyDown,
  nextMouseClick,
  nextPhase,
  nextScrollTick,
  poseFor,
  strokeAt,
  tapSpeed,
  typingSeed,
} from './typing';

describe('the rhythm matches the arm animation', () => {
  it('keeps the old burst, tap and mouse maths', () => {
    for (let t = 0; t < 40; t += 0.137) {
      expect(burstLevel(t)).toBe(Math.sin(t * 0.8) + Math.sin(t * 2.1) * 0.6 > -0.35 ? 1 : 0.15);
      expect(handLift(t, 19, 2.4)).toBe(Math.max(0, Math.sin(t * 19 + 2.4)));
      expect(mouseDip(t)).toBe(Math.sin(t * 5.3) > 0.93 ? 0.04 : 0);
    }
    expect(tapSpeed('working')).toBe(19);
    expect(tapSpeed('preparing')).toBe(10);
  });

  it('puts a key click where the hand comes back down', () => {
    for (const [speed, phase] of [
      [19, 0],
      [19, 2.4],
      [10, 0],
    ]) {
      let t = 3.21;
      for (let i = 0; i < 20; i++) {
        const next = nextKeyDown(t, speed, phase);
        expect(next).toBeGreaterThan(t);
        expect(next - t).toBeLessThanOrEqual((2 * Math.PI) / speed + 1e-9);
        expect(handLift(next - 0.004, speed, phase)).toBeGreaterThan(0);
        expect(handLift(next + 0.004, speed, phase)).toBe(0);
        t = next;
      }
    }
  });

  it('puts a mouse click at the start of the dip', () => {
    let t = 1;
    for (let i = 0; i < 10; i++) {
      const next = nextMouseClick(t);
      expect(mouseDip(next - 0.002)).toBe(0);
      expect(mouseDip(next + 0.002)).toBe(0.04);
      t = next;
    }
  });

  it('never returns the same time again', () => {
    const t = nextPhase(1, 4, 0.5, 1);
    expect(nextPhase(t, 4, 0.5, 1)).toBeCloseTo(t + (2 * Math.PI) / 4, 9);
  });

  it('scrolls only in reading pauses', () => {
    let ticks = 0;
    for (let t = nextScrollTick(0, 60); t <= 60; t = nextScrollTick(t, 60)) {
      expect(inBurst(t)).toBe(false);
      ticks++;
    }
    expect(ticks).toBeGreaterThan(0);
  });

  it('ends a burst with enter, from the right hand only', () => {
    const strokes = new Set<string>();
    for (let t = nextKeyDown(0, 19, 2.4); t < 120; t = nextKeyDown(t, 19, 2.4)) if (inBurst(t)) strokes.add(strokeAt(t, 19, 1));
    expect(strokes).toEqual(new Set(['key', 'space', 'enter']));
    for (let t = nextKeyDown(0, 19, 0); t < 120; t = nextKeyDown(t, 19, 0)) expect(strokeAt(t, 19, 0)).not.toBe('enter');
  });

  it('gives each person a stable offset', () => {
    expect(typingSeed('ada')).toBe(typingSeed('ada'));
    expect(typingSeed('ada')).not.toBe(typingSeed('bob'));
    expect(typingSeed('ada')).toBeGreaterThanOrEqual(0);
    expect(typingSeed('ada')).toBeLessThan(100);
  });
});

describe('poseFor', () => {
  it('picks the pose from the status and recent tools', () => {
    expect(poseFor('preparing', null, null, 1e9, false)).toBe('typing');
    expect(poseFor('working', 'Edit', 'Edit', 0, false)).toBe('typing');
    expect(poseFor('working', null, 'Edit', 1000, false)).toBe('typing');
    expect(poseFor('working', null, 'Edit', 3000, false)).toBe('thinking');
    expect(poseFor('working', null, 'mcp__playwright__browser_click', 3000, false)).toBe('browsing');
    expect(poseFor('working', null, 'mcp__playwright__browser_click', 5000, false)).toBe('thinking');
    expect(poseFor('error', null, null, 0, false)).toBe('slump');
    expect(poseFor('done', null, null, 0, true)).toBe('cheer');
    expect(poseFor('idle', 'Edit', 'Edit', 0, false)).toBe('relaxed');
  });
});

describe('keyboardSpot', () => {
  const out = { x: 0, y: 0, z: 0 };
  it('sits in front of an agent', () => {
    const d = deskPosition(5);
    expect(keyboardSpot('agent', 5, false, out)).toEqual({ x: d.x, y: KEYBOARD_OFFSET.y, z: d.z + KEYBOARD_OFFSET.z });
    expect(keyboardSpot('ceo', 0, false, out)).toEqual({ x: CEO_DESK.x, y: KEYBOARD_OFFSET.y, z: CEO_DESK.z + KEYBOARD_OFFSET.z });
  });
  it("turns with the east wall's desks", () => {
    const s = keyboardSpot('agent', MAX_DESKS + 1, false, out);
    expect(s.x).toBeCloseTo(EAST_DESKS.x - KEYBOARD_OFFSET.z, 9);
    expect(s.z).toBeCloseTo(EAST_DESKS.z[1], 9);
    const m = keyboardSpot('agent', MAX_DESKS + 1, true, { x: 0, y: 0, z: 0 });
    expect(Math.hypot(m.x - s.x, m.z - s.z)).toBeGreaterThan(0.4);
  });
});

describe('who gets heard', () => {
  it('picks the nearest few, nearest first', () => {
    const out = new Int32Array(4);
    const dist = [9, 2, 14, 1, 7, 3, 12];
    expect(nearestK(dist, dist.length, 4, out)).toBe(4);
    expect(Array.from(out)).toEqual([3, 1, 5, 4]);
    expect(nearestK(dist, 2, 4, out)).toBe(2);
    expect(Array.from(out.slice(0, 2))).toEqual([1, 0]);
    expect(nearestK(dist, 0, 4, out)).toBe(0);
  });

  it('keeps people in their channel and fills the gaps', () => {
    const slots: (string | null)[] = [null, null, null, null];
    assignSlots(slots, ['a', 'b', 'c'], 3);
    expect(slots).toEqual(['a', 'b', 'c', null]);
    assignSlots(slots, ['d', 'c', 'a', 'e'], 4);
    expect(slots).toEqual(['a', 'd', 'c', 'e']);
    assignSlots(slots, [], 0);
    expect(slots).toEqual([null, null, null, null]);
  });
});
