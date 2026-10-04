import { useFrame } from '@react-three/fiber';
import { create } from 'zustand';
import { DAY_MODES, dayPhase, DEFAULT_DAY_MODE, parseDaytimeParam, parseDayMode, type DayMode } from './time';

// The office's shared time of day. Things that move with it read `dayTime.t` in their useFrame (DayClock
// advances it once per frame, so nothing re-renders per frame); HTML and anything else that only needs a
// rough time uses useDayTime(), whose `t` changes about once a minute. The viewer's mode is saved per browser.
// QA: `?daytime=0.73` freezes the phase; window.__swarmSky reads and moves it.

const MODE_KEY = 'cubefarm:daytime';
const COARSE_MS = 60_000;

function loadMode(): DayMode {
  try {
    return parseDayMode(localStorage.getItem(MODE_KEY));
  } catch {
    return DEFAULT_DAY_MODE;
  }
}

function urlFrozen(): number | null {
  try {
    return parseDaytimeParam(window.location.search);
  } catch {
    return null;
  }
}

/** The live clock (a mutable ref): `t` is the phase this frame, `frozen` holds it still when set. */
export const dayTime: { t: number; mode: DayMode; frozen: number | null } = { t: 0, mode: loadMode(), frozen: urlFrozen() };

/** Moves `dayTime.t` to now and returns it. */
export function sampleDayTime(now = Date.now()): number {
  dayTime.t = dayTime.frozen ?? dayPhase(now, dayTime.mode);
  return dayTime.t;
}
sampleDayTime();

const useCoarse = create<{ t: number; mode: DayMode }>(() => ({ t: dayTime.t, mode: dayTime.mode }));

function publish() {
  useCoarse.setState({ t: sampleDayTime(), mode: dayTime.mode });
}
if (typeof window !== 'undefined') setInterval(publish, COARSE_MS);

/** The live clock to read in useFrame, plus a coarse `t` and the mode for React (re-renders about once a minute). */
export function useDayTime() {
  const { t, mode } = useCoarse();
  return { clock: dayTime, t, mode };
}

export function setDayMode(mode: DayMode) {
  dayTime.mode = mode;
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // storage may be unavailable (private mode); the setting just won't be remembered
  }
  publish();
}

/** Mounted once inside the Canvas: advances the clock before the frame draws. */
export function DayClock() {
  useFrame(() => {
    sampleDayTime();
  });
  return null;
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__swarmSky = {
    get t() {
      return sampleDayTime();
    },
    get mode() {
      return dayTime.mode;
    },
    set mode(m: DayMode) {
      if (DAY_MODES.includes(m)) setDayMode(m);
    },
    /** Jumps to phase t and holds it there (freeze(false) lets the clock run again). */
    set(t: number) {
      if (!Number.isFinite(t)) return;
      dayTime.frozen = t - Math.floor(t);
      publish();
    },
    /** Holds the current phase (true) or lets the viewer's mode drive it again (false). */
    freeze(on: boolean) {
      dayTime.frozen = on ? sampleDayTime() : null;
      publish();
    },
  };
}
