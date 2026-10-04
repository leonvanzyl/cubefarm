import { describe, expect, it } from 'vitest';
import {
  eligible,
  EVENT_IDS,
  EVENTS,
  gapSeconds,
  newDirector,
  parseEventId,
  parseEventParam,
  pickEvent,
  RETRY_SECONDS,
  startRunning,
  stepDirector,
  weightOf,
  type EventId,
  type Moment,
} from './director';

const day: Moment = { frequency: 'normal', calm: false, night: false, weather: true, rain: 0, sinceRain: Infinity };
const night: Moment = { ...day, night: true };

/** Runs a director for `minutes` of watching, starting each event it picks; returns what started when. */
function simulate(m: Moment, minutes: number, seed = 1, step = 1) {
  const d = newDirector(seed, m.frequency);
  const started: { id: EventId; at: number }[] = [];
  let key = 0;
  for (let t = 0; t < minutes * 60; t += step) {
    const id = stepDirector(d, step, m);
    if (id) {
      started.push({ id, at: d.clock });
      startRunning(d, ++key, id);
    }
    // never two big ones at once
    expect(d.running.filter((r) => r.big).length).toBeLessThanOrEqual(1);
  }
  return started;
}

describe('the catalogue', () => {
  it('has every event the issue lists, with its kind', () => {
    for (const id of ['plane', 'helicopter', 'birds', 'balloon', 'blimp', 'skywriting', 'fireworks', 'ufo', 'meteors', 'rainbow', 'kaiju', 'duck', 'whale', 'hurricane']) expect(EVENT_IDS).toContain(id);
    expect(EVENTS.plane.big).toBe(false);
    expect(EVENTS.kaiju).toMatchObject({ tier: 'absurd', big: true, toast: true });
    expect(EVENTS.blimp.toast).toBe(false);
  });

  it('reads ?event= and its aliases', () => {
    expect(parseEventParam('?event=kaiju')).toBe('kaiju');
    expect(parseEventParam('?event=rubber_duck')).toBe('duck');
    expect(parseEventParam('?event=airliner')).toBe('plane');
    expect(parseEventParam('?event=godzilla')).toBeNull();
    expect(parseEventId(null)).toBeNull();
  });
});

describe('what may happen now', () => {
  it('keeps fireworks and meteors to the night and balloons and skywriting to the day', () => {
    expect(eligible(EVENTS.fireworks, day)).toBe(false);
    expect(eligible(EVENTS.fireworks, night)).toBe(true);
    expect(eligible(EVENTS.meteors, day)).toBe(false);
    expect(eligible(EVENTS.skywriting, night)).toBe(false);
    expect(eligible(EVENTS.balloon, day)).toBe(true);
  });

  it('keeps it calm: no absurd events and no hurricane', () => {
    const calm = { ...day, calm: true };
    for (const id of ['kaiju', 'duck', 'whale', 'hurricane'] as const) expect(eligible(EVENTS[id], calm)).toBe(false);
    for (const id of ['plane', 'blimp', 'ufo'] as const) expect(eligible(EVENTS[id], calm)).toBe(true);
  });

  it('has no hurricane with the weather off, and a rainbow most likely right after rain', () => {
    expect(eligible(EVENTS.hurricane, { ...day, weather: false })).toBe(false);
    expect(eligible(EVENTS.rainbow, { ...day, rain: 0.8 })).toBe(false);
    expect(weightOf(EVENTS.rainbow, { ...day, sinceRain: 60 })).toBeGreaterThan(weightOf(EVENTS.rainbow, day) * 5);
    expect(weightOf(EVENTS.hurricane, { ...day, rain: 1 })).toBeGreaterThan(weightOf(EVENTS.hurricane, day));
  });

  it('never picks a second big event while one runs, or one already running', () => {
    for (let i = 0; i < 200; i++) {
      const id = pickEvent(day, [{ id: 'kaiju', big: true }], i / 200);
      expect(id).not.toBeNull();
      expect(EVENTS[id!].big).toBe(false);
    }
    for (let i = 0; i < 200; i++) expect(pickEvent(day, [{ id: 'plane', big: false }], i / 200)).not.toBe('plane');
  });

  it('weights the everyday higher than the rare', () => {
    const counts: Partial<Record<EventId, number>> = {};
    for (let i = 0; i < 2000; i++) {
      const id = pickEvent(day, [], i / 2000)!;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    expect(counts.plane!).toBeGreaterThan(counts.ufo! * 3);
    expect(counts.ufo!).toBeGreaterThan(counts.kaiju!);
    expect(counts.fireworks).toBeUndefined();
  });
});

describe('the schedule', () => {
  it('starts an event every 6-20 minutes at normal frequency, the first one sooner', () => {
    const started = simulate(day, 8 * 60);
    expect(started[0].at).toBeLessThanOrEqual(10 * 60);
    const gaps = started.slice(1).map((s, i) => s.at - started[i].at);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(6 * 60 - 1);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(20 * 60 + RETRY_SECONDS * 10);
    expect(started.length).toBeGreaterThan(20);
    expect(started.length).toBeLessThan(80);
  });

  it('respects the frequency: none when off, fewer when rare, many in chaos', () => {
    expect(simulate({ ...day, frequency: 'off' }, 120)).toEqual([]);
    const rare = simulate({ ...day, frequency: 'rare' }, 8 * 60).length;
    const normal = simulate(day, 8 * 60).length;
    const chaos = simulate({ ...day, frequency: 'chaos' }, 60).length;
    expect(rare).toBeLessThan(normal);
    expect(chaos).toBeGreaterThan(20);
    expect(gapSeconds('off', 0.5)).toBe(Infinity);
  });

  it('never starts an absurd event when kept calm', () => {
    const started = simulate({ ...day, frequency: 'chaos', calm: true }, 6 * 60, 7);
    expect(started.length).toBeGreaterThan(100);
    expect(started.filter((s) => EVENTS[s.id].tier === 'absurd' || s.id === 'hurricane')).toEqual([]);
  });

  it('is the same for the same seed', () => {
    expect(simulate(day, 120, 42)).toEqual(simulate(day, 120, 42));
    expect(simulate(day, 300, 42)).not.toEqual(simulate(day, 300, 43));
  });
});
