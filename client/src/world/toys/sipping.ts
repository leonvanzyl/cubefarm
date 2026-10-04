import { useStore } from '../../store';
import { noise, tone, type Vec3 } from '../../ui/sfx';
import { dropMug } from './mugs';
import { cuesDue, planFor, pose, type SipCue, type SipPlan } from './sip';

// Drinking the coffee in your hands: E starts a sip (Player.tsx), Player ticks it every frame, and the first-person
// mug (MugToys.tsx) and the camera read `sipPose`. The timings are in sip.ts. Outside the lazily loaded toy chunk, so
// sips still count down when the physics engine isn't there; walking carries on throughout.

let sip: { plan: SipPlan; mugId: string; start: number; next: number } | null = null;

/** The current sip's pose, written by tickSip each frame: lift 0-1, the mug's tip and the view's tilt back (radians). */
export const sipPose = { lift: 0, tilt: 0, head: 0 };

const TOYS = { group: 'toys' } as const;

const sounds: Record<SipCue, () => void> = {
  slurp: () => {
    noise({ ...TOYS, name: 'mug-sip', dur: 0.2, peak: 0.05, filter: 'bandpass', freq: 900, to: 2600, q: 3, attack: 0.03 });
    tone({ ...TOYS, name: 'mug-sip', freq: 320, to: 540, type: 'triangle', dur: 0.16, peak: 0.02, attack: 0.02 });
  },
  mm: () => {
    tone({ ...TOYS, name: 'mug-mm', freq: 196, to: 175, dur: 0.34, peak: 0.07, attack: 0.04 });
    tone({ ...TOYS, name: 'mug-mm', freq: 392, to: 350, type: 'triangle', dur: 0.3, peak: 0.012, attack: 0.04 });
  },
  gulp: () => {
    for (let i = 0; i < 3; i++) tone({ ...TOYS, name: 'mug-gulp', freq: 280 - i * 30, to: 110, at: i * 0.24, dur: 0.15, peak: 0.09, attack: 0.01 });
    noise({ ...TOYS, name: 'mug-gulp', dur: 0.7, peak: 0.025, filter: 'lowpass', freq: 500, attack: 0.08 });
  },
  ahh: () => {
    noise({ ...TOYS, name: 'mug-ahh', dur: 0.65, peak: 0.07, filter: 'bandpass', freq: 1200, to: 700, q: 1.3, attack: 0.05 });
    tone({ ...TOYS, name: 'mug-ahh', freq: 230, to: 165, type: 'triangle', dur: 0.6, peak: 0.035, attack: 0.06 });
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

/** E with coffee in hand: start a sip (or the big last gulp). Does nothing mid-sip or without coffee. */
export function sipCoffee(now = performance.now()): boolean {
  const held = useStore.getState().held;
  if (sip || held?.kind !== 'mug') return false;
  const plan = planFor(held.sips);
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
  // The mug left your hands some other way (G, a panel, the machine): the sip is off.
  if (s.held?.kind !== 'mug' || s.held.id !== sip.mugId) return endSip();
  const { plan } = sip;
  const t = (now - sip.start) / 1000;
  const to = cuesDue(plan, sip.next, t);
  for (let i = sip.next; i < to; i++) {
    const cue = plan.cues[i].cue;
    sounds[cue]();
    const held = useStore.getState().held;
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
