import { describe, expect, it } from 'vitest';
import { BALCONY_OUT, HALF_W, SIDE_OPENINGS } from '../world/layout';
import {
  birdCall,
  BIRD_CALL_MAX,
  BURST_LEVEL,
  cricketPhrase,
  CRICKET_PHRASE_MAX,
  cutoffHz,
  DOOR_LEVEL,
  LEAK,
  MIN_GAP,
  MUFFLED_HZ,
  nextBirdIn,
  nextCarIn,
  nextCricketIn,
  nextDueAt,
  OPEN_HZ,
  outsideHearing,
  outsideLayers,
  RECHECK,
} from './outsideMix';

const SHUT = { west: 0, east: 0 };
const WEST_OPEN = { west: 1, east: 0 };
const westDoor = SIDE_OPENINGS.office.west.door;

/** A seeded [0, 1) source, so calls are varied but the test is repeatable. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('outsideHearing', () => {
  it('is full and clear out on a balcony, whether the door behind you is open or shut', () => {
    for (const open of [SHUT, WEST_OPEN]) {
      const h = outsideHearing('office', -(HALF_W + 1.8), 0, open);
      expect(h.level).toBe(1);
      expect(h.clarity).toBe(1);
      expect(h.from).toBeNull();
    }
    expect(outsideHearing('office', BALCONY_OUT - 0.3, -9, SHUT).level).toBe(1);
    expect(outsideHearing('lobby', -(HALF_W + 2), 8, SHUT).level).toBe(1);
  });

  it('is almost silent and fully muffled deep inside the office', () => {
    for (const open of [SHUT, WEST_OPEN, { west: 1, east: 1 }]) {
      const h = outsideHearing('office', 0, -2, open);
      expect(h.level).toBe(LEAK);
      expect(h.clarity).toBe(0);
    }
  });

  it('is quiet and muffled indoors by an open door, and fades as it shuts or you walk away', () => {
    const x = -(HALF_W - 1);
    const open = outsideHearing('office', x, westDoor, WEST_OPEN);
    expect(open.level).toBeGreaterThan(BURST_LEVEL);
    expect(open.level).toBeLessThanOrEqual(DOOR_LEVEL);
    expect(open.clarity).toBeGreaterThan(0);
    expect(cutoffHz(open.clarity)).toBeLessThan(2000);
    expect(open.from).toEqual({ x: -(HALF_W + 0.15), z: westDoor });

    const half = outsideHearing('office', x, westDoor, { west: 0.5, east: 0 });
    expect(half.level).toBeLessThan(open.level);
    expect(outsideHearing('office', x, westDoor, SHUT).level).toBe(LEAK);

    let prev = open.level;
    for (let step = 1; step <= 10; step++) {
      const l = outsideHearing('office', x + step, westDoor, WEST_OPEN).level;
      expect(l).toBeLessThanOrEqual(prev);
      prev = l;
    }
    expect(prev).toBe(LEAK);
  });

  it('rises steadily as you step through the doorway onto the balcony', () => {
    let prev = 0;
    for (let x = HALF_W - 1; x <= HALF_W + 1.5; x += 0.1) {
      const h = outsideHearing('office', -x, westDoor, WEST_OPEN);
      expect(h.level).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = h.level;
    }
    expect(prev).toBe(1);
  });

  it('only hears a door on your own side: the east door does nothing by the west wall', () => {
    expect(outsideHearing('office', -(HALF_W - 1), westDoor, { west: 0, east: 1 }).level).toBe(LEAK);
  });
});

describe('cutoffHz', () => {
  it('runs from muffled to open air', () => {
    expect(cutoffHz(0)).toBeCloseTo(MUFFLED_HZ);
    expect(cutoffHz(1)).toBeCloseTo(OPEN_HZ);
    expect(cutoffHz(-1)).toBeCloseTo(MUFFLED_HZ);
    expect(cutoffHz(0.5)).toBeGreaterThan(MUFFLED_HZ);
    expect(cutoffHz(0.5)).toBeLessThan(OPEN_HZ);
  });
});

describe('outsideLayers', () => {
  it('has birds and no crickets at noon', () => {
    const l = outsideLayers(0.5);
    expect(l.birds).toBeGreaterThan(0.8);
    expect(l.crickets).toBe(0);
  });

  it('has crickets and no birds at night, with a quieter, deeper city and fewer cars', () => {
    const night = outsideLayers(0.95);
    const noon = outsideLayers(0.5);
    expect(night.crickets).toBe(1);
    expect(night.birds).toBe(0);
    expect(night.city).toBeLessThan(noon.city);
    expect(night.cityHz).toBeLessThan(noon.cityHz);
    expect(night.carsPerMin).toBeLessThan(noon.carsPerMin);
    expect(night.wind).toBeGreaterThan(0);
  });

  it('has the city at its loudest at dusk, with the birds thinning out', () => {
    const dusk = outsideLayers(0.765);
    for (const t of [0.1, 0.3, 0.5, 0.6, 0.95]) expect(dusk.city).toBeGreaterThan(outsideLayers(t).city);
    expect(dusk.birds).toBeLessThan(outsideLayers(0.6).birds);
  });

  it('crossfades without jumps through the day', () => {
    let prev = outsideLayers(0);
    for (let i = 1; i <= 1000; i++) {
      const l = outsideLayers(i / 1000);
      for (const k of ['wind', 'city', 'birds', 'crickets'] as const) {
        expect(l[k]).toBeGreaterThanOrEqual(0);
        expect(l[k]).toBeLessThanOrEqual(1);
        expect(Math.abs(l[k] - prev[k])).toBeLessThan(0.1);
      }
      prev = l;
    }
  });
});

describe('bursts are rate-limited', () => {
  const rolls = [0, 0.001, 0.25, 0.5, 0.9, 0.999, 1];

  it('never comes closer than the minimum gap, however the dice fall', () => {
    for (const r of rolls) {
      expect(nextBirdIn(1, r)).toBeGreaterThanOrEqual(MIN_GAP.bird);
      expect(nextCarIn(10, r)).toBeGreaterThanOrEqual(MIN_GAP.car);
      expect(nextCricketIn(1, r)).toBeGreaterThanOrEqual(MIN_GAP.cricket);
      expect(Number.isFinite(nextCarIn(10, r))).toBe(true);
    }
  });

  it('comes less often as a layer fades, and not at all without it', () => {
    expect(nextBirdIn(0.3, 0.5)).toBeGreaterThan(nextBirdIn(1, 0.5));
    expect(nextBirdIn(0, 0.5)).toBe(Infinity);
    expect(nextCricketIn(0, 0.5)).toBe(Infinity);
    expect(nextCarIn(0, 0.5)).toBe(Infinity);
  });

  it('keeps checking through the night, so the birds come back in the morning', () => {
    expect(nextDueAt(10, Infinity)).toBe(10 + RECHECK);
    expect(nextDueAt(10, 3)).toBe(13);
    expect(outsideLayers(0.95).birds).toBeLessThan(0.05);
    // Tick a bird schedule second by second through a night (t 0.95), then a day (t 0.5), as outsideSfx does.
    let first = -1;
    for (let now = 0, due = 0; now < 600 && first < 0; now++) {
      if (now < due) continue;
      const wait = nextBirdIn(outsideLayers(now < 300 ? 0.95 : 0.5).birds, 0.5);
      due = nextDueAt(now, wait);
      expect(Number.isFinite(due)).toBe(true);
      if (Number.isFinite(wait)) first = now;
    }
    // No call at night; the first of the day within one recheck of sunrise.
    expect(first).toBeGreaterThanOrEqual(300);
    expect(first).toBeLessThanOrEqual(300 + RECHECK);
  });
});

describe('birdCall and cricketPhrase', () => {
  it('makes short, varied bird calls whose notes never overlap', () => {
    const rand = seeded(7);
    const shapes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const notes = birdCall(rand);
      expect(notes.length).toBeGreaterThan(0);
      expect(notes.length).toBeLessThanOrEqual(12);
      for (let j = 0; j < notes.length; j++) {
        const n = notes[j];
        expect(n.at + n.dur).toBeLessThanOrEqual(BIRD_CALL_MAX);
        expect(n.from).toBeGreaterThan(1500);
        expect(n.to).toBeGreaterThan(1500);
        expect(n.peak).toBeGreaterThan(0);
        expect(n.peak).toBeLessThanOrEqual(1);
        if (j) expect(n.at).toBeGreaterThanOrEqual(notes[j - 1].at + notes[j - 1].dur);
      }
      shapes.add(notes.map((n) => Math.round(n.from)).join(','));
    }
    expect(shapes.size).toBeGreaterThan(150);
  });

  it('makes cricket phrases of quick pulses that fit their voice', () => {
    const rand = seeded(3);
    for (let i = 0; i < 100; i++) {
      const pulses = cricketPhrase(rand);
      expect(pulses.length).toBeGreaterThanOrEqual(9);
      for (let j = 0; j < pulses.length; j++) {
        expect(pulses[j].at + pulses[j].dur).toBeLessThanOrEqual(CRICKET_PHRASE_MAX);
        if (j) expect(pulses[j].at).toBeGreaterThanOrEqual(pulses[j - 1].at + pulses[j - 1].dur);
      }
    }
  });
});
