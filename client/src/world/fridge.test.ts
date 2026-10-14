import { describe, expect, it } from 'vitest';
import { FRIDGE, SNACKS, SNACK_IDS, autoCloseDue, bare, beepDue, favouriteOf, freshStock, lunchLabel, pickFor, restock, restockOne, take, type Stock } from './fridge';
import { GULP, LAST_BITE, eAction, snackPlanFor } from './toys/sip';

const empty = (): Stock => Object.fromEntries(SNACK_IDS.map((id) => [id, 0])) as Stock;

/** Plays a snack to the end like sipping.ts does: one plan per E, until it's gone. Returns every cue in order. */
function finish(id: (typeof SNACK_IDS)[number]) {
  const s = SNACKS.find((x) => x.id === id)!;
  let left = s.sips;
  const cues: string[] = [];
  let presses = 0;
  for (let plan = snackPlanFor(s, left); plan; plan = snackPlanFor(s, left)) {
    presses++;
    for (const c of plan.cues) {
      cues.push(c.cue);
      if (c.cue === 'drink') left--;
    }
    if (presses > 10) throw new Error('never finishes');
  }
  return { presses, cues, left };
}

describe('the catalogue', () => {
  it('has at least eight snacks, drinks and food, with made-up names and two or three sips or bites each', () => {
    expect(SNACKS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(SNACK_IDS).size).toBe(SNACKS.length);
    expect(SNACKS.filter((s) => s.kind === 'drink').length).toBeGreaterThanOrEqual(4);
    expect(SNACKS.filter((s) => s.kind === 'food').length).toBeGreaterThanOrEqual(4);
    for (const s of SNACKS) expect(s.sips === 2 || s.sips === 3, s.id).toBe(true);
    expect(SNACKS.find((s) => s.id === 'overclock')?.name).toMatch(/Overclock/);
  });

  it('finishes every snack in its sips or bites, the last one the gulp or the last bite, then it is gone', () => {
    for (const s of SNACKS) {
      const r = finish(s.id);
      expect(r.presses, s.id).toBe(s.sips);
      expect(r.left, s.id).toBe(0);
      expect(r.cues.at(-1), s.id).toBe('drop');
      const last = snackPlanFor(s, 1)!;
      expect(last.dur).toBe((s.kind === 'drink' ? GULP : LAST_BITE).dur);
    }
  });

  it('opens a can with a pssht and crunches it once empty, twists a cap, rustles a wrapper', () => {
    const cues = (id: (typeof SNACK_IDS)[number]) => finish(id).cues;
    expect(cues('overclock')[0]).toBe('pssht');
    expect(cues('overclock').filter((c) => c === 'pssht')).toHaveLength(1);
    expect(cues('overclock').slice(-2)).toEqual(['crunch', 'drop']);
    expect(cues('coldbrew')[0]).toBe('twist');
    expect(cues('coldbrew')).not.toContain('crunch');
    expect(cues('bar')[0]).toBe('rustle');
    expect(cues('pizza')).not.toContain('rustle');
    expect(cues('pizza')).toContain('chomp');
    expect(cues('mate')).toContain('gulp');
  });

  it('keeps every plan in time order', () => {
    for (const s of SNACKS)
      for (let left = s.sips; left > 0; left--) {
        const at = snackPlanFor(s, left)!.cues.map((c) => c.at);
        expect([...at].sort((a, b) => a - b)).toEqual(at);
      }
  });

  it('E eats a snack in hand, except at the fridge, where it acts on the fridge', () => {
    const held = { kind: 'snack', left: 2 };
    expect(eAction(held, null)).toBe('sip');
    expect(eAction(held, 'pickup')).toBe('sip');
    expect(eAction(held, 'fridge')).toBe('target');
    expect(eAction({ kind: 'snack', left: 0 }, null)).toBe('empty');
  });
});

describe('the stock', () => {
  it('starts with two to four of each, the same for the same floor', () => {
    for (const seed of [1, 2, 3, 9]) {
      const s = freshStock(seed);
      for (const id of SNACK_IDS) {
        expect(s[id]).toBeGreaterThanOrEqual(FRIDGE.min);
        expect(s[id]).toBeLessThanOrEqual(FRIDGE.max);
      }
      expect(freshStock(seed)).toEqual(s);
    }
  });

  it('goes down as things are taken, and a sold-out snack cannot be taken', () => {
    let s: Stock | null = { ...empty(), cheese: 2 };
    s = take(s, 'cheese');
    expect(s?.cheese).toBe(1);
    s = take(s!, 'cheese');
    expect(s?.cheese).toBe(0);
    expect(take(s!, 'cheese')).toBeNull();
    expect(take(s!, 'pizza')).toBeNull();
  });

  it('brings one item back every few minutes, the scarcest first, never past the max', () => {
    const s = { ...freshStock(1), choc: 0 };
    expect(restockOne(s).choc).toBe(1);
    const full = Object.fromEntries(SNACK_IDS.map((id) => [id, FRIDGE.max])) as Stock;
    expect(restockOne(full)).toBe(full);
    const r = restock(empty(), 0, FRIDGE.restock * 2.5);
    expect(SNACK_IDS.reduce((n, id) => n + r.stock[id], 0)).toBe(2);
    expect(r.since).toBe(FRIDGE.restock * 2);
    expect(restock(empty(), 0, FRIDGE.restock - 1).stock).toEqual(empty());
    expect(bare(empty())).toBe(true);
    expect(bare(r.stock)).toBe(false);
  });
});

describe('the door', () => {
  it('shuts by itself a few seconds after everyone walked away', () => {
    expect(autoCloseDue(true, 1000, 1000 + FRIDGE.autoClose - 1)).toBe(false);
    expect(autoCloseDue(true, 1000, 1000 + FRIDGE.autoClose)).toBe(true);
    expect(autoCloseDue(false, 0, 1e9)).toBe(false);
  });

  it('beeps once it has been open about 20 s, then every couple of seconds', () => {
    expect(beepDue(true, 0, 0, FRIDGE.beepAfter - 1)).toBe(false);
    expect(beepDue(true, 0, 0, FRIDGE.beepAfter)).toBe(true);
    expect(beepDue(true, 0, FRIDGE.beepAfter, FRIDGE.beepAfter + 100)).toBe(false);
    expect(beepDue(true, 0, FRIDGE.beepAfter, FRIDGE.beepAfter + FRIDGE.beepEvery)).toBe(true);
    expect(beepDue(false, 0, 0, 1e9)).toBe(false);
  });
});

describe('what agents take', () => {
  it('is their favourite, the same every time, else the next one in stock, else nothing', () => {
    const fav = favouriteOf('agent-7');
    expect(favouriteOf('agent-7')).toBe(fav);
    expect(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(favouriteOf)).size).toBeGreaterThan(2);
    expect(pickFor('agent-7', freshStock(1))).toBe(fav);
    const noFav = { ...freshStock(1), [fav]: 0 };
    const other = pickFor('agent-7', noFav);
    expect(other).not.toBe(fav);
    expect(noFav[other!]).toBeGreaterThan(0);
    expect(pickFor('agent-7', empty())).toBeNull();
  });

  it("labels someone's lunch", () => {
    expect(lunchLabel('Ada')).toBe("Ada's lunch, DO NOT EAT");
  });
});
