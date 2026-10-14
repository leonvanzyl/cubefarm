import { describe, expect, it } from 'vitest';
import type { ActStep } from './errands';
import { freshStock, pickFor, snackOf, take, type Stock } from './fridge';
import { FridgeBreak, SNACK, SNACK_SPOTS, fanciesSnack, type HandSnack, type SnackWorld } from './fridgeBreak';
import { spot, standable, walkways } from './walkways';

/** The kitchenette fridge as a snack break sees it, with a stock and a door the test can watch. */
function kitchen(stock: Stock = freshStock(1)) {
  const k = {
    stock,
    open: false,
    door: null as string | null,
    playerNear: false,
    opened: 0,
    closed: 0,
    bites: [] as string[],
    hands: new Map<string, HandSnack | null>(),
  };
  const world: SnackWorld = {
    doorFree: (who) => (k.door === null || k.door === who) && !k.playerNear,
    claim(who) {
      if (!world.doorFree(who)) return false;
      k.door = who;
      return true;
    },
    release(who) {
      if (k.door === who) k.door = null;
    },
    open() {
      k.open = true;
      k.opened++;
    },
    close() {
      k.open = false;
      k.closed++;
    },
    take(who) {
      const id = pickFor(who, k.stock);
      const next = id && take(k.stock, id);
      if (!id || !next) return null;
      k.stock = next;
      return { snack: id, left: snackOf(id)!.sips };
    },
    seats: new Map(),
    hold: (who, s) => void k.hands.set(who, s),
    bite: (who) => void k.bites.push(who),
  };
  return { k, world };
}

/** Runs someone's break on a clock, arriving at each spot as soon as they're sent. Returns the last step and what they walked to. */
function run(b: FridgeBreak, from: number, until: number, dt = 0.1, every?: (t: number) => void) {
  let last: ActStep = { stand: 'none' };
  const walks: string[] = [];
  let walking = '';
  for (let t = from; t < until; t += dt) {
    every?.(t);
    last = b.step(t, true);
    if (last !== 'done' && 'walk' in last && last.walk !== walking) {
      walking = last.walk;
      walks.push(walking);
    }
    if (last === 'done') break;
  }
  return { last, walks };
}

describe('a snack break', () => {
  it('opens the door, takes their favourite, shuts it, and eats it by the counter in a few bites', () => {
    const { k, world } = kitchen();
    const before = { ...k.stock };
    const b = new FridgeBreak('ada', world, () => 0.9); // 0.9: eat it there, not at the desk
    const fav = pickFor('ada', before)!;
    const r = run(b, 0, 60);
    expect(r.last).toBe('done');
    expect(r.walks).toContain(SNACK_SPOTS.door);
    expect(k.opened).toBe(1);
    expect(k.closed).toBe(1);
    expect(k.open).toBe(false);
    expect(k.door).toBeNull();
    expect(k.stock[fav]).toBe(before[fav] - 1);
    expect(k.bites.length).toBe(snackOf(fav)!.sips);
    expect(k.hands.get('ada')).toBeNull();
    expect(world.seats.size).toBe(0);
  });

  it('takes something else when their favourite is sold out, and shrugs at a bare fridge', () => {
    const { k, world } = kitchen();
    const fav = pickFor('bo', k.stock)!;
    k.stock = { ...k.stock, [fav]: 0 };
    const b = new FridgeBreak('bo', world, () => 0.9);
    let held: HandSnack | null = null;
    run(b, 0, 60, 0.1, () => {
      held ??= k.hands.get('bo') ?? null;
    });
    expect(held).not.toBeNull();
    expect(held!.snack).not.toBe(fav);

    const bare = kitchen(Object.fromEntries(Object.keys(k.stock).map((id) => [id, 0])) as Stock);
    const c = new FridgeBreak('cy', bare.world, () => 0.9);
    let shrugged = false;
    let last: ActStep = { stand: 'none' };
    for (let t = 0; t < 30 && last !== 'done'; t += 0.1) {
      last = c.step(t, true);
      shrugged ||= last !== 'done' && 'stand' in last && last.stand === 'shrug';
    }
    expect(last).toBe('done');
    expect(shrugged).toBe(true);
    expect(bare.k.opened).toBe(1);
    expect(bare.k.closed).toBe(1);
    expect(bare.k.hands.get('cy') ?? null).toBeNull();
  });

  it('never has two at the door at once, and waits while the player is at the fridge', () => {
    const { k, world } = kitchen();
    const a = new FridgeBreak('a', world, () => 0.9);
    const b = new FridgeBreak('b', world, () => 0.9);
    k.playerNear = true;
    for (let t = 0; t < 5; t += 0.1) {
      a.step(t, true);
      b.step(t, true);
      expect(k.door).toBeNull();
    }
    expect(k.opened).toBe(0);
    k.playerNear = false;
    let both = false;
    for (let t = 5; t < 80; t += 0.1) {
      a.step(t, true);
      b.step(t, true);
      both ||= a.stage === 'door' && b.stage === 'door';
    }
    expect(both).toBe(false);
    expect(k.opened).toBe(2);
    expect(a.stage).toBe('done');
    expect(b.stage).toBe('done');
  });

  it('gives up after waiting too long', () => {
    const { k, world } = kitchen();
    k.playerNear = true;
    const b = new FridgeBreak('d', world);
    const r = run(b, 0, SNACK.wait + 5);
    expect(r.last).toBe('done');
    expect(k.opened).toBe(0);
  });

  it('sometimes takes it back to the desk, where it is gone once they sit', () => {
    const { k, world } = kitchen();
    const b = new FridgeBreak('e', world, () => 0.1); // under SNACK.toDesk
    const r = run(b, 0, 30);
    expect(r.last).toBe('done');
    expect(b.carry).toBe('hold');
    expect(k.hands.get('e')).not.toBeNull();
    expect(k.open).toBe(false);
    b.end();
    expect(k.hands.get('e')).toBeNull();
  });

  it('called back to work: shuts the fridge it had open, and the snack comes along', () => {
    const { k, world } = kitchen();
    const b = new FridgeBreak('f', world, () => 0.9);
    for (let t = 0; t < 30 && !k.hands.get('f'); t += 0.1) b.step(t, true);
    expect(k.open).toBe(true);
    b.abort();
    expect(k.open).toBe(false);
    expect(k.door).toBeNull();
    expect(b.carry).toBe('hold');
    b.end();
    expect(k.hands.get('f')).toBeNull();
  });

  it('is fancied on a share of restless moments, like coffee', () => {
    let n = 0;
    for (let i = 0; i < 1000; i++) if (fanciesSnack(25 + (i / 1000) * 45)) n++;
    expect(n).toBeGreaterThan(120);
    expect(n).toBeLessThan(330);
  });
});

describe('the fridge spots', () => {
  it('are where people can stand, the door spot clear of the door swinging open', () => {
    const w = walkways('office');
    for (const id of [SNACK_SPOTS.door, ...SNACK_SPOTS.eat]) {
      const s = spot(w, id);
      expect(s, id).toBeDefined();
      expect(standable(w, s!.x, s!.z), id).toBe(true);
    }
    // the door hinges at the fridge front's south corner and is 0.8 m wide
    const hinge = { x: 16 - 0.85, z: 7 + 2.45 + 0.4 };
    const d = spot(w, SNACK_SPOTS.door)!;
    expect(Math.hypot(d.x - hinge.x, d.z - hinge.z)).toBeGreaterThan(0.8 + 0.3);
  });
});
