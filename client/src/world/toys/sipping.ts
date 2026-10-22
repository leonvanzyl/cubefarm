import { useStore } from '../../store';
import { noise, tone, type Vec3 } from '../../ui/sfx';
import { dropMug } from './mugs';
import type { SnackCue } from '../fridge';
import { biteFor, cuesDue, planFor, pose, snackFor, type SipCue, type SipPlan } from './sip';

// Drinking the coffee in your hands: E starts a sip (Player.tsx), Player ticks it every frame, and the first-person
// mug (MugToys.tsx) and the camera read `sipPose`. The timings are in sip.ts. Outside the lazily loaded toy chunk, so
// sips still count down when the physics engine isn't there; walking carries on throughout. A sausage from the roof's
// grill is eaten the same way, bite by bite (roof/HeldSausage.tsx draws it), and a snack from the fridge sip by sip or
// bite by bite, with its own sounds (HeldSnack.tsx draws it).

let sip: { plan: SipPlan; mugId: string; start: number; next: number } | null = null;

/** The current sip's pose, written by tickSip each frame: lift 0-1, the mug's tip and the view's tilt back (radians). */
export const sipPose = { lift: 0, tilt: 0, head: 0 };

const TOYS = { group: 'toys' } as const;

const sounds: Record<SipCue, (pos?: Vec3) => void> = {
  slurp: (pos) => {
    noise({ ...TOYS, pos, name: 'mug-sip', dur: 0.2, peak: 0.05, filter: 'bandpass', freq: 900, to: 2600, q: 3, attack: 0.03 });
    tone({ ...TOYS, pos, name: 'mug-sip', freq: 320, to: 540, type: 'triangle', dur: 0.16, peak: 0.02, attack: 0.02 });
  },
  mm: (pos) => {
    tone({ ...TOYS, pos, name: 'mug-mm', freq: 196, to: 175, dur: 0.34, peak: 0.07, attack: 0.04 });
    tone({ ...TOYS, pos, name: 'mug-mm', freq: 392, to: 350, type: 'triangle', dur: 0.3, peak: 0.012, attack: 0.04 });
  },
  gulp: (pos) => {
    for (let i = 0; i < 3; i++) tone({ ...TOYS, pos, name: 'mug-gulp', freq: 280 - i * 30, to: 110, at: i * 0.24, dur: 0.15, peak: 0.09, attack: 0.01 });
    noise({ ...TOYS, pos, name: 'mug-gulp', dur: 0.7, peak: 0.025, filter: 'lowpass', freq: 500, attack: 0.08 });
  },
  ahh: (pos) => {
    noise({ ...TOYS, pos, name: 'mug-ahh', dur: 0.65, peak: 0.07, filter: 'bandpass', freq: 1200, to: 700, q: 1.3, attack: 0.05 });
    tone({ ...TOYS, pos, name: 'mug-ahh', freq: 230, to: 165, type: 'triangle', dur: 0.6, peak: 0.035, attack: 0.06 });
  },
  chomp: (pos) => {
    noise({ ...TOYS, pos, name: 'sausage-bite', dur: 0.09, peak: 0.08, filter: 'bandpass', freq: 2400, to: 1100, q: 1.4, attack: 0.003 });
    tone({ ...TOYS, pos, name: 'sausage-bite', freq: 150, to: 90, dur: 0.08, peak: 0.05, attack: 0.004 });
  },
  munch: (pos) => {
    for (let i = 0; i < 3; i++) noise({ ...TOYS, pos, name: 'sausage-munch', at: i * 0.16, dur: 0.1, peak: 0.035, filter: 'lowpass', freq: 900, attack: 0.01 });
  },
  // ---- snacks from the fridge (fridge.ts says which of these each one makes) ----
  // a can's tab: a click and a burst of escaping fizz
  pssht: (pos) => {
    tone({ ...TOYS, pos, name: 'snack-pssht', freq: 2600, to: 1900, type: 'triangle', dur: 0.025, peak: 0.03, attack: 0.002 });
    noise({ ...TOYS, pos, name: 'snack-pssht', at: 0.02, dur: 0.38, peak: 0.07, filter: 'highpass', freq: 3200, to: 6500, q: 0.7, attack: 0.008 });
  },
  // a bottle's cap: two plastic clicks and a short hiss
  twist: (pos) => {
    for (const at of [0, 0.09]) noise({ ...TOYS, pos, name: 'snack-twist', at, dur: 0.03, peak: 0.05, filter: 'bandpass', freq: 3200, q: 3, attack: 0.002 });
    noise({ ...TOYS, pos, name: 'snack-twist', at: 0.12, dur: 0.18, peak: 0.025, filter: 'highpass', freq: 4000, attack: 0.01 });
  },
  // a wrapper: a few crinkly bursts
  rustle: (pos) => {
    for (const at of [0, 0.07, 0.15, 0.26]) noise({ ...TOYS, pos, name: 'snack-rustle', at, dur: 0.06, peak: 0.04, filter: 'bandpass', freq: 4200 - at * 3000, q: 0.9, attack: 0.004 });
  },
  // string cheese pulled out of its film: a rising tear
  peel: (pos) => {
    noise({ ...TOYS, pos, name: 'snack-peel', dur: 0.26, peak: 0.035, filter: 'bandpass', freq: 1800, to: 5200, q: 2, attack: 0.02 });
  },
  // a square of chocolate breaking off: a crisp crack
  snap: (pos) => {
    noise({ ...TOYS, pos, name: 'snack-snap', dur: 0.04, peak: 0.08, filter: 'highpass', freq: 2500, attack: 0.002 });
    tone({ ...TOYS, pos, name: 'snack-snap', freq: 900, to: 600, type: 'triangle', dur: 0.035, peak: 0.03, attack: 0.002 });
  },
  // a soft bite (the cheese)
  nom: (pos) => {
    tone({ ...TOYS, pos, name: 'snack-nom', freq: 260, to: 180, dur: 0.1, peak: 0.05, attack: 0.01 });
    noise({ ...TOYS, pos, name: 'snack-nom', dur: 0.08, peak: 0.03, filter: 'lowpass', freq: 650, attack: 0.008 });
  },
  // a dense, chewy bar
  chew: (pos) => {
    for (let i = 0; i < 4; i++) noise({ ...TOYS, pos, name: 'snack-chew', at: i * 0.17, dur: 0.12, peak: 0.03, filter: 'lowpass', freq: 520, attack: 0.02 });
    tone({ ...TOYS, pos, name: 'snack-chew', freq: 130, to: 110, dur: 0.6, peak: 0.015, attack: 0.05 });
  },
  // bubbles on the tongue
  fizz: (pos) => {
    noise({ ...TOYS, pos, name: 'snack-fizz', dur: 0.6, peak: 0.022, filter: 'highpass', freq: 5200, attack: 0.04 });
  },
  // the last of a bottle: hollow glugs
  glug: (pos) => {
    for (let i = 0; i < 3; i++) {
      tone({ ...TOYS, pos, name: 'snack-glug', freq: 250 - i * 25, to: 130, type: 'triangle', at: i * 0.22, dur: 0.14, peak: 0.08, attack: 0.01 });
      noise({ ...TOYS, pos, name: 'snack-glug', at: i * 0.22, dur: 0.12, peak: 0.02, filter: 'bandpass', freq: 700, q: 4, attack: 0.01 });
    }
  },
  // the empty can squashed in your hand
  crunch: (pos) => {
    for (const at of [0, 0.06, 0.13]) noise({ ...TOYS, pos, name: 'snack-crunch', at, dur: 0.09, peak: 0.07, filter: 'bandpass', freq: 1900 + at * 4000, q: 0.8, attack: 0.003 });
    tone({ ...TOYS, pos, name: 'snack-crunch', freq: 2100, to: 1500, type: 'square', dur: 0.12, peak: 0.01, attack: 0.003 });
  },
  drink: () => undefined,
  drop: () => undefined,
};

/** A dropped mug landing: a short ceramic clunk at `pos`, `peak` loud (from sip.ts's clunkPeak). */
export function clunk(pos: Vec3, peak: number) {
  tone({ ...TOYS, pos, name: 'mug-clunk', freq: 1150, to: 880, type: 'triangle', dur: 0.08, peak: peak * 0.6, attack: 0.002 });
  tone({ ...TOYS, pos, name: 'mug-clunk', freq: 2350, dur: 0.12, peak: peak * 0.2, attack: 0.002 });
  noise({ ...TOYS, pos, name: 'mug-clunk', dur: 0.05, peak: peak * 0.8, filter: 'lowpass', freq: 650, attack: 0.002 });
}

/** Someone else's sip (an agent on a coffee break), heard from where they stand. */
export const slurpAt = (pos: Vec3) => sounds.slurp(pos);

/** One of a snack's sounds (fridge.ts), from someone else's hands at `pos` (an agent on a snack break). */
export const snackSoundAt = (cue: SnackCue, pos: Vec3) => sounds[cue](pos);

/** E with coffee in hand: start a sip (or the big last gulp); with a sausage, a bite; with a snack, either. Does nothing mid-sip or without one. */
export function sipCoffee(now = performance.now()): boolean {
  const held = useStore.getState().held;
  if (sip || !held) return false;
  const plan = held.kind === 'mug' ? planFor(held.sips) : held.kind === 'sausage' ? biteFor(held.bites) : held.kind === 'snack' ? snackFor(held.snack, held.left) : null;
  if (!plan) return false;
  sip = { plan, mugId: held.id, start: now, next: 0 };
  return true;
}

/** Whether a sip is under way. */
export const sipping = () => sip !== null;

/** Move the current sip along: play its cues, take the sip off the mug, let go of an empty one. Called every frame. */
export function tickSip(now = performance.now()) {
  if (!sip) return;
  const s = useStore.getState();
  // The mug (sausage, snack) left your hands some other way (G, a panel, the machine): the sip is off.
  if (s.held?.id !== sip.mugId) return endSip();
  const { plan } = sip;
  const t = (now - sip.start) / 1000;
  const to = cuesDue(plan, sip.next, t);
  for (let i = sip.next; i < to; i++) {
    const cue = plan.cues[i].cue;
    sounds[cue]();
    const held = useStore.getState().held;
    if (held?.kind === 'sausage' || held?.kind === 'snack') {
      if (cue === 'drink') s.setHeld(held.kind === 'snack' ? { ...held, left: Math.max(0, held.left - 1) } : { ...held, bites: Math.max(0, held.bites - 1) });
      if (cue === 'drop') {
        endSip();
        s.setHeld(null); // all gone
        return;
      }
      continue;
    }
    if (held?.kind !== 'mug') break;
    if (cue === 'drink') s.setHeld({ ...held, sips: Math.max(0, held.sips - 1) });
    if (cue === 'drop') {
      endSip();
      dropMug(); // the shared drop helper: it falls in front of you
      return;
    }
  }
  sip.next = to;
  pose(plan, t, sipPose);
  if (t >= plan.dur) endSip();
}

function endSip() {
  sip = null;
  sipPose.lift = 0;
  sipPose.tilt = 0;
  sipPose.head = 0;
}
