// Decorations on an office floor (#210), the pure side: how big each item is, where it stands in its slot, its
// collider, and which slots a held item can go in. Decorations.tsx draws them; layout.ts says where the slots are.
import { catalogueItem, DECOR_SLOTS, type DecorItem, type DecorKind } from '../../../../shared/progress';
import { DECOR_SLOT_AT, type DecorSpot, type Rect } from '../layout';

/** An item's size in its own frame: w across its front, d front to back, h tall. */
export interface DecorSize {
  w: number;
  d: number;
  h: number;
}

const SIZES: Record<DecorItem, DecorSize> = {
  plant: { w: 0.6, d: 0.6, h: 1.05 },
  fig: { w: 0.85, d: 0.85, h: 2.1 },
  beanbag: { w: 0.9, d: 0.9, h: 0.62 },
  'poster-ship': { w: 1.0, d: 0.05, h: 1.3 },
  'poster-repo': { w: 1.0, d: 0.05, h: 1.3 },
  'poster-pr': { w: 1.0, d: 0.05, h: 1.3 },
  neon: { w: 2.1, d: 0.06, h: 0.62 },
  lights: { w: 2.4, d: 0.05, h: 0.45 },
  rug: { w: 0, d: 0, h: 0 }, // fills its slot (decorSize)
  fishtank: { w: 1.4, d: 0.55, h: 1.45 },
  pingpong: { w: 2.2, d: 1.2, h: 0.78 },
  arcade: { w: 0.8, d: 0.75, h: 1.85 },
};

/** What a toy or a person bumps into: the pots, not the leaves; everything else, all of it. */
const SOLID: Partial<Record<DecorItem, { w: number; d: number }>> = { plant: { w: 0.45, d: 0.45 }, fig: { w: 0.55, d: 0.55 } };

export const spotOf = (slot: string): DecorSpot | undefined => DECOR_SLOT_AT[slot];

/** Where a slot is, in words, for the decor box's list. */
export const SLOT_NAMES: Record<string, string> = {
  'w-west': 'west wall, south of the window',
  'w-south-w': 'south wall, over the blasters',
  'w-south-e': 'south wall, by the hoop',
  'w-north-e': 'north wall, past the "ship it" sign',
  'w-kitchen': 'over the kitchenette',
  'f-ne': 'north-east corner',
  'f-se': 'south-east corner',
  'f-sw': 'by the couch',
  'f-west': 'west wall, by the door',
  'b-west': 'west wall',
  'b-lounge': 'the lounge',
  'b-south': 'south wall, east of the elevator',
  'r-lounge': 'under the ping-pong table',
  'r-entry': 'in front of the elevator',
};

export function decorSize(item: DecorItem, slot?: string): DecorSize {
  if (item === 'rug') {
    const s = slot ? spotOf(slot) : undefined;
    return { w: (s?.w ?? 3) - 0.2, d: (s?.d ?? 2) - 0.2, h: 0.01 };
  }
  return SIZES[item];
}

/** Where an item in `slot` stands: the middle of its footprint on the floor (y: the middle of a wall item), facing rotY. */
export function placement(slot: string, item: DecorItem): { x: number; y: number; z: number; rotY: number } | null {
  const s = spotOf(slot);
  if (!s) return null;
  const size = decorSize(item, slot);
  const out = s.back ? size.d / 2 + 0.02 : 0;
  return { x: s.x + Math.sin(s.rotY) * out, y: s.y ?? 0, z: s.z + Math.cos(s.rotY) * out, rotY: s.rotY };
}

/** The axis-aligned footprint of a w x d box at (x, z), turned by rotY (a quarter turn swaps its sides). */
export function footprint(x: number, z: number, w: number, d: number, rotY: number, h?: number): Rect {
  const c = Math.abs(Math.cos(rotY));
  const s = Math.abs(Math.sin(rotY));
  const hx = (w * c + d * s) / 2;
  const hz = (w * s + d * c) / 2;
  return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, h };
}

const kindOf = (slot: string): DecorKind | undefined => DECOR_SLOTS.find((d) => d.id === slot)?.kind;
const standsOnFloor = (kind: DecorKind | undefined) => kind === 'floor' || kind === 'big';

/** The collider of `item` in `slot`; null for what you walk over or past (rugs, wall decorations). */
export function decorRect(slot: string, item: DecorItem): Rect | null {
  if (!standsOnFloor(kindOf(slot))) return null;
  const p = placement(slot, item);
  if (!p) return null;
  const size = decorSize(item, slot);
  const solid = SOLID[item] ?? size;
  return footprint(p.x, p.z, solid.w, solid.d, p.rotY, size.h);
}

/** The colliders of everything placed on a floor. */
export function decorRects(placed: Record<string, DecorItem>): Rect[] {
  return Object.entries(placed)
    .map(([slot, item]) => decorRect(slot, item))
    .filter((r): r is Rect => !!r);
}

/**
 * Every floor and big slot's whole room, placed or not. People and the roomba plan their walks round these, so a
 * decoration put down later never lands on a path someone is walking (walkways.ts builds its grid once).
 */
export function reservedDecorRects(): Rect[] {
  return DECOR_SLOTS.filter((d) => standsOnFloor(d.kind)).map((d) => {
    const s = DECOR_SLOT_AT[d.id];
    const out = s.back ? s.d / 2 : 0;
    return footprint(s.x + Math.sin(s.rotY) * out, s.z + Math.cos(s.rotY) * out, s.w, s.d, s.rotY, 2.2);
  });
}

/** The slots `item` could go in now: its kind's empty ones, plus the one it came from. */
export function openSlots(item: DecorItem, placed: Record<string, DecorItem>, from: string | null): string[] {
  const kind = catalogueItem(item)?.kind;
  return DECOR_SLOTS.filter((d) => d.kind === kind && (!placed[d.id] || d.id === from)).map((d) => d.id);
}
