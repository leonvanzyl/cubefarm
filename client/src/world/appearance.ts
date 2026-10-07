import type { AgentLook, AgentRole } from '../../../shared/types';
import {
  ACCENT_COLORS,
  BUILDS,
  FACIAL_HAIR,
  GLASSES,
  HAIR_COLORS,
  HAIR_STYLES,
  HEADWEAR,
  OUTFITS,
  SKIN_TONES,
  type AgentStyle,
  type Build,
  type FacialHair,
  type Glasses,
  type HairStyle,
  type Headwear,
  type Outfit,
} from '../../../shared/looks';

// Everything that makes one cartoon person look different from the next, picked from a hash of the agent's id
// so the same person looks the same after a reload and in every client, with the manager's picks from the look
// editor (agent.style, shared/looks.ts) laid over it. Pure: no three.js, easy to test.

export type { Build, FacialHair, Glasses, HairStyle, Headwear, Outfit };

export interface Appearance {
  hair: HairStyle;
  facialHair: FacialHair;
  glasses: Glasses;
  headphones: boolean;
  headwear: Headwear;
  outfit: Outfit;
  /** Upper-body scale, about ±10%. */
  height: number;
  /** A little shoulder-width variation on top of the build, about ±5%. */
  shoulders: number;
  build: Build;
  /** Index into a small accent palette (glasses frames, beanie/cap, stripe). */
  accent: number;
  hairColor: string;
  skin: string;
}

export const ACCENTS = ACCENT_COLORS;

/** How each build scales the torso: width (with the shoulders) and depth. */
export const BUILD_SHAPE: Record<Build, { width: number; depth: number }> = {
  slim: { width: 0.88, depth: 0.92 },
  average: { width: 1, depth: 1 },
  broad: { width: 1.15, depth: 1.1 },
};

/** Styles that sit on top of or bulge out from the head and would poke through a beanie or cap. */
export const TALL_HAIR: readonly HairStyle[] = ['quiff', 'afro', 'bun', 'curls', 'mohawk'];

type Weighted<T> = [T, number][];

const HAIR: Record<AgentLook, Weighted<HairStyle>> = {
  feminine: [
    ['long', 4],
    ['ponytail', 3],
    ['bun', 3],
    ['curls', 2],
    ['afro', 2],
    ['sidePart', 2],
    ['buzz', 1],
  ],
  masculine: [
    ['crop', 2],
    ['quiff', 3],
    ['sidePart', 3],
    ['buzz', 2],
    ['bald', 2],
    ['curls', 2],
    ['afro', 2],
    ['long', 1],
    ['ponytail', 1],
    ['bun', 1],
  ],
};
/** The styles added later, drawn by a separate number so everyone who had a style before keeps it (most do). */
const NEW_HAIR: Record<AgentLook, Weighted<HairStyle>> = {
  feminine: [
    ['bob', 3],
    ['locs', 2],
    ['mohawk', 1],
  ],
  masculine: [
    ['locs', 2],
    ['mohawk', 2],
    ['bob', 1],
  ],
};
const NEW_HAIR_SHARE = 0.22;
const NEW_OUTFIT_SHARE = 0.3;

/** FNV-1a: a small, stable 32-bit string hash. */
export function hashId(id: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: turns the hash into a stream of numbers in [0, 1), so each pick below is independent. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: number, options: Weighted<T>): T {
  const total = options.reduce((n, [, w]) => n + w, 0);
  let x = r * total;
  for (const [v, w] of options) if ((x -= w) < 0) return v;
  return options[options.length - 1][0];
}

type Who = { id: string; look: AgentLook; role: AgentRole; hair?: string; skin?: string; style?: AgentStyle | null };

/** The look picked from their id alone (the look editor's "Back to their seeded look"). */
export function seededAppearance(agent: Who): Appearance {
  const next = rng(hashId(agent.id));
  // Always draw every number in the same order, so tweaking one rule doesn't reshuffle everything else; new draws
  // go on the end.
  const [rHair, rFacial, rGlasses, rPhones, rHat, rOutfit, rHeight, rShoulders, rAccent, rBuild, rNewHair, rNewOutfit] = Array.from({ length: 12 }, next);
  // the CEO keeps their suit and a bare head; hats, headphones and outfits are for everyone else
  const staff = agent.role !== 'ceo';
  const masculine = agent.look === 'masculine';

  // (the CEO's id is the same in every office: they keep the hair everyone knows them by)
  const hair = agent.role !== 'ceo' && rNewHair < NEW_HAIR_SHARE ? pick(rHair, NEW_HAIR[agent.look]) : pick(rHair, HAIR[agent.look]);
  const facialHair = masculine
    ? pick<FacialHair>(rFacial, [
        ['none', 5],
        ['stubble', 2],
        ['beard', 2],
        ['moustache', 1],
      ])
    : 'none';
  const glasses = pick<Glasses>(rGlasses, [
    ['none', 6],
    ['round', 2],
    ['square', 2],
  ]);
  // Headphones and hats both sit on the head, so a person gets at most one of them.
  const headphones = staff && hair !== 'afro' && hair !== 'mohawk' && rPhones < 0.3;
  const headwear =
    staff && !headphones && !TALL_HAIR.includes(hair)
      ? pick<Headwear>(rHat, [
          ['none', 7],
          ['beanie', 1],
          ['cap', 1],
        ])
      : 'none';
  const outfit = !staff
    ? 'tee'
    : rNewOutfit < NEW_OUTFIT_SHARE
      ? pick<Outfit>(rOutfit, [
          ['cardigan', 1],
          ['turtleneck', 1],
        ])
      : pick<Outfit>(rOutfit, [
          ['tee', 1],
          ['hoodie', 1],
          ['stripe', 1],
          ['sweater', 1],
        ]);

  return {
    hair,
    facialHair,
    glasses,
    headphones,
    headwear,
    outfit,
    height: +(0.9 + rHeight * 0.2).toFixed(3),
    shoulders: +(0.95 + rShoulders * 0.1).toFixed(3),
    build: pick<Build>(rBuild, [
      ['slim', 1],
      ['average', 2],
      ['broad', 1],
    ]),
    accent: Math.floor(rAccent * ACCENTS.length),
    hairColor: agent.hair ?? '#2b2118',
    skin: agent.skin ?? '#f1c27d',
  };
}

/** A whole new look for the editor's "Shuffle", from `rand` (0 to 1). Plain more often than not, like the seeded ones. */
export function randomStyle(agent: { look: AgentLook; role: AgentRole }, rand: () => number = Math.random): AgentStyle {
  const one = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
  const hair = one(HAIR_STYLES);
  return {
    hair,
    hairColor: one(HAIR_COLORS),
    skin: one(SKIN_TONES),
    facialHair: agent.look === 'masculine' && rand() < 0.5 ? one(FACIAL_HAIR) : 'none',
    glasses: rand() < 0.4 ? one(GLASSES) : 'none',
    headwear: !TALL_HAIR.includes(hair) && rand() < 0.3 ? one(HEADWEAR) : 'none',
    ...(agent.role !== 'ceo' ? { outfit: one(OUTFITS) } : {}),
    accent: Math.floor(rand() * ACCENTS.length),
    build: one(BUILDS),
  };
}

/**
 * How they're drawn: the seeded look with the manager's picks (agent.style) over it. The picks still never stack
 * things that would clip: a hat only goes on hair that fits under it, headphones only where there's room. The CEO
 * keeps their blazer.
 */
export function appearanceFor(agent: Who): Appearance {
  const seeded = seededAppearance(agent);
  const s = agent.style;
  if (!s) return seeded;
  const hair = s.hair ?? seeded.hair;
  const headwear = TALL_HAIR.includes(hair) ? 'none' : (s.headwear ?? seeded.headwear);
  return {
    ...seeded,
    hair,
    facialHair: s.facialHair ?? seeded.facialHair,
    glasses: s.glasses ?? seeded.glasses,
    headphones: seeded.headphones && headwear === 'none' && hair !== 'afro' && hair !== 'mohawk',
    headwear,
    outfit: agent.role !== 'ceo' ? (s.outfit ?? seeded.outfit) : 'tee',
    build: s.build ?? seeded.build,
    accent: s.accent ?? seeded.accent,
    hairColor: s.hairColor ?? seeded.hairColor,
    skin: s.skin ?? seeded.skin,
  };
}
