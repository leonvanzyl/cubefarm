// Which office this device gets: the 3D one, or pocket mode (2D, for phones and touch screens; docs/pocket.md).
// ?pocket=1 / ?pocket=0 decide for one visit; a choice made in the app is remembered on this device.
import { create } from 'zustand';

export type ViewMode = 'pocket' | 'office';

const KEY = 'cubefarm:mode';

/** The mode to start in: the URL's say, then this device's last choice, then pocket on narrow or touch-only screens. */
export function pickMode(x: { param: string | null; saved: string | null; narrow: boolean; touch: boolean }): ViewMode {
  if (x.param !== null) return x.param === '0' || x.param === 'false' ? 'office' : 'pocket';
  if (x.saved === 'pocket' || x.saved === 'office') return x.saved;
  return x.narrow || x.touch ? 'pocket' : 'office';
}

function startMode(): ViewMode {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    // no storage: decide from the screen
  }
  return pickMode({
    param: new URLSearchParams(location.search).get('pocket'),
    saved,
    narrow: matchMedia('(max-width: 760px)').matches,
    touch: matchMedia('(hover: none) and (pointer: coarse)').matches,
  });
}

export const useMode = create<{ mode: ViewMode }>(() => ({ mode: typeof window === 'undefined' ? 'office' : startMode() }));

/** Switches this device to `mode` and remembers it. */
export function setMode(mode: ViewMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // remembered for this visit only
  }
  useMode.setState({ mode });
}
