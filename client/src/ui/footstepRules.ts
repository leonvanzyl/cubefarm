// When the player's feet make a sound, kept free of WebAudio so it can be tested: a step each half head-bob
// cycle while moving (so the rate follows the bob and quickens when running), feet taking turns, and one scuff
// when you stop after walking. Standing still is silent.

export interface StepTracker {
  /** Half bob cycles counted so far. */
  half: number;
  /** Steps since the player last stood still. */
  walked: number;
  wasMoving: boolean;
  /** 0 = left, 1 = right: the foot of the last step. */
  foot: 0 | 1;
}

export const createStepTracker = (): StepTracker => ({ half: 0, walked: 0, wasMoving: false, foot: 1 });

/** Advance the tracker by one frame. Returns what to play, if anything. Never allocates. */
export function trackSteps(t: StepTracker, bobPhase: number, moving: boolean): 'step' | 'scuff' | null {
  const half = Math.floor(bobPhase / Math.PI);
  let out: 'step' | 'scuff' | null = null;
  if (moving && half !== t.half) {
    out = 'step';
    t.walked++;
    t.foot = t.foot === 0 ? 1 : 0;
  } else if (!moving && t.wasMoving && t.walked > 0) {
    out = 'scuff';
  }
  if (!moving) t.walked = 0;
  t.half = half;
  t.wasMoving = moving;
  return out;
}

/** A multiplier within ±10% of 1, from a random number in [0, 1). */
export const vary = (r: number) => 0.9 + r * 0.2;
