import { ROOMBA, type RoombaMove, type RoombaState } from './roombaBrain';

// What the roomba's motor and brush hum should sound like right now, and when its bumper may bonk again. Pure, so
// RoombaSounds.tsx only turns these numbers into WebAudio parameters.

export interface Hum {
  /** 0-1, before distance: 0 is off. */
  level: number;
  /** Pitch multiplier on the motor's base frequency (1 at full cleaning speed). */
  pitch: number;
}

/** Beyond this the hum is switched off altogether (and from HUM_NEAR it fades towards it): it's a quiet, close sound. */
export const HUM_FAR = 8;
const HUM_NEAR = 3;
/** Shortest gap between two bonks, in seconds. */
export const BUMP_GAP = 0.4;

/** The hum for a roomba in this state, move and speed (m/s). Writes into `out` so the caller can reuse it every frame. */
export function humFor(state: RoombaState, move: RoombaMove, speed: number, out: Hum): Hum {
  if (state === 'charging' && move !== 'spin') {
    out.level = 0;
    out.pitch = 0.8;
    return out;
  }
  if (move === 'spin') {
    // the happy spin: busy, a little higher
    out.level = 0.85;
    out.pitch = 1.08;
    return out;
  }
  if (move === 'idle' || move === 'wait') {
    // parked or waiting for the player: off
    out.level = 0;
    out.pitch = 0.8;
    return out;
  }
  const f = Math.min(1, speed / ROOMBA.speed);
  if (move === 'turn' || f < 0.02) {
    // turning on the spot (every other move that isn't getting anywhere is turning too): a touch lower and steadier
    out.level = 0.6;
    out.pitch = 0.9;
    return out;
  }
  out.level = 0.45 + 0.55 * f;
  out.pitch = 0.8 + 0.2 * f;
  return out;
}

/** Extra fade on top of the panner's distance model, so the hum only carries a few metres (1 close by, 0 from HUM_FAR). */
export function humReach(distance: number) {
  if (distance <= HUM_NEAR) return 1;
  if (distance >= HUM_FAR) return 0;
  const t = (distance - HUM_NEAR) / (HUM_FAR - HUM_NEAR);
  return (1 - t) * (1 - t);
}

/** Whether a bonk at `now` (seconds) may play after the last one at `last`. */
export const bumpAllowed = (last: number, now: number) => now - last >= BUMP_GAP;
