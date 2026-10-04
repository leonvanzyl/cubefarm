import { describe, expect, it } from 'vitest';
import type { Stage } from '../world/body.ts';
import { CHAT_RADIUS, HEAR_RANGE, hearPerson, MAX_WALKERS, MURMUR_GAP, MURMUR_SPACING, newHearing, type Crowd, type Frame, type Hearing, type PersonEvent } from './peopleSoundRules.ts';

const frame = (f: Partial<Frame> = {}): Frame => ({ stage: 'seated', x: 0, z: 0, speed: 0, phase: 0, gesture: 'none', d: 3, ...f });
const crowdOf = (...people: Hearing[]): Crowd => ({ people, lastMurmur: -Infinity });

/** Feed one person a run of frames (0.1 s each), collecting everything they ask to play. */
function run(frames: Partial<Frame>[], h = newHearing(), crowd = crowdOf(h)) {
  const out: PersonEvent[] = [];
  frames.forEach((f, i) => out.push(...hearPerson(h, frame(f), crowd, 0.1, i * 0.1, 0.5)));
  return out;
}

/** Walking frames: the walk cycle advancing by `step` radians a frame. */
const walking = (n: number, f: Partial<Frame> = {}, step = 0.8) => Array.from({ length: n }, (_, i) => ({ stage: 'up' as Stage, speed: 1.1, phase: (i * step) % (Math.PI * 2), ...f }));

describe('hearPerson: the chair', () => {
  it('is quiet while someone sits at their desk', () => {
    expect(run([{}, {}, {}])).toEqual([]);
  });

  it('rolls and creaks once as they get up, rolls as they sit and creaks as they settle', () => {
    const stages: Stage[] = ['seated', 'rising', 'rising', 'up', 'up', 'sitting', 'sitting', 'seated', 'seated'];
    expect(run(stages.map((stage) => ({ stage })))).toEqual(['rise', 'sit', 'seated']);
  });

  it('sits back down when they change their mind halfway up', () => {
    expect(run([{ stage: 'seated' }, { stage: 'rising' }, { stage: 'sitting' }, { stage: 'seated' }])).toEqual(['rise', 'sit', 'seated']);
  });
});

describe('hearPerson: footsteps', () => {
  it('steps each half walk cycle, in time with their pace, and scuffs once on stopping', () => {
    const slow = run([...walking(16, {}, 0.6), { stage: 'up', speed: 0, phase: 9.6 % (Math.PI * 2) }]);
    const brisk = run(walking(16, {}, 1.2));
    expect(slow.filter((e) => e === 'step').length).toBe(2); // 0 to 9 rad: the phase crosses π and 2π
    expect(slow.at(-1)).toBe('scuff');
    expect(brisk.filter((e) => e === 'step').length).toBeGreaterThan(slow.filter((e) => e === 'step').length);
  });

  it('is silent past HEAR_RANGE', () => {
    expect(run(walking(16, { d: HEAR_RANGE + 1 }))).toEqual(['rise']); // the chair is left to the mixer's own cut-off
  });

  it(`only the ${MAX_WALKERS} walkers nearest you are heard`, () => {
    const people = Array.from({ length: 6 }, () => newHearing());
    const crowd = crowdOf(...people);
    const heard = people.map(() => 0);
    for (const [i, f] of walking(20).entries())
      people.forEach((h, n) => {
        heard[n] += hearPerson(h, frame({ ...f, d: 2 + n }), crowd, 0.1, i * 0.1, 0.5).filter((e) => e === 'step').length;
      });
    expect(heard.slice(0, MAX_WALKERS).every((n) => n > 0)).toBe(true);
    expect(heard.slice(MAX_WALKERS)).toEqual([0, 0, 0]);
  });

  it("someone standing still doesn't count against the nearest few", () => {
    const idle = Array.from({ length: 4 }, () => newHearing());
    const walker = newHearing();
    const crowd = crowdOf(...idle, walker);
    idle.forEach((h) => hearPerson(h, frame({ stage: 'up', d: 1 }), crowd, 0.1, 0, 0.5));
    const out = run(walking(12, { d: 8 }), walker, crowd);
    expect(out).toContain('step');
  });
});

describe('hearPerson: gestures', () => {
  it('reports a gesture starting and ending, once each', () => {
    const out = run([{ stage: 'up' }, { stage: 'up', gesture: 'reach' }, { stage: 'up', gesture: 'reach' }, { stage: 'up', gesture: 'stretch' }, { stage: 'up' }]).filter((e) => e !== 'rise');
    expect(out).toEqual(['start:reach', 'end:reach', 'start:stretch', 'end:stretch']);
  });
});

describe('hearPerson: chats', () => {
  /** Two people standing `apart` metres from each other for `seconds`; their murmurs, in order. */
  function chat(apart: number, seconds: number, d = 3) {
    const [a, b] = [newHearing(), newHearing()];
    const crowd = crowdOf(a, b);
    const out: string[] = [];
    for (let i = 0; i * 0.1 < seconds; i++) {
      for (const [h, x, who] of [[a, 0, 'a'], [b, apart, 'b']] as const)
        if (hearPerson(h, frame({ stage: 'up', x, d }), crowd, 0.1, i * 0.1, 0.5).includes('murmur')) out.push(`${who}@${(i * 0.1).toFixed(1)}`);
    }
    return out;
  }

  it('murmurs now and then while two people stand together, never two at once', () => {
    const out = chat(CHAT_RADIUS - 0.3, 30);
    expect(out.length).toBeGreaterThan(30 / MURMUR_GAP.max);
    expect(out.length).toBeLessThan(30 / MURMUR_SPACING);
    const times = out.map((s) => Number(s.split('@')[1]));
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(MURMUR_SPACING - 1e-9);
    expect(new Set(out.map((s) => s[0]))).toEqual(new Set(['a', 'b'])); // both of them talk
  });

  it("is quiet for someone alone, too far apart or out of earshot", () => {
    expect(chat(CHAT_RADIUS + 0.5, 30)).toEqual([]);
    expect(chat(1, 30, HEAR_RANGE + 1)).toEqual([]);
    expect(run(Array.from({ length: 300 }, () => ({ stage: 'up' as Stage })))).toEqual(['rise']);
  });

  it("walking past someone isn't a chat", () => {
    const still = newHearing();
    const walker = newHearing();
    const crowd = crowdOf(still, walker);
    const out: PersonEvent[] = [];
    for (const [i, f] of walking(100, { x: 0.5 }).entries()) {
      out.push(...hearPerson(still, frame({ stage: 'up' }), crowd, 0.1, i * 0.1, 0.5));
      out.push(...hearPerson(walker, frame(f), crowd, 0.1, i * 0.1, 0.5));
    }
    expect(out).not.toContain('murmur');
  });
});
