// The kitchenette fridge, as pure rules: what's in it (a software team's fridge, no real brands), the stock per floor
// (taking, sold out, one item back every few minutes), when the door closes by itself and starts beeping, and what
// each agent fancies. fridgeState.ts keeps the live state, FridgeModel.tsx draws it, fridgeBreak.ts sends agents to it.

export type SnackId = 'overclock' | 'fizz' | 'coldbrew' | 'mate' | 'pizza' | 'bar' | 'cheese' | 'choc';

export interface Snack {
  id: SnackId;
  /** Its name on the label, and what you call it ("Grab the cold brew"). */
  name: string;
  short: string;
  /** A drink is sipped like coffee, food bitten like the sausage. */
  kind: 'drink' | 'food';
  /** How it opens: a can goes "pssht" and crunches when empty, a bottle's cap twists, a wrapper rustles. */
  pack: 'can' | 'bottle' | 'wrapper' | 'none';
  /** Sips or bites in a full one. */
  sips: number;
  /** Its colours, and how high its sounds are (1 normal). */
  color: string;
  accent: string;
  pitch: number;
  emoji: string;
}

export const SNACKS: readonly Snack[] = [
  { id: 'overclock', name: 'Overclock energy drink', short: 'Overclock', kind: 'drink', pack: 'can', sips: 3, color: '#2b2d42', accent: '#9ef01a', pitch: 1.15, emoji: '⚡' },
  { id: 'fizz', name: 'Sparkling water', short: 'sparkling water', kind: 'drink', pack: 'can', sips: 2, color: '#e0fbfc', accent: '#3a86ff', pitch: 1.3, emoji: '🫧' },
  { id: 'coldbrew', name: 'Cold brew', short: 'cold brew', kind: 'drink', pack: 'bottle', sips: 3, color: '#3d2314', accent: '#f1e3c8', pitch: 0.85, emoji: '🧋' },
  { id: 'mate', name: 'Yerba mate soda', short: 'mate soda', kind: 'drink', pack: 'bottle', sips: 3, color: '#b5d99c', accent: '#2d6a4f', pitch: 1, emoji: '🧉' },
  { id: 'pizza', name: 'Cold leftover pizza', short: 'cold pizza', kind: 'food', pack: 'none', sips: 3, color: '#f6bd60', accent: '#c1121f', pitch: 0.9, emoji: '🍕' },
  { id: 'bar', name: 'Protein bar', short: 'protein bar', kind: 'food', pack: 'wrapper', sips: 2, color: '#ff9f1c', accent: '#6d4c41', pitch: 0.8, emoji: '💪' },
  { id: 'cheese', name: 'String cheese', short: 'string cheese', kind: 'food', pack: 'wrapper', sips: 2, color: '#fff3c4', accent: '#e63946', pitch: 1.2, emoji: '🧀' },
  { id: 'choc', name: 'Chocolate bar', short: 'chocolate bar', kind: 'food', pack: 'wrapper', sips: 3, color: '#5c3317', accent: '#9d4edd', pitch: 1.05, emoji: '🍫' },
];

export const SNACK_IDS: readonly SnackId[] = SNACKS.map((s) => s.id);

const BY_ID = new Map(SNACKS.map((s) => [s.id, s]));

/** A snack by id (undefined for anything else, from the probe say). */
export const snackOf = (id: string): Snack | undefined => BY_ID.get(id as SnackId);

export const isSnackId = (id: string): id is SnackId => BY_ID.has(id as SnackId);

export const FRIDGE = {
  /** How many of each there are on a fresh floor, and at most. */
  min: 2,
  max: 4,
  /** One item comes back this often (ms). */
  restock: 3 * 60_000,
  /** The door closes by itself this long after everyone walked away (ms), and beeps after being open this long. */
  autoClose: 6_000,
  beepAfter: 20_000,
  beepEvery: 2_500,
  /** Standing this close (m) to the fridge's front counts as being at it. */
  near: 2.2,
};

export type Stock = Record<SnackId, number>;

/** A fresh fridge: between min and max of each, from `seed` (a floor's number, so a floor's fridge looks the same each visit). */
export function freshStock(seed = 1): Stock {
  const out = {} as Stock;
  let h = (seed * 2654435761) >>> 0;
  for (const id of SNACK_IDS) {
    h = (Math.imul(h ^ (h >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
    out[id] = FRIDGE.min + (h % (FRIDGE.max - FRIDGE.min + 1));
  }
  return out;
}

/** The stock with one `id` taken, or null when it's sold out. */
export function take(stock: Stock, id: SnackId): Stock | null {
  if (!(stock[id] > 0)) return null;
  return { ...stock, [id]: stock[id] - 1 };
}

/** One item back: the snack there's least of (the first of those in the catalogue). Unchanged when it's full. */
export function restockOne(stock: Stock): Stock {
  let best: SnackId | null = null;
  for (const id of SNACK_IDS) if (stock[id] < FRIDGE.max && (best === null || stock[id] < stock[best])) best = id;
  return best ? { ...stock, [best]: stock[best] + 1 } : stock;
}

/** Items back since `since` (ms), one per `FRIDGE.restock`: the new stock and when the next count starts. */
export function restock(stock: Stock, since: number, now: number): { stock: Stock; since: number } {
  let s = stock;
  let at = since;
  while (now - at >= FRIDGE.restock) {
    s = restockOne(s);
    at += FRIDGE.restock;
  }
  return { stock: s, since: at };
}

/** Nothing left at all. */
export const bare = (stock: Stock) => SNACK_IDS.every((id) => !(stock[id] > 0));

// ---------- the door ----------

/** An open door shuts by itself once nobody has been at it for `FRIDGE.autoClose`. */
export const autoCloseDue = (open: boolean, lastNear: number, now: number) => open && now - lastNear >= FRIDGE.autoClose;

/** Open long enough to start the "door left open" beep, and due for the next one. */
export const beepDue = (open: boolean, openAt: number, lastBeep: number, now: number) =>
  open && now - openAt >= FRIDGE.beepAfter && now - lastBeep >= FRIDGE.beepEvery;

// ---------- agents ----------

const hash = (id: string) => {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0;
  return h;
};

/** What someone always goes for (by their id, like their lunch). */
export const favouriteOf = (id: string): SnackId => SNACK_IDS[hash(id) % SNACK_IDS.length];

/** What they take: their favourite, else the next one along that's in stock; null when the fridge is bare. */
export function pickFor(id: string, stock: Stock): SnackId | null {
  const start = SNACK_IDS.indexOf(favouriteOf(id));
  for (let i = 0; i < SNACK_IDS.length; i++) {
    const s = SNACK_IDS[(start + i) % SNACK_IDS.length];
    if (stock[s] > 0) return s;
  }
  return null;
}

/** The tupperware's label: someone's lunch. */
export const lunchLabel = (name: string) => `${name}'s lunch, DO NOT EAT`;
