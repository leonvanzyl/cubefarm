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
  /** The floor's roomba: where it is and what it's doing (state is 'charging', 'leaving', 'cleaning', 'returning' or 'docking'). */
  roomba: ToyRoombaState | null;
}

export interface ToyRoombaState {
  x: number;
  z: number;
  state: string;
  /** 0-100 */
  battery: number;
  /** Doing its happy spin (E), and how many it has done since the floor loaded. */
  spinning: boolean;
  spins: number;
}

type Source = () => Omit<ToysSnapshot, 'held' | 'charging' | 'roomba'>;

let source: Source | null = null;
let roombaSource: (() => ToyRoombaState) | null = null;

/** The mounted toy world registers itself here; null when there is none (loading, failed, or between floors). */
export function setToySource(s: Source | null) {
  source = s;
}

/** The mounted roomba registers itself here; null when there is none. */
export function setRoombaSource(s: (() => ToyRoombaState) | null) {
  roombaSource = s;
}

function snapshot(): ToysSnapshot {
  const { held, chargeAt } = useStore.getState();
  let roomba: ToyRoombaState | null = null;
  try {
    roomba = roombaSource ? roombaSource() : null;
  } catch {
    // being torn down
  }
  const hands = { held, charging: chargeAt !== null, roomba };
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
