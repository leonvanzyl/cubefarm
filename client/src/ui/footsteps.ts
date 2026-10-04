// The player's footsteps: a voice per surface (layout.ts's surfaceAt), built from sfx.ts's tone() and noise().
// Feet alternate, a touch lower and left then higher and right, and pitch, level and filter vary by about ±10%,
// so no two steps match. They sit well under every other sound: a minute of walking shouldn't get tiring.

import type { Surface } from '../world/layout';
import { createStepTracker, trackSteps, vary } from './footstepRules';
import { noise, tone } from './sfx';

/** One step's multipliers: pitch, level, filter brightness and length, plus its stereo position. */
interface Step {
  p: number;
  v: number;
  f: number;
  d: number;
  pan: number;
}

const VOICES: Record<Surface, (s: Step) => void> = {
  // A soft, slightly hollow knock: the heel, then the toe.
  wood: ({ p, v, f, d, pan }) => {
    tone({ freq: 165 * p, to: 110 * p, dur: 0.07 * d, peak: 0.028 * v, attack: 0.004, pan });
    noise({ dur: 0.06 * d, peak: 0.026 * v, freq: 650 * f, q: 0.8, attack: 0.003, pan });
    noise({ at: 0.05 * d, dur: 0.04 * d, peak: 0.012 * v, filter: 'bandpass', freq: 1300 * f, q: 1.2, attack: 0.003, pan });
  },
  // A muted, soft thump.
  rug: ({ p, v, f, d, pan }) => {
    noise({ dur: 0.11 * d, peak: 0.03 * v, freq: 260 * f, q: 0.6, attack: 0.012, pan });
    tone({ freq: 85 * p, to: 60 * p, dur: 0.08 * d, peak: 0.016 * v, attack: 0.01, pan });
  },
  // A brighter, crisper tap on the lobby's hard floor.
  lobby: ({ p, v, f, d, pan }) => {
    noise({ dur: 0.04 * d, peak: 0.02 * v, filter: 'bandpass', freq: 2400 * f, q: 1.3, attack: 0.0015, pan });
    noise({ dur: 0.05 * d, peak: 0.016 * v, freq: 900 * f, q: 0.8, attack: 0.002, pan });
    tone({ freq: 520 * p, to: 380 * p, type: 'triangle', dur: 0.03 * d, peak: 0.007 * v, attack: 0.002, pan });
  },
  // A dull metallic tonk: two inharmonic partials ring briefly over the elevator's steel floor.
  cabin: ({ p, v, f, d, pan }) => {
    tone({ freq: 196 * p, to: 186 * p, type: 'triangle', dur: 0.18 * d, peak: 0.018 * v, attack: 0.003, pan });
    tone({ freq: 296 * p, dur: 0.12 * d, peak: 0.007 * v, attack: 0.003, pan });
    noise({ dur: 0.05 * d, peak: 0.02 * v, freq: 420 * f, q: 0.7, attack: 0.003, pan });
  },
};

// How bright a scuff sounds on each surface.
const SCUFF: Record<Surface, number> = { wood: 1, rug: 0.55, lobby: 1.4, cabin: 0.85 };

const step: Step = { p: 1, v: 1, f: 1, d: 1, pan: 0 };

/** One footstep on a surface. Running is a touch louder, sharper and shorter. */
export function footstep(surface: Surface, running = false, foot: 0 | 1 = 0) {
  step.p = vary(Math.random()) * (foot ? 1.03 : 0.97) * (running ? 1.03 : 1);
  step.v = vary(Math.random()) * (running ? 1.2 : 1);
  step.f = vary(Math.random()) * (running ? 1.25 : 1);
  step.d = running ? 0.85 : 1;
  step.pan = foot ? 0.12 : -0.12;
  VOICES[surface](step);
}

/** The soft scuff of coming to a stop. */
export function scuff(surface: Surface) {
  const b = SCUFF[surface] * vary(Math.random());
  noise({ dur: 0.2, peak: 0.012 * vary(Math.random()), filter: 'bandpass', freq: 1100 * b, to: 450 * b, q: 0.7, attack: 0.05 });
}

const tracker = createStepTracker();

/** Called every frame with the head-bob phase and the surface underfoot; plays steps and the stopping scuff. */
export function footstepsFollow(bobPhase: number, moving: boolean, running: boolean, surface: Surface) {
  const what = trackSteps(tracker, bobPhase, moving);
  if (what === 'step') footstep(surface, running, tracker.foot);
  else if (what === 'scuff') scuff(surface);
}
