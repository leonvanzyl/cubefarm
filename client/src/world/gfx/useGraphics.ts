import { create } from 'zustand';
import { DEFAULT_PRESET, effectNames, GRAPHICS_PRESETS, governorSample, governorSettle, newGovernor, normalizePreset, type GovernorChange, type GraphicsPreset, type Tier } from './quality';

// The viewer's graphics quality (Help → Graphics, saved per browser) and, on Auto, the tier the governor (quality.ts)
// has settled on, fed by perf.tsx's frame-rate samples. Graphics.tsx draws the tier; Effects.tsx reports when its
// post-processing is on screen, or that it couldn't start (then the office draws as on Low for the rest of the session).
// window.__swarmGfx reports the tier, Auto's decisions and the active effects, for QA.

const KEY = 'cubefarm:graphics';

function loadPreset(): GraphicsPreset {
  try {
    return normalizePreset(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_PRESET;
  }
}

interface GfxState {
  preset: GraphicsPreset;
  /** The tier to draw: the preset, or Auto's choice. */
  tier: Tier;
  /** The tier whose post-processing is on screen (it loads lazily): 'low' until then. */
  shown: Tier;
  /** Why the effects are off for this session (no float render targets, the chunk failed to load); null when fine. */
  blocked: string | null;
}

export interface GfxDecision extends GovernorChange {
  at: number;
}

const governor = newGovernor('high');
const decisions: GfxDecision[] = [];
let lastSample: { fps: number; ms: number } | null = null;
/** What the running effects report about themselves (Effects.tsx): passes, blooming meshes, samples. */
let pipelineStats: Record<string, unknown> | null = null;

const initial = loadPreset();
export const useGfx = create<GfxState>(() => ({ preset: initial, tier: initial === 'auto' ? governor.tier : initial, shown: 'low', blocked: null }));

/** The tier actually in force: Low whenever the effects are blocked. */
export const effectiveTier = (s: GfxState): Tier => (s.blocked ? 'low' : s.tier);

export function setGraphicsPreset(raw: GraphicsPreset) {
  const preset = normalizePreset(raw);
  try {
    localStorage.setItem(KEY, preset);
  } catch {
    // storage may be unavailable (private mode); the setting just won't be remembered
  }
  // Auto starts over at High each time it's picked.
  if (preset === 'auto' && useGfx.getState().preset !== 'auto') Object.assign(governor, newGovernor('high'));
  useGfx.setState({ preset, tier: preset === 'auto' ? governor.tier : preset });
}

function decide(change: GovernorChange | null) {
  if (!change) return;
  decisions.push({ at: Date.now(), ...change });
  if (decisions.length > 20) decisions.shift();
  useGfx.setState({ tier: governor.tier });
}

/** One frame-rate sample from perf.tsx (sampled only on Auto): the average fps over the last `ms` of drawing. */
export function reportFrameRate(fps: number, ms: number) {
  lastSample = { fps: Math.round(fps * 10) / 10, ms: Math.round(ms) };
  const s = useGfx.getState();
  if (s.preset !== 'auto' || s.blocked) return;
  // While a tier's effects are still loading, the frames on screen are another tier's: don't judge it on them.
  if (s.shown !== effectiveTier(s) && effectiveTier(s) !== 'low') {
    governorSettle(governor);
    return;
  }
  decide(governorSample(governor, fps, ms));
}

/** The view stopped drawing (a panel, a hidden tab): the next frames are no measure of anything. */
export function gfxPaused() {
  governorSettle(governor);
}

/** Effects.tsx: this tier's post-processing is drawing now (or 'low': it stopped). */
export function gfxShown(tier: Tier) {
  governorSettle(governor);
  if (useGfx.getState().shown !== tier) useGfx.setState({ shown: tier });
}

/** The effects can't run here: draw as on Low for the rest of the session. */
export function gfxBlocked(reason: string, err?: unknown) {
  if (useGfx.getState().blocked) return;
  console.warn(`Graphics effects are switched off: ${reason}.`, err ?? '');
  useGfx.setState({ blocked: reason, shown: 'low' });
}

export function setPipelineStats(stats: Record<string, unknown> | null) {
  pipelineStats = stats;
}

/** A short label for ?stats: "high", "auto: medium", "low (blocked)". */
export function gfxLabel() {
  const s = useGfx.getState();
  const tier = effectiveTier(s);
  return s.blocked ? `${tier} (effects off)` : s.preset === 'auto' ? `auto: ${tier}` : tier;
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__swarmGfx = {
    get preset() {
      return useGfx.getState().preset;
    },
    set preset(p: GraphicsPreset) {
      if (GRAPHICS_PRESETS.includes(p)) setGraphicsPreset(p);
    },
    /** The tier in force, and the one whose post-processing is on screen (they differ while it loads). */
    get tier() {
      return effectiveTier(useGfx.getState());
    },
    get shown() {
      return useGfx.getState().shown;
    },
    get effects() {
      return effectNames(effectiveTier(useGfx.getState()));
    },
    get blocked() {
      return useGfx.getState().blocked;
    },
    /** Auto's last 20 steps, oldest first. */
    get decisions() {
      return decisions.map((d) => ({ ...d }));
    },
    get governor() {
      return { ...governor };
    },
    get fps() {
      return lastSample;
    },
    get pipeline() {
      return pipelineStats;
    },
    /** Feeds Auto `seconds` of half-second samples at `fps`, as if frames had been that slow (or fast). */
    simulate(fps: number, seconds: number) {
      for (let t = 0; t < seconds * 1000; t += 500) reportFrameRate(fps, 500);
      return effectiveTier(useGfx.getState());
    },
  };
}
