import { useStore, type Held } from '../../store';
import { toEvict } from './darts';

// Coffee mugs: the rules (kept pure so they can be tested), taking and dropping a mug, and a small registry of the
// mugs lying loose in the current physics world. Lives outside the lazily loaded toy chunk, so the kitchenette's
// dispenser (Props.tsx) and Player can use it without pulling in the physics engine.

export type HeldMug = Extract<Held, { kind: 'mug' }>;

/** A full mug holds this many sips; a floor keeps at most `cap` loose mugs, dropping another removes the oldest. */
export const MUG = { maxSips: 3, cap: 8 };

/** The kitchenette's mug dispenser, as a pickup target. */
export const DISPENSER_ID = 'mug-dispenser';

export const isMugId = (id: string) => id === DISPENSER_ID || id.startsWith('mug-');

/** Sips as a whole number from 0 (empty) to MUG.maxSips (full); anything else (NaN, a string) counts as empty. */
export function clampSips(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return Math.min(MUG.maxSips, Math.max(0, Math.round(n)));
}

/** How high the coffee stands in a mug, from 0 (empty) to 1 (full). */
export const fillLevel = (sips: number) => clampSips(sips) / MUG.maxSips;

/** The oldest loose mugs to remove so that dropping `adding` more keeps the floor at `cap` or fewer. */
export const mugsToEvict = <T extends { born: number }>(mugs: readonly T[], cap = MUG.cap, adding = 1): T[] => toEvict(mugs, cap, adding);

// ---------- hands ----------

let seq = 1;

/** Put a fresh mug in your hands, with `sips` of coffee in it (0, an empty one from the dispenser, by default). */
export function takeNewMug(sips = 0): HeldMug {
  const mug: HeldMug = { kind: 'mug', id: `mug-${seq++}`, sips: clampSips(sips) };
  useStore.getState().setHeld(mug);
  return mug;
}

/** Pick a loose mug up off the floor, with whatever coffee it still has. False when there is no such mug. */
export function pickUpMug(id: string): boolean {
  const sips = source?.take(id);
  if (sips === undefined || sips === null) return false;
  useStore.getState().setHeld({ kind: 'mug', id, sips: clampSips(sips) });
  return true;
}

/** The aim target's E: a fresh mug from the dispenser, or a loose one back into your hands. */
export function takeMug(id: string) {
  if (id === DISPENSER_ID) takeNewMug();
  else pickUpMug(id);
}

/**
 * Let go of the mug in your hands, if you hold one. Every way a mug leaves your hands (this, G, a panel opening,
 * picking something else up) ends up as a drop, so the toy world puts it on the floor in front of you.
 */
export function dropMug() {
  const s = useStore.getState();
  if (s.held?.kind === 'mug') s.setHeld(null);
}

/** Hand the held mug over (to the coffee machine): it leaves your hands without falling. Returns it, or null. */
export function stowMug(): HeldMug | null {
  const s = useStore.getState();
  if (s.held?.kind !== 'mug') return null;
  const mug = s.held;
  stowing = true;
  try {
    s.setHeld(null);
  } finally {
    stowing = false;
  }
  return mug;
}

// Mugs that left your hands since the toy world's last physics step.
let drops: { id: string; sips: number }[] = [];
let stowing = false;

useStore.subscribe((s, prev) => {
  const was = prev.held;
  if (stowing || was?.kind !== 'mug' || (s.held?.kind === 'mug' && s.held.id === was.id)) return;
  drops.push({ id: was.id, sips: was.sips });
});

/** For the toy world: the next mug to drop in front of the player, or null. */
export function takeDrop(): { id: string; sips: number } | null {
  return drops.shift() ?? null;
}

/** A fresh floor: no mugs waiting to fall (one you held on the old floor stays behind). */
export function resetMugs() {
  drops = [];
}

// ---------- registry ----------

/** A mug lying loose (on the floor, or wherever it came to rest). */
export interface LooseMug {
  id: string;
  x: number;
  y: number;
  z: number;
  sips: number;
  sleeping: boolean;
}

interface MugSource {
  loose(): LooseMug[];
  /** Take a loose mug out of the world: its sips, or null when there is no such mug. */
  take(id: string): number | null;
}

let source: MugSource | null = null;

/** The mounted toy world registers its mugs here; null when there is none (loading, failed, or between floors). */
export function setMugSource(s: MugSource | null) {
  source = s;
}

/** Loose mugs on the current floor. */
export const looseMugs = (): LooseMug[] => source?.loose() ?? [];
