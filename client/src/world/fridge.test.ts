import { describe, expect, it } from 'vitest';
import {
  DOOR,
  SNACKS,
  SNACK_IDS,
  STOCK,
  closeDoor,
  doorTick,
  favouriteOf,
  grabLabel,
  isFood,
  lowest,
  lunchLabel,
  newDoor,
  newPantry,
  openDoor,
  pickFor,
  restock,
  startingStock,
  swingTo,
  takeSnack,
  type Stock,
} from './fridge';
import { eAction, snackFor, SNACK_PLANS, cuesDue } from './toys/sip';

describe('the catalogue', () => {
  it('has at least eight snacks, drinks and food, each with 2-3 sips or bites and made-up names', () => {
    expect(SNACK_IDS.length).toBeGreaterThanOrEqual(8);
    expect(SNACK_IDS.filter((id) => SNACKS[id].kind === 'drink')).toEqual(['overclock', 'sparkling', 'coldbrew', 'mate']);
    expect(SNACK_IDS.filter((id) => SNACKS[id].kind === 'food')).toEqual(['pizza', 'protein', 'cheese', 'chocolate']);
    for (const id of SNACK_IDS) {
      expect(SNACKS[id].portions, id).toBeGreaterThanOrEqual(2);
      expect(SNACKS[id].portions, id).toBeLessThanOrEqual(3);
    }
    expect(SNACKS.overclock.name).toContain('Overclock');
  });

  it('cans go pssht first and crunch at the end; wrappers rustle first', () => {
    for (const id of SNACK_IDS.filter((x) => SNACKS[x].pack === 'can')) {
      expect(SNACKS[id].open).toBe('pssht');
      expect(SNACKS[id].done).toBe('crunch');
    }
    for (const id of SNACK_IDS.filter((x) => SNACKS[x].pack === 'wrapper')) expect(SNACKS[id].open).toBe('rustle');
  });

  it('labels a snack to grab, or sold out', () => {
    expect(grabLabel('coldbrew', 2)).toBe('Grab the cold brew');
    expect(grabLabel('cheese', 0)).toBe('Out of string cheese');
  });

  it("labels the tupperware with someone on the floor, the same one every time", () => {
    expect(lunchLabel(['Mia', 'Ben'], 3)).toBe(lunchLabel(['Ben', 'Mia'], 3));
    expect(lunchLabel(['Mia'], 7)).toBe("Mia's lunch, DO NOT EAT");
    expect(lunchLabel([], 1)).toMatch(/'s lunch, DO NOT EAT$/);
  });

  it('only food makes the dog beg', () => {
    expect(isFood({ kind: 'snack', snack: 'pizza' })).toBe(true);
    expect(isFood({ kind: 'snack', snack: 'overclock' })).toBe(false);
    expect(isFood({ kind: 'sausage' })).toBe(true);
    expect(isFood({ kind: 'mug' })).toBe(false);
    expect(isFood(null)).toBe(false);
  });
});

describe('sipping and biting a snack', () => {
  it('E has a sip or a bite, the first one opening it and the last one finishing it', () => {
    for (const id of SNACK_IDS) {
      const n = SNACKS[id].portions;
      const first = snackFor(id, n)!;
      const last = snackFor(id, 1)!;
      expect(first, id).toBe(SNACK_PLANS[id].first);
      expect(last, id).toBe(SNACK_PLANS[id].last);
      expect(snackFor(id, 0)).toBeNull();
      if (SNACKS[id].open) expect(first.cues[0].cue).toBe(SNACKS[id].open);
      // every plan takes exactly one sip or bite off, and the last lets go of it
      for (const p of [first, SNACK_PLANS[id].next, last]) expect(p.cues.filter((c) => c.cue === 'drink')).toHaveLength(1);
      expect(last.cues.at(-1)?.cue).toBe('drop');
      if (SNACKS[id].done) expect(last.cues.map((c) => c.cue)).toContain(SNACKS[id].done);
      // the cues are in order, so they all play
      for (const p of [first, SNACK_PLANS[id].next, last]) expect(cuesDue(p, 0, p.dur)).toBe(p.cues.length);
    }
  });

  it('a can tips up to drink; food goes up level', () => {
    expect(SNACK_PLANS.overclock.next.tilt).toBeGreaterThan(0);
    expect(SNACK_PLANS.pizza.next.tilt).toBe(0);
  });

  it('E eats it wherever you look, except at the fridge, which E works with full hands', () => {
    const can = { kind: 'snack', snack: 'overclock', left: 2 };
    expect(eAction(can, null)).toBe('sip');
    expect(eAction(can, 'coffee')).toBe('sip');
    expect(eAction(can, 'fridge')).toBe('target');
    expect(eAction({ kind: 'mug', sips: 3 }, 'fridge')).toBe('target');
    expect(eAction({ kind: 'snack', left: 0 }, null)).toBe('empty');
    // the mug and the sausage are as they were
    expect(eAction({ kind: 'mug', sips: 3 }, null)).toBe('sip');
    expect(eAction({ kind: 'sausage', bites: 2 }, 'coffee')).toBe('sip');
  });
});

describe('the stock', () => {
  it('starts with 2-4 of each, the same for the same floor', () => {
    const s = startingStock(3);
    for (const id of SNACK_IDS) {
      expect(s[id]).toBeGreaterThanOrEqual(STOCK.min);
      expect(s[id]).toBeLessThanOrEqual(STOCK.max);
    }
    expect(startingStock(3)).toEqual(s);
  });

  it('goes down as snacks are taken, and a sold-out one cannot be taken', () => {
    const p = newPantry(1, 0);
    const n = p.stock.cheese;
    for (let i = 0; i < n; i++) expect(takeSnack(p, 'cheese')).toBe(true);
    expect(p.stock.cheese).toBe(0);
    expect(takeSnack(p, 'cheese')).toBe(false);
    expect(p.stock.cheese).toBe(0);
  });

  it('brings one item back every few minutes, the most missed first, up to what it started with', () => {
    const p = newPantry(2, 0);
    const full = { ...p.full };
    while (takeSnack(p, 'mate'));
    takeSnack(p, 'pizza');
    expect(lowest(p)).toBe('mate');
    expect(restock(p, STOCK.restockMs - 1)).toBe(0);
    expect(restock(p, STOCK.restockMs)).toBe(1);
    expect(p.stock.mate).toBe(1);
    // a long while later, everything is back, and no more than that
    expect(restock(p, STOCK.restockMs * 50)).toBeGreaterThan(0);
    expect(p.stock).toEqual(full);
    expect(lowest(p)).toBeNull();
  });

  it('a full fridge starts the restock clock afresh, so the next item takes its full interval', () => {
    const p = newPantry(4, 0);
    restock(p, STOCK.restockMs * 10);
    takeSnack(p, 'overclock');
    expect(restock(p, STOCK.restockMs * 10 + 1000)).toBe(0);
    expect(restock(p, STOCK.restockMs * 11)).toBe(1);
  });
});

describe('the door', () => {
  it('opens and shuts', () => {
    const d = newDoor();
    expect(openDoor(d, 0)).toBe(true);
    expect(openDoor(d, 1)).toBe(false);
    expect(closeDoor(d)).toBe(true);
    expect(closeDoor(d)).toBe(false);
  });

  it('shuts by itself a few seconds after everyone walks away, not while someone is there', () => {
    const d = newDoor();
    openDoor(d, 0);
    expect(doorTick(d, 10, true)).toBe(null);
    expect(d.open).toBe(true);
    expect(doorTick(d, 11, false)).toBe(null);
    expect(doorTick(d, 11 + DOOR.closeAfter - 0.1, false)).toBe(null);
    expect(doorTick(d, 11 + DOOR.closeAfter, false)).toBe('close');
    expect(d.open).toBe(false);
    expect(doorTick(d, 100, false)).toBe(null);
  });

  it('coming back resets the walk-away clock', () => {
    const d = newDoor();
    openDoor(d, 0);
    doorTick(d, 1, false);
    doorTick(d, 3, true);
    expect(doorTick(d, 1 + DOOR.closeAfter + 0.5, false)).toBe(null);
    expect(d.open).toBe(true);
  });

  it('left open, it beeps after about 20 s, every few seconds', () => {
    const d = newDoor();
    openDoor(d, 0);
    expect(doorTick(d, DOOR.beepAfter - 0.5, true)).toBe(null);
    expect(doorTick(d, DOOR.beepAfter, true)).toBe('beep');
    expect(doorTick(d, DOOR.beepAfter + 1, true)).toBe(null);
    expect(doorTick(d, DOOR.beepAfter + DOOR.beepEvery, true)).toBe('beep');
  });

  it('swings open and shut', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = swingTo(a, true, 1 / 60);
    expect(a).toBe(DOOR.swing);
    for (let i = 0; i < 60; i++) a = swingTo(a, false, 1 / 60);
    expect(a).toBe(0);
  });
});

describe('who fancies what', () => {
  it("has a favourite, the same every time, and it's spread over the snacks", () => {
    expect(favouriteOf('agent-1')).toBe(favouriteOf('agent-1'));
    const seen = new Set(Array.from({ length: 60 }, (_, i) => favouriteOf(`agent-${i}`)));
    expect(seen.size).toBeGreaterThan(4);
  });

  it('takes the favourite, else the next one in stock, else nothing', () => {
    const fav = favouriteOf('a');
    const stock = Object.fromEntries(SNACK_IDS.map((id) => [id, 1])) as Stock;
    expect(pickFor('a', stock)).toBe(fav);
    stock[fav] = 0;
    const other = pickFor('a', stock);
    expect(other).not.toBe(fav);
    expect(other && stock[other]).toBe(1);
    for (const id of SNACK_IDS) stock[id] = 0;
    expect(pickFor('a', stock)).toBeNull();
  });
});
