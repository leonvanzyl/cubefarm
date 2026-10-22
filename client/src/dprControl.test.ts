import { describe, expect, it } from 'vitest';
import { displayHz, DPR, dprSample, dprSettle, newDpr, type DprState } from './dprControl';

/** Feeds `seconds` of half-second samples at `fps`; returns every pixel ratio it stepped to. */
function feed(s: DprState, fps: number, seconds: number) {
  const steps: number[] = [];
  for (let t = 0; t < seconds * 1000; t += 500) {
    const d = dprSample(s, fps, 500);
    if (d !== null) steps.push(d);
  }
  return steps;
}

describe('the adaptive resolution', () => {
  it('waits out its settle time, then steps down after 3 s of slow frames', () => {
    const s = newDpr(1.75);
    expect(feed(s, 20, 2.5)).toEqual([]);
    expect(feed(s, 20, 3)).toEqual([1.5]);
    expect(feed(s, 20, 30)).toEqual([1.25, 1]);
  });

  it('ignores frame rates between slow and headroom', () => {
    const s = newDpr(1.5);
    s.settle = 0;
    expect(feed(s, 45, 120)).toEqual([]);
  });

  it('steps up only after sustained headroom', () => {
    const s = newDpr(1);
    s.settle = 0;
    expect(feed(s, 60, DPR.upAfterMs / 1000 - 1)).toEqual([]);
    expect(feed(s, 60, 1)).toEqual([1.25]);
  });

  it('never flip-flops: a step up that fails doubles the wait before the next one', () => {
    const s = newDpr(1.5);
    s.settle = 0;
    // A busy part of the floor, a quiet one, the busy one again, over and over.
    const steps: number[] = [];
    for (let lap = 0; lap < 20; lap++) steps.push(...feed(s, 25, 5), ...feed(s, 60, 15));
    // Five minutes of walking back and forth: down once, then at most a couple of tries back up that fail.
    expect(steps.length).toBeLessThanOrEqual(6);
    expect(s.upAfterMs).toBeGreaterThan(DPR.upAfterMs);
  });

  it('is never stuck at the bottom: after a busy spell it comes back up within minutes', () => {
    const s = newDpr(1.75);
    feed(s, 20, 30);
    expect(s.dpr).toBe(1);
    feed(s, 60, (DPR.maxUpAfterMs * 3) / 1000);
    expect(s.dpr).toBe(1.75);
  });

  it('a step up that held resets the wait', () => {
    const s = newDpr(1);
    s.settle = 0;
    s.upAfterMs = 80_000;
    feed(s, 60, 80);
    expect(s.dpr).toBe(1.25);
    feed(s, 50, DPR.failWindowMs / 1000 + 5);
    expect(s.upAfterMs).toBe(DPR.upAfterMs);
  });

  it('settling restarts the runs (a pause or a tier change)', () => {
    const s = newDpr(1.75);
    s.settle = 0;
    feed(s, 20, 2.5);
    dprSettle(s);
    expect(feed(s, 20, 2.5)).toEqual([]);
    expect(s.slowMs).toBe(0);
  });

  it('holds still while it may not step down (Auto drops its effects first)', () => {
    const s = newDpr(1.75);
    s.settle = 0;
    for (let t = 0; t < 10_000; t += 500) expect(dprSample(s, 20, 500, DPR, false)).toBeNull();
    expect(feed(s, 20, 3)).toEqual([1.5]);
  });

  it('judges against the display rate', () => {
    expect(displayHz(59)).toBe(60);
    expect(displayHz(118)).toBe(120);
    expect(displayHz(170)).toBe(144);
    const s = newDpr(1.75);
    s.settle = 0;
    feed(s, 120, 0.5); // one fast burst isn't a 120 Hz screen...
    expect(s.hz).toBe(60);
    feed(s, 120, 2.5); // ...a run of them is
    expect(s.hz).toBe(120);
    expect(feed(s, 60, 3.5)).toEqual([1.5]); // and 60 fps is slow there
  });
});
