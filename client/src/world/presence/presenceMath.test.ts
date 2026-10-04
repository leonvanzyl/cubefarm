import { describe, expect, it } from 'vitest';
import type { VisitorPose } from '../../../../shared/types';
import { RateMeter, newClock, pingNoun, poseChanged, poseTime, pruneSamples, pushSample, renderDelay, sampleAt, shouldSend, visitorLooks, wheelPick, wheelSpot, WHEEL, type Sample } from './presenceMath';

const s = (t: number, x: number, z = 0, h = 0): Sample => ({ t, x, z, h, p: 0 });
const out = (): Sample => ({ t: 0, x: 0, z: 0, h: 0, p: 0 });

describe('easing between poses', () => {
  it('eases between the two poses around the time asked for, and holds at either end', () => {
    const buf = [s(0, 0), s(100, 1), s(200, 3)];
    expect(sampleAt(buf, 50, out())?.x).toBeCloseTo(0.5);
    expect(sampleAt(buf, 150, out())?.x).toBeCloseTo(2);
    expect(sampleAt(buf, -10, out())?.x).toBe(0);
    expect(sampleAt(buf, 999, out())?.x).toBe(3);
    expect(sampleAt([], 0, out())).toBeNull();
  });

  it('turns the short way round', () => {
    const buf = [s(0, 0, 0, 3), s(100, 0, 0, -3)]; // 3 rad to -3 rad: through PI, not through 0
    const h = sampleAt(buf, 50, out())!.h;
    expect(Math.abs(h)).toBeGreaterThan(3);
  });

  it('after standing still, walks off from where they stood over one interval instead of drifting all along', () => {
    const buf: Sample[] = [];
    pushSample(buf, s(0, 0));
    pushSample(buf, s(5000, 0.36)); // five seconds still, then a step
    expect(buf.map((b) => b.t)).toEqual([0, 4900, 5000]);
    expect(sampleAt(buf, 4900, out())?.x).toBe(0); // render time (now - 100 ms): still where they stood
    expect(sampleAt(buf, 4950, out())?.x).toBeCloseTo(0.18);
  });

  it('spaces poses as they were sent, even when a busy tab reads them in bursts', () => {
    const c = newClock();
    // sent every 100 ms on the sender's clock (which starts at 5000); read here at 1000, then three at once at 1302
    const at = [poseTime(c, 5000, 1000), poseTime(c, 5100, 1302), poseTime(c, 5200, 1302), poseTime(c, 5300, 1302)];
    expect(at).toEqual([1000, 1100, 1200, 1300]);
    expect(renderDelay(c)).toBeGreaterThan(300); // it waits longer while poses come late
    for (let i = 4; i < 200; i++) poseTime(c, 5000 + i * 100, 1000 + i * 100);
    expect(renderDelay(c)).toBeCloseTo(120, 0); // back to about the usual once they're on time again
  });

  it('waits for a slow sender, whose poses come only a few times a second', () => {
    const c = newClock();
    for (let i = 0; i < 20; i++) poseTime(c, i * 300, 50 + i * 300);
    expect(renderDelay(c)).toBeGreaterThanOrEqual(300);
  });

  it('keeps the buffer short', () => {
    const buf: Sample[] = [];
    for (let i = 0; i < 100; i++) pushSample(buf, s(i * 100, i));
    expect(buf.length).toBeLessThanOrEqual(30);
    pruneSamples(buf, 9850);
    expect(buf.map((b) => b.x)).toEqual([98, 99]);
  });
});

describe('sending our pose', () => {
  const pose = (patch: Partial<VisitorPose> = {}): VisitorPose => ({ ts: 0, f: 1, x: 0, z: 0, h: 0, p: 0, held: null, ...patch });

  it('sends the first pose at once, then only changes, at most every 100 ms', () => {
    expect(shouldSend(null, pose(), 0)).toBe(true);
    const last = { pose: pose(), at: 1000 };
    expect(shouldSend(last, pose({ x: 1 }), 1050)).toBe(false); // too soon
    expect(shouldSend(last, pose({ x: 1 }), 1100)).toBe(true);
    expect(shouldSend(last, pose({ x: 0.005 }), 5000)).toBe(false); // not worth it
    expect(shouldSend(last, pose(), 5000)).toBe(false); // standing still sends nothing
  });

  it('notices floor, heading, pitch and hands', () => {
    expect(poseChanged(pose(), pose({ f: 2 }))).toBe(true);
    expect(poseChanged(pose({ h: Math.PI - 0.001 }), pose({ h: -Math.PI + 0.001 }))).toBe(false); // the same way, wrapped
    expect(poseChanged(pose(), pose({ h: 0.1 }))).toBe(true);
    expect(poseChanged(pose(), pose({ p: 0.1 }))).toBe(true);
    expect(poseChanged(pose(), pose({ held: { k: 'mug', id: 'm', s: 3 } }))).toBe(true);
    expect(poseChanged(pose({ held: { k: 'mug', id: 'm', s: 3 } }), pose({ held: { k: 'mug', id: 'm', s: 2 } }))).toBe(true); // a sip
  });

  it('stays well under 10 KB/s per client with four visitors walking non-stop', () => {
    // three others, each relayed at most 10 times a second, plus our own 10 a second out
    const msg = JSON.stringify({ type: 'visitorPose', id: 'a1b2c3d4', ts: 1234567890123, f: 12, x: -13.37, z: 10.25, h: -2.718, p: -0.314, held: { k: 'mug', id: 'mug-ceo-12', s: 3 } });
    expect(msg.length * 10 * 4).toBeLessThan(10_000);
  });
});

describe('the emote wheel', () => {
  it('picks the slice the mouse points at, clockwise from wave at the top', () => {
    expect(wheelPick(0, -60)).toBe('wave');
    expect(WHEEL).toEqual(['wave', 'thumbs', 'clap', 'point', 'laugh']);
    for (let i = 0; i < WHEEL.length; i++) {
      const at = wheelSpot(i, 80);
      expect(wheelPick(at.x, at.y)).toBe(WHEEL[i]);
    }
    expect(wheelPick(5, 5)).toBeNull(); // the dead zone
  });
});

describe('pings', () => {
  it('say what was aimed at', () => {
    expect(pingNoun(null)).toBe('');
    expect(pingNoun({ id: 'board-o/r', action: { kind: 'kanban' } })).toBe('the whiteboard');
    expect(pingNoun({ id: 'agent-ada', action: { kind: 'terminal', agentId: 'ada' } }, () => 'Ada')).toBe("Ada's desk");
    expect(pingNoun({ id: 'toy:beach-ball', action: { kind: 'pickup', toyId: 'beach-ball' } })).toBe('the beach ball');
    expect(pingNoun({ id: 'toy:mug-dispenser', action: { kind: 'pickup', toyId: 'mug-dispenser' } })).toBe('a mug');
    expect(pingNoun({ id: 'gong', action: { kind: 'poke', toyId: 'gong' } })).toBe('the gong');
    expect(pingNoun({ id: 'elevator', action: { kind: 'elevator' } })).toBe('the elevator');
  });
});

describe('rates and looks', () => {
  it('counts over the last two seconds', () => {
    const m = new RateMeter();
    for (let t = 0; t < 4000; t += 100) m.add(1, t);
    expect(m.perSecond(3900)).toBe(10);
    expect(m.perSecond(9000)).toBe(0);
  });

  it('gives a visitor the same face everywhere', () => {
    expect(visitorLooks('a1b2')).toEqual(visitorLooks('a1b2'));
  });
});
