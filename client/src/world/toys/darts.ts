// Foam blasters and darts: the rules, kept pure so they can be tested, plus a small registry of the darts in the
// current physics world. The registry lives here (not in the lazily loaded toy chunk) so anything can ask which
// darts are lying on the floor, or tidy one away, without pulling in the physics engine.

export interface BlasterDef {
  id: string;
  body: string;
  trim: string;
  /** Colour of the darts it fires. */
  foam: string;
}

/** The two blasters on every floor's rack, top slot first. */
export const BLASTERS: BlasterDef[] = [
  { id: 'blaster-orange', body: '#ff8c1a', trim: '#3a86ff', foam: '#3a86ff' },
  { id: 'blaster-blue', body: '#3a86ff', trim: '#ff8c1a', foam: '#ff8c1a' },
];

export const isBlasterId = (id: string) => BLASTERS.some((b) => b.id === id);

/** Magazine size, the shortest gap between shots (ms, so at most 4 a second) and how long a reload takes (ms). */
export const BLASTER = { mag: 12, gapMs: 250, reloadMs: 1000 };

/** Most darts one floor keeps; firing another removes the oldest. */
export const DART_CAP = 40;

// ---------- magazine ----------

export interface Mag {
  ammo: number;
  /** performance.now() when a reload started; null when not reloading. */
  reloadAt: number | null;
}

/** The magazine as it stands at `now`: a reload that has run its course is finished and full. */
export function settle(m: Mag, now: number): Mag {
  if (m.reloadAt === null || now - m.reloadAt < BLASTER.reloadMs) return m;
  return { ammo: BLASTER.mag, reloadAt: null };
}

export const isReloading = (m: Mag, now: number) => settle(m, now).reloadAt !== null;

/** 0 to 1 through a reload, or null when not reloading. */
export function reloadProgress(m: Mag, now: number): number | null {
  const s = settle(m, now);
  return s.reloadAt === null ? null : Math.min(1, Math.max(0, (now - s.reloadAt) / BLASTER.reloadMs));
}

/** Fire one dart: the magazine afterwards, or null when you can't (empty, reloading, or too soon after the last shot). */
export function fire(m: Mag, lastShot: number, now: number): Mag | null {
  const s = settle(m, now);
  if (s.reloadAt !== null || s.ammo <= 0 || now - lastShot < BLASTER.gapMs) return null;
  return { ammo: s.ammo - 1, reloadAt: null };
}

/** Start a reload: the magazine afterwards, or null when it is already full or reloading. */
export function reload(m: Mag, now: number): Mag | null {
  const s = settle(m, now);
  if (s.reloadAt !== null || s.ammo >= BLASTER.mag) return null;
  return { ammo: s.ammo, reloadAt: now };
}

/** The HUD's ammo text, e.g. "Darts 9/12". */
export function ammoLabel(m: Mag, now: number) {
  return `Darts ${settle(m, now).ammo}/${BLASTER.mag}`;
}

// ---------- hits ----------

interface Vec {
  x: number;
  y: number;
  z: number;
}

/** A hit counts as square-on within this angle of the surface normal, and only from a dart still going this fast (m/s). */
export const STICK = { maxAngle: (28 * Math.PI) / 180, minSpeed: 6 };

/**
 * Does a dart flying at velocity `v` stick to a flat surface with outward normal `n` (unit length)?
 * Only a fast, square-on hit presses the suction tip flat; anything glancing bounces off.
 */
export function sticks(v: Vec, n: Vec): boolean {
  const speed = Math.hypot(v.x, v.y, v.z);
  if (speed < STICK.minSpeed) return false;
  const into = -(v.x * n.x + v.y * n.y + v.z * n.z) / speed; // cosine between the flight and the inward normal
  return into >= Math.cos(STICK.maxAngle);
}

/** The oldest darts to remove so that adding `adding` more keeps the floor at `cap` or fewer. */
export function toEvict<T extends { born: number }>(darts: readonly T[], cap = DART_CAP, adding = 1): T[] {
  const over = darts.length + adding - cap;
  if (over <= 0) return [];
  return [...darts].sort((a, b) => a.born - b.born).slice(0, over);
}

// ---------- registry ----------

/** A dart lying loose (on the floor, or wherever it came to rest), not stuck to anything. */
export interface LooseDart {
  id: number;
  x: number;
  y: number;
  z: number;
  /** Its foam colour, e.g. '#3a86ff', and its orientation, so something tidying it up can draw it. */
  color: string;
  q: { x: number; y: number; z: number; w: number };
}

/** Below this height (m) a loose dart counts as lying on the floor. */
export const FLOOR_Y = 0.2;

interface DartSource {
  count(): number;
  stuck(): number;
  loose(): LooseDart[];
  remove(id: number): boolean;
}

let source: DartSource | null = null;

/** The mounted toy world registers its darts here; null when there is none (loading, failed, or between floors). */
export function setDartSource(s: DartSource | null) {
  source = s;
}

/** How many darts the current floor has (flying, loose and stuck). */
export const dartCount = () => source?.count() ?? 0;

/** How many darts are stuck to a wall, desk, board or screen. */
export const stuckDartCount = () => source?.stuck() ?? 0;

/** Darts lying on the current floor, e.g. for something that tidies them up. */
export const floorDarts = (): LooseDart[] => (source?.loose() ?? []).filter((d) => d.y < FLOOR_Y);

/** Take a dart out of the world (flying, loose or stuck). False when there is no such dart. */
export const removeDart = (id: number) => source?.remove(id) ?? false;
