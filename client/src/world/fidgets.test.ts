import { describe, expect, it } from 'vitest';
import { DOZE_AFTER, FIDGET_SECONDS, IDLE_GAP, LONG_SESSION, LONG_THOUGHT, fidgetProgress, fidgetWeight, newDeskLife, play, seedOf, stepDeskLife, wake, type DeskLife, type Fidget, type Mood } from './fidgets';

/** Steps a desk through `seconds` at 30 fps in one mood, collecting each fidget as it starts. */
function run(s: DeskLife, mood: Mood, from: number, seconds: number) {
  const started: { f: Fidget; at: number }[] = [];
  let prev: Fidget | null = s.fidget;
  for (let t = from; t < from + seconds; t += 1 / 30) {
    stepDeskLife(s, mood, t);
    if (s.fidget && s.fidget !== prev) started.push({ f: s.fidget, at: t });
    prev = s.fidget;
  }
  return started;
}

describe('fidgets', () => {
  it('seeds from the id, so the same agent fidgets the same way and others differently', () => {
    expect(seedOf('ada')).toBe(seedOf('ada'));
    expect(seedOf('ada')).not.toBe(seedOf('bob'));
    const a = run(newDeskLife('ada', 0), 'idle', 0, 60).map((x) => x.f);
    expect(run(newDeskLife('ada', 0), 'idle', 0, 60).map((x) => x.f)).toEqual(a);
  });

  it('an idle agent fidgets now and then, never the same thing twice running, with a gap between', () => {
    const s = newDeskLife('ada', 0);
    const started = run(s, 'idle', 0, DOZE_AFTER.min - 1);
    expect(started.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < started.length; i++) {
      expect(started[i].f).not.toBe(started[i - 1].f);
      expect(started[i].at - started[i - 1].at).toBeGreaterThanOrEqual(FIDGET_SECONDS[started[i - 1].f] * 0.9 + IDLE_GAP.min - 0.1);
    }
    expect(started.every((x) => x.f !== 'doze')).toBe(true);
  });

  it('neighbours who sit down together are not in lockstep', () => {
    const starts = ['ada', 'bob', 'cy', 'dee'].map((id) => run(newDeskLife(id, 0), 'idle', 0, 40)[0]?.at ?? Infinity);
    expect(new Set(starts.map((t) => Math.round(t * 10))).size).toBe(starts.length);
  });

  it('nods off after a long idle and stays asleep until something happens', () => {
    const s = newDeskLife('ada', 0);
    run(s, 'idle', 0, DOZE_AFTER.max + 10);
    expect(s.fidget).toBe('doze');
    run(s, 'idle', DOZE_AFTER.max + 10, 120);
    expect(s.fidget).toBe('doze');
    wake(s, 300);
    expect(s.fidget).toBeNull();
    stepDeskLife(s, 'working', 301);
    expect(s.fidget).toBeNull();
  });

  it('a new task ends an idle fidget, and nobody fidgets while busy', () => {
    const s = newDeskLife('ada', 0);
    play(s, 'phone', 0);
    stepDeskLife(s, 'idle', 0.5);
    expect(s.fidget).toBe('phone');
    stepDeskLife(s, 'working', 1);
    expect(s.fidget).toBeNull();
    expect(run(s, 'busy', 1, 400)).toEqual([]);
  });

  it('only stretches the neck and shoulders once a working session has run a while', () => {
    const s = newDeskLife('ada', 0);
    const started = run(s, 'working', 0, LONG_SESSION + 120);
    expect(started.length).toBeGreaterThan(0);
    expect(started[0].at).toBeGreaterThanOrEqual(LONG_SESSION);
    expect(started.every((x) => x.f === 'neckRoll' || x.f === 'shoulders')).toBe(true);
  });

  it('switching between typing, thinking and browsing keeps the session going', () => {
    const s = newDeskLife('ada', 0);
    const moods: Mood[] = ['working', 'browsing', 'working', 'thinking'];
    for (let t = 0; t < LONG_SESSION + 120; t += 1 / 30) stepDeskLife(s, moods[Math.floor(t / 3) % 4], t);
    expect(s.sessionSince).toBe(0);
  });

  it('scratches the head when thinking drags on, not straight away', () => {
    const s = newDeskLife('ada', 0);
    const started = run(s, 'thinking', 0, 20);
    expect(started[0]).toMatchObject({ f: 'scratch' });
    expect(started[0].at).toBeGreaterThanOrEqual(LONG_THOUGHT);
  });

  it('reactions play over anything and wake a sleeper, without dozing straight back off', () => {
    const s = newDeskLife('ada', 0);
    run(s, 'idle', 0, DOZE_AFTER.max + 5);
    expect(s.fidget).toBe('doze');
    const at = DOZE_AFTER.max + 5;
    play(s, 'fistPump', at);
    stepDeskLife(s, 'idle', at + 0.1);
    expect(s.fidget).toBe('fistPump');
    stepDeskLife(s, 'busy', at + 0.2); // a reaction plays out even when the mood changes
    expect(s.fidget).toBe('fistPump');
    stepDeskLife(s, 'idle', at + FIDGET_SECONDS.fistPump * 1.1 + 0.1);
    expect(s.fidget).toBeNull();
  });

  it('eases each fidget in and out', () => {
    const s = newDeskLife('ada', 0);
    expect(fidgetWeight(s, 0)).toBe(0);
    play(s, 'wave', 10);
    expect(fidgetWeight(s, 10)).toBe(0);
    expect(fidgetWeight(s, 11)).toBe(1);
    expect(fidgetWeight(s, s.until)).toBe(0);
    expect(fidgetProgress(s, 10)).toBe(0);
    expect(fidgetProgress(s, s.until)).toBe(1);
    expect(fidgetProgress(s, (s.since + s.until) / 2)).toBeCloseTo(0.5);
  });
});
