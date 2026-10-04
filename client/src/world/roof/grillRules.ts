// The roof's barbecue, as pure rules: E puts a sausage on the grill, it sizzles and browns for a few seconds (E turns it
// over meanwhile), then it's ready to take in a bun; left on too long it chars, and it's still edible. Grill.tsx draws and
// plays it. Times are seconds on any clock.

export type GrillState = 'idle' | 'cooking' | 'ready' | 'charred';

/** Cooked `cook` seconds after it goes on; charred `char` seconds after that. A sausage in a bun is three bites. */
export const GRILL_TIMES = { cook: 7, char: 30 };
export const BITES = 3;

export interface Grill {
  /** When the sausage went on; null while the grill is empty. */
  since: number | null;
  /** How many times it's been turned over (which side faces up). */
  turns: number;
}

export const emptyGrill = (): Grill => ({ since: null, turns: 0 });

export function grillState(g: Grill, now: number): GrillState {
  if (g.since === null) return 'idle';
  const t = now - g.since;
  return t < GRILL_TIMES.cook ? 'cooking' : t < GRILL_TIMES.cook + GRILL_TIMES.char ? 'ready' : 'charred';
}

/** How done it is: 0 raw, 1 cooked, 2 charred, easing between (for its colour). 0 with nothing on. */
export function doneness(g: Grill, now: number): number {
  if (g.since === null) return 0;
  const t = Math.max(0, now - g.since);
  if (t < GRILL_TIMES.cook) return t / GRILL_TIMES.cook;
  return 1 + Math.min(1, (t - GRILL_TIMES.cook) / GRILL_TIMES.char);
}

/** How hard it sizzles, 0-1: loudest while it cooks, a quieter spit once it's done, nothing on an empty grill. */
export function sizzle(g: Grill, now: number): number {
  const s = grillState(g, now);
  return s === 'cooking' ? 1 : s === 'idle' ? 0 : 0.35;
}

export type GrillOp = 'start' | 'turn' | 'take' | 'full';

/**
 * E at the grill: put a sausage on an empty grill, turn a cooking one over, or take a done one (cooked or charred).
 * `handsFull`: holding something already, so there's no taking (or starting) one.
 */
export function pressGrill(g: Grill, now: number, handsFull: boolean): { op: GrillOp; grill: Grill } {
  const s = grillState(g, now);
  if (s === 'cooking') return { op: 'turn', grill: { ...g, turns: g.turns + 1 } };
  if (handsFull) return { op: 'full', grill: g };
  if (s === 'idle') return { op: 'start', grill: { since: now, turns: 0 } };
  return { op: 'take', grill: emptyGrill() };
}

/** What E at the grill says. */
export function grillLabel(s: GrillState): string {
  if (s === 'idle') return 'Grill a sausage';
  if (s === 'cooking') return 'Turn the sausage';
  return s === 'charred' ? 'Take the (charred) sausage' : 'Take the sausage';
}
