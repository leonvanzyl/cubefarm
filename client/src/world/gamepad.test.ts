import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUTTON, DEADZONE, buttonBits, deadzone, lookCurve, pad, padName, pollPad, wasPressed, wasReleased } from './gamepad';

const out = { x: 0, y: 0 };

describe('deadzone', () => {
  it('reads a stick resting near the middle as centred', () => {
    expect(deadzone(0.1, -0.12, DEADZONE, out)).toEqual({ x: 0, y: 0 });
    expect(deadzone(0, 0, DEADZONE, out)).toEqual({ x: 0, y: 0 });
  });

  it('starts from zero at the edge and reaches one at full tilt, keeping the direction', () => {
    const edge = deadzone(DEADZONE + 0.001, 0, DEADZONE, out).x;
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(0.01);
    expect(deadzone(1, 0, DEADZONE, out).x).toBeCloseTo(1);
    const d = deadzone(-0.6, 0.6, DEADZONE, out);
    expect(d.x).toBeCloseTo(-d.y);
    expect(Math.hypot(d.x, d.y)).toBeLessThan(1);
  });

  it('never goes past one on a stick that reports a square', () => {
    const d = deadzone(1, 1, DEADZONE, out);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1);
  });

  it('treats junk as centred', () => {
    expect(deadzone(Number.NaN, 0.5, DEADZONE, out)).toEqual({ x: 0, y: 0 });
  });
});

describe('lookCurve', () => {
  it('is gentle near the middle and keeps the sign', () => {
    expect(lookCurve(0.5)).toBeCloseTo(0.25);
    expect(lookCurve(-0.5)).toBeCloseTo(-0.25);
    expect(lookCurve(1)).toBe(1);
  });
});

const buttons = (down: number[], values: Record<number, number> = {}) =>
  Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), value: values[i] ?? (down.includes(i) ? 1 : 0) }));

describe('buttonBits', () => {
  it('sets a bit per held button, and counts a trigger past halfway', () => {
    expect(buttonBits({ buttons: buttons([BUTTON.A, BUTTON.START]) })).toBe((1 << BUTTON.A) | (1 << BUTTON.START));
    expect(buttonBits({ buttons: buttons([], { [BUTTON.RT]: 0.3 }) })).toBe(0);
    expect(buttonBits({ buttons: buttons([], { [BUTTON.RT]: 0.8 }) })).toBe(1 << BUTTON.RT);
  });
});

describe('pollPad', () => {
  afterEach(() => vi.unstubAllGlobals());

  const plug = (down: number[], axes = [0, 0, 0, 0]) =>
    vi.stubGlobal('navigator', { getGamepads: () => [null, { id: 'Pad (STANDARD GAMEPAD)', connected: true, mapping: 'standard', axes, buttons: buttons(down) }] });

  it('reports presses and releases once, as edges', () => {
    plug([]);
    pollPad(0);
    plug([BUTTON.A]);
    pollPad(16);
    expect(wasPressed('A')).toBe(true);
    pollPad(32);
    expect(wasPressed('A')).toBe(false); // still held: no new edge
    plug([]);
    pollPad(48);
    expect(wasReleased('A')).toBe(true);
    expect(pad.connected).toBe(true);
  });

  it('puts the sticks through the deadzone', () => {
    plug([], [0.05, -1, 0.1, 0]);
    pollPad(64);
    expect(pad.lx).toBeCloseTo(0.05, 1); // radial: a full push keeps its slight lean
    expect(pad.ly).toBeCloseTo(-1);
    expect(pad.rx).toBe(0);
  });

  it('is disconnected with no pad', () => {
    vi.stubGlobal('navigator', { getGamepads: () => [null, null] });
    pollPad(80);
    expect(pad.connected).toBe(false);
    expect(pad.down).toBe(0);
  });
});

describe('padName', () => {
  it('drops the vendor details', () => {
    expect(padName('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)')).toBe('Xbox Wireless Controller');
    expect(padName('')).toBe('Controller');
  });
});
