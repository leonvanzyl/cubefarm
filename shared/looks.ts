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
/** Shirt colours new hires are given (and the designer offers). The CEO's is in Settings. */
export const SHIRT_COLORS = ['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#9b5de5', '#f15bb5', '#00bbf9', '#06d6a0', '#ffbe0b', '#8338ec', '#fb5607', '#3a86ff'];
/** How a character is drawn ("Drawn as": she / he). */
export const LOOKS = ['feminine', 'masculine'] as const;

// New agents are named after computing pioneers, then fictional detectives.
export const AGENT_NAMES = [
  'Ada', 'Linus', 'Grace', 'Alan', 'Margaret', 'Dennis', 'Barbara', 'Ken', 'Radia', 'Guido', 'Hedy', 'Tim', 'Katherine',
  'Bjarne', 'Frances', 'Edsger', 'Anita', 'Donald', 'Sophie', 'Yukihiro', 'Jean', 'Niklaus', 'Karen', 'Brendan',
  'Sherlock', 'Marple', 'Poirot', 'Nancy', 'Columbo', 'Fletcher', 'Watson', 'Morse', 'Holmes', 'Maigret',
];

// Names that get the feminine character look: everyone in the name pool above, plus common first names
// for agents the manager names themselves. The manager can always change an agent's look in the console.
const FEMININE_NAMES = new Set(
  (
    'ada grace margaret barbara radia hedy katherine frances anita sophie jean karen marple nancy fletcher ' +
    'alice amanda amelia amy ana anna anne aisha astrid ava bella beth carla caroline charlotte chloe claire clara ' +
    'diana elena elizabeth ella ellie emily emma eva fatima fiona freya georgia hannah harper helen holly ingrid iris ' +
    'isabella ivy jane jasmine jessica julia kate laura leah leila lena lily linda lisa lucy maria marie mary maya mei ' +
    'mia mila monica naomi natalie nina nora olivia paula priya rachel rose ruby sandra sara sarah scarlett sofia ' +
    'stella susan tess tessa tina vera victoria yuki zara zoe'
  ).split(' '),
);
/** The look a name suggests. */
export const lookFor = (name: string): (typeof LOOKS)[number] => (FEMININE_NAMES.has(name.trim().split(/\s+/)[0].toLowerCase()) ? 'feminine' : 'masculine');
/** The first name from the pool nobody has (`count`: how many agents there are, for the fallback). */
export const freeName = (taken: Iterable<string>, count: number) => {
  const t = new Set(taken);
  return AGENT_NAMES.find((n) => !t.has(n)) || `Agent ${count + 1}`;
};

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
  /** Headphones on (never with a hat, or over an afro or mohawk). */
  headphones?: boolean;
}

/** A hex colour such as #a1b2c3. */
export const HEX = /^#[0-9a-f]{6}$/i;
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
    headphones: typeof r.headphones === 'boolean' ? r.headphones : undefined,
  };
  for (const k of Object.keys(s) as (keyof AgentStyle)[]) if (s[k] === undefined) delete s[k];
  return Object.keys(s).length ? s : null;
}
