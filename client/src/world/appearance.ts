import type { AgentLook, AgentRole } from '../../../shared/types';

// Everything that makes one cartoon person look different from the next, picked from a hash of the agent's id
// so the same person looks the same after a reload and in every client. Pure: no three.js, easy to test.

export type HairStyle = 'crop' | 'long' | 'ponytail' | 'bun' | 'quiff' | 'afro' | 'sidePart' | 'buzz' | 'bald' | 'curls';
export type FacialHair = 'none' | 'stubble' | 'beard' | 'moustache';
export type Glasses = 'none' | 'round' | 'square';
export type Headwear = 'none' | 'beanie' | 'cap';
export type Outfit = 'tee' | 'hoodie' | 'stripe' | 'sweater';

export interface Appearance {
  hair: HairStyle;
  facialHair: FacialHair;
  glasses: Glasses;
  headphones: boolean;
  headwear: Headwear;
  outfit: Outfit;
  /** Upper-body scale, about ±6%. */
  height: number;
  /** Shoulder width scale, about ±8%. */
  shoulders: number;
  /** Index into a small accent palette (glasses frames, beanie/cap, stripe). */
  accent: number;
}

export const ACCENTS = ['#ffffff', '#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#2b2d42'] as const;

/** Styles that sit on top of or bulge out from the head and would poke through a beanie or cap. */
const TALL_HAIR: HairStyle[] = ['quiff', 'afro', 'bun', 'curls'];

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

export function appearanceFor(agent: { id: string; look: AgentLook; role: AgentRole }): Appearance {
  const next = rng(hashId(agent.id));
  // Always draw every number in the same order, so tweaking one rule doesn't reshuffle everything else.
  const [rHair, rFacial, rGlasses, rPhones, rHat, rOutfit, rHeight, rShoulders, rAccent] = Array.from({ length: 9 }, next);
  const dev = agent.role === 'dev';
  const masculine = agent.look === 'masculine';

  const hair = pick(rHair, HAIR[agent.look]);
  const facialHair = masculine
    ? pick<FacialHair>(rFacial, [
        ['none', 5],
        ['stubble', 2],
        ['beard', 2],
        ['moustache', 1],
      ])
    : 'none';
  // QA keep their inspector glasses, so only developers and the CEO get their own pair.
  const glasses = agent.role === 'qa' ? 'none' : pick<Glasses>(rGlasses, [
    ['none', 6],
    ['round', 2],
    ['square', 2],
  ]);
  // Headphones and hats are for developers; both sit on the head, so a person gets at most one of them.
  const headphones = dev && hair !== 'afro' && rPhones < 0.3;
  const headwear =
    dev && !headphones && !TALL_HAIR.includes(hair)
      ? pick<Headwear>(rHat, [
          ['none', 7],
          ['beanie', 1],
          ['cap', 1],
        ])
      : 'none';
  const outfit = dev
    ? pick<Outfit>(rOutfit, [
        ['tee', 1],
        ['hoodie', 1],
        ['stripe', 1],
        ['sweater', 1],
      ])
    : 'tee';

  return {
    hair,
    facialHair,
    glasses,
    headphones,
    headwear,
    outfit,
    height: +(0.94 + rHeight * 0.12).toFixed(3),
    shoulders: +(0.92 + rShoulders * 0.16).toFixed(3),
    accent: Math.floor(rAccent * ACCENTS.length),
  };
}
