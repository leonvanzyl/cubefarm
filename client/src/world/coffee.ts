// The kitchenette's coffee machine as pure state: empty → mugPlaced → brewing → ready, and back to empty when the
// mug is taken. Time is passed in (performance.now() ms), so it's tested without a clock. CoffeeMachine.tsx draws it.

/** A full mug holds this many sips (the same as mugs.ts's MUG.maxSips). */
export const FULL_SIPS = 3;

/** How long a brew takes, and the share of it spent grinding before the coffee starts to pour. */
export const BREW = { ms: 4500, grind: 0.22, pourEnd: 0.92 };

/** A mug in the machine: its id and the sips it had when it went in. */
export interface MachineMug {
  id: string;
  sips: number;
}

export type BrewState =
  | { kind: 'empty' }
  | { kind: 'mugPlaced'; mug: MachineMug }
  /** `start` is when the button was pressed (ms); the coffee rises from `mug.sips` to full. */
  | { kind: 'brewing'; mug: MachineMug; start: number }
  | { kind: 'ready'; mug: MachineMug };

export const EMPTY: BrewState = { kind: 'empty' };

/** Whether this mug can go under the spout: the slot must be empty and the mug not already full. */
export const canPlace = (s: BrewState, sips: number) => s.kind === 'empty' && sips < FULL_SIPS;

/** Put a mug under the spout. Unchanged when the slot is taken or the mug is full. */
export function placeMug(s: BrewState, mug: MachineMug): BrewState {
  if (!canPlace(s, mug.sips)) return s;
  return { kind: 'mugPlaced', mug: { id: mug.id, sips: Math.max(0, mug.sips) } };
}

/** What pressing the button did: started a brew, or nothing (no mug, already brewing, or the mug is full). */
export type PressResult = 'started' | 'noMug' | 'busy' | 'full';

export function pressButton(s: BrewState, now: number): { state: BrewState; result: PressResult } {
  if (s.kind === 'empty') return { state: s, result: 'noMug' };
  if (s.kind === 'brewing') return { state: s, result: 'busy' };
  if (s.kind === 'ready') return { state: s, result: 'full' };
  return { state: { kind: 'brewing', mug: s.mug, start: now }, result: 'started' };
}

/** How far through the brew, 0 to 1 (1 once ready, 0 when not brewing). */
export function progress(s: BrewState, now: number) {
  if (s.kind === 'ready') return 1;
  if (s.kind !== 'brewing') return 0;
  return Math.min(1, Math.max(0, (now - s.start) / BREW.ms));
}

/** How far the pour has got, 0 (still grinding) to 1 (the stream has stopped). */
export const pourProgress = (p: number) => Math.min(1, Math.max(0, (p - BREW.grind) / (BREW.pourEnd - BREW.grind)));

/** Whether coffee is running from the spout at this point in the brew. */
export const pouring = (p: number) => p > BREW.grind && p < BREW.pourEnd;

/** Coffee in the placed mug right now, in (fractional) sips; 0 with no mug. */
export function level(s: BrewState, now: number) {
  if (s.kind === 'empty') return 0;
  if (s.kind === 'ready') return FULL_SIPS;
  if (s.kind === 'mugPlaced') return s.mug.sips;
  return s.mug.sips + (FULL_SIPS - s.mug.sips) * pourProgress(progress(s, now));
}

/** Moves a brew on to ready once its time is up; anything else is unchanged. */
export function tick(s: BrewState, now: number): BrewState {
  return s.kind === 'brewing' && now - s.start >= BREW.ms ? { kind: 'ready', mug: s.mug } : s;
}

/**
 * Take the mug out (done, mid-brew or never brewed): it keeps the level it reached, to the nearest whole sip, and the
 * slot is empty again. Null with no mug.
 */
export function takeMug(s: BrewState, now: number): { state: BrewState; mug: MachineMug } | null {
  if (s.kind === 'empty') return null;
  const sips = Math.min(FULL_SIPS, Math.max(0, Math.round(level(tick(s, now), now))));
  return { state: EMPTY, mug: { id: s.mug.id, sips } };
}

/** The brew's sounds, by when they start (share of the brew). CoffeeMachine plays each one as the brew passes it. */
export const BREW_CUES: readonly { at: number; name: 'grind' | 'hiss' | 'gurgle' }[] = [
  { at: 0, name: 'grind' },
  { at: BREW.grind, name: 'hiss' },
  { at: 0.4, name: 'gurgle' },
  { at: 0.58, name: 'gurgle' },
  { at: 0.76, name: 'gurgle' },
];

/** The next cue index after progress `p`, starting from `from`: cues before `p` are passed. */
export function cuesPassed(from: number, p: number) {
  let i = from;
  while (i < BREW_CUES.length && BREW_CUES[i].at <= p) i++;
  return i;
}
