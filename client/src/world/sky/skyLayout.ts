// Where the sky's clouds and stars are. Pure and seeded (the same sky every visit), so the drift and the
// wrap-around are tested without a browser. Positions are relative to the viewer: the sky moves with the camera.

/** How far out (horizontally) a cloud can be before it has shrunk away. Inside the camera's far plane (90). */
export const CLOUD_REACH = 66;
/** Clouds drift along +z and wrap from +CLOUD_WRAP back to −CLOUD_WRAP, out of sight (beyond CLOUD_REACH). */
export const CLOUD_WRAP = 70;
export const CLOUD_COUNT = 16;
export const MAX_PUFFS = 6;

/** One sphere of a cloud, relative to the cloud's centre, in units of the cloud's size. Clouds are long along
 * the wind (z), so the side windows, which look along x, see them broadside. */
export interface Puff {
  dx: number;
  dy: number;
  dz: number;
  r: number;
}

export interface Cloud {
  /** The cloud's lane across the wind (x) and its height above the eye (y), in metres. */
  x: number;
  y: number;
  /** Where along the wind (z) it is at drift 0. */
  z0: number;
  /** Metres per second of drift. */
  speed: number;
  /** Metres per puff unit. */
  size: number;
  puffs: Puff[];
}

/** mulberry32: a tiny seeded random in [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The sky's clouds: mostly low and far (what the windows see), a few overhead (what the balcony sees). */
export function makeClouds(seed = 7, count = CLOUD_COUNT): Cloud[] {
  const rnd = seeded(seed);
  const out: Cloud[] = [];
  for (let i = 0; i < count; i++) {
    const overhead = i % 5 === 0;
    const side = i % 2 === 0 ? 1 : -1;
    const lane = overhead ? 6 + rnd() * 18 : 34 + rnd() * 22;
    const n = 4 + Math.floor(rnd() * (MAX_PUFFS - 3));
    const puffs: Puff[] = [];
    for (let k = 0; k < n; k++) {
      const u = n === 1 ? 0 : k / (n - 1) - 0.5; // −0.5 .. 0.5 along the cloud
      const r = 1.25 - Math.abs(u) * 0.9 + rnd() * 0.25; // biggest in the middle
      puffs.push({ dx: (rnd() - 0.5) * 0.5, dy: r * 0.6 - 0.45, dz: u * n * 0.95, r });
    }
    out.push({
      x: side * lane,
      y: overhead ? 26 + rnd() * 10 : 8 + rnd() * 14,
      z0: (i / count) * 2 * CLOUD_WRAP - CLOUD_WRAP + rnd() * 6,
      speed: 0.7 + rnd() * 0.7,
      size: 1.7 + rnd() * 1.1,
      puffs,
    });
  }
  return out;
}

/** The cloud's position along the wind after `drift` seconds of drifting, wrapped into [−CLOUD_WRAP, CLOUD_WRAP). */
export function cloudZ(cloud: Cloud, drift: number): number {
  const span = 2 * CLOUD_WRAP;
  const z = cloud.z0 + cloud.speed * drift + CLOUD_WRAP;
  return z - Math.floor(z / span) * span - CLOUD_WRAP;
}

/** 1 for clouds well inside the sky, shrinking to 0 at CLOUD_REACH, so the wrap happens out of sight. */
export function cloudScale(x: number, z: number): number {
  const d = Math.hypot(x, z);
  const k = Math.min(1, Math.max(0, (CLOUD_REACH - d) / 14));
  return k * k * (3 - 2 * k);
}

/** Star directions (unit vectors, xyz per star) with a size in pixels and a twinkle phase per star. */
export function starField(count: number, seed = 11): { positions: Float32Array; sizes: Float32Array; phases: Float32Array } {
  const rnd = seeded(seed);
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // uniform on the sphere: the stars wheel round with the sun, so they fill the whole sky
    const y = rnd() * 2 - 1;
    const a = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - y * y);
    positions.set([Math.cos(a) * s, y, Math.sin(a) * s], i * 3);
    const bright = rnd();
    sizes[i] = bright > 0.94 ? 4.5 : bright > 0.7 ? 3 : 2;
    phases[i] = rnd();
  }
  return { positions, sizes, phases };
}
