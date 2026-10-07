// Room acoustics as pure decisions (no WebAudio, so they're unit tested): which kind of space a point is in, what each
// space's echo sounds like (the impulse responses roomSfx.ts writes into its convolvers), how much of each sound group
// goes into the room, when to move the reverb to a new room, and how much the walls between a sound and you muffle it.

import { CEO_ROOM, ELEVATOR, HALF_D, HALF_W, MANAGER_ROOM, WALL_T, type Rect, type Side } from '../world/layout';
import type { SoundGroup } from './audioPrefs';
import { MAX_DISTANCE } from './sfxMix';

type FloorKind = 'office' | 'lobby' | 'roof';

/** The kinds of space that sound different. Balconies, the lobby's patio and the roof are 'outside'. */
export type Room = 'lobby' | 'office' | 'kitchen' | 'cabin' | 'outside';
export const ROOMS: readonly Room[] = ['lobby', 'office', 'kitchen', 'cabin', 'outside'];

/**
 * The enclosure a point is in, for occlusion: an office floor's open plan (the desks and the kitchenette) is one
 * space, the elevator cabin, each balcony and the lobby's two glass offices are others.
 */
export type Zone = 'floor' | 'cabin' | Side | 'manager' | 'ceo';

const inRect = (r: Pick<Rect, 'minX' | 'maxX' | 'minZ' | 'maxZ'>, x: number, z: number, grow = 0) => x >= r.minX - grow && x <= r.maxX + grow && z >= r.minZ - grow && z <= r.maxZ + grow;

/** Past the elevator doorway, inside the cabin. */
const inCabin = (x: number, z: number) => z > HALF_D + 0.2 && Math.abs(x) < ELEVATOR.cabinHalf + 0.3;
/** Past the middle of a side wall: out on a balcony (or the patio). */
const outside = (x: number) => Math.abs(x) > HALF_W + WALL_T / 2;
/** The kitchenette: the east wall's corner past the side door, by the counter and fridge. */
const KITCHEN = { minX: HALF_W - 3.4, maxX: HALF_W, minZ: 4.5, maxZ: HALF_D };

/** The kind of space at (x, z) on a floor of `kind`. The lobby's glass offices are carpeted like an office floor. */
export function roomAt(kind: FloorKind, x: number, z: number): Room {
  if (inCabin(x, z)) return 'cabin';
  if (outside(x) || kind === 'roof') return 'outside';
  if (kind === 'lobby') return inRect(MANAGER_ROOM, x, z) || inRect(CEO_ROOM, x, z) ? 'office' : 'lobby';
  if (inRect(KITCHEN, x, z)) return 'kitchen';
  return 'office';
}

/** The enclosure at (x, z), for occlusion. */
export function zoneAt(kind: FloorKind, x: number, z: number): Zone {
  if (inCabin(x, z)) return 'cabin';
  if (kind === 'roof') return 'floor'; // the whole deck is one open space
  if (outside(x)) return x < 0 ? 'west' : 'east';
  if (kind === 'lobby' && inRect(MANAGER_ROOM, x, z)) return 'manager';
  if (kind === 'lobby' && inRect(CEO_ROOM, x, z)) return 'ceo';
  return 'floor';
}

// ---------- each room's echo ----------

export interface RoomSound {
  /** The impulse's length (s) and how long its tail takes to fall 60 dB. */
  length: number;
  rt60: number;
  /** Silence before the tail (s): how far away the walls are. */
  predelay: number;
  /** How bright the tail stays as it fades: 0 dark (carpet, soft chairs) to 1 bright (glass, tiles). */
  brightness: number;
  /** Early reflections off the nearest walls: [seconds, level against the tail's start]. */
  early: readonly (readonly [number, number])[];
  /** One distinct far echo, [seconds, level]: the lobby's far glass wall, the city across the street. */
  echo?: readonly [number, number];
  /** How much of the room you hear: the reverb's return level. */
  wet: number;
}

export const ROOM_SOUND: Record<Room, RoomSound> = {
  // big and glassy: a long, bright tail and a little echo off the far wall
  lobby: { length: 2, rt60: 1.4, predelay: 0.022, brightness: 0.8, early: [[0.031, 1.6], [0.047, 1.2], [0.083, 1]], echo: [0.19, 4], wet: 0.3 },
  // carpet and desks soak it up: short and dark
  office: { length: 0.8, rt60: 0.5, predelay: 0.01, brightness: 0.3, early: [[0.012, 1.2], [0.021, 0.9], [0.034, 0.6]], wet: 0.13 },

  // tiles and steel: short, but bright and ringing
  kitchen: { length: 1, rt60: 0.75, predelay: 0.004, brightness: 0.95, early: [[0.005, 2], [0.009, 1.6], [0.013, 1.3], [0.019, 1]], wet: 0.24 },
  // a metal box: very short and boxy, reflections crowding in
  cabin: { length: 0.35, rt60: 0.2, predelay: 0.002, brightness: 0.6, early: [[0.003, 2.4], [0.0047, 2], [0.0068, 1.7], [0.0091, 1.4], [0.012, 1.1]], wet: 0.3 },
  // open air: almost dry, with the city answering from across the street
  outside: { length: 0.75, rt60: 0.12, predelay: 0.004, brightness: 0.7, early: [[0.006, 0.8]], echo: [0.41, 2.2], wet: 0.12 },
};

/**
 * Writes a room's impulse response at `rate` Hz, one buffer per channel (the channels' noise differs, for width):
 * an exponentially fading noise tail that darkens as it fades, early reflections and an echo as short bursts, scaled so
 * each channel carries unit energy (the convolver neither boosts nor cuts a steady sound; `wet` sets how much is heard).
 */
export function fillImpulse(spec: RoomSound, rate: number, rand: () => number, channels = 2): Float32Array[] {
  const n = Math.max(1, Math.round(spec.length * rate));
  const out: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) {
    const data = new Float32Array(n);
    const start = Math.round(spec.predelay * rate);
    // the tail: noise through a one-pole lowpass that closes as the tail fades
    let lp = 0;
    for (let i = start; i < n; i++) {
      const t = (i - start) / rate;
      const fade = Math.min(1, t / spec.rt60);
      const open = (0.15 + 0.85 * spec.brightness) * (1 - fade) + (0.03 + 0.4 * spec.brightness) * fade;
      lp += open * (rand() * 2 - 1 - lp);
      data[i] = lp * Math.exp((-6.91 * t) / spec.rt60);
    }
    const burst = (at: number, level: number, ms: number, dark: number) => {
      const from = Math.round((at + (ch % 2) * 0.0006) * rate);
      const len = Math.max(1, Math.round((ms / 1000) * rate));
      let b = 0;
      for (let k = 0; k < len && from + k < n; k++) {
        b += dark * (rand() * 2 - 1 - b);
        data[from + k] += (level * b * Math.exp((-5 * k) / len)) / Math.sqrt(dark);
      }
    };
    // Levels are against the tail's start (its lowpassed noise is about 0.35 at full brightness).
    for (const [at, level] of spec.early) burst(at, level * 0.35, 2.5, 0.6 + 0.4 * spec.brightness);
    if (spec.echo) burst(spec.echo[0], spec.echo[1] * 0.35, 30, 0.25);
    let energy = 0;
    for (const v of data) energy += v * v;
    const k = energy > 0 ? 1 / Math.sqrt(energy) : 0;
    for (let i = 0; i < n; i++) data[i] *= k;
    out.push(data);
  }
  return out;
}

// ---------- the sends ----------

/** How much of each group goes into the room: none for messages read aloud (your phone) or the outside's own air. */
export const ROOM_SENDS: Record<SoundGroup, number> = { steps: 1, typing: 0.8, babble: 0.7, toys: 1, alerts: 0.5, music: 0.6, voice: 0, outside: 0, score: 0.35 };

// ---------- moving between rooms ----------

/** A room change waits this long (s), so walking along the line between two rooms doesn't flicker. */
export const SETTLE = 0.25;
/** Seconds the reverb takes to cross-fade from one room to the next. */
export const FADE = 0.8;

export interface RoomTracker {
  /** The room the reverb is in (null before the first). */
  room: Room | null;
  /** A room the listener has moved into, since when (s). */
  pending: Room | null;
  since: number;
  /** When the last cross-fade ends (s): the next waits for it, since it reuses the convolver fading out. */
  fadeUntil: number;
}

export const newRoomTracker = (): RoomTracker => ({ room: null, pending: null, since: 0, fadeUntil: 0 });

/** Steps the tracker with the room the listener is in at `now` (s). Returns the room to cross-fade to now, or null. */
export function trackRoom(st: RoomTracker, here: Room, now: number): Room | null {
  if (st.room === null) {
    st.room = here;
    st.pending = null;
    return here;
  }
  if (here === st.room) {
    st.pending = null;
    return null;
  }
  if (st.pending !== here) {
    st.pending = here;
    st.since = now;
  }
  if (now - st.since < SETTLE || now < st.fadeUntil) return null;
  st.room = here;
  st.pending = null;
  st.fadeUntil = now + FADE;
  return here;
}

// ---------- occlusion ----------

/** What the walls between a sound and you do to it: its gain and a lowpass cutoff (Hz). */
export interface Occlusion {
  gain: number;
  cutoff: number;
}

/** A glass office wall with its doorway, or the elevator's doorway: a little quieter and duller. */
export const GLASS: Occlusion = { gain: 0.6, cutoff: 2400 };
/** An outside wall with its side door shut, and with it wide open. */
export const WALL: Occlusion = { gain: 0.35, cutoff: 700 };
export const DOOR: Occlusion = { gain: 0.8, cutoff: 3600 };

/** The barrier between a zone and the open floor (the hub every other zone opens onto). */
function barrier(zone: Zone, open: Readonly<Record<Side, number>>): Occlusion | null {
  if (zone === 'floor') return null;
  if (zone === 'west' || zone === 'east') {
    const k = Math.min(1, Math.max(0, open[zone]));
    return { gain: WALL.gain + (DOOR.gain - WALL.gain) * k, cutoff: WALL.cutoff * (DOOR.cutoff / WALL.cutoff) ** k };
  }
  return GLASS;
}

/**
 * How the walls muffle a sound in zone `sound` for a listener in zone `listener`, `d` metres away, with each side door
 * `open` 0-1. Null in the same space. One barrier between (a glass wall, the elevator doorway, a side door) or two
 * (across the floor from one to another, much duller); the further away, the duller still. A cheap stand-in for
 * raycasting each sound.
 */
export function occlusion(listener: Zone, sound: Zone, d: number, open: Readonly<Record<Side, number>>): Occlusion | null {
  if (listener === sound) return null;
  const a = barrier(listener, open);
  const b = barrier(sound, open);
  const gain = (a?.gain ?? 1) * (b?.gain ?? 1);
  const cutoff = Math.min(a?.cutoff ?? Infinity, b?.cutoff ?? Infinity) * (a && b ? 0.6 : 1);
  return { gain, cutoff: cutoff * (1 - 0.4 * Math.min(1, Math.max(0, d) / MAX_DISTANCE)) };
}
