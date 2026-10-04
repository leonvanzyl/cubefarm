// window.__swarmActivity, for QA and Playwright: what the sign over each person on this floor says (ActivityIcon.tsx),
// the floor ticker's lines and how many times it was painted (ActivityTicker.tsx), and the hover card (ui/AgentCard.tsx).

import { say } from './people';

export interface SignInfo {
  name: string;
  /** The icon shown, '' while they have no sign (idle, or it's fading out). */
  icon: string;
  kind: string | null;
  detail: string;
}

export interface CardInfo {
  agentId: string;
  name: string;
  lines: string[];
}

const signs = new Map<string, SignInfo>();
const where = new Map<string, () => { shown: boolean; x: number; y: number; z: number }>();
let ticker = { lines: [] as string[], paints: 0 };
let card: CardInfo | null = null;

/** A person's sign changed (null: they left the floor). */
export function reportSign(id: string, info: SignInfo | null) {
  if (info) signs.set(id, info);
  else signs.delete(id);
}

/** How the probe finds a sign in the scene: whether it's drawn this frame, and where (rounded to the centimetre). */
export function trackSign(id: string, find: () => { shown: boolean; x: number; y: number; z: number }) {
  where.set(id, find);
  return () => {
    if (where.get(id) === find) where.delete(id);
  };
}

/** The ticker painted a new tape with these lines. */
export function reportTicker(lines: string[]) {
  ticker = { lines, paints: ticker.paints + 1 };
}

export function reportCard(info: CardInfo | null) {
  card = info;
}

const probe = {
  /** Everyone on this floor (and the CEO in the lobby) with the sign over their head. */
  agents: () => [...signs].map(([id, s]) => ({ id, ...s, ...where.get(id)?.() })),
  /** The ticker's lines, oldest first, and how many times its tape has been painted. */
  ticker: () => ({ lines: ticker.lines.slice(), paints: ticker.paints }),
  /** The hover card, while one is showing. */
  card: () => card,
  /** Shows (or with null hides) a speech bubble over someone, to see their sign stack above it. */
  bubble: (id: string, text: string | null) => say(id, text),
};

if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__swarmActivity = probe;
