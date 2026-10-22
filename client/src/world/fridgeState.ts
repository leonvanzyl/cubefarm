// The current floor's fridge (fridge.ts has its rules): the door, the stock, who stands at it, the player's E on it
// and the agents' hands in it (fridgeErrand.ts). KitchenFridge.tsx draws it and runs its clock. One fridge is drawn at a
// time (the floor you're on); each floor keeps its own stock for the session, while the door starts shut on every visit.
// window.__swarmFridge and __swarmFridgeDo are its probes for QA.

import { useStore } from '../store';
import { fridgeBeep, fridgeClose, fridgeOpen, tone, type Vec3 } from '../ui/sfx';
import { playerAt } from './camera/rig';
import { DOOR, SNACKS, closeDoor, doorTick, isSnackId, lunchLabel, newDoor, newPantry, openDoor, restock, takeSnack, type Pantry, type SnackId, type Stock } from './fridge';
import { snackHolders } from './people';

const pantries = new Map<number, Pantry>();
let pantry: Pantry | null = null;
const door = newDoor();
/** The agent at the door (one at a time), and the name on the tupperware. */
let atDoor: string | null = null;
let lunch = lunchLabel([], 0);
let seq = 1;
/** Where its door is (the middle of its front, at hand height), for its sounds and who is near; set once it's drawn. */
export const fridgeAt: Vec3 & { on: boolean } = { x: 0, y: 1.1, z: 0, on: false };

// ---------- redraws ----------

const listeners = new Set<() => void>();
let version = 0;
let queued = false;

/** KitchenFridge.tsx redraws when the door or the stock changes (rarely), once for a burst of changes. */
export function subscribeFridge(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export const fridgeVersion = () => version;

function changed() {
  version++;
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    for (const fn of listeners) fn();
  });
}

// ---------- the floor ----------

/** KitchenFridge.tsx is drawn on `floor`, its front at (x, z): that floor's stock comes out, and the door starts shut. */
export function mountFridge(floor: number, x: number, z: number) {
  const now = performance.now();
  let p = pantries.get(floor);
  if (!p) pantries.set(floor, (p = newPantry(floor, now)));
  restock(p, now); // what came back while you were away
  pantry = p;
  closeDoor(door);
  atDoor = null;
  Object.assign(fridgeAt, { x, z, on: true });
  changed();
  return () => {
    if (pantry === p) pantry = null;
    closeDoor(door);
    atDoor = null;
    fridgeAt.on = false;
    changed();
  };
}

/** The tupperware's label, from who's on the floor. */
export function setLunchLabel(names: readonly string[], floor: number) {
  lunch = lunchLabel(names, floor);
}

export const lunchText = () => lunch;
export const doorOpen = () => door.open;
export const stockOf = (id: SnackId) => pantry?.stock[id] ?? 0;

/** The player is standing at the fridge. */
export const playerAtFridge = () => fridgeAt.on && Math.hypot(playerAt.x - fridgeAt.x, playerAt.z - fridgeAt.z) < DOOR.reach;

function open(): boolean {
  if (!fridgeAt.on || !openDoor(door, performance.now() / 1000)) return false;
  fridgeOpen(fridgeAt);
  changed();
  return true;
}

function close(): boolean {
  if (!closeDoor(door)) return false;
  fridgeClose(fridgeAt);
  changed();
  return true;
}

function take(id: SnackId): boolean {
  if (!pantry || !door.open) return false;
  restock(pantry, performance.now());
  if (!takeSnack(pantry, id)) return false;
  changed();
  return true;
}

/**
 * The fridge's clock (KitchenFridge.tsx calls it a few times a second): the door closes by itself once everyone has walked
 * away and beeps when it's left open, and the stock comes back. `quiet`: the tab is hidden or the floor is out of view,
 * so no beeps.
 */
export function tickFridge(quiet: boolean) {
  const now = performance.now();
  if (pantry && restock(pantry, now) > 0) changed();
  const ev = doorTick(door, now / 1000, playerAtFridge() || atDoor !== null);
  if (ev === 'close') {
    fridgeClose(fridgeAt);
    changed();
  } else if (ev === 'beep' && !quiet) fridgeBeep(fridgeAt);
}

// ---------- the player (Player.tsx's E) ----------

/** E on the fridge: open or shut the door, grab a snack (hands free, door open), or read the label on someone's lunch. */
export function fridgeAction(op: 'door' | 'take' | 'lunch', snack?: SnackId) {
  const s = useStore.getState();
  if (op === 'door') {
    if (!close()) open();
    return;
  }
  if (op === 'lunch') {
    s.pushToast('info', `🥡 “${lunch}”. Best leave it.`);
    return;
  }
  if (!snack || !isSnackId(snack)) return;
  const def = SNACKS[snack];
  if (s.held) {
    s.pushToast('info', s.held.kind === 'snack' ? `${SNACKS[s.held.snack].emoji} One at a time: finish that one first (E)` : '🙌 Your hands are full');
    return;
  }
  if (!take(snack)) {
    if (door.open) {
      tone({ name: 'fridge:none', group: 'toys', pos: fridgeAt, freq: 240, to: 180, type: 'triangle', dur: 0.12, peak: 0.03 });
      s.pushToast('info', `${def.emoji} Out of ${def.short}: more comes in every few minutes`);
    }
    return;
  }
  s.setHeld({ kind: 'snack', id: `snack-${seq++}`, snack, left: def.portions });
}

// ---------- the agents (fridgeErrand.ts) ----------

/** The fridge as an agent on a snack break uses it: one at the door at a time, never while the player is at it. */
export const fridge = {
  playerBusy: playerAtFridge,
  /** Takes the door (true), or someone else has it. */
  claim(who: string): boolean {
    if (atDoor !== null && atDoor !== who) return false;
    atDoor = who;
    return true;
  },
  release(who: string) {
    if (atDoor === who) atDoor = null;
  },
  isOpen: doorOpen,
  open,
  close,
  stock: (): Readonly<Stock> | null => pantry?.stock ?? null,
  take,
};

// ---------- probes ----------

/** window.__swarmFridge: the current floor's fridge, for QA and Playwright. */
export interface FridgeSnapshot {
  /** Drawn on this floor; the door open; who's at it ('player', an agent's id, or null). */
  here: boolean;
  open: boolean;
  atDoor: string | null;
  stock: Partial<Stock>;
  /** The snack in your hands and what's left of it. */
  held: { snack: SnackId; left: number } | null;
  /** Agents with a snack in hand (eating it, or taking it back to their desk). */
  eating: string[];
  lunch: string;
}

if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmFridge')) {
  Object.defineProperty(window, '__swarmFridge', {
    get: (): FridgeSnapshot => {
      const h = useStore.getState().held;
      return {
        here: fridgeAt.on,
        open: door.open,
        atDoor: playerAtFridge() ? 'player' : atDoor,
        stock: { ...(pantry?.stock ?? {}) },
        held: h?.kind === 'snack' ? { snack: h.snack, left: h.left } : null,
        eating: snackHolders(),
        lunch,
      };
    },
    enumerable: false,
    configurable: false,
  });
  // __swarmFridgeDo('open' | 'close' | 'take', snack?): act on the fridge without aiming (pointer lock doesn't work
  // headless). 'take' opens the door first if it's shut. Returns whether it happened.
  Object.defineProperty(window, '__swarmFridgeDo', {
    value: (op: 'open' | 'close' | 'take', snack?: SnackId): boolean => {
      if (op === 'open') return open() || door.open;
      if (op === 'close') return close() || !door.open;
      if (op !== 'take' || !isSnackId(snack)) return false;
      open();
      const before = useStore.getState().held;
      fridgeAction('take', snack);
      const after = useStore.getState().held;
      return after !== before && after?.kind === 'snack';
    },
    enumerable: false,
    configurable: false,
  });
}
