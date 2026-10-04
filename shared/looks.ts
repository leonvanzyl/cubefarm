// What the manager can pick in an agent's look editor (⚙️ Setup → Look), shared by the server, which checks and keeps
// the picks on the agent, and the client, which draws them over the look seeded from the agent's id
// (client/src/world/appearance.ts). Pure.

export const HAIR_STYLES = ['crop', 'long', 'ponytail', 'bun', 'quiff', 'afro', 'sidePart', 'buzz', 'bald', 'curls', 'bob', 'mohawk', 'locs'] as const;
export const FACIAL_HAIR = ['none', 'stubble', 'beard', 'moustache'] as const;
export const GLASSES = ['none', 'round', 'square'] as const;
export const HEADWEAR = ['none', 'beanie', 'cap'] as const;
export const OUTFITS = ['tee', 'hoodie', 'stripe', 'sweater', 'cardigan', 'turtleneck'] as const;
export const BUILDS = ['slim', 'average', 'broad'] as const;

export type HairStyle = (typeof HAIR_STYLES)[number];
export type FacialHair = (typeof FACIAL_HAIR)[number];
export type Glasses = (typeof GLASSES)[number];
export type Headwear = (typeof HEADWEAR)[number];
export type Outfit = (typeof OUTFITS)[number];
export type Build = (typeof BUILDS)[number];

/** The small accent palette: glasses frames, beanies and caps, the stripe. */
export const ACCENT_COLORS = ['#ffffff', '#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#2b2d42'] as const;
/** Hair colours and skin tones new hires are given (and the editor offers). */
export const HAIR_COLORS = ['#2b2118', '#6b4226', '#c68642', '#f2d16b', '#d94f30', '#1c1c1c', '#8e8e8e', '#5b3cc4', '#e76f51', '#e8e2d0'];
export const SKIN_TONES = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffe0bd', '#a86b3c', '#5c3a21'];

/** The manager's picks; anything left out comes from the agent's seeded look. */
export interface AgentStyle {
  hair?: HairStyle;
  hairColor?: string;
  skin?: string;
  facialHair?: FacialHair;
  glasses?: Glasses;
  headwear?: Headwear;
  outfit?: Outfit;
  /** Index into ACCENT_COLORS. */
  accent?: number;
  build?: Build;
}

const HEX = /^#[0-9a-f]{6}$/i;
const oneOf = <T extends string>(list: readonly T[], v: unknown) => ((list as readonly unknown[]).includes(v) ? (v as T) : undefined);

/**
 * The valid picks in `raw` (anything from a request body or an old state file): unknown keys and values that aren't
 * one of the options are dropped, so those parts fall back to the seeded look. null when nothing valid is left.
 */
export function cleanStyle(raw: unknown): AgentStyle | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const s: AgentStyle = {
    hair: oneOf(HAIR_STYLES, r.hair),
    hairColor: typeof r.hairColor === 'string' && HEX.test(r.hairColor) ? r.hairColor.toLowerCase() : undefined,
    skin: typeof r.skin === 'string' && HEX.test(r.skin) ? r.skin.toLowerCase() : undefined,
    facialHair: oneOf(FACIAL_HAIR, r.facialHair),
    glasses: oneOf(GLASSES, r.glasses),
    headwear: oneOf(HEADWEAR, r.headwear),
    outfit: oneOf(OUTFITS, r.outfit),
    accent: Number.isInteger(r.accent) && (r.accent as number) >= 0 && (r.accent as number) < ACCENT_COLORS.length ? (r.accent as number) : undefined,
    build: oneOf(BUILDS, r.build),
  };
  for (const k of Object.keys(s) as (keyof AgentStyle)[]) if (s[k] === undefined) delete s[k];
  return Object.keys(s).length ? s : null;
}
