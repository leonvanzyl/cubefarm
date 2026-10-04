// The balls' sounds: a bounce per kind, the hoop's rim and backboard, and picking a ball up. All positional, in the
// 'toys' group. ToyWorld.tsx decides when (impacts.ts says how loud and bright); these say what they sound like.

import { noise, tone, type Vec3 } from '../../ui/sfx';
import type { BallKind } from './balls';
import type { ImpactLevel } from './impacts';

const G = 'toys' as const;

/** A little random spread, so repeated bounces don't sound machine-made. */
const vary = (x: number, by = 0.06) => x * (1 - by + Math.random() * by * 2);

const BOUNCES: Record<BallKind, (pos: Vec3, l: ImpactLevel) => void> = {
  // light, hollow plastic: a short "pok" with an airy click
  beach: (pos, { gain, bright }) => {
    const name = 'bounce:beach';
    tone({ name, group: G, pos, freq: vary(340), to: 260, type: 'triangle', dur: 0.08, peak: 0.09 * gain, attack: 0.003 });
    noise({ name, group: G, pos, dur: 0.05, peak: 0.05 * gain, filter: 'bandpass', freq: vary(1400 + bright * 1600), q: 2.5, attack: 0.002 });
  },
  // deep and rubbery: a low thump that sags in pitch
  exercise: (pos, { gain, bright }) => {
    const name = 'bounce:exercise';
    tone({ name, group: G, pos, freq: vary(105), to: 62, dur: 0.2, peak: 0.16 * gain, attack: 0.006 });
    noise({ name, group: G, pos, dur: 0.09, peak: 0.05 * gain, freq: 220 + bright * 380, q: 0.8, attack: 0.004 });
  },
  // soft and muffled: mostly a dull puff
  yarn: (pos, { gain, bright }) => {
    const name = 'bounce:yarn';
    noise({ name, group: G, pos, dur: 0.1, peak: 0.07 * gain, freq: vary(260 + bright * 260), q: 0.6, attack: 0.008 });
    tone({ name, group: G, pos, freq: vary(130), to: 95, dur: 0.08, peak: 0.04 * gain, attack: 0.008 });
  },
  // a proper bounce: a firm thud with a little ring from the ball's skin
  basketball: (pos, { gain, bright }) => {
    const name = 'bounce:basketball';
    tone({ name, group: G, pos, freq: vary(150), to: 105, dur: 0.12, peak: 0.13 * gain, attack: 0.003 });
    noise({ name, group: G, pos, dur: 0.05, peak: 0.06 * gain, filter: 'bandpass', freq: vary(700 + bright * 1300), q: 1.4, attack: 0.002 });
    tone({ name, group: G, pos, freq: vary(560, 0.03), to: 540, type: 'triangle', dur: 0.22, peak: 0.025 * gain * (0.4 + bright * 0.6), attack: 0.004 });
  },
};

/** A ball of `kind` hitting something at `pos`. */
export const bounce = (kind: BallKind, pos: Vec3, l: ImpactLevel) => BOUNCES[kind](pos, l);

/** A ball hitting the rim: a metallic clank, a few inharmonic partials ringing out. */
export function rimClank(pos: Vec3, { gain, bright }: ImpactLevel) {
  const name = 'rim';
  const f = vary(620, 0.04);
  [1, 1.48, 2.37].forEach((m, i) => tone({ name, group: G, pos, freq: f * m, type: i ? 'triangle' : 'square', dur: 0.32 - i * 0.07, peak: (i ? 0.06 : 0.04) * gain, attack: 0.002 }));
  noise({ name, group: G, pos, dur: 0.04, peak: 0.07 * gain, filter: 'highpass', freq: 2200 + bright * 2000, q: 0.7, attack: 0.001 });
}

/** A ball hitting the backboard: a hollow board thud. */
export function boardThud(pos: Vec3, { gain, bright }: ImpactLevel) {
  const name = 'backboard';
  tone({ name, group: G, pos, freq: vary(92), to: 74, dur: 0.22, peak: 0.13 * gain, attack: 0.004 });
  tone({ name, group: G, pos, freq: vary(230), to: 205, type: 'triangle', dur: 0.14, peak: 0.04 * gain, attack: 0.004 });
  noise({ name, group: G, pos, dur: 0.07, peak: 0.06 * gain, filter: 'bandpass', freq: 450 + bright * 500, q: 1.3, attack: 0.002 });
}

const GRABS: Record<BallKind, { freq: number; peak: number; q: number }> = {
  beach: { freq: 1600, peak: 0.035, q: 1.6 },
  exercise: { freq: 500, peak: 0.04, q: 0.9 },
  yarn: { freq: 700, peak: 0.03, q: 0.5 },
  basketball: { freq: 1100, peak: 0.035, q: 1.2 },
};

/** Picking a ball up: a soft pat of hands on it, pitched by what it's made of. */
export function grabSound(kind: BallKind, pos: Vec3) {
  const g = GRABS[kind];
  noise({ name: `grab:${kind}`, group: G, pos, dur: 0.07, peak: g.peak, filter: 'bandpass', freq: vary(g.freq), q: g.q, attack: 0.006 });
}
