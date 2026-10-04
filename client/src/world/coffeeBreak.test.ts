import { describe, expect, it } from 'vitest';
import { BREW, EMPTY, placeMug, pressButton, takeMug, tick, type BrewState } from './coffee';
import {
  BREAK,
  CoffeeBreak,
  PLAYER,
  SPOTS,
  drinkPlan,
  fanciesCoffee,
  joinLine,
  leaveLine,
  machineMove,
  myTurn,
  pickLineSpot,
  pickSeat,
  type BreakWorld,
  type Mug,
} from './coffeeBreak';
import type { ActStep } from './errands';
import { spot, standable, walkways } from './walkways';

/** The kitchenette as coffeeBreak sees it: coffee.ts's real brew states, on a clock the test moves (seconds). */
function kitchen() {
  let state: BrewState = EMPTY;
  let owner: string | null = null;
  const k = {
    now: 0,
    playerNear: false,
    log: [] as string[],
    desk: new Map<string, Mug>(),
    hands: new Map<string, Mug | null>(),
    get state() {
      return tick(state, k.now * 1000);
    },
    get owner() {
      return owner;
    },
    playerPlaces(mug: Mug) {
      state = placeMug(state, mug);
      owner = PLAYER;
    },
    playerTakes() {
      const r = takeMug(state, k.now * 1000);
      if (r) state = r.state;
      owner = null;
      return r?.mug ?? null;
    },
  };
  let seq = 0;
  const world: BreakWorld = {
    slot: () => {
      const s = tick(state, k.now * 1000);
      return s.kind === 'empty' ? null : { kind: s.kind, owner };
    },
    playerFirst: () => (state.kind !== 'empty' && owner === PLAYER) || k.playerNear,
    line: [],
    seats: new Map(),
    place(who, mug) {
      const next = placeMug(state, mug);
      if (next === state) return false;
      state = next;
      owner = who;
      k.log.push(`${who} place`);
      return true;
    },
    press(who) {
      if (owner !== who && owner !== null) return false;
      const r = pressButton(state, k.now * 1000);
      if (r.result !== 'started') return false;
      state = r.state;
      owner = who;
      k.log.push(`${who} press`);
      return true;
    },
    take(who) {
      if (owner !== who && owner !== null) return null;
      const r = takeMug(state, k.now * 1000);
      if (!r) return null;
      state = r.state;
      owner = null;
      k.log.push(`${who} take ${r.mug.sips}`);
      return r.mug;
    },
    abandon(who) {
      if (owner === who) owner = null;
    },
    newMug: (who) => {
      k.log.push(`${who} newMug`);
      return { id: `mug-${who}-${++seq}`, sips: 0 };
    },
    putBack: (who) => void k.log.push(`${who} putBack`),
    hold: (who, mug) => void k.hands.set(who, mug),
    sip: (who) => void k.log.push(`${who} sip`),
    toDesk: (who, mug) => void k.desk.set(who, mug),
  };
  return { k, world };
}

/** Walks someone through their break: a walk arrives `walkSeconds` after it's asked for. Returns where they were sent. */
function runner(b: CoffeeBreak, walkSeconds = 1) {
  let walking: string | null = SPOTS.mugs;
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

describe('fancying a coffee', () => {
  it('about one restless moment in four becomes a coffee break', () => {
    let n = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) if (fanciesCoffee(25 + (45 * i) / N)) n++;
    expect(n / N).toBeGreaterThan(0.2);
    expect(n / N).toBeLessThan(0.3);
  });
});

describe('what to do at the machine', () => {
  it('places a mug in an empty slot, or fetches one first', () => {
    expect(machineMove(null, 'a', true)).toBe('place');
    expect(machineMove(null, 'a', false)).toBe('getMug');
  });

  it('presses, waits and takes for their own mug, and never touches the player’s or another agent’s', () => {
    expect(machineMove({ kind: 'mugPlaced', owner: 'a' }, 'a', false)).toBe('press');
    expect(machineMove({ kind: 'brewing', owner: 'a' }, 'a', false)).toBe('wait');
    expect(machineMove({ kind: 'ready', owner: 'a' }, 'a', false)).toBe('take');
    for (const kind of ['mugPlaced', 'brewing', 'ready'] as const) {
      expect(machineMove({ kind, owner: PLAYER }, 'a', false)).toBe('blocked');
      expect(machineMove({ kind, owner: 'b' }, 'a', true)).toBe('blocked');
    }
  });

  it('a coffee left behind is anyone’s: have it, after putting your own empty mug back', () => {
    expect(machineMove({ kind: 'ready', owner: null }, 'a', false)).toBe('take');
    expect(machineMove({ kind: 'brewing', owner: null }, 'a', false)).toBe('wait');
    expect(machineMove({ kind: 'mugPlaced', owner: null }, 'a', false)).toBe('press');
    expect(machineMove({ kind: 'ready', owner: null }, 'a', true)).toBe('returnMug');
  });

  it('keeps a line, first come first served', () => {
    const line: string[] = [];
    joinLine(line, 'a');
    joinLine(line, 'b');
    joinLine(line, 'a');
    expect(line).toEqual(['a', 'b']);
    expect(myTurn(line, 'a')).toBe(true);
    expect(myTurn(line, 'b')).toBe(false);
    leaveLine(line, 'a');
    expect(myTurn(line, 'b')).toBe(true);
  });

  it('hands out the spots by the counter one each', () => {
    const seats = new Map<string, string>();
    expect(pickSeat(seats, 'a')).toBe(SPOTS.sip[0]);
    expect(pickSeat(seats, 'b')).toBe(SPOTS.sip[1]);
    expect(pickSeat(seats, 'a')).toBe(SPOTS.sip[0]);
    expect(pickSeat(seats, 'c')).toBeNull();
  });

  it('gives each one waiting their own spot in line, and the one behind moves up', () => {
    const seats = new Map<string, string>();
    expect(pickLineSpot(seats, 'a')).toBe(SPOTS.line[0]);
    expect(pickLineSpot(seats, 'b')).toBe(SPOTS.line[1]);
    expect(pickLineSpot(seats, 'a')).toBe(SPOTS.line[0]);
    expect(pickLineSpot(seats, 'b')).toBe(SPOTS.line[1]);
    seats.delete(SPOTS.line[0]);
    expect(pickLineSpot(seats, 'b')).toBe(SPOTS.line[0]);
    expect([...seats]).toEqual([[SPOTS.line[0], 'b']]);
  });
});

describe('drinking', () => {
  it('sips one, two or all three, with a chat after each', () => {
    const sipsOf = (r: number) => drinkPlan(3, r).filter((s) => s.sip).length;
    expect(sipsOf(0.1)).toBe(3);
    expect(sipsOf(0.5)).toBe(2);
    expect(sipsOf(0.9)).toBe(1);
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const plan = drinkPlan(3, r);
      plan.forEach((s, i) => expect(s.gesture).toBe(i % 2 ? 'chat' : 'sip'));
      for (const s of plan.filter((x) => !x.sip)) {
        expect(s.seconds).toBeGreaterThanOrEqual(BREAK.chat[0]);
        expect(s.seconds).toBeLessThanOrEqual(BREAK.chat[1]);
      }
    }
    expect(drinkPlan(1, 0.9).filter((s) => s.sip)).toHaveLength(1);
  });
});

describe('a coffee break', () => {
  it('mug, machine, brew, a sip or two by the counter, then back to the desk with the rest', () => {
    const { k, world } = kitchen();
    const b = new CoffeeBreak('a', world, () => 0.9); // one sip
    const r = runner(b);
    for (k.now = 0; k.now < 60 && r.step(k.now) !== 'done'; k.now += DT);
    expect(r.last).toBe('done');
    expect(k.log).toEqual(['a newMug', 'a place', 'a press', 'a take 3', 'a sip']);
    expect(r.visits).toEqual([SPOTS.machine, SPOTS.sip[0]]);
    expect(b.mug?.sips).toBe(2);
    expect(b.carry).toBe('mug');
    // the brew took its full time
    expect(k.now).toBeGreaterThan(BREW.ms / 1000 + 3 * BREAK.reach);
    b.end(true);
    expect(k.desk.get('a')?.sips).toBe(2);
    expect(k.hands.get('a')).toBeNull();
    expect(world.line).toEqual([]);
    expect(world.seats.size).toBe(0);
  });

  it('drinks it all and puts the empty mug back on the dispenser', () => {
    const { k, world } = kitchen();
    const b = new CoffeeBreak('a', world, () => 0.1);
    const r = runner(b);
    for (k.now = 0; k.now < 80 && r.step(k.now) !== 'done'; k.now += DT);
    expect(k.log.filter((l) => l === 'a sip')).toHaveLength(3);
    expect(k.log.at(-1)).toBe('a putBack');
    expect(r.visits.at(-1)).toBe(SPOTS.mugs);
    expect(b.carry).toBe('none');
    b.end(true);
    expect(k.desk.has('a')).toBe(false);
  });

  it('two at once: the second waits a step back until the first has their coffee', () => {
    const { k, world } = kitchen();
    const a = new CoffeeBreak('a', world, () => 0.9);
    const b = new CoffeeBreak('b', world, () => 0.9);
    const ra = runner(a);
    const rb = runner(b);
    let bWaited = false;
    for (k.now = 0; k.now < 90; k.now += DT) {
      const da = ra.step(k.now);
      const db = rb.step(k.now);
      // never both at the machine
      if (a.stage === 'machine' && b.stage === 'machine') throw new Error('both at the machine');
      if (b.stage === 'line' && a.stage === 'machine') bWaited = true;
      if (da === 'done' && db === 'done') break;
    }
    expect(bWaited).toBe(true);
    expect(rb.visits[0]).toBe(SPOTS.line[0]);
    expect(k.log.indexOf('b place')).toBeGreaterThan(k.log.indexOf('a take 3'));
    expect(k.log).toContain('b take 3');
    expect(new Set([...k.log].filter((l) => l.endsWith('sip')))).toEqual(new Set(['a sip', 'b sip']));
  });

  it('the player goes first: an agent steps back while they stand there with a mug', () => {
    const { k, world } = kitchen();
    k.playerNear = true;
    const b = new CoffeeBreak('a', world);
    const r = runner(b);
    for (k.now = 0; k.now < 10; k.now += DT) r.step(k.now);
    expect(b.stage).toBe('line');
    expect(k.log).toEqual(['a newMug']);
    // the player puts their mug in and brews: the agent still waits, and never takes it
    k.playerNear = false;
    k.playerPlaces({ id: 'mug-1', sips: 0 });
    for (; k.now < 30; k.now += DT) r.step(k.now);
    expect(b.stage).toBe('line');
    expect(k.log).toEqual(['a newMug']);
    // once the player has taken it, the agent's turn
    expect(k.playerTakes()?.id).toBe('mug-1');
    for (; k.now < 40; k.now += DT) r.step(k.now);
    expect(k.log).toContain('a place');
  });

  it('the player goes first and two wait: they stand in two different spots, never on each other', () => {
    const { k, world } = kitchen();
    k.playerPlaces({ id: 'mug-1', sips: 0 });
    const a = new CoffeeBreak('a', world);
    const b = new CoffeeBreak('b', world);
    const ra = runner(a);
    const rb = runner(b);
    for (k.now = 0; k.now < 20; k.now += DT) {
      ra.step(k.now);
      rb.step(k.now);
    }
    expect(a.stage).toBe('line');
    expect(b.stage).toBe('line');
    const wa = ra.last;
    const wb = rb.last;
    if (typeof wa !== 'object' || !('walk' in wa) || typeof wb !== 'object' || !('walk' in wb)) throw new Error('not waiting');
    expect(new Set([wa.walk, wb.walk])).toEqual(new Set(SPOTS.line));
    // the player takes their coffee: the first goes to the machine and the second moves up to the front spot
    k.playerTakes();
    let movedUp = false;
    for (; k.now < 30; k.now += DT) {
      ra.step(k.now);
      const s = rb.step(k.now);
      if (b.stage === 'line' && typeof s === 'object' && 'walk' in s && s.walk === SPOTS.line[0]) movedUp = true;
    }
    expect(a.stage).not.toBe('line');
    expect(movedUp).toBe(true);
  });

  it('gives up after waiting too long behind the player’s mug, and puts the empty mug back', () => {
    const { k, world } = kitchen();
    k.playerPlaces({ id: 'mug-1', sips: 0 });
    const b = new CoffeeBreak('a', world);
    const r = runner(b);
    for (k.now = 0; k.now < BREAK.line + 20 && r.step(k.now) !== 'done'; k.now += DT);
    expect(r.last).toBe('done');
    expect(k.log).toEqual(['a newMug', 'a putBack']);
    expect(k.owner).toBe(PLAYER);
    expect(k.state.kind).toBe('mugPlaced');
    expect(world.line).toEqual([]);
  });

  it('called back mid-brew: the brew finishes and the coffee is anyone’s, so the next one has it', () => {
    const { k, world } = kitchen();
    const a = new CoffeeBreak('a', world);
    const ra = runner(a);
    for (k.now = 0; k.now < 30 && !k.log.includes('a press'); k.now += DT) ra.step(k.now);
    a.abort();
    expect(a.stage).toBe('done');
    expect(k.owner).toBeNull();
    expect(world.line).toEqual([]);
    k.now += BREW.ms / 1000;
    expect(k.state.kind).toBe('ready');
    // the next one skips the dispenser and takes it
    const b = new CoffeeBreak('b', world, () => 0.9);
    const rb = runner(b);
    for (; k.now < 60 && rb.step(k.now) !== 'done'; k.now += DT);
    expect(k.log).not.toContain('b newMug');
    expect(k.log).toContain('b take 3');
  });

  it('their mug went from the machine (the player took it): they let it go and head back', () => {
    const { k, world } = kitchen();
    const b = new CoffeeBreak('a', world);
    const r = runner(b);
    for (k.now = 0; k.now < 30 && !k.log.includes('a press'); k.now += DT) r.step(k.now);
    k.playerTakes();
    for (; k.now < 40 && r.step(k.now) !== 'done'; k.now += DT);
    expect(r.last).toBe('done');
    expect(b.mug).toBeNull();
  });
});

describe('the kitchenette spots', () => {
  it('are where people can stand, the line a step back from the machine and the two by the counter facing each other', () => {
    const w = walkways('office');
    const ids = [SPOTS.mugs, SPOTS.machine, ...SPOTS.line, ...SPOTS.sip];
    for (const id of ids) {
      const s = spot(w, id);
      expect(s, id).toBeDefined();
      expect(standable(w, s!.x, s!.z), id).toBe(true);
    }
    const m = spot(w, SPOTS.machine)!;
    const [l0, l1] = SPOTS.line.map((id) => spot(w, id)!);
    expect(Math.hypot(m.x - l0.x, m.z - l0.z)).toBeGreaterThan(0.7);
    expect(Math.hypot(l0.x - l1.x, l0.z - l1.z)).toBeGreaterThan(0.7);
    const [s0, s1] = SPOTS.sip.map((id) => spot(w, id)!);
    expect(Math.abs(Math.abs(s0.facing - s1.facing) - Math.PI)).toBeLessThan(1e-9);
  });
});
