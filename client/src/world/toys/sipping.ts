import { useStore } from '../../store';
import { noise, tone, type Vec3 } from '../../ui/sfx';
import { dropMug } from './mugs';
import { biteFor, cuesDue, planFor, pose, snackPlanFor, type SipCue, type SipPlan } from './sip';
import { snackOf } from '../fridge';

// Drinking the coffee in your hands: E starts a sip (Player.tsx), Player ticks it every frame, and the first-person
// mug (MugToys.tsx) and the camera read `sipPose`. The timings are in sip.ts. Outside the lazily loaded toy chunk, so
// sips still count down when the physics engine isn't there; walking carries on throughout. A sausage from the roof's
// grill is eaten the same way, bite by bite (roof/HeldSausage.tsx draws it), and so is a snack from the fridge
// (HeldSnack.tsx), each with its own pitch.

let sip: { plan: SipPlan; mugId: string; start: number; next: number } | null = null;

/** The current sip's pose, written by tickSip each frame: lift 0-1, the mug's tip and the view's tilt back (radians). */
export const sipPose = { lift: 0, tilt: 0, head: 0 };

const TOYS = { group: 'toys' } as const;

// How high the current sip's or bite's sounds are: a snack's own pitch (fridge.ts), 1 for coffee and the sausage.
let pitch = 1;
const f = (hz: number) => hz * pitch;

const sounds: Record<SipCue, (pos?: Vec3) => void> = {
  slurp: (pos) => {
    noise({ ...TOYS, pos, name: 'mug-sip', dur: 0.2, peak: 0.05, filter: 'bandpass', freq: f(900), to: f(2600), q: 3, attack: 0.03 });
    tone({ ...TOYS, pos, name: 'mug-sip', freq: f(320), to: f(540), type: 'triangle', dur: 0.16, peak: 0.02, attack: 0.02 });
  },
  mm: () => {
    tone({ ...TOYS, name: 'mug-mm', freq: f(196), to: f(175), dur: 0.34, peak: 0.07, attack: 0.04 });
    tone({ ...TOYS, name: 'mug-mm', freq: f(392), to: f(350), type: 'triangle', dur: 0.3, peak: 0.012, attack: 0.04 });
  },
  gulp: () => {
    for (let i = 0; i < 3; i++) tone({ ...TOYS, name: 'mug-gulp', freq: f(280 - i * 30), to: f(110), at: i * 0.24, dur: 0.15, peak: 0.09, attack: 0.01 });
    noise({ ...TOYS, name: 'mug-gulp', dur: 0.7, peak: 0.025, filter: 'lowpass', freq: f(500), attack: 0.08 });
  },
  ahh: () => {
    noise({ ...TOYS, name: 'mug-ahh', dur: 0.65, peak: 0.07, filter: 'bandpass', freq: f(1200), to: f(700), q: 1.3, attack: 0.05 });
    tone({ ...TOYS, name: 'mug-ahh', freq: f(230), to: f(165), type: 'triangle', dur: 0.6, peak: 0.035, attack: 0.06 });
  },
  chomp: () => {
    noise({ ...TOYS, name: 'sausage-bite', dur: 0.09, peak: 0.08, filter: 'bandpass', freq: f(2400), to: f(1100), q: 1.4, attack: 0.003 });
    tone({ ...TOYS, name: 'sausage-bite', freq: f(150), to: f(90), dur: 0.08, peak: 0.05, attack: 0.004 });
  },
  munch: () => {
    for (let i = 0; i < 3; i++) noise({ ...TOYS, name: 'sausage-munch', at: i * 0.16, dur: 0.1, peak: 0.035, filter: 'lowpass', freq: f(900), attack: 0.01 });
  },
  drink: () => undefined,
  drop: () => undefined,
  pssht: () => {
    noise({ ...TOYS, name: 'can-open', dur: 0.05, peak: 0.08, filter: 'bandpass', freq: 3200, q: 2, attack: 0.002 });
    noise({ ...TOYS, name: 'can-open', at: 0.03, dur: 0.45, peak: 0.05, filter: 'highpass', freq: f(4200), to: 2600, q: 0.8, attack: 0.01 });
  },
  twist: () => {
    for (let i = 0; i < 4; i++) noise({ ...TOYS, name: 'cap-twist', at: i * 0.045, dur: 0.03, peak: 0.04, filter: 'bandpass', freq: f(2600), q: 3, attack: 0.002 });
    noise({ ...TOYS, name: 'cap-twist', at: 0.2, dur: 0.18, peak: 0.03, filter: 'highpass', freq: 3800, attack: 0.01 });
  },
  rustle: () => {
    for (let i = 0; i < 5; i++) noise({ ...TOYS, name: 'wrapper', at: i * 0.05 + Math.random() * 0.02, dur: 0.06, peak: 0.035, filter: 'bandpass', freq: f(3500 + i * 300), q: 1.5, attack: 0.003 });
  },
  crunch: () => {
    for (let i = 0; i < 3; i++) noise({ ...TOYS, name: 'can-crunch', at: i * 0.05, dur: 0.07, peak: 0.07, filter: 'bandpass', freq: 1800 - i * 300, q: 1.2, attack: 0.002 });
    tone({ ...TOYS, name: 'can-crunch', freq: 900, to: 400, type: 'square', dur: 0.12, peak: 0.012, attack: 0.002 });
  },
};

/** A dropped mug landing: a short ceramic clunk at `pos`, `peak` loud (from sip.ts's clunkPeak). */
export function clunk(pos: Vec3, peak: number) {
  tone({ ...TOYS, pos, name: 'mug-clunk', freq: 1150, to: 880, type: 'triangle', dur: 0.08, peak: peak * 0.6, attack: 0.002 });
  tone({ ...TOYS, pos, name: 'mug-clunk', freq: 2350, dur: 0.12, peak: peak * 0.2, attack: 0.002 });
  noise({ ...TOYS, pos, name: 'mug-clunk', dur: 0.05, peak: peak * 0.8, filter: 'lowpass', freq: 650, attack: 0.002 });
}

/** Someone else's sip (an agent on a coffee break), heard from where they stand. */
export const slurpAt = (pos: Vec3) => sounds.slurp(pos);

/** Someone else's bite or sip of a snack (an agent by the fridge), heard from where they stand. */
export function snackAt(pos: Vec3, snack: string) {
  const s = snackOf(snack);
  pitch = s?.pitch ?? 1;
  if (s?.kind === 'drink') noise({ ...TOYS, pos, name: 'snack-sip', dur: 0.2, peak: 0.04, filter: 'bandpass', freq: f(900), to: f(2400), q: 3, attack: 0.03 });
  else {
    noise({ ...TOYS, pos, name: 'snack-bite', dur: 0.09, peak: 0.06, filter: 'bandpass', freq: f(2400), to: f(1100), q: 1.4, attack: 0.003 });
    for (let i = 1; i < 3; i++) noise({ ...TOYS, pos, name: 'snack-bite', at: i * 0.16, dur: 0.1, peak: 0.03, filter: 'lowpass', freq: f(900), attack: 0.01 });
  }
  pitch = 1;
}

/** E with coffee in hand: start a sip (or the big last gulp); with a sausage or a snack, a bite (or a sip). Does nothing mid-sip or without one. */
export function sipCoffee(now = performance.now()): boolean {
  const held = useStore.getState().held;
  if (sip || !held) return false;
  const snack = held.kind === 'snack' ? snackOf(held.snack) : undefined;
  const plan = held.kind === 'mug' ? planFor(held.sips) : held.kind === 'sausage' ? biteFor(held.bites) : held.kind === 'snack' && snack ? snackPlanFor(snack, held.left) : null;
  if (!plan) return false;
  pitch = snack?.pitch ?? 1;
  sip = { plan, mugId: held.id, start: now, next: 0 };
  return true;
}

/** Whether a sip is under way. */
export const sipping = () => sip !== null;

/** Move the current sip along: play its cues, take the sip off the mug, let go of an empty one. Called every frame. */
export function tickSip(now = performance.now()) {
  if (!sip) return;
  const s = useStore.getState();
  // The mug (or sausage) left your hands some other way (G, a panel, the machine): the sip is off.
  if (s.held?.id !== sip.mugId) return endSip();
  const { plan } = sip;
  const t = (now - sip.start) / 1000;
  const to = cuesDue(plan, sip.next, t);
  for (let i = sip.next; i < to; i++) {
    const cue = plan.cues[i].cue;
    sounds[cue]();
    const held = useStore.getState().held;
    if (held?.kind === 'snack') {
      if (cue === 'drink') s.setHeld({ ...held, left: Math.max(0, held.left - 1) });
      if (cue === 'drop') {
        endSip();
        s.setHeld(null); // all gone
        return;
      }
      continue;
    }
    if (held?.kind === 'sausage') {
      if (cue === 'drink') s.setHeld({ ...held, bites: Math.max(0, held.bites - 1) });
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
  pitch = 1;
  sipPose.lift = 0;
  sipPose.tilt = 0;
  sipPose.head = 0;
}
