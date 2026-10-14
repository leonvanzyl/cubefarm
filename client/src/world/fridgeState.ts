// The kitchenette fridge on the floor you're on: its door, who is at it, and each floor's stock (client-side, kept per
// floor for the visit, like the coffee machine's state). The player's E (Player.tsx) and the agents' snack breaks
// (fridgeErrand.ts) both come through here; FridgeModel.tsx draws it and runs its clock (auto-close, the beep, restocks).
// window.__swarmFridge reports it and __swarmFridgeDo acts on it, for QA.

import { useStore } from '../store';
import { fridgePop, fridgeThunk, type Vec3 } from '../ui/sfx';
import { SNACK_IDS, freshStock, isSnackId, pickFor, restock, snackOf, take, type SnackId, type Stock } from './fridge';
import type { HandSnack } from './fridgeBreak';

export const PLAYER = 'player';

/** Where the fridge's door is in the world (FridgeModel.tsx fills it in once drawn), for sounds and who is near. */
export const fridgeSpot: Vec3 = { x: 0, y: 1.2, z: 0 };

const stocks = new Map<number, { stock: Stock; since: number }>();

export const fridge = {
  floor: 0,
  open: false,
  openAt: 0,
  /** performance.now() when someone was last at the open door, and when it last beeped. */
  lastNear: 0,
  lastBeep: 0,
  /** The player is standing at the fridge (agents wait for them). */
  playerNear: false,
  /** The agent at the door, if any (one at a time). */
  door: null as string | null,
  /** Agents with a snack from it in hand. */
  eating: new Set<string>(),
  /** Whose lunch the tupperware is (a name), for its label. */
  lunchOf: '',
};

const listeners = new Set<() => void>();
let version = 0;

/** FridgeModel.tsx redraws when the door or the stock changes. */
export function subscribeFridge(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export const fridgeVersion = () => version;

function changed() {
  version++;
  for (const fn of listeners) fn();
}

/** This floor's stock, restocked up to `now`. */
export function stockNow(now = performance.now()): Stock {
  let s = stocks.get(fridge.floor);
  if (!s) {
    s = { stock: freshStock(fridge.floor + 1), since: now };
    stocks.set(fridge.floor, s);
  }
  const r = restock(s.stock, s.since, now);
  if (r.stock !== s.stock) {
    stocks.set(fridge.floor, r);
    changed();
  } else s.since = r.since;
  return r.stock;
}

/** Arriving on a floor: its fridge, shut, with whatever stock it had. */
export function enterFloor(floor: number) {
  fridge.floor = floor;
  fridge.open = false;
  fridge.door = null;
  fridge.playerNear = false;
  fridge.eating.clear();
  changed();
}

function takeOne(id: SnackId): boolean {
  const now = performance.now();
  const next = take(stockNow(now), id);
  if (!next) return false;
  stocks.set(fridge.floor, { stock: next, since: stocks.get(fridge.floor)!.since });
  changed();
  return true;
}

export function openDoor() {
  const now = performance.now();
  fridge.lastNear = now;
  if (fridge.open) return;
  fridge.open = true;
  fridge.openAt = now;
  fridge.lastBeep = 0;
  fridgePop(fridgeSpot);
  changed();
}

export function closeDoor() {
  if (!fridge.open) return;
  fridge.open = false;
  fridgeThunk(fridgeSpot);
  changed();
}

let seq = 1;

// ---------- the player ----------

export type FridgeOp = 'open' | 'close' | 'take' | 'lunch';

/** E on the fridge: open or shut its door, take a snack, or leave someone's lunch alone. */
export function fridgeAction(op: FridgeOp, snack?: SnackId) {
  const s = useStore.getState();
  if (op === 'open') return openDoor();
  if (op === 'close') return closeDoor();
  if (op === 'lunch') {
    s.pushToast('info', `🥡 That's ${fridge.lunchOf || 'someone'}'s lunch. Better leave it.`);
    return;
  }
  const def = snack ? snackOf(snack) : undefined;
  if (!def || !fridge.open) return;
  if (s.held) {
    s.pushToast('info', s.held.kind === 'snack' ? `${snackOf(s.held.snack)?.emoji ?? '🙌'} One at a time: finish that one first (E)` : '🙌 Your hands are full');
    return;
  }
  if (!takeOne(def.id)) {
    s.pushToast('info', `${def.emoji} Out of ${def.short}`);
    return;
  }
  fridge.lastNear = performance.now();
  s.setHeld({ kind: 'snack', id: `snack-${seq++}`, snack: def.id, left: def.sips });
}

// ---------- agents (fridgeErrand.ts) ----------

/** The door is free for `who`: nobody else at it, and the player isn't at the fridge. */
export const doorFree = (who: string) => (fridge.door === null || fridge.door === who) && !fridge.playerNear;

export function claimDoor(who: string) {
  if (!doorFree(who)) return false;
  fridge.door = who;
  return true;
}

export function releaseDoor(who: string) {
  if (fridge.door === who) fridge.door = null;
}

/** An agent's pick out of the fridge (their favourite, else whatever's left): null when it's bare. */
export function takeFor(who: string): HandSnack | null {
  const id = pickFor(who, stockNow());
  if (!id || !takeOne(id)) return null;
  return { snack: id, left: snackOf(id)!.sips };
}

// ---------- probe ----------

/** window.__swarmFridge: the current floor's fridge, for QA and Playwright. */
export interface FridgeSnapshot {
  open: boolean;
  stock: Record<string, number>;
  /** What the player holds from it: the snack and its sips or bites left. */
  held: { snack: SnackId; left: number } | null;
  /** Agents with a snack from it in hand; who is at the door. */
  eating: string[];
  door: string | null;
}

if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmFridge')) {
  Object.defineProperty(window, '__swarmFridge', {
    get: (): FridgeSnapshot => {
      const held = useStore.getState().held;
      const stock = stockNow();
      return {
        open: fridge.open,
        stock: Object.fromEntries(SNACK_IDS.map((id) => [id, stock[id]])),
        held: held?.kind === 'snack' ? { snack: held.snack, left: held.left } : null,
        eating: [...fridge.eating],
        door: fridge.door,
      };
    },
    enumerable: false,
    configurable: false,
  });
  // __swarmFridgeDo('open' | 'close' | 'take', snack?): act on the fridge without aiming (pointer lock doesn't work headless).
  Object.defineProperty(window, '__swarmFridgeDo', {
    value: (op: FridgeOp, snack?: string) => {
      if (op === 'take' && (!snack || !isSnackId(snack))) throw new Error(`no snack "${snack}": try ${SNACK_IDS.join(', ')}`);
      fridgeAction(op, snack as SnackId | undefined);
    },
    enumerable: false,
    configurable: false,
  });
}
