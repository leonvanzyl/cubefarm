import { noise, tone, type NoiseOpts, type ToneOpts, type Vec3 } from '../../ui/sfx';
import { reloadCues, type DartSound, type ThwipVoice } from './blasterSounds';

// The foam blasters' and darts' sounds, synthesized like every other office sound (ui/sfx.ts) and mixed into the
// 'toys' group. Dart impacts and a dropped blaster come from where they happen; sounds in your hands don't.

const tn = (name: string, o: ToneOpts, pos?: Vec3) => tone({ ...o, name, group: 'toys', pos });
const ns = (name: string, o: NoiseOpts, pos?: Vec3) => noise({ ...o, name, group: 'toys', pos });

// ---------- in your hands ----------

/** The blaster's "thwip": a puff of air through the barrel with a springy little pop, varied per shot. */
export function thwip({ pitch, gain }: ThwipVoice) {
  ns('blaster:thwip', { dur: 0.085, peak: 0.1 * gain, filter: 'bandpass', freq: 2600 * pitch, to: 900 * pitch, q: 1.4, attack: 0.003 });
  tn('blaster:thwip', { freq: 520 * pitch, to: 190 * pitch, type: 'triangle', dur: 0.075, peak: 0.07 * gain, attack: 0.004 });
}

/** Pulling the trigger on an empty magazine. */
export function dryClick() {
  tn('blaster:dry', { freq: 1400, to: 900, type: 'square', dur: 0.03, peak: 0.03, attack: 0.002 });
}

/** Taking a blaster: a plastic clack, and from the rack a priming pump (slide back, slide forward). */
export function takeSound(fromRack: boolean) {
  ns('blaster:take', { dur: 0.04, peak: 0.07, filter: 'bandpass', freq: 2200, q: 2.5, attack: 0.002 });
  tn('blaster:take', { freq: 300, to: 220, type: 'triangle', dur: 0.05, peak: 0.04, attack: 0.003 });
  if (!fromRack) return;
  ns('blaster:pump', { at: 0.14, dur: 0.12, peak: 0.05, filter: 'bandpass', freq: 700, to: 1300, q: 2, attack: 0.03 });
  ns('blaster:pump', { at: 0.27, dur: 0.035, peak: 0.08, filter: 'bandpass', freq: 1800, q: 3, attack: 0.002 });
  ns('blaster:pump', { at: 0.33, dur: 0.1, peak: 0.05, filter: 'bandpass', freq: 1300, to: 700, q: 2, attack: 0.02 });
  ns('blaster:pump', { at: 0.44, dur: 0.035, peak: 0.09, filter: 'bandpass', freq: 1500, q: 3, attack: 0.002 });
}

/** R: the magazine slides out, the full one clicks in, and the blaster's ready, timed to a reload of `reloadMs`. */
export function reloadSound(reloadMs: number) {
  const c = reloadCues(reloadMs);
  ns('blaster:mag-out', { at: c.magOut, dur: 0.1, peak: 0.06, filter: 'bandpass', freq: 1100, to: 600, q: 2, attack: 0.01 });
  tn('blaster:mag-out', { at: c.magOut, freq: 240, to: 160, type: 'triangle', dur: 0.08, peak: 0.03 });
  ns('blaster:mag-in', { at: c.magIn, dur: 0.06, peak: 0.05, filter: 'bandpass', freq: 800, to: 1400, q: 2, attack: 0.02 });
  ns('blaster:mag-in', { at: c.magIn + 0.06, dur: 0.04, peak: 0.1, filter: 'bandpass', freq: 1600, q: 3, attack: 0.002 });
  tn('blaster:mag-in', { at: c.magIn + 0.06, freq: 420, to: 300, type: 'triangle', dur: 0.05, peak: 0.04, attack: 0.003 });
  ns('blaster:ready', { at: c.ready, dur: 0.03, peak: 0.06, filter: 'bandpass', freq: 2400, q: 3, attack: 0.002 });
}

// ---------- in the world ----------

/** A dropped blaster landing at `pos`: a light, hollow plastic clatter, `gain` 0 to 1 by how hard. */
export function blasterClatter(pos: Vec3, gain: number) {
  ns('blaster:clatter', { dur: 0.06, peak: 0.1 * gain, filter: 'bandpass', freq: 1500, q: 1.5, attack: 0.002 }, pos);
  tn('blaster:clatter', { freq: 260, to: 180, type: 'triangle', dur: 0.08, peak: 0.06 * gain, attack: 0.003 }, pos);
  ns('blaster:clatter', { at: 0.07, dur: 0.04, peak: 0.05 * gain, filter: 'bandpass', freq: 2300, q: 2, attack: 0.002 }, pos);
}

/** A dart meeting something at `pos` (see dartImpact in blasterSounds.ts). */
export function dartSound(sound: DartSound, pos: Vec3, gain: number) {
  const name = `dart:${sound}`;
  switch (sound) {
    case 'thwock': // a suction cup slapping flat: a low hollow pop
      tn(name, { freq: 300, to: 120, dur: 0.11, peak: 0.16 * gain, attack: 0.003 }, pos);
      ns(name, { dur: 0.05, peak: 0.08 * gain, filter: 'lowpass', freq: 900, q: 1, attack: 0.002 }, pos);
      return;
    case 'tock': // the same cup on a desk: shorter and woodier
      tn(name, { freq: 520, to: 300, type: 'triangle', dur: 0.07, peak: 0.12 * gain, attack: 0.002 }, pos);
      ns(name, { dur: 0.035, peak: 0.07 * gain, filter: 'bandpass', freq: 1200, q: 2, attack: 0.002 }, pos);
      return;
    case 'tick': // light plastic glancing off something hard
      ns(name, { dur: 0.025, peak: 0.07 * gain, filter: 'bandpass', freq: 3200, q: 3, attack: 0.001 }, pos);
      tn(name, { freq: 1900, to: 1500, type: 'triangle', dur: 0.03, peak: 0.025 * gain, attack: 0.001 }, pos);
      return;
    case 'bonk': // off a ball: a tick with a rubbery boing under it
      ns(name, { dur: 0.025, peak: 0.06 * gain, filter: 'bandpass', freq: 2800, q: 3, attack: 0.001 }, pos);
      tn(name, { freq: 180, to: 260, type: 'sine', dur: 0.12, peak: 0.1 * gain, attack: 0.004 }, pos);
      return;
    case 'patter': // foam dropping onto the carpet: two soft pats
      ns(name, { dur: 0.04, peak: 0.07 * gain, filter: 'lowpass', freq: 1100, q: 0.7, attack: 0.002 }, pos);
      ns(name, { at: 0.045, dur: 0.03, peak: 0.035 * gain, filter: 'lowpass', freq: 900, q: 0.7, attack: 0.002 }, pos);
      return;
  }
}
