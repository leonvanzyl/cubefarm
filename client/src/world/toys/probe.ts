// window.__swarmToys: a read-only peek at the toys, for QA and Playwright (pointer lock doesn't work headless).
// Each read returns a fresh snapshot. Later toys (hoop score, darts, roomba) add fields here.

import { useStore, type Held } from '../../store';

export interface ToyBallState {
  id: string;
  x: number;
  y: number;
  z: number;
  sleeping: boolean;
}

export interface ToysSnapshot {
  balls: ToyBallState[];
  /** Rigid bodies in the current physics world (building + player pusher + toys). */
  bodies: number;
  /** What the player is carrying, e.g. { kind: 'ball', id: 'beach-ball' }. */
  held: Held | null;
  /** Whether a throw is being charged right now. */
  charging: boolean;
  /** This floor's basketball hoop: baskets scored here this session and the floor's best (kept across reloads). */
  hoop: HoopScore | null;
}

export interface HoopScore {
  score: number;
  best: number;
}

type Source = () => Omit<ToysSnapshot, 'held' | 'charging' | 'hoop'>;

let source: Source | null = null;
let hoop: (() => HoopScore) | null = null;

/** The mounted toy world registers itself here; null when there is none (loading, failed, or between floors). */
export function setToySource(s: Source | null) {
  source = s;
}

/** The mounted hoop registers its scoreboard here. */
export function setHoopSource(s: (() => HoopScore) | null) {
  hoop = s;
}

function snapshot(): ToysSnapshot {
  const { held, chargeAt } = useStore.getState();
  const hands = { held, charging: chargeAt !== null, hoop: hoop ? hoop() : null };
  try {
    if (source) return { ...source(), ...hands };
  } catch {
    // the world is being torn down; report it as empty
  }
  return { balls: [], bodies: 0, ...hands };
}

if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmToys')) {
  Object.defineProperty(window, '__swarmToys', { get: snapshot, enumerable: false, configurable: false });
}
