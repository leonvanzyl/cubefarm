import { noise, tone, type Vec3 } from '../../../ui/sfx';

// The themes' little sounds, synthesized through the office's mixer like every other sound (and listed in
// window.__swarmSfx by name): a candy wrapper's crinkle, an egg's chime, paper tearing off a present, candles blown out.

/** A sweet wrapper crinkling: a quick run of bright crackles. */
export function crinkle(pos?: Vec3) {
  for (let i = 0; i < 7; i++) {
    noise({ name: 'theme:crinkle', group: 'toys', pos, at: i * 0.045 + Math.random() * 0.02, dur: 0.035, peak: 0.05 + Math.random() * 0.04, filter: 'highpass', freq: 3500 + Math.random() * 3000, q: 0.7, attack: 0.002 });
  }
}

/** Found something: a rising little arpeggio (the egg hunt; a bigger one with `big`). */
export function chime(pos?: Vec3, big = false) {
  const notes = big ? [784, 988, 1175, 1568, 1976] : [988, 1319, 1568];
  notes.forEach((freq, i) => tone({ name: big ? 'theme:fanfare' : 'theme:chime', group: 'alerts', pos, freq, type: 'triangle', at: i * 0.09, dur: big ? 0.5 : 0.3, peak: 0.1, attack: 0.005 }));
}

/** Wrapping paper torn off a present. */
export function unwrap(pos?: Vec3) {
  noise({ name: 'theme:unwrap', group: 'toys', pos, dur: 0.35, peak: 0.08, filter: 'bandpass', freq: 2400, to: 900, q: 1.2, attack: 0.01 });
  noise({ name: 'theme:unwrap', group: 'toys', pos, at: 0.3, dur: 0.25, peak: 0.06, filter: 'bandpass', freq: 3000, to: 1400, q: 1.4, attack: 0.01 });
}

/** A long breath blowing candles out. */
export function blow(pos?: Vec3) {
  noise({ name: 'theme:blow', group: 'toys', pos, dur: 0.7, peak: 0.12, filter: 'bandpass', freq: 700, to: 400, q: 0.6, attack: 0.08 });
}

/** A party popper. */
export function pop(pos?: Vec3) {
  noise({ name: 'theme:pop', group: 'toys', pos, dur: 0.12, peak: 0.14, filter: 'bandpass', freq: 1600, to: 500, q: 0.8, attack: 0.002 });
}
