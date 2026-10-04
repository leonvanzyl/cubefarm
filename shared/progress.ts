// Office progression (#210): what both sides need to agree on. The decoration catalogue and its prices, the
// decoration slots every office floor has (layout.ts places them), the achievements, and the views the server's
// ledger (server/ledger.ts) sends to the browser.

/** Where a decoration goes: on a wall, a small spot on the floor, a big spot on the floor, or flat under foot. */
export type DecorKind = 'wall' | 'floor' | 'big' | 'rug';

export type DecorItem = 'plant' | 'beanbag' | 'fig' | 'poster-ship' | 'poster-repo' | 'poster-pr' | 'rug' | 'lights' | 'neon' | 'fishtank' | 'pingpong' | 'arcade';

export interface CatalogueItem {
  id: DecorItem;
  name: string;
  icon: string;
  kind: DecorKind;
  /** Coins for the first one; each one the floor already owns makes the next a little dearer (priceOf). */
  price: number;
  blurb: string;
}

export const CATALOGUE: readonly CatalogueItem[] = [
  { id: 'plant', name: 'Potted plant', icon: '🪴', kind: 'floor', price: 20, blurb: 'A cheerful leafy friend for a corner.' },
  { id: 'beanbag', name: 'Bean bag', icon: '🛋️', kind: 'floor', price: 35, blurb: 'For thinking very hard, horizontally.' },
  { id: 'fig', name: 'Fiddle-leaf fig', icon: '🌳', kind: 'floor', price: 45, blurb: 'Big, glossy and a little dramatic.' },
  { id: 'poster-ship', name: '"Ship it" poster', icon: '🚀', kind: 'wall', price: 25, blurb: 'Framed motivation.' },
  { id: 'poster-repo', name: 'Repo poster', icon: '🖼️', kind: 'wall', price: 30, blurb: "The floor's repo, framed." },
  { id: 'poster-pr', name: 'First PR poster', icon: '📜', kind: 'wall', price: 40, blurb: "The floor's first merged PR, framed for posterity." },
  { id: 'rug', name: 'Accent rug', icon: '🟧', kind: 'rug', price: 30, blurb: "A rug in the floor's colour." },
  { id: 'lights', name: 'String lights', icon: '💡', kind: 'wall', price: 50, blurb: 'Warm little bulbs along a wall.' },
  { id: 'neon', name: 'Neon sign', icon: '🌈', kind: 'wall', price: 80, blurb: "The floor's name in glowing tubes." },
  { id: 'fishtank', name: 'Fish tank', icon: '🐠', kind: 'big', price: 120, blurb: 'A few toon fish doing laps.' },
  { id: 'pingpong', name: 'Ping-pong table', icon: '🏓', kind: 'big', price: 150, blurb: 'Decorative, for now.' },
  { id: 'arcade', name: 'Arcade cabinet', icon: '🕹️', kind: 'big', price: 200, blurb: "Press E on it to play the phone's games." },
];

export const catalogueItem = (id: string): CatalogueItem | undefined => CATALOGUE.find((c) => c.id === id);
export const isDecorItem = (id: unknown): id is DecorItem => typeof id === 'string' && CATALOGUE.some((c) => c.id === id);

/** What the next `item` costs on a floor that already owns `owned` of them: a quarter more for each, rounded to 5. */
export function priceOf(item: DecorItem, owned = 0): number {
  const base = catalogueItem(item)?.price ?? 0;
  return Math.round((base * (1 + 0.25 * Math.max(0, owned))) / 5) * 5;
}

/**
 * Every office floor's decoration slots: a few per zone. Their positions are in client/src/world/layout.ts
 * (DECOR_SLOT_AT), kept clear of desks, walkways, the whiteboard and the elevator.
 */
export const DECOR_SLOTS: readonly { id: string; kind: DecorKind }[] = [
  { id: 'w-west', kind: 'wall' },
  { id: 'w-south-w', kind: 'wall' },
  { id: 'w-south-e', kind: 'wall' },
  { id: 'w-north-e', kind: 'wall' },
  { id: 'w-kitchen', kind: 'wall' },
  { id: 'f-ne', kind: 'floor' },
  { id: 'f-se', kind: 'floor' },
  { id: 'f-sw', kind: 'floor' },
  { id: 'f-west', kind: 'floor' },
  { id: 'b-west', kind: 'big' },
  { id: 'b-lounge', kind: 'big' },
  { id: 'b-south', kind: 'big' },
  { id: 'r-lounge', kind: 'rug' },
  { id: 'r-entry', kind: 'rug' },
];

export const slotKind = (id: string): DecorKind | undefined => DECOR_SLOTS.find((s) => s.id === id)?.kind;
export const slotsOfKind = (kind: DecorKind) => DECOR_SLOTS.filter((s) => s.kind === kind).length;

// ---------- coins ----------

/** What a merge earns its floor: a base, and bonuses for a clean run. Nothing is ever taken away. */
export const COINS = { merge: 10, firstQa: 5, greenCi: 5, streak: 10 } as const;
/** A floor's merge counts towards a streak bonus when it is the third (or more) within this long. */
export const STREAK_WINDOW_MS = 60 * 60_000;
export const STREAK_MERGES = 3;

// ---------- achievements ----------

export type AchievementId =
  | 'first-merge'
  | 'hat-trick'
  | 'ten-a-day'
  | 'clean-day'
  | 'night-owl'
  | 'full-house'
  | 'comeback'
  | 'coffee-addict'
  | 'perfect-five'
  | 'quarter-century'
  | 'century'
  | 'interior-designer'
  | 'fully-furnished';

export interface AchievementDef {
  id: AchievementId;
  name: string;
  icon: string;
  /** What it takes, as the trophy's plaque says it. */
  blurb: string;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first-merge', name: 'First merge', icon: '🎉', blurb: 'The first PR merged since the trophy shelf went up' },
  { id: 'hat-trick', name: 'Hat trick', icon: '⚡', blurb: 'Three merges on one floor within an hour' },
  { id: 'ten-a-day', name: 'Ten in a day', icon: '🔟', blurb: 'Ten merges in one day' },
  { id: 'clean-day', name: 'Spotless day', icon: '✨', blurb: 'Five or more merges in a day without one failed QA round' },
  { id: 'night-owl', name: 'Night owl', icon: '🦉', blurb: 'A merge between midnight and 5 am' },
  { id: 'full-house', name: 'Full house', icon: '🏠', blurb: 'Everyone on a floor busy at once (four or more people)' },
  { id: 'comeback', name: 'Comeback', icon: '🔁', blurb: 'A PR that needed you was merged after all' },
  { id: 'coffee-addict', name: 'Coffee addict', icon: '☕', blurb: 'You drank ten coffees' },
  { id: 'perfect-five', name: 'Perfect five', icon: '💎', blurb: 'Five merges in a row without a failed QA round or check' },
  { id: 'quarter-century', name: 'Quarter century', icon: '🥈', blurb: '25 PRs merged' },
  { id: 'century', name: 'Century', icon: '🥇', blurb: '100 PRs merged' },
  { id: 'interior-designer', name: 'Interior designer', icon: '🪴', blurb: 'The first decoration placed' },
  { id: 'fully-furnished', name: 'Fully furnished', icon: '🛋️', blurb: 'Every decoration slot on a floor filled' },
];

export const achievementDef = (id: string) => ACHIEVEMENTS.find((a) => a.id === id);

/** Coffees the player drinks before the coffee addict trophy. */
export const COFFEE_ADDICT = 10;

// ---------- views ----------

export interface FloorProgressView {
  coins: number;
  /** Coins earned on this floor, ever. */
  earned: number;
  merges: number;
  /** Decorations bought for the floor, placed or in its decor box. */
  owned: Partial<Record<DecorItem, number>>;
  /** Slot id -> what stands there. */
  placed: Record<string, DecorItem>;
  /** The first PR merged on the floor while the ledger watched: the "first PR" poster shows it. */
  firstPr: { n: number; title: string } | null;
}

export interface AchievementView {
  id: AchievementId;
  at: number;
  /** What earned it, e.g. "PR #12 on demo-co/pixel-todo". */
  detail: string;
}

export interface ProgressView {
  /** By repo id, for the connected floors. */
  floors: Record<string, FloorProgressView>;
  achievements: AchievementView[];
  coffees: number;
  merges: number;
}

/** A merge's coins, sent as it happens for the coin burst and the pling. */
export interface RewardView {
  repoId: string;
  prNumber: number;
  /** The PR's author, whose desk the coins burst over (null: over the whiteboard). */
  agentId: string | null;
  coins: number;
  reasons: string[];
}

/** How many decorations of `item` a floor has in its decor box (bought and not placed). */
export function stored(floor: Pick<FloorProgressView, 'owned' | 'placed'>, item: DecorItem) {
  const placed = Object.values(floor.placed).filter((p) => p === item).length;
  return Math.max(0, (floor.owned[item] ?? 0) - placed);
}
