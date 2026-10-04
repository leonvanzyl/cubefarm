import { trackSteps, type StepTracker } from '../../ui/footstepRules';
import type { Surface } from '../layout';

// When the dog makes a sound, kept free of WebAudio so it can be tested: a woof or bark at most every so often, a
// breath of panting on a beat while it's out of breath, and its claws tapping on hard floors (not rugs) with each paw,
// using the footsteps' own step tracker and surfaces. DogSounds.tsx turns these into sounds, all quiet.

/** Shortest gap between two woofs, barks or yips (s). */
export const VOICE_GAP = 1.2;
/** Between two breaths of panting (s), and two claw taps (s): a gallop's taps are thinned out. */
export const PANT_GAP = 0.32;
export const TAP_GAP = 0.11;
/** Beyond this (m) its little sounds (claws, panting, sniffing) aren't played at all. */
export const HEAR = 9;

export const mayVoice = (last: number, now: number) => now - last >= VOICE_GAP;

/** How loud claws are on a surface: not at all on a rug, brightest on the lobby's tiles. */
export function clawLevel(surface: Surface): number {
  switch (surface) {
    case 'rug':
      return 0;
    case 'lobby':
      return 1.2;
    case 'cabin':
      return 0.9;
    default:
      return 1;
  }
}

/** Whether a paw comes down this frame: four a stride (the gait's phase in radians), as the footsteps count them. */
export const pawDown = (t: StepTracker, phase: number, moving: boolean) => trackSteps(t, phase * 2, moving) === 'step';

/** Whether a claw tap plays: a paw came down on a hard floor, near enough, and not too soon after the last. */
export const tapDue = (paw: boolean, surface: Surface, distance: number, last: number, now: number) => paw && clawLevel(surface) > 0 && distance < HEAR && now - last >= TAP_GAP;

/** Whether a breath of panting plays now. */
export const pantDue = (panting: boolean, distance: number, last: number, now: number) => panting && distance < HEAR && now - last >= PANT_GAP;
