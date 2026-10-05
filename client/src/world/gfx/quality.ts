// Graphics quality: the presets in Help → Graphics, what each tier draws, and Auto's governor, which steps the tier
// down when frames stay slow and back up only after sustained headroom. Pure, so every decision is tested without a
// browser; useGraphics.ts feeds it frame-rate samples and saves the preset.

export const GRAPHICS_PRESETS = ['low', 'medium', 'high', 'auto'] as const;
export type GraphicsPreset = (typeof GRAPHICS_PRESETS)[number];
export const DEFAULT_PRESET: GraphicsPreset = 'auto';

/** What actually draws, cheapest first. Low is the office as it always was: no post-processing at all. */
export const TIERS = ['low', 'medium', 'high'] as const;
export type Tier = (typeof TIERS)[number];

/** A saved preset, or Auto when it's missing, mistyped or from an older build. */
export function normalizePreset(raw: unknown): GraphicsPreset {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
  return GRAPHICS_PRESETS.includes(v as GraphicsPreset) ? (v as GraphicsPreset) : DEFAULT_PRESET;
}

export interface TierEffects {
  /** Selective bloom: only emissive things (screens, lamps, neon, the city's windows, the moon) glow. */
  bloom: boolean;
  /** Monitors cast a soft coloured glow on desks and faces at night. */
  screenGlow: boolean;
  /** Ambient occlusion (N8AO). */
  ao: boolean;
  /** Soft contact shadows under people and furniture. */
  contactShadows: boolean;
  /** Time-of-day colour grading. */
  grading: boolean;
}

export function tierEffects(tier: Tier): TierEffects {
  const medium = tier !== 'low';
  const high = tier === 'high';
  return { bloom: medium, screenGlow: medium, ao: high, contactShadows: high, grading: high };
}

/** The names of the effects a tier turns on (for the probe and ?stats). */
export const effectNames = (tier: Tier) =>
  Object.entries(tierEffects(tier))
    .filter(([, on]) => on)
    .map(([name]) => name);

export const tierIndex = (tier: Tier) => TIERS.indexOf(tier);
export const isTierAtLeast = (tier: Tier, min: Tier) => tierIndex(tier) >= tierIndex(min);

// ---------- Auto's governor ----------

export interface GovernorConfig {
  /** Average fps below this is slow... */
  downFps: number;
  /** ...and this long of nothing but slow samples steps the tier down. */
  downAfterMs: number;
  /** Average fps at or above this is headroom (a 60 Hz screen at its cap)... */
  upFps: number;
  /** ...and this long of nothing but headroom steps it up, doubling after every step up that didn't hold. */
  upAfterMs: number;
  maxUpAfterMs: number;
  /** A step down this soon after a step up means the step up failed. */
  failWindowMs: number;
  /** Samples ignored after a change, a pause or new effects loading (shader compiles, texture uploads)... */
  settleMs: number;
  /** ...and, longer, when the office has just opened and everything is still loading in. */
  startMs: number;
}

export const GOVERNOR: GovernorConfig = {
  downFps: 50,
  downAfterMs: 3_000,
  upFps: 57,
  upAfterMs: 20_000,
  maxUpAfterMs: 320_000,
  failWindowMs: 20_000,
  settleMs: 2_500,
  startMs: 8_000,
};

export interface GovernorState {
  tier: Tier;
  /** Milliseconds of samples still to ignore. */
  settle: number;
  /** How long the current run of slow (or fast) samples has lasted. */
  slowMs: number;
  fastMs: number;
  /** Headroom needed before the next step up. */
  upAfterMs: number;
  /** Time since the last step up, while it may still turn out to have failed; null otherwise. */
  sinceUpMs: number | null;
}

export interface GovernorChange {
  from: Tier;
  to: Tier;
  reason: string;
}

/** Auto starts at High and finds its own level. */
export function newGovernor(start: Tier = 'high', cfg: GovernorConfig = GOVERNOR): GovernorState {
  return { tier: start, settle: cfg.startMs, slowMs: 0, fastMs: 0, upAfterMs: cfg.upAfterMs, sinceUpMs: null };
}

/** Ignore the next few samples and start the runs again: after a pause, a tier change or effects finishing loading. */
export function governorSettle(s: GovernorState, cfg: GovernorConfig = GOVERNOR) {
  s.settle = cfg.settleMs;
  s.slowMs = 0;
  s.fastMs = 0;
}

/**
 * One frame-rate sample: the average `fps` over the last `ms` milliseconds of drawing. Updates `s` and returns the
 * step it takes, if any. Slow means under downFps for downAfterMs straight; headroom means at least upFps for
 * upAfterMs straight, and anything in between breaks both runs.
 */
export function governorSample(s: GovernorState, fps: number, ms: number, cfg: GovernorConfig = GOVERNOR): GovernorChange | null {
  if (!Number.isFinite(fps) || !Number.isFinite(ms) || ms <= 0) return null;
  if (s.sinceUpMs !== null) {
    s.sinceUpMs += ms;
    // Held long enough: the step up worked, so the next one needn't wait any longer than usual.
    if (s.sinceUpMs > cfg.failWindowMs) {
      s.sinceUpMs = null;
      s.upAfterMs = cfg.upAfterMs;
    }
  }
  if (s.settle > 0) {
    s.settle -= ms;
    return null;
  }
  if (fps < cfg.downFps) {
    s.slowMs += ms;
    s.fastMs = 0;
  } else if (fps >= cfg.upFps) {
    s.fastMs += ms;
    s.slowMs = 0;
  } else {
    s.slowMs = 0;
    s.fastMs = 0;
  }

  const i = tierIndex(s.tier);
  if (s.slowMs >= cfg.downAfterMs && i > 0) {
    const from = s.tier;
    const failed = s.sinceUpMs !== null;
    if (failed) s.upAfterMs = Math.min(cfg.maxUpAfterMs, s.upAfterMs * 2);
    s.tier = TIERS[i - 1];
    s.sinceUpMs = null;
    governorSettle(s, cfg);
    return { from, to: s.tier, reason: `${Math.round(fps)} fps for ${Math.round(cfg.downAfterMs / 1000)}s${failed ? `, so the next step up waits ${Math.round(s.upAfterMs / 1000)}s` : ''}` };
  }
  if (s.fastMs >= s.upAfterMs && i < TIERS.length - 1) {
    const from = s.tier;
    const waited = s.fastMs;
    s.tier = TIERS[i + 1];
    s.sinceUpMs = 0;
    governorSettle(s, cfg);
    return { from, to: s.tier, reason: `${Math.round(fps)} fps with headroom for ${Math.round(waited / 1000)}s` };
  }
  return null;
}
