// Photo mode's filters as numbers for its one grading shader (post.ts), applied to the finished picture (after tone
// mapping, in display colours) so 'none' is the office exactly as it looks. Pure data, tested.

export const FILTERS = ['none', 'warm', 'night', 'mono', 'polaroid', 'comic'] as const;
export type Filter = (typeof FILTERS)[number];

export const FILTER_LABELS: Record<Filter, string> = {
  none: 'None',
  warm: 'Warm film',
  night: 'Cool night',
  mono: 'Black & white',
  polaroid: 'Polaroid',
  comic: 'Comic book',
};

export interface Grade {
  /** 0 = grey, 1 = as is. */
  saturation: number;
  /** Around mid-grey. */
  contrast: number;
  /** Multiplies each channel (a tint, and brightness). */
  gain: [number, number, number];
  /** Added to each channel (lifted, faded blacks). */
  lift: [number, number, number];
  /** Darkening towards the corners, 0..1. */
  vignette: number;
  /** Film grain strength, 0..~0.1. */
  grain: number;
  /** Colour levels per channel for a printed look; 0 = off. */
  posterize: number;
  /** Ink lines along edges, 0..1. */
  ink: number;
  /** A white instant-photo frame round the picture (drawn by overlay.ts). */
  frame: boolean;
}

const IDENTITY: Grade = { saturation: 1, contrast: 1, gain: [1, 1, 1], lift: [0, 0, 0], vignette: 0, grain: 0, posterize: 0, ink: 0, frame: false };

export const GRADES: Record<Filter, Grade> = {
  none: IDENTITY,
  warm: { ...IDENTITY, saturation: 1.08, contrast: 1.06, gain: [1.07, 1.0, 0.84], lift: [0.045, 0.025, 0.0], vignette: 0.32, grain: 0.045 },
  night: { ...IDENTITY, saturation: 0.82, contrast: 1.12, gain: [0.78, 0.9, 1.12], lift: [0.0, 0.012, 0.045], vignette: 0.45, grain: 0.03 },
  mono: { ...IDENTITY, saturation: 0, contrast: 1.18, vignette: 0.3, grain: 0.055 },
  polaroid: { ...IDENTITY, saturation: 0.88, contrast: 0.94, gain: [1.04, 1.0, 0.9], lift: [0.07, 0.06, 0.05], vignette: 0.22, grain: 0.03, frame: true },
  comic: { ...IDENTITY, saturation: 1.4, contrast: 1.12, posterize: 6, ink: 1 },
};

/** Whether the picture needs the grading pass at all (otherwise it's drawn straight to the screen). Called every frame. */
export const needsGrade = (g: Grade) =>
  g.saturation !== 1 ||
  g.contrast !== 1 ||
  g.gain[0] !== 1 ||
  g.gain[1] !== 1 ||
  g.gain[2] !== 1 ||
  g.lift[0] !== 0 ||
  g.lift[1] !== 0 ||
  g.lift[2] !== 0 ||
  g.vignette > 0 ||
  g.grain > 0 ||
  g.posterize > 0 ||
  g.ink > 0;

export const isFilter = (v: unknown): v is Filter => FILTERS.includes(v as Filter);
