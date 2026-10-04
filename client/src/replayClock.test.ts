import { describe, expect, it } from 'vitest';
import { AWAY_MS, CHUNK_MS, clockEnded, clockTime, createClock, nextFetch, parsePresence, seekClock, sinceLastHere, timelineAt, touchPresence, withPlaying, withSpeed, type Presence } from './replayClock';

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = 1_800_000_000_000;

describe('the replay clock', () => {
  it('runs at its speed from where it starts', () => {
    const c = createClock(T0, T0 + 8 * HOUR, 120, 1000);
    expect(clockTime(c, 1000)).toBe(T0);
    expect(clockTime(c, 31_000)).toBe(T0 + HOUR); // 30 s at 120× is an hour
  });

  it('changes speed without jumping', () => {
    let c = createClock(T0, T0 + 8 * HOUR, 30, 0);
    c = withSpeed(c, 600, 10_000); // 10 s at 30× = 5 minutes in
    expect(clockTime(c, 10_000)).toBe(T0 + 5 * MIN);
    expect(clockTime(c, 11_000)).toBe(T0 + 15 * MIN); // then 10 minutes a second
  });

  it('holds still while paused, and carries on from there', () => {
    let c = createClock(T0, T0 + 8 * HOUR, 120, 0);
    c = withPlaying(c, false, 15_000);
    expect(clockTime(c, 15_000)).toBe(T0 + 30 * MIN);
    expect(clockTime(c, 99_000)).toBe(T0 + 30 * MIN);
    c = withPlaying(c, true, 99_000);
    expect(clockTime(c, 114_000)).toBe(T0 + HOUR);
  });

  it('seeks anywhere inside its range, and stops at the end', () => {
    let c = createClock(T0, T0 + HOUR, 600, 0);
    c = seekClock(c, T0 + 50 * MIN, 1000);
    expect(clockTime(c, 1000)).toBe(T0 + 50 * MIN);
    expect(clockEnded(c, 1000)).toBe(false);
    expect(clockTime(c, 3000)).toBe(T0 + HOUR);
    expect(clockEnded(c, 3000)).toBe(true);
    expect(clockTime(seekClock(c, T0 - HOUR, 0), 0)).toBe(T0);
    expect(clockTime(seekClock(c, T0 + 9 * HOUR, 0), 0)).toBe(T0 + HOUR);
  });
});

describe('nextFetch', () => {
  it('fetches the next hour once what is loaded runs out within a few seconds at this speed', () => {
    const to = T0 + 8 * HOUR;
    expect(nextFetch(T0 + HOUR, T0, 120, to)).toBeNull(); // 30 s of play left
    expect(nextFetch(T0 + HOUR, T0 + 50 * MIN, 120, to)).toEqual({ from: T0 + HOUR, to: T0 + HOUR + CHUNK_MS }); // 5 s left
    expect(nextFetch(T0 + HOUR, T0, 600, to)).toEqual({ from: T0 + HOUR, to: T0 + 2 * HOUR }); // 6 s left at 600×
  });

  it('never fetches past the end of the replay', () => {
    expect(nextFetch(T0 + HOUR, T0 + 59 * MIN, 120, T0 + 90 * MIN)).toEqual({ from: T0 + HOUR, to: T0 + 90 * MIN });
    expect(nextFetch(T0 + HOUR, T0 + 59 * MIN, 120, T0 + HOUR)).toBeNull();
  });
});

describe('timelineAt', () => {
  it('places a moment on the timeline', () => {
    expect(timelineAt(T0 + HOUR, T0, T0 + 4 * HOUR)).toBe(0.25);
    expect(timelineAt(T0 - HOUR, T0, T0 + HOUR)).toBe(0);
    expect(timelineAt(T0 + 2 * HOUR, T0, T0 + HOUR)).toBe(1);
    expect(timelineAt(T0, T0, T0)).toBe(0);
  });
});

describe('since I was last here', () => {
  const none: Presence = { last: null, awayFrom: null, backAt: null };

  it('notices a time away when activity comes back after a long gap', () => {
    let p = touchPresence(none, T0);
    expect(p).toEqual({ last: T0, awayFrom: null, backAt: null });
    p = touchPresence(p, T0 + MIN); // still here
    expect(p.awayFrom).toBeNull();
    p = touchPresence(p, T0 + MIN + 3 * HOUR); // back after lunch
    expect(p).toEqual({ last: T0 + MIN + 3 * HOUR, awayFrom: T0 + MIN, backAt: T0 + MIN + 3 * HOUR });
    p = touchPresence(p, T0 + MIN + 3 * HOUR + AWAY_MS - 1); // keeps working: the time away stays
    expect(p.awayFrom).toBe(T0 + MIN);
  });

  it('replays the time away, within what was recorded', () => {
    const p: Presence = { last: T0 + 5 * HOUR, awayFrom: T0 + HOUR, backAt: T0 + 4 * HOUR };
    expect(sinceLastHere(p, { from: T0, to: T0 + 5 * HOUR })).toEqual({ from: T0 + HOUR, to: T0 + 4 * HOUR });
    expect(sinceLastHere(p, { from: T0 + 2 * HOUR, to: T0 + 5 * HOUR })).toEqual({ from: T0 + 2 * HOUR, to: T0 + 4 * HOUR });
    expect(sinceLastHere(p, { from: T0, to: T0 + 3 * HOUR })).toEqual({ from: T0 + HOUR, to: T0 + 3 * HOUR });
  });

  it('offers nothing without a time away, a journal, or anything recorded in it', () => {
    expect(sinceLastHere(none, { from: T0, to: T0 + HOUR })).toBeNull();
    expect(sinceLastHere({ last: T0, awayFrom: T0 - HOUR, backAt: T0 }, null)).toBeNull();
    expect(sinceLastHere({ last: T0, awayFrom: T0 - HOUR, backAt: T0 }, { from: T0 + HOUR, to: T0 + 2 * HOUR })).toBeNull();
  });

  it('reads back what this browser stored, ignoring anything broken', () => {
    expect(parsePresence(JSON.stringify({ last: T0, awayFrom: T0 - HOUR, backAt: T0 }))).toEqual({ last: T0, awayFrom: T0 - HOUR, backAt: T0 });
    expect(parsePresence('{"last":"soon","awayFrom":-4}')).toEqual(none);
    expect(parsePresence('not json')).toEqual(none);
    expect(parsePresence(null)).toEqual(none);
  });
});
