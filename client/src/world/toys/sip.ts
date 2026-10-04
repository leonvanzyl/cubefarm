// Drinking coffee, as pure rules: what E does with a mug in hand, the timeline of a sip and of the big last gulp
// (when the sounds play, when the coffee goes down, when the empty mug is let go), the mug's pose along the way,
// and how loud a dropped mug clunks when it lands. sipping.ts plays it; MugToys.tsx draws it. A sausage off the roof's
// grill is eaten the same way, a bite at a time (roof/HeldSausage.tsx draws it).

/** What E does with something in your hands: sip the coffee, hint that the mug is empty, or act on the target. */
export type EAction = 'sip' | 'empty' | 'target';

/**
 * E with a mug of coffee sips it, whatever the crosshair is on, except the coffee machine (where E puts the mug
 * under the spout or presses the button). With an empty mug E acts on the target as usual, or hints when there is none.
 */
export function eAction(held: { kind: string; sips?: number; bites?: number } | null, focusKind: string | null): EAction {
  if (held?.kind === 'sausage') return (held.bites ?? 0) > 0 ? 'sip' : focusKind ? 'target' : 'empty';
  if (held?.kind !== 'mug' || focusKind === 'coffee') return 'target';
  if ((held.sips ?? 0) > 0) return 'sip';
  return focusKind ? 'target' : 'empty';
}

export type SipCue = 'slurp' | 'drink' | 'mm' | 'gulp' | 'ahh' | 'drop' | 'chomp' | 'munch';

export interface SipPlan {
  /** Seconds the whole thing takes. */
  dur: number;
  /** Seconds from the start: the mug is up by `up`, held at the mouth until `down`, and back in place by `dur`. */
  up: number;
  down: number;
  /** How far the mug tips towards you at the mouth (radians), and how far the view tilts back (radians, up). */
  tilt: number;
  head: number;
  /** What happens when, in order. `drink` takes the sip off the mug (a bite off a sausage); `drop` lets the empty mug go (the sausage is gone). */
  cues: readonly { at: number; cue: SipCue }[];
}

/** An ordinary sip: about 0.7 s, a slurp at the mouth and a contented "mm" on the way down. */
export const SIP: SipPlan = {
  dur: 0.7,
  up: 0.22,
  down: 0.45,
  tilt: 1.1,
  head: 0,
  cues: [
    { at: 0.18, cue: 'slurp' },
    { at: 0.32, cue: 'drink' },
    { at: 0.46, cue: 'mm' },
  ],
};

/** The last sip: the mug tips right up, the view tilts back, three big glugs, an "ahh", then the mug is let go. */
export const GULP: SipPlan = {
  dur: 1.75,
  up: 0.3,
  down: 1.15,
  tilt: 2.3,
  head: 0.16,
  cues: [
    { at: 0.3, cue: 'gulp' },
    { at: 0.95, cue: 'drink' },
    { at: 1.2, cue: 'ahh' },
    { at: 1.6, cue: 'drop' },
  ],
};

/** The plan for the next sip of a mug with `sips` left: the last one is the gulp. Null when it's empty. */
export function planFor(sips: number): SipPlan | null {
  if (!(sips > 0)) return null;
  return sips <= 1 ? GULP : SIP;
}

/** A bite of a sausage in a bun: up to the mouth, a chomp, and a munch on the way down. */
export const BITE: SipPlan = {
  dur: 0.8,
  up: 0.22,
  down: 0.4,
  tilt: 0,
  head: 0,
  cues: [
    { at: 0.2, cue: 'chomp' },
    { at: 0.3, cue: 'drink' },
    { at: 0.45, cue: 'munch' },
  ],
};

/** The last bite: a bigger one, a long munch and a contented "mm", and that's the sausage gone. */
export const LAST_BITE: SipPlan = {
  dur: 1.5,
  up: 0.24,
  down: 0.5,
  tilt: 0,
  head: 0.05,
  cues: [
    { at: 0.22, cue: 'chomp' },
    { at: 0.32, cue: 'drink' },
    { at: 0.55, cue: 'munch' },
    { at: 1.05, cue: 'mm' },
    { at: 1.4, cue: 'drop' },
  ],
};

/** The plan for the next bite of a sausage with `bites` left: the last one finishes it. Null when it's gone. */
export function biteFor(bites: number): SipPlan | null {
  if (!(bites > 0)) return null;
  return bites <= 1 ? LAST_BITE : BITE;
}

/** The index of the first cue still to come `t` seconds in, having played those before `from`. */
export function cuesDue(plan: SipPlan, from: number, t: number): number {
  let i = from;
  while (i < plan.cues.length && plan.cues[i].at <= t) i++;
  return i;
}

const smooth = (x: number) => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

/** How far up the mug is at `t` seconds: 0 resting in view, 1 at the mouth. */
export function lift(plan: SipPlan, t: number): number {
  if (t <= 0 || t >= plan.dur) return 0;
  if (t < plan.up) return smooth(t / plan.up);
  if (t < plan.down) return 1;
  return 1 - smooth((t - plan.down) / (plan.dur - plan.down));
}

/** The mug's pose at `t` seconds: how far up (0-1), how far tipped (radians) and the view's tilt back (radians). */
export function pose(plan: SipPlan, t: number, out = { lift: 0, tilt: 0, head: 0 }) {
  const l = lift(plan, t);
  out.lift = l;
  out.tilt = l * plan.tilt;
  out.head = l * plan.head;
  return out;
}

// ---------- landing ----------

/** A dropped mug clunks on impacts above `min` m/s (resting and rocking stay quiet), loudest by `max`, once per `cooldown` ms. */
export const CLUNK = { min: 0.6, max: 4.5, peak: 0.14, cooldown: 160 };

/** The speed change of an impact from Rapier's contact force (N) over one step (s), for a body of `mass` kg. */
export const impactSpeed = (force: number, step: number, mass: number) => (mass > 0 ? (force * step) / mass : 0);

/** How loud a clunk is for an impact of `speed` m/s, `sinceLast` ms after this mug's last one: 0 for none. */
export function clunkPeak(speed: number, sinceLast: number): number {
  if (!(speed >= CLUNK.min) || sinceLast < CLUNK.cooldown) return 0;
  const k = Math.min(1, (speed - CLUNK.min) / (CLUNK.max - CLUNK.min));
  return CLUNK.peak * (0.25 + 0.75 * k);
}
