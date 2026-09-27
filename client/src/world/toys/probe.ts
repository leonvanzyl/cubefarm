// window.__swarmToys: a read-only peek at the toys, for QA and Playwright (pointer lock doesn't work headless).
// Each read returns a fresh snapshot. Later toys (held item, hoop score, darts, roomba) add fields here.

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
}

type Source = () => ToysSnapshot;

let source: Source | null = null;

/** The mounted toy world registers itself here; null when there is none (loading, failed, or between floors). */
export function setToySource(s: Source | null) {
  source = s;
}

function snapshot(): ToysSnapshot {
  try {
    if (source) return source();
  } catch {
    // the world is being torn down; report it as empty
  }
  return { balls: [], bodies: 0 };
}

if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmToys')) {
  Object.defineProperty(window, '__swarmToys', { get: snapshot, enumerable: false, configurable: false });
}
