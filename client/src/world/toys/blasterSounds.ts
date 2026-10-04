// What the blasters and darts should sound like: which surface a dart met, which impact sound that makes and how
// loud, when a tumbling dart or a dropped blaster lands, how a burst of shots varies, and when a reload's
// clicks fall. Pure, so it can be tested; the sounds themselves are in blasterSfx.ts.

/** Anything at least this tall (m) sounds like a wall when a dart hits it: walls, boards, glass partitions. */
export const TALL_SURFACE = 2.5;

/** 'person' is the sensor round someone seated: they say "boop" themselves (useHitReaction.tsx). */
export type DartSurface = 'wall' | 'furniture' | 'floor' | 'ball' | 'toy' | 'person';

export interface SurfaceProbe {
  /** The thing hit belongs to the building (a fixed body). */
  fixed: boolean;
  /** Its physics userData, e.g. { toy: 'beach-ball' } for a ball. */
  tag?: unknown;
  /** Half the height of the box collider that was hit, or null when it isn't a box. */
  halfHeight: number | null;
  /** The surface normal's y and the hit point's height (m). */
  normalY: number;
  y: number;
}

const toyTag = (tag: unknown) => (tag && typeof tag === 'object' ? (tag as { toy?: unknown }).toy : undefined);

/** Which surface a dart's look-ahead ray met. Anything moving that isn't a dart, blaster or the roomba is a ball. */
export function dartSurface(p: SurfaceProbe): DartSurface {
  if (!p.fixed) {
    if (p.tag && typeof p.tag === 'object' && 'seat' in p.tag) return 'person';
    const toy = toyTag(p.tag);
    return typeof toy === 'string' && toy !== 'dart' && toy !== 'roomba' && !toy.startsWith('blaster-') ? 'ball' : 'toy';
  }
  if (p.normalY > 0.7 && p.y < 0.05) return 'floor';
  return p.halfHeight !== null && p.halfHeight * 2 < TALL_SURFACE ? 'furniture' : 'wall';
}

/** thwock: the suction tip sticking to a wall or board; tock: sticking to furniture; tick: a glance; bonk: off a ball; patter: landing on the floor. */
export type DartSound = 'thwock' | 'tock' | 'tick' | 'bonk' | 'patter';

export interface DartImpact {
  sound: DartSound;
  /** 0.25 to 1, by how hard it hit. */
  gain: number;
}

/** Below this speed (m/s) an impact makes no sound. */
export const QUIET_SPEED = 0.6;

const loudness = (speed: number, full: number) => Math.min(1, Math.max(0.25, speed / full));

/**
 * The sound of a dart meeting `surface` at `speed` (m/s): sticking to it, glancing off it in flight, or a loose,
 * tumbling dart landing on it. Null when it's too gentle to hear.
 */
export function dartImpact(how: 'stick' | 'glance' | 'land', surface: DartSurface, speed: number): DartImpact | null {
  if (!(speed >= QUIET_SPEED) || surface === 'person') return null;
  if (how === 'stick') return { sound: surface === 'furniture' ? 'tock' : 'thwock', gain: loudness(speed, 15) };
  if (surface === 'floor') return { sound: 'patter', gain: loudness(speed, how === 'land' ? 4 : 10) };
  if (surface === 'ball') return { sound: 'bonk', gain: loudness(speed, 12) };
  return { sound: 'tick', gain: loudness(speed, how === 'land' ? 4 : 12) };
}

/**
 * Physics steps after a dart's look-ahead last met someone in which its own hits stay quiet: the chair's solid box
 * sits just inside the person's sensor, so a dart that reaches someone hits the chair next, and their boop is the sound.
 */
export const PERSON_HUSH_STEPS = 6;

/** The surface a dart's hit sounds like: someone it just reached, rather than the chair behind them, else `ahead`. */
export function heardSurface(ahead: DartSurface | null, stepsSincePerson: number, fallback: DartSurface): DartSurface {
  return stepsSincePerson <= PERSON_HUSH_STEPS ? 'person' : (ahead ?? fallback);
}

// ---------- landings ----------

/** Vertical speed (m/s) a falling body must lose in one physics step to count as landing on something. */
export const LANDING_JOLT = 0.8;

/**
 * Did a body falling at `prevVy` just land, given its vertical velocity is now `vy`? Returns the speed it landed
 * at, or null. Gravity only ever makes vy smaller, so a sudden jump upwards means it hit something underneath.
 */
export function landingSpeed(prevVy: number, vy: number): number | null {
  if (!(prevVy < -QUIET_SPEED) || vy - prevVy < LANDING_JOLT) return null;
  return -prevVy;
}

/** Landing sounds per tumbling dart, and per dropped blaster: the first bounces make noise, the jitter after doesn't. */
export const LANDING_SOUNDS = { dart: 3, blaster: 2 };

// ---------- in your hands ----------

/** A burst counts as rapid fire while shots come closer than this (ms). */
export const BURST_GAP_MS = 450;

export interface ThwipVoice {
  /** Multiplies the thwip's pitches. */
  pitch: number;
  /** Multiplies its loudness. */
  gain: number;
}

/**
 * One shot's thwip: `burst` is how many shots came right before it (0 for a single shot), `rand` is 0 to 1.
 * Each shot's pitch wanders a little, and a long burst gets slightly softer, so emptying a magazine sounds lively
 * rather than like one note buzzing.
 */
export function thwipVoice(burst: number, rand: number): ThwipVoice {
  const jitter = (Math.min(1, Math.max(0, rand)) - 0.5) * 0.14; // ±7%
  // Alternate up and down a touch within a burst, so neighbouring shots never land on the same pitch.
  const sway = burst > 0 ? (burst % 2 ? 0.03 : -0.03) : 0;
  return { pitch: 1 + jitter + sway, gain: Math.max(0.7, 1 - Math.max(0, burst) * 0.03) };
}

/** The next burst count: one more when this shot follows the last within BURST_GAP_MS, otherwise 0. */
export const nextBurst = (burst: number, sinceLastMs: number) => (sinceLastMs < BURST_GAP_MS ? burst + 1 : 0);

/** When a reload's sounds fall (seconds from pressing R): the magazine out, the new one in, and the slide clicking home. */
export function reloadCues(reloadMs: number): { magOut: number; magIn: number; ready: number } {
  const s = reloadMs / 1000;
  return { magOut: 0.04 * s, magIn: 0.62 * s, ready: Math.max(0.62 * s, s - 0.12) };
}
