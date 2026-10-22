// The kitchenette fridge, as pure rules: what's in it (the snacks, each with its sips or bites and its sounds), the
// stock and its slow restocking, the door (left open, it beeps and then closes by itself once everyone has walked
// away) and which snack someone fancies. fridgeState.ts holds the current floor's fridge, KitchenFridge.tsx draws it, sip.ts
// times the eating and snackBreak.ts sends the agents for a snack.

// ---------- the snacks ----------

export type SnackId = 'overclock' | 'sparkling' | 'coldbrew' | 'mate' | 'pizza' | 'protein' | 'cheese' | 'chocolate';

/** A snack's sounds (toys/sipping.ts plays them), by name. */
export type SnackCue = 'pssht' | 'twist' | 'rustle' | 'peel' | 'slurp' | 'chomp' | 'snap' | 'nom' | 'munch' | 'chew' | 'fizz' | 'mm' | 'gulp' | 'glug' | 'ahh' | 'crunch';

export interface Snack {
  id: SnackId;
  /** Its full (made-up) name, and what "Grab the …" and "Out of …" call it. */
  name: string;
  short: string;
  emoji: string;
  /** Drinks are sipped (the last one a gulp), food is bitten (the last bite finishes it). */
  kind: 'drink' | 'food';
  pack: 'can' | 'bottle' | 'wrapper' | 'slice' | 'stick';
  /** Sips or bites in one. */
  portions: number;
  /** Opening it (before the first sip or bite), each sip or bite, just after one, the last one, and once it's finished. */
  open?: SnackCue;
  bite: SnackCue;
  after: SnackCue;
  last: SnackCue;
  done?: SnackCue;
}

export const SNACKS: Readonly<Record<SnackId, Snack>> = {
  overclock: { id: 'overclock', name: 'Overclock energy drink', short: 'Overclock', emoji: '⚡', kind: 'drink', pack: 'can', portions: 3, open: 'pssht', bite: 'slurp', after: 'fizz', last: 'gulp', done: 'crunch' },
  sparkling: { id: 'sparkling', name: 'Bubble Sort sparkling water', short: 'sparkling water', emoji: '🫧', kind: 'drink', pack: 'can', portions: 2, open: 'pssht', bite: 'slurp', after: 'fizz', last: 'gulp', done: 'crunch' },
  coldbrew: { id: 'coldbrew', name: 'Night Shift cold brew', short: 'cold brew', emoji: '🧋', kind: 'drink', pack: 'bottle', portions: 3, open: 'twist', bite: 'slurp', after: 'mm', last: 'glug' },
  mate: { id: 'mate', name: 'Mate Mode yerba-mate soda', short: 'mate soda', emoji: '🧉', kind: 'drink', pack: 'bottle', portions: 2, open: 'twist', bite: 'slurp', after: 'fizz', last: 'glug' },
  pizza: { id: 'pizza', name: 'cold leftover pizza', short: 'cold pizza', emoji: '🍕', kind: 'food', pack: 'slice', portions: 3, bite: 'chomp', after: 'munch', last: 'chomp' },
  protein: { id: 'protein', name: 'Refactor protein bar', short: 'protein bar', emoji: '💪', kind: 'food', pack: 'wrapper', portions: 3, open: 'rustle', bite: 'chomp', after: 'chew', last: 'chomp', done: 'rustle' },
  cheese: { id: 'cheese', name: 'Strung Along string cheese', short: 'string cheese', emoji: '🧀', kind: 'food', pack: 'stick', portions: 2, open: 'peel', bite: 'nom', after: 'munch', last: 'nom' },
  chocolate: { id: 'chocolate', name: 'Hotfix chocolate bar', short: 'chocolate bar', emoji: '🍫', kind: 'food', pack: 'wrapper', portions: 3, open: 'rustle', bite: 'snap', after: 'munch', last: 'snap', done: 'rustle' },
};

/** Every snack, in the fridge's order. */
export const SNACK_IDS = Object.keys(SNACKS) as SnackId[];

export const isSnackId = (s: unknown): s is SnackId => typeof s === 'string' && s in SNACKS;

/** What E on a snack's spot on the shelf says: grab it, or that it's sold out. */
export const grabLabel = (id: SnackId, left: number) => (left > 0 ? `Grab the ${SNACKS[id].short}` : `Out of ${SNACKS[id].short}`);

/** The tupperware at the back, labelled with someone on the floor (or nobody in particular). */
export function lunchLabel(names: readonly string[], seed: number) {
  const list = [...names].sort();
  const who = list.length ? list[Math.abs(Math.floor(seed)) % list.length] : 'Dave';
  return `${who}'s lunch, DO NOT EAT`;
}

// ---------- the stock ----------

export type Stock = Record<SnackId, number>;

export const STOCK = {
  /** Each snack starts with between `min` and `max` of it. */
  min: 2,
  max: 4,
  /** One item comes back this often (ms), the one furthest below what it started with. */
  restockMs: 150_000,
};

/** What's in the fridge: the stock, what it was stocked with (what restocking fills it back up to), the next restock. */
export interface Pantry {
  stock: Stock;
  full: Stock;
  /** performance.now() when the next item comes back. */
  nextAt: number;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};

/** 2-4 of each, the same every time for the same floor (`seed`). */
export function startingStock(seed: number): Stock {
  const out = {} as Stock;
  for (const id of SNACK_IDS) out[id] = STOCK.min + (hash(`${seed}:${id}`) % (STOCK.max - STOCK.min + 1));
  return out;
}

export function newPantry(seed: number, now: number): Pantry {
  const stock = startingStock(seed);
  return { stock, full: { ...stock }, nextAt: now + STOCK.restockMs };
}

/** Takes one off the shelf; false when it's sold out. */
export function takeSnack(p: Pantry, id: SnackId): boolean {
  if (!(p.stock[id] > 0)) return false;
  p.stock[id]--;
  return true;
}

/** The snack furthest below what it was stocked with (the first in the fridge's order on a tie), or null when it's full. */
export function lowest(p: Pantry): SnackId | null {
  let best: SnackId | null = null;
  let gap = 0;
  for (const id of SNACK_IDS) {
    const g = p.full[id] - p.stock[id];
    if (g > gap) {
      gap = g;
      best = id;
    }
  }
  return best;
}

/** Brings back whatever is due by `now`, one item per restock interval; returns how many came back. */
export function restock(p: Pantry, now: number): number {
  let n = 0;
  for (let id = lowest(p); id && now >= p.nextAt; id = lowest(p)) {
    p.stock[id]++;
    p.nextAt += STOCK.restockMs;
    n++;
  }
  // full (or not due yet): the clock for the next one starts when something's missing
  if (!lowest(p) && p.nextAt < now) p.nextAt = now + STOCK.restockMs;
  return n;
}

// ---------- the door ----------

export const DOOR = {
  /** Seconds after everyone has walked away that it closes by itself. */
  closeAfter: 4,
  /** Open this long (s), it starts beeping, once every `beepEvery` seconds. */
  beepAfter: 20,
  beepEvery: 4,
  /** Someone within this far (m) of its front is using it. */
  reach: 2.2,
  /** How far it swings open (radians), and how fast it swings (radians a second). */
  swing: 1.9,
  speed: 6,
};

export interface Door {
  open: boolean;
  /** Seconds (any clock): when it opened, when everyone walked away (null: someone's there), and the next beep. */
  openedAt: number;
  awayAt: number | null;
  beepAt: number;
}

export const newDoor = (): Door => ({ open: false, openedAt: 0, awayAt: null, beepAt: 0 });

/** Opens it; false when it was open already. */
export function openDoor(d: Door, now: number): boolean {
  if (d.open) return false;
  d.open = true;
  d.openedAt = now;
  d.awayAt = null;
  d.beepAt = now + DOOR.beepAfter;
  return true;
}

/** Shuts it; false when it was shut already. */
export function closeDoor(d: Door): boolean {
  if (!d.open) return false;
  d.open = false;
  d.awayAt = null;
  return true;
}

/**
 * The door's clock, every frame: with nobody `near` for DOOR.closeAfter seconds it closes ('close'); left open for
 * DOOR.beepAfter seconds it beeps every few seconds ('beep'). Mutates `d`; allocates nothing.
 */
export function doorTick(d: Door, now: number, near: boolean): 'close' | 'beep' | null {
  if (!d.open) return null;
  if (near) d.awayAt = null;
  else if (d.awayAt === null) d.awayAt = now;
  if (d.awayAt !== null && now - d.awayAt >= DOOR.closeAfter) {
    closeDoor(d);
    return 'close';
  }
  if (now >= d.beepAt) {
    d.beepAt = now + DOOR.beepEvery;
    return 'beep';
  }
  return null;
}

/** The door's angle `dt` seconds on, swinging towards open or shut. */
export function swingTo(angle: number, open: boolean, dt: number) {
  const target = open ? DOOR.swing : 0;
  const step = DOOR.speed * dt;
  return Math.abs(target - angle) <= step ? target : angle + Math.sign(target - angle) * step;
}

// ---------- who fancies what ----------

/** Someone's favourite snack: the same every time (by their id). */
export const favouriteOf = (id: string): SnackId => SNACK_IDS[hash(id) % SNACK_IDS.length];

/** What they take: their favourite, or (sold out) the next snack along that's in stock; null when the fridge is bare. */
export function pickFor(id: string, stock: Readonly<Stock>): SnackId | null {
  const fav = SNACK_IDS.indexOf(favouriteOf(id));
  for (let i = 0; i < SNACK_IDS.length; i++) {
    const s = SNACK_IDS[(fav + i) % SNACK_IDS.length];
    if (stock[s] > 0) return s;
  }
  return null;
}

/** The dog begs for food in your hands, but not for a drink. */
export const isFood = (held: { kind: string; snack?: string } | null) => held?.kind === 'sausage' || (held?.kind === 'snack' && isSnackId(held.snack) && SNACKS[held.snack].kind === 'food');
