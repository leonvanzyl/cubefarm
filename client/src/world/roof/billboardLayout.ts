// The billboards on the city's rooftops round the office (Billboards.tsx), with the office's own numbers on them: too
// small to read with the naked eye from the roof, readable through the telescope by day. Pure: where they stand (the
// nearest blocks, one each way, in clear sight of the roof) and what they say. Units are cityLayout.ts's.

import type { CityBox, CityLayout } from '../outside/cityLayout';

/** A board's face (w × h) on legs above its building's roof. */
export const BOARD = { w: 12, h: 5.2, legs: 3 };
/** How far out to look for buildings to put boards on, from the office's middle. */
export const BOARD_RANGE = { min: 42, max: 140 };

export interface BillboardSpot {
  /** The middle of the face, from street level. */
  x: number;
  y: number;
  z: number;
  /** Turned (about y) to face the office. */
  yaw: number;
  /** Its building's roof. */
  top: number;
  dist: number;
}

type P = { x: number; y: number; z: number };

/** Whether the segment a → b passes through the box of `c` (a building, or a water tower's tank taken as a box): a slab test. */
export function blocks(c: CityBox, a: P, b: P): boolean {
  let t0 = 0;
  let t1 = 1;
  const axes: [number, number, number, number][] = [
    [a.x, b.x - a.x, c.x - c.w / 2, c.x + c.w / 2],
    [a.y, b.y - a.y, c.y, c.y + c.h],
    [a.z, b.z - a.z, c.z - c.d / 2, c.z + c.d / 2],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return false;
      continue;
    }
    let ta = (lo - o) / d;
    let tb = (hi - o) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Up to `count` boards, one per direction round the office (north, east, south, west, then whatever's left), each on
 * the bare roof of the nearest building in range whose board the eye (the telescope, in the city's frame) can see whole.
 */
export function billboardSpots(layout: CityLayout, eye: P, count = 4): BillboardSpot[] {
  // A building's roof is the top of its highest tier.
  const tops = new Map<string, number>();
  for (const b of layout.buildings) tops.set(`${b.x},${b.z}`, Math.max(tops.get(`${b.x},${b.z}`) ?? 0, b.y + b.h));
  const bits = [...layout.boxes, ...layout.cylinders, ...layout.cones];
  const solids: CityBox[] = [...layout.buildings, ...bits];
  const candidates: (BillboardSpot & { sector: number })[] = [];
  for (const b of layout.buildings) {
    if (b.y !== 0 || Math.min(b.w, b.d) < 8) continue;
    const dist = Math.hypot(b.x, b.z);
    if (dist < BOARD_RANGE.min || dist > BOARD_RANGE.max) continue;
    const top = tops.get(`${b.x},${b.z}`)!;
    // not on a roof with a water tower, a hut or an aerial already up there
    if (bits.some((k) => k.y >= top - 0.5 && Math.abs(k.x - b.x) < b.w / 2 && Math.abs(k.z - b.z) < b.d / 2)) continue;
    const spot = { x: b.x, y: top + BOARD.legs + BOARD.h / 2, z: b.z, yaw: Math.atan2(-b.x, -b.z), top, dist };
    // the face's middle and all four corners in sight (not quite to the face, so its own legs don't count)
    const side = { x: Math.cos(spot.yaw) * (BOARD.w / 2), z: -Math.sin(spot.yaw) * (BOARD.w / 2) };
    const ends = [spot, ...[1, -1].flatMap((s) => [1, -1].map((u) => ({ x: spot.x + s * side.x, y: spot.y + (u * BOARD.h) / 2, z: spot.z + s * side.z })))];
    const seen = ends.every((e) => {
      const to = { x: eye.x + (e.x - eye.x) * 0.97, y: eye.y + (e.y - eye.y) * 0.97, z: eye.z + (e.z - eye.z) * 0.97 };
      return !solids.some((c) => blocks(c, eye, to));
    });
    if (!seen) continue;
    // 0 north (−z), 1 east, 2 south, 3 west
    const sector = Math.round(Math.atan2(b.x, -b.z) / (Math.PI / 2)) & 3;
    candidates.push({ ...spot, sector });
  }
  candidates.sort((a, b) => a.dist - b.dist);
  const out: BillboardSpot[] = [];
  for (let s = 0; s < 4 && out.length < count; s++) {
    const c = candidates.find((k) => k.sector === s);
    if (c) out.push(c);
  }
  for (const c of candidates) {
    if (out.length >= count) break;
    if (!out.includes(c) && out.every((o) => Math.hypot(o.x - c.x, o.z - c.z) > 40)) out.push(c);
  }
  return out.map(({ x, y, z, yaw, top, dist }) => ({ x, y, z, yaw, top, dist }));
}

// ---------- what they say ----------

/** The office's numbers, for the boards. */
export interface OfficeNumbers {
  company: string;
  floors: number;
  agents: number;
  working: number;
  issues: number;
  openPrs: number;
  inQa: number;
  merged: number;
}

export interface BoardText {
  /** A small line on top, the big number or word, and a line under it. */
  top: string;
  big: string;
  under: string;
  /** Background and text colours. */
  bg: string;
  fg: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Four boards' worth: the team at work, merges, the backlog, and the company's own ad. */
export function boardTexts(n: OfficeNumbers): BoardText[] {
  return [
    { top: 'AGENTS AT WORK RIGHT NOW', big: `${n.working} / ${n.agents}`, under: `on ${plural(n.floors, 'floor')}`, bg: '#ffd166', fg: '#2b2d42' },
    { top: 'PULL REQUESTS MERGED', big: String(n.merged), under: `${n.openPrs} open · ${n.inQa} in QA`, bg: '#06d6a0', fg: '#073b4c' },
    { top: 'OPEN ISSUES', big: String(n.issues), under: n.issues ? 'the backlog awaits' : 'inbox zero!', bg: '#ef476f', fg: '#ffffff' },
    { top: (n.company || 'cubefarm').toUpperCase(), big: 'SHIP IT', under: 'small PRs, happy reviewers', bg: '#3a86ff', fg: '#ffffff' },
  ];
}
