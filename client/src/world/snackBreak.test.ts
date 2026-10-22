import { describe, expect, it } from 'vitest';
import { BREAK, fanciesCoffee } from './coffeeBreak';
import type { ActStep } from './errands';
import { SNACKS, SNACK_IDS, favouriteOf, newDoor, newPantry, openDoor, closeDoor, takeSnack, type SnackId, type SnackCue } from './fridge';
import { SNACK, SNACK_SPOTS, SnackBreak, eatPlan, fanciesSnack, type FridgeWorld, type HeldSnack } from './snackBreak';
import { spot, standable, walkways } from './walkways';

/** The fridge as snackBreak sees it: fridge.ts's real door and stock, and a log of what happened. */
function kitchen(seed = 1) {
  const pantry = newPantry(seed, 0);
  const door = newDoor();
  const k = {
    playerNear: false,
    atDoor: null as string | null,
    pantry,
    door,
    log: [] as string[],
    hands: new Map<string, HeldSnack | null>(),
    sounds: [] as { who: string; cue: SnackCue }[],
  };
  const world: FridgeWorld = {
    playerBusy: () => k.playerNear,
    claim(who) {
      if (k.atDoor !== null && k.atDoor !== who) return false;
      k.atDoor = who;
      return true;
    },
    release(who) {
      if (k.atDoor === who) k.atDoor = null;
    },
    isOpen: () => door.open,
    open(who) {
      if (openDoor(door, 0)) k.log.push(`${who} open`);
    },
    close(who) {
      if (closeDoor(door)) k.log.push(`${who} close`);
    },
    stock: () => pantry.stock,
    take(who, snack) {
      if (!door.open || !takeSnack(pantry, snack)) return false;
      k.log.push(`${who} take ${snack}`);
      return true;
    },
    hold: (who, s) => void k.hands.set(who, s),
    sound: (who, cue) => void k.sounds.push({ who, cue }),
    say: () => undefined,
    line: new Map(),
    seats: new Map(),
  };
  return { k, world };
}

/** Walks someone through their break: a walk arrives `walkSeconds` after it's asked for. */
function runner(b: SnackBreak, walkSeconds = 1) {
  let walking: string | null = SNACK_SPOTS.line[0];
  let since = 0;
  const visits: string[] = [];
  let last: ActStep = 'done';
  return {
    visits,
    get last() {
      return last;
    },
    step(now: number) {
      const arrived = now - since >= walkSeconds;
      last = b.step(now, arrived);
      if (typeof last === 'object' && 'walk' in last && last.walk !== walking) {
        walking = last.walk;
        since = now;
        visits.push(last.walk);
      }
      return last;
    },
  };
}

const DT = 0.1;

/** Runs until the break is over (or `until` seconds), calling `each` every step. */
function run(r: ReturnType<typeof runner>, until = 120, each?: (t: number) => void) {
  let t = 0;
  for (; t < until; t += DT) {
    each?.(t);
    if (r.step(t) === 'done') break;
  }
  return t;
}

describe('fancying a snack', () => {
  it('about one restless moment in five, never one that fancies a coffee', () => {
    let n = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const r = 25 + (45 * i) / N;
      if (fanciesSnack(r)) {
        n++;
        expect(fanciesCoffee(r)).toBe(false);
      }
    }
    expect(n / N).toBeGreaterThan(0.17);
    expect(n / N).toBeLessThan(0.27);
    expect(BREAK.chance + SNACK.chance).toBeLessThan(1);
  });
});

describe('the fridge spots', () => {
  it('are on the office floor, standable, and the door spot is clear of the door’s swing', () => {
    const w = walkways('office');
    for (const id of [SNACK_SPOTS.door, ...SNACK_SPOTS.line, ...SNACK_SPOTS.eat]) {
      const s = spot(w, id);
      expect(s, id).toBeDefined();
      expect(standable(w, s!.x, s!.z), id).toBe(true);
    }
    // the hinge is at the fridge front's south corner; its door is 0.8 m wide
    const door = spot(w, SNACK_SPOTS.door)!;
    const hingeX = 16 - 0.45 - 0.4;
    const hingeZ = 7 + 2.45 + 0.4;
    expect(Math.hypot(door.x - hingeX, door.z - hingeZ)).toBeGreaterThan(0.8 + 0.3);
  });
});

describe('eating it by the counter', () => {
  it('has every sip or bite, with a chat between', () => {
    const p = eatPlan(3, 0.5);
    expect(p.filter((s) => s.bite)).toHaveLength(3);
    expect(p[0].gesture).toBe('sip');
  });
});

describe('a snack break', () => {
  it('opens the fridge, takes their favourite, shuts it and eats it all by the counter, with its sounds', () => {
    const { k, world } = kitchen();
    const fav = favouriteOf('a');
    const before = k.pantry.stock[fav];
    const b = new SnackBreak('a', world, () => 0); // 0: stays to eat
    const r = runner(b);
    run(r);
    expect(r.visits).toEqual([SNACK_SPOTS.door, SNACK_SPOTS.eat[0]]);
    expect(k.log).toEqual(['a open', `a take ${fav}`, 'a close']);
    expect(k.pantry.stock[fav]).toBe(before - 1);
    expect(k.door.open).toBe(false);
    expect(k.atDoor).toBeNull();
    // all of it, then it's gone
    expect(k.hands.get('a')).toBeNull();
    const def = SNACKS[fav];
    const cues = k.sounds.map((s) => s.cue);
    if (def.open) expect(cues[0]).toBe(def.open);
    expect(cues).toContain(def.last);
    expect(cues.filter((c) => c === def.bite || c === def.last).length).toBeGreaterThanOrEqual(def.portions);
    expect(world.seats.size).toBe(0);
  });

  it('or takes it back to their desk, where it is gone once they sit', () => {
    const { k, world } = kitchen();
    const b = new SnackBreak('a', world, () => 0.99);
    const r = runner(b);
    run(r);
    expect(r.visits).toEqual([SNACK_SPOTS.door]);
    expect(b.carry).toBe('hold');
    expect(k.hands.get('a')?.snack).toBe(favouriteOf('a'));
    b.end();
    expect(k.hands.get('a')).toBeNull();
  });

  it('takes something else when their favourite is sold out, and shrugs at a bare fridge', () => {
    const { k, world } = kitchen();
    const fav = favouriteOf('a');
    k.pantry.stock[fav] = 0;
    const b = new SnackBreak('a', world, () => 0.99);
    run(runner(b));
    const got = k.hands.get('a')?.snack;
    expect(got).toBeDefined();
    expect(got).not.toBe(fav);

    const bare = kitchen();
    for (const id of SNACK_IDS) bare.k.pantry.stock[id as SnackId] = 0;
    const c = new SnackBreak('c', bare.world, () => 0);
    const seen: string[] = [];
    run(runner(c), 120, () => {
      if (c.stage === 'shrug') seen.push('shrug');
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(bare.k.hands.get('c') ?? null).toBeNull();
    expect(bare.k.log).toEqual(['c open', 'c close']);
  });

  it('never two at the door: the second waits in line for the first', () => {
    const { k, world } = kitchen();
    const a = new SnackBreak('a', world, () => 0.99);
    const c = new SnackBreak('c', world, () => 0.99);
    const ra = runner(a);
    const rc = runner(c);
    let both = 0;
    for (let t = 0; t < 60; t += DT) {
      ra.step(t);
      rc.step(t);
      if (a.stage !== 'wait' && a.stage !== 'done' && c.stage !== 'wait' && c.stage !== 'done') both++;
    }
    expect(both).toBe(0);
    expect(k.log.filter((l) => l.includes('take'))).toHaveLength(2);
    expect(k.log[0]).toBe('a open');
    // the second only opens it once the first has shut it and gone
    expect(k.log.indexOf('a close')).toBeLessThan(k.log.indexOf('c open'));
    expect(rc.visits).toContain(SNACK_SPOTS.door);
  });

  it('waits while the player is at the fridge, and gives up after a while', () => {
    const { k, world } = kitchen();
    k.playerNear = true;
    const b = new SnackBreak('a', world);
    const r = runner(b);
    const t = run(r, 120);
    expect(k.log).toEqual([]);
    expect(t).toBeGreaterThan(SNACK.wait - 1);
    expect(b.stage).toBe('done');
  });

  it('called back to work: lets go of the door, the snack comes along and is gone once they sit', () => {
    const { k, world } = kitchen();
    const b = new SnackBreak('a', world, () => 0);
    const r = runner(b);
    let t = 0;
    for (; t < 60 && !k.hands.get('a'); t += DT) r.step(t);
    expect(k.hands.get('a')).toBeTruthy();
    b.abort();
    expect(k.atDoor).toBeNull();
    expect(b.carry).toBe('hold');
    b.end();
    expect(k.hands.get('a')).toBeNull();
  });
});
