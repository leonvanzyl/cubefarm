// The holiday themes as data (shared/themes.ts says which one is on): the decorations each puts in the floors' named
// slots (layout.ts), the string lights along the walls, how it tints the lights and the sky, the costumes people wear,
// its jukebox songs and its merge confetti. Pure, so placement and costumes are tested; the theme's lazy chunk draws it.

import type { AgentRole } from '../../../../shared/types';
import type { ThemeId } from '../../../../shared/themes';
import { hashId } from '../appearance';
import { decorSlots, rect, type DecorSlot, type Rect } from '../layout';

type FloorKind = 'office' | 'lobby';

export type DecorItem =
  | 'jackOLantern'
  | 'bigPumpkin'
  | 'cobweb'
  | 'broom'
  | 'gravestone'
  | 'inflatablePumpkin'
  | 'candyBowl'
  | 'tree'
  | 'heartBalloon'
  | 'balloons'
  | 'cake'
  | 'banner'
  | 'snowman'
  | 'champagne'
  | 'eggBasket'
  | 'goldenEgg';

export type Costume =
  | 'witchHat'
  | 'pumpkinHead'
  | 'vampire'
  | 'ghost'
  | 'catEars'
  | 'skeleton'
  | 'deerstalker'
  | 'crown'
  | 'santaHat'
  | 'antlers'
  | 'uglySweater'
  | 'partyHat'
  | 'heartBoppers'
  | 'bunnyEars';

export interface ThemeDef {
  id: ThemeId;
  /** Which slots get which item: a slot id, or a prefix ending in `*` (`desk-*`), on both floor kinds or just `kind`. */
  decor: { slots: string; item: DecorItem; kind?: FloorKind }[];
  /** String lights along the walls (layout.ts decorRuns), in these colours; null for none. */
  lights: string[] | null;
  /** Bunting (little flags) along the walls, in these colours. */
  bunting?: string[];
  /** Tinsel garlands along the walls. */
  garland?: boolean;
  /** Mixed into the room's hemisphere and ambient light. */
  tint: { color: string; amount: number };
  /** Mixed into the sky and the fog, mostly in the evening and at night, and how much closer the fog comes then. */
  sky?: { color: string; amount: number; fog: number };
  costumes: { dev: Costume[]; qa: Costume[]; ceo: Costume[] };
  /** Song ids (jukeboxSongs.ts HOLIDAY_SONGS), played before the usual playlist. */
  playlist: string[];
  /** Merge confetti, instead of the usual colours. */
  confetti?: { colors: string[]; shape: 'paper' | 'heart' };
}

const HALLOWEEN_CONFETTI = ['#ff7b00', '#ff9e1f', '#7b2cbf', '#9d4edd', '#1b1b1f', '#2b2d42'];

export const THEMES: Record<ThemeId, ThemeDef> = {
  halloween: {
    id: 'halloween',
    decor: [
      { slots: 'desk-*', item: 'jackOLantern' },
      { slots: 'qa-*', item: 'jackOLantern' },
      { slots: 'reception-w', item: 'jackOLantern' },
      { slots: 'reception-e', item: 'candyBowl' },
      { slots: 'balcony-*', item: 'bigPumpkin' },
      { slots: 'corner-*', item: 'cobweb' },
      { slots: 'elevator-e', item: 'broom' },
      { slots: 'lobby-feature', item: 'gravestone' },
      { slots: 'patio', item: 'inflatablePumpkin' },
    ],
    lights: ['#ff7b00', '#9d4edd'],
    tint: { color: '#b48cff', amount: 0.12 },
    sky: { color: '#5a189a', amount: 0.45, fog: 0.35 },
    costumes: { dev: ['witchHat', 'pumpkinHead', 'vampire', 'ghost', 'catEars', 'skeleton'], qa: ['deerstalker'], ceo: ['crown'] },
    playlist: ['haunted-hotfix', 'monster-merge'],
    confetti: { colors: HALLOWEEN_CONFETTI, shape: 'paper' },
  },
  christmas: {
    id: 'christmas',
    decor: [
      { slots: 'lobby-feature', item: 'tree' },
      { slots: 'reception-w', item: 'snowman' },
      { slots: 'elevator-w', item: 'snowman', kind: 'lobby' },
    ],
    lights: ['#ff3b3b', '#2dc653', '#ffd23f', '#4cc9f0'],
    garland: true,
    tint: { color: '#ffd6a0', amount: 0.1 },
    sky: { color: '#c8d7ff', amount: 0.2, fog: 0.2 },
    costumes: { dev: ['santaHat', 'antlers', 'uglySweater'], qa: ['santaHat', 'antlers'], ceo: ['santaHat'] },
    playlist: ['snowed-in-standup', 'cocoa-and-code'],
    confetti: { colors: ['#e63946', '#2a9d8f', '#ffd166', '#ffffff', '#52b788'], shape: 'paper' },
  },
  newyear: {
    id: 'newyear',
    decor: [
      { slots: 'reception-w', item: 'champagne' },
      { slots: 'reception-e', item: 'champagne' },
    ],
    lights: ['#ffd23f', '#f8f9fa', '#c0c0ff'],
    bunting: ['#ffd23f', '#1b1b3a', '#f8f9fa', '#c77dff'],
    tint: { color: '#ffe8b0', amount: 0.08 },
    sky: { color: '#1b1b4a', amount: 0.25, fog: 0 },
    costumes: { dev: ['partyHat'], qa: ['partyHat'], ceo: ['crown'] },
    playlist: ['countdown-commit'],
    confetti: { colors: ['#ffd23f', '#f8f9fa', '#c0c0c0', '#c77dff', '#4cc9f0'], shape: 'paper' },
  },
  valentines: {
    id: 'valentines',
    decor: [
      { slots: 'desk-*', item: 'heartBalloon' },
      { slots: 'qa-*', item: 'heartBalloon' },
      { slots: 'reception-*', item: 'heartBalloon' },
    ],
    lights: ['#ff4d6d', '#ff8fab', '#c9184a'],
    tint: { color: '#ff9eb5', amount: 0.12 },
    costumes: { dev: ['heartBoppers'], qa: ['heartBoppers'], ceo: ['crown'] },
    playlist: ['pair-programming'],
    confetti: { colors: ['#ff4d6d', '#ff8fab', '#c9184a', '#ffccd5', '#ffffff'], shape: 'heart' },
  },
  easter: {
    id: 'easter',
    decor: [
      { slots: 'reception-w', item: 'eggBasket' },
      { slots: 'elevator-e', item: 'eggBasket' },
      { slots: 'cabinet-top', item: 'goldenEgg' },
    ],
    lights: null,
    bunting: ['#ffc8dd', '#bde0fe', '#caffbf', '#fdffb6', '#e4c1f9'],
    tint: { color: '#e9ffd6', amount: 0.08 },
    costumes: { dev: ['bunnyEars'], qa: ['bunnyEars'], ceo: ['bunnyEars'] },
    playlist: ['egg-hunt-hop'],
    confetti: { colors: ['#ffc8dd', '#bde0fe', '#caffbf', '#fdffb6', '#e4c1f9'], shape: 'paper' },
  },
  birthday: {
    id: 'birthday',
    decor: [
      { slots: 'banner', item: 'banner' },
      { slots: 'reception-*', item: 'balloons' },
      { slots: 'elevator-*', item: 'balloons' },
      { slots: 'desk-*', item: 'balloons' },
      { slots: 'manager-desk', item: 'cake' },
    ],
    lights: ['#ffd23f', '#ff5d8f', '#3a86ff', '#06d6a0'],
    bunting: ['#ff5d8f', '#ffd23f', '#3bceac', '#3a86ff', '#9b5de5'],
    tint: { color: '#fff0c2', amount: 0.06 },
    costumes: { dev: ['partyHat'], qa: ['partyHat'], ceo: ['partyHat'] },
    playlist: ['another-year-of-uptime'],
    confetti: { colors: ['#ff5d8f', '#ffd23f', '#3bceac', '#3a86ff', '#ff8c42', '#9b5de5'], shape: 'paper' },
  },
};

const matches = (pattern: string, id: string) => (pattern.endsWith('*') ? id.startsWith(pattern.slice(0, -1)) : id === pattern);

/** What theme `id` puts where on a floor kind: each slot once (the first rule that names it wins). */
export function placeDecor(id: ThemeId | null, kind: FloorKind): { slot: DecorSlot; item: DecorItem }[] {
  if (!id) return [];
  const rules = THEMES[id].decor;
  const out: { slot: DecorSlot; item: DecorItem }[] = [];
  for (const slot of decorSlots(kind)) {
    const rule = rules.find((r) => (!r.kind || r.kind === kind) && matches(r.slots, slot.id));
    if (rule) out.push({ slot, item: rule.item });
  }
  return out;
}

/** How much floor an item standing in a floor slot takes (w along x, d along z, before the slot's turn) and its height. */
export const FOOTPRINT: Partial<Record<DecorItem, { w: number; d: number; h: number }>> = {
  bigPumpkin: { w: 0.55, d: 0.55, h: 0.45 },
  broom: { w: 0.35, d: 0.3, h: 1.3 },
  gravestone: { w: 1.0, d: 0.5, h: 1.25 },
  inflatablePumpkin: { w: 1.7, d: 1.7, h: 1.6 },
  tree: { w: 2.6, d: 2.6, h: 3.2 }, // the presents under it too
  snowman: { w: 0.7, d: 0.7, h: 1.3 },
  balloons: { w: 0.45, d: 0.45, h: 0.3 },
  eggBasket: { w: 0.5, d: 0.5, h: 0.4 },
};

/** The solids theme `id`'s floor-standing decorations add on a floor kind (kept in step with Game.tsx's colliders). */
export function decorColliders(id: ThemeId | null, kind: FloorKind): Rect[] {
  return placeDecor(id, kind).flatMap(({ slot, item }) => {
    const f = FOOTPRINT[item];
    if (!slot.floor || !f) return [];
    const turned = Math.abs(Math.sin(slot.rotY)) > 0.7;
    return [rect(slot.x, slot.z, turned ? f.d : f.w, turned ? f.w : f.d, f.h)];
  });
}

/** What someone wears for theme `id`: picked from their id, so it's the same in every browser and after a reload. */
export function costumeFor(id: ThemeId | null, agent: { id: string; role: AgentRole }): Costume | null {
  if (!id) return null;
  const list = THEMES[id].costumes[agent.role];
  return list.length ? list[hashId(`${id}:${agent.id}`) % list.length] : null;
}
