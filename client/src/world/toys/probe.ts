// window.__swarmToys: a read-only peek at the toys, for QA and Playwright (pointer lock doesn't work headless).
// Each read returns a fresh snapshot. Later toys (hoop score, darts, roomba) add fields here.
// window.__swarmGiveMug(sips): put a mug with that much coffee (0-3) in your hands, to test without brewing.

import { useStore, type Held } from '../../store';
import { dartCount, stuckDartCount } from './darts';
import { reactionCount } from './hits';
import { looseMugs, takeNewMug, type LooseMug } from './mugs';
import { sipping } from './sipping';
import { vacuumedCount } from './vacuum';

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
  /** The floor's roomba: where it is and what it's doing (state is 'charging', 'leaving', 'cleaning', 'returning' or 'docking'). */
  roomba: ToyRoombaState | null;
  /** Foam darts on this floor (flying, loose and stuck), and how many of them are stuck to something. */
  darts: number;
  dartsStuck: number;
  /** Times a seated person reacted to being hit by a ball or dart, and darts the roomba vacuumed, this session. */
  reactions: number;
  vacuumed: number;
  /** Coffee mugs lying loose on this floor, with the sips (0-3) left in each. A mug in hand shows in `held`. */
  mugs: LooseMug[];
  /** Whether a sip (or the last big gulp) of the mug in hand is under way. */
  sipping: boolean;
}

export interface HoopScore {
  score: number;
  best: number;
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

type Source = () => Omit<ToysSnapshot, 'held' | 'charging' | 'hoop' | 'roomba' | 'darts' | 'dartsStuck' | 'reactions' | 'vacuumed' | 'mugs' | 'sipping'>;

let source: Source | null = null;
let hoop: (() => HoopScore) | null = null;
let roombaSource: (() => ToyRoombaState) | null = null;

/** The mounted toy world registers itself here; null when there is none (loading, failed, or between floors). */
export function setToySource(s: Source | null) {
  source = s;
}

/** The mounted hoop registers its scoreboard here. */
export function setHoopSource(s: (() => HoopScore) | null) {
  hoop = s;
}

/** The mounted roomba registers itself here; null when there is none. */
export function setRoombaSource(s: (() => ToyRoombaState) | null) {
  roombaSource = s;
}

function safeMugs(): LooseMug[] {
  try {
    return looseMugs();
  } catch {
    return []; // being torn down
  }
}

function snapshot(): ToysSnapshot {
  const { held, chargeAt } = useStore.getState();
  let roomba: ToyRoombaState | null = null;
  try {
    roomba = roombaSource ? roombaSource() : null;
  } catch {
    // being torn down
  }
  const hands = { held, charging: chargeAt !== null, hoop: hoop ? hoop() : null, roomba, darts: dartCount(), dartsStuck: stuckDartCount(), reactions: reactionCount(), vacuumed: vacuumedCount(), mugs: safeMugs(), sipping: sipping() };
  try {
    if (source) return { ...source(), ...hands };
  } catch {
    // the world is being torn down; report it as empty
  }
  return { balls: [], bodies: 0, ...hands };
}

if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmToys')) {
  Object.defineProperty(window, '__swarmToys', { get: snapshot, enumerable: false, configurable: false });
  Object.defineProperty(window, '__swarmGiveMug', { value: (sips = 0) => takeNewMug(sips), enumerable: false, configurable: false });
}
