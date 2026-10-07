// Where a desk's story sits on it (#226), in the desk's own frame (Desk.tsx: the top at y 0.77, the monitor at z -0.3,
// its occupant on the +z side): a plank of PR plaques on top of the monitor, the gold star at its end, and the personal
// items tenure brings. Pure: DeskStory.tsx turns these into instances.
import { PLAQUES, type DeskItems, type DeskToy } from '../../../../shared/careers';

export interface Spot {
  x: number;
  y: number;
  z: number;
  rotY?: number;
}

/** Desk.tsx's monitor: its middle and its size, bezel included. */
export const MONITOR = { y: 1.31, z: -0.3, w: 1.07, h: 0.67 };
const TOP = 0.77;
const ON_MONITOR = MONITOR.y + MONITOR.h / 2;

export const PLAQUE = { w: 0.085, h: 0.075, d: 0.012 };
export const SHELF = { w: 1.0, h: 0.016, d: 0.1, y: ON_MONITOR + 0.008, z: MONITOR.z };

/** Plaque i (0 = newest) on the plank along the top of the monitor, facing the desk's owner and anyone behind them. */
export const plaqueSpot = (i: number): Spot => ({ x: -0.44 + i * 0.1, y: SHELF.y + SHELF.h / 2 + PLAQUE.h / 2, z: MONITOR.z + 0.015 });
/** The "+N" plaque after the last one shown. */
export const moreSpot = (): Spot => plaqueSpot(PLAQUES);
export const starSpot = (): Spot => ({ x: plaqueSpot(PLAQUES + 1).x, y: SHELF.y + 0.055, z: MONITOR.z + 0.01 });

/**
 * The plant's pot, where every desk's plant is (Desk.tsx draws an empty desk's). The photo and the toy keep clear of
 * the evening lamp and the lunch plate (Rituals.tsx).
 */
export const plantSpot = (): Spot => ({ x: -0.76, y: TOP, z: -0.22 });
export const photoSpot = (): Spot => ({ x: -0.42, y: TOP, z: -0.12, rotY: 0.25 });
export const toySpot = (): Spot => ({ x: 0.5, y: TOP, z: -0.08, rotY: -0.5 });

/** Everything one desk shows, as spots: what DeskStory.tsx instances. */
export function deskLayout(items: DeskItems) {
  return {
    shelf: items.plaques.length > 0,
    plaques: items.plaques.map((n, i) => ({ n, at: plaqueSpot(i) })),
    more: items.more > 0 ? { n: items.more, at: moreSpot() } : null,
    star: items.star ? starSpot() : null,
    plant: { at: plantSpot(), grow: items.plant },
    photo: items.photo ? photoSpot() : null,
    toy: items.toy ? { kind: items.toy as DeskToy, at: toySpot() } : null,
  };
}
