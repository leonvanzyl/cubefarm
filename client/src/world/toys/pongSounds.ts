// Ping-pong's sounds, all synthesized and positional in the 'toys' group: the pock of a paddle, the table, the net and
// the floor, a smash's crack, and the quiet "ooh" of the floor watching a long rally. PingPong.tsx says when.

import { noise, tone, type Vec3 } from '../../ui/sfx';

const G = 'toys' as const;
const vary = (x: number, by = 0.05) => x * (1 - by + Math.random() * by * 2);

/** The ball off a paddle: a hard, woody "tock", sharper the harder it's hit (power 0-1). */
export function paddlePock(pos: Vec3, power: number) {
  const name = 'pong:paddle';
  tone({ name, group: G, pos, freq: vary(1150 + power * 350), to: 820, type: 'triangle', dur: 0.045, peak: 0.08 + power * 0.06, attack: 0.001 });
  noise({ name, group: G, pos, dur: 0.03, peak: 0.05 + power * 0.05, filter: 'bandpass', freq: vary(2800 + power * 1800), q: 2.2, attack: 0.001 });
}

/** A smash: the paddle's crack on top of the pock. */
export function smashCrack(pos: Vec3) {
  noise({ name: 'pong:smash', group: G, pos, dur: 0.09, peak: 0.12, filter: 'highpass', freq: 1800, q: 0.8, attack: 0.001 });
  tone({ name: 'pong:smash', group: G, pos, freq: vary(520), to: 300, type: 'square', dur: 0.06, peak: 0.03, attack: 0.001 });
}

/** The ball on the table: the hollow "pock" the game is named for (gain 0-1). */
export function tablePock(pos: Vec3, gain: number) {
  const name = 'pong:table';
  tone({ name, group: G, pos, freq: vary(760), to: 610, type: 'sine', dur: 0.06, peak: 0.07 + gain * 0.07, attack: 0.001 });
  noise({ name, group: G, pos, dur: 0.035, peak: 0.04 + gain * 0.04, filter: 'bandpass', freq: vary(2200), q: 3, attack: 0.001 });
}

/** The ball into the net: a soft fabric brush. */
export function netBrush(pos: Vec3) {
  noise({ name: 'pong:net', group: G, pos, dur: 0.14, peak: 0.05, filter: 'lowpass', freq: vary(900), to: 400, q: 0.7, attack: 0.004 });
}

/** The ball on the floor: a duller, lower tick (gain 0-1). */
export function floorTick(pos: Vec3, gain: number) {
  const name = 'pong:floor';
  tone({ name, group: G, pos, freq: vary(520), to: 430, type: 'sine', dur: 0.05, peak: 0.03 + gain * 0.05, attack: 0.001 });
  noise({ name, group: G, pos, dur: 0.025, peak: 0.02 + gain * 0.03, filter: 'bandpass', freq: vary(1500), q: 2, attack: 0.001 });
}

/** A long rally: the room goes "ooh", quietly — a few voices, a vowel sliding up and back down. */
export function crowdOoh(pos: Vec3) {
  const name = 'pong:ooh';
  for (let i = 0; i < 4; i++) {
    const f = vary(170 + i * 45, 0.08);
    const at = i * 0.04 + Math.random() * 0.05;
    tone({ name, group: G, pos, at, freq: f, to: f * 1.18, type: 'sawtooth', dur: 0.55, peak: 0.008, attack: 0.12 });
    tone({ name, group: G, pos, at: at + 0.5, freq: f * 1.18, to: f * 0.9, type: 'sawtooth', dur: 0.45, peak: 0.006, attack: 0.05 });
  }
  noise({ name, group: G, pos, dur: 1.0, peak: 0.012, filter: 'bandpass', freq: 520, to: 680, q: 1.5, attack: 0.25 });
}
