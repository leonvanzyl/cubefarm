// The adaptive score: a quiet ambient layer under the office, separate from the jukebox, that follows the floor's mood
// (scoreMood.ts): soft pads when it's calm, a gentle pulse when it's busy, a minor colour and a low ostinato under a
// red CI or a PR that needs you, sparser and slower at night, and a rising sting after a merge, once the gong has died
// down (a bigger one on a streak). It plays the jukebox's synth voices (music.ts) bar by bar, a moment ahead, and only
// changes mood on a bar line. It goes through the Soundtrack group (its slider, on/off, the master volume and M), dips
// with the jukebox under alerts and voices, and gives way to the jukebox: wherever a jukebox can be heard, it fades
// out. Silent, it stops scheduling and lets go of its few nodes. `?mood=` forces a mood for QA.

import { onGongParty } from '../world/gongState';
import { nightFactor } from '../world/sky/time';
import { sampleDayTime } from '../world/sky/useDayTime';
import { DUCK_GAIN } from './musicMix';
import { followMusicDuck, jukeboxHeard, keys, musicDucked, pad, voice, type Tally } from './music';
import { GONG_CLEAR, barSeconds, onStreak, parseMoodParam, recentMerges, scoreBar, scoreMood, stingNotes, type OfficeState, type ScoreMood, type ScoreNote } from './scoreMood';
import { audio, getAudioPrefs, groupOutput, recordSfx, subscribeAudio } from './sfx';

const TICK_MS = 100;
/** Seconds of bars scheduled ahead of the clock. */
const LOOKAHEAD = 0.6;
/** The score's level before the Soundtrack slider: under the jukebox, and its loudest (a big sting) well under the merge cue. */
const LEVEL = 0.29;
/** Its loudest moment (a big sting) at the slider's full level, for __swarmSfx (measured offline with __swarmScorePeak). */
const PEAK = 0.1;
/** Each part's loudest note, before LEVEL. */
const PART = { pad: 0.05, keys: 0.1, bass: 0.09, ostinato: 0.08 } as const;
/** With the jukebox heard above this, the score is silent. */
const JUKEBOX_WINS = 0.98;

interface Chain {
  bus: GainNode;
  /** Dips with the jukebox under alerts and speech. */
  duck: GainNode;
  /** Fades the score out when the jukebox is heard (or it's turned off). */
  fade: GainNode;
  stopDuck: () => void;
  nodes: number;
}

let started = false;
let quiet = false;
let state: OfficeState = { working: 0, red: false };
const override = typeof location !== 'undefined' ? parseMoodParam(location.search) : null;
let mood: ScoreMood = override && override !== 'triumph' ? override : 'calm';
let chain: Chain | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
/** The next bar line (context time), and its number since the score started. */
let nextBar = 0;
let bar = 0;
let fadeLevel = 0;
const tally: Tally = { nodes: 0 };
/** Merges on this floor (performance seconds), and a sting waiting for its bar line. */
let merges: number[] = [];
let sting: { due: number; big: boolean } | null = null;
let stings = 0;
let lastSting: { at: number; big: boolean } | null = null;
const transitions: { at: number; from: ScoreMood; to: ScoreMood }[] = [];
let stopParty: (() => void) | null = null;

/** The floor came into view: the score starts following it. */
export function startScore() {
  started = true;
  stopParty ??= onGongParty(merged);
  if (!timer) timer = setInterval(tick, TICK_MS);
  tick();
}

/** The floor's gone: fade out and stop. */
export function stopScore() {
  started = false;
  stopParty?.();
  stopParty = null;
  sting = null;
  if (timer) clearInterval(timer);
  timer = null;
  release();
}

/** Quiet (a panel or the phone open, the elevator travelling), like the jukebox. */
export function setScoreQuiet(q: boolean) {
  if (q === quiet) return;
  quiet = q;
  if (timer) tick();
}

/** What the floor is up to (Soundscape.tsx feeds it from the store). */
export function setScoreState(s: OfficeState) {
  state = s;
}

/** A merge on this floor struck the gong: a sting once it has died down, bigger on a streak. */
function merged() {
  const now = performance.now() / 1000;
  merges = recentMerges([...merges, now], now);
  sting = { due: now + GONG_CLEAR, big: onStreak(merges, now) };
}

/** The mood the office is in now (the `?mood=` override wins). */
function target(): ScoreMood {
  if (override && override !== 'triumph') return override;
  return scoreMood(state, nightFactor(sampleDayTime()), mood);
}

function tick() {
  const want = target();
  const prefs = getAudioPrefs();
  const heardJukebox = jukeboxHeard();
  const on = started && prefs.soundtrack && !prefs.muted && prefs.score > 0 && !quiet && !document.hidden && heardJukebox < JUKEBOX_WINS;
  const out = on ? groupOutput('score') : null;
  if (!out) {
    // Silent: no bars to keep, so the mood just follows the office.
    if (want !== mood) change(want, false);
    if (sting && performance.now() / 1000 > sting.due + 10) sting = null;
    release();
    return;
  }
  try {
    const c = out.context;
    if (!chain || chain.bus.context !== c) {
      release();
      chain = build(c, out);
      nextBar = c.currentTime + 0.1;
    }
    const fade = 1 - heardJukebox;
    if (Math.abs(fade - fadeLevel) > 0.01) {
      fadeLevel = fade;
      chain.fade.gain.setTargetAtTime(fade, c.currentTime, 0.4);
    }
    if (nextBar < c.currentTime) nextBar = c.currentTime + 0.05; // the clock ran on while silent
    while (nextBar < c.currentTime + LOOKAHEAD) {
      if (want !== mood) change(want, true);
      playBar(c, chain, nextBar);
      nextBar += barSeconds(mood);
      bar++;
    }
  } catch {
    // audio is optional
  }
}

/** Moves to a new mood (on a bar line, while it plays), with a __swarmSfx entry. */
function change(to: ScoreMood, played: boolean) {
  const from = mood;
  mood = to;
  transitions.push({ at: Math.round(performance.now()), from, to });
  if (transitions.length > 12) transitions.shift();
  const rec = recordSfx(`score:${to}`, { group: 'score', peak: PEAK, played });
  rec.mood = to;
  rec.prev = from;
}

/** One bar of the mood at context time `at`, and the sting if it's due (and no alert is ringing). */
function playBar(c: BaseAudioContext, ch: Chain, at: number) {
  const beat = barSeconds(mood) / 4;
  for (const n of scoreBar(mood, bar)) note(c, ch, n, at, beat);
  const perfAt = performance.now() / 1000 + (at - c.currentTime);
  const triumph = override === 'triumph' && bar % 4 === 1;
  if ((sting && perfAt >= sting.due && !musicDucked()) || triumph) {
    const big = sting?.big ?? bar % 8 === 5;
    for (const n of stingNotes(big)) note(c, ch, n, at, beat);
    sting = null;
    stings++;
    lastSting = { at: Math.round(performance.now()), big };
    const rec = recordSfx(big ? 'score:sting:big' : 'score:sting', { group: 'score', peak: PEAK, played: true });
    rec.mood = 'triumph';
    rec.prev = mood;
  }
}

function note(c: BaseAudioContext, ch: Chain, n: ScoreNote, barAt: number, beat: number) {
  const when = barAt + n.at * beat;
  const dur = n.len * beat;
  const peak = PART[n.part] * n.level;
  if (n.part === 'pad') pad(c, ch.bus, n.midi, when, dur, peak, tally);
  else if (n.part === 'keys') keys(c, ch.bus, n.midi, when, dur, peak, tally);
  else voice(c, ch.bus, n.part === 'bass' ? 'sine' : 'triangle', n.midi, when, dur, peak, n.part === 'bass' ? 0.3 : 0.01, n.part === 'bass' ? 0.8 : 0.4, tally);
}

/** bus → a soft lowpass → duck → fade → the Soundtrack group. */
function build(c: BaseAudioContext, out: AudioNode): Chain {
  const bus = c.createGain();
  bus.gain.value = LEVEL;
  const tone = c.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 3200;
  tone.Q.value = 0.5;
  const duck = c.createGain();
  const fade = c.createGain();
  fade.gain.value = 0;
  fadeLevel = 0;
  bus.connect(tone).connect(duck).connect(fade).connect(out);
  return { bus, duck, fade, stopDuck: followMusicDuck(duck), nodes: 4 };
}

function release() {
  const ch = chain;
  if (!ch) return;
  chain = null;
  ch.stopDuck();
  try {
    ch.fade.gain.setTargetAtTime(0, ch.fade.context.currentTime, 0.15);
  } catch {
    // audio is optional
  }
  setTimeout(() => {
    try {
      ch.fade.disconnect();
    } catch {
      // already gone
    }
  }, 1500);
}

// The soundtrack's settings changing (turned off, muted) take effect at once, not on the next tick.
subscribeAudio(() => {
  if (timer) tick();
});

// ---------- probe ----------

// window.__swarmScore: the soundtrack's mood, why, and what it's doing, for QA (a fresh snapshot per read). Mood changes
// and stings are also recorded in window.__swarmSfx as score:… entries. __swarmScorePeak(what) renders a mood's four
// bars or a sting offline at the slider's full level and resolves to its peak, to check it stays under the merge cue.
if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmScore')) {
  Object.defineProperty(window, '__swarmScore', {
    get: () => {
      const prefs = getAudioPrefs();
      return {
        running: timer !== null,
        playing: chain !== null,
        mood,
        target: target(),
        override,
        state: { ...state, night: +nightFactor(sampleDayTime()).toFixed(2) },
        bar,
        /** How much the jukebox is heard here (the score gives way to it) and the score's own fade. */
        jukebox: +jukeboxHeard().toFixed(2),
        fade: +fadeLevel.toFixed(2),
        ducked: musicDucked(),
        duckGain: DUCK_GAIN,
        soundtrack: prefs.soundtrack,
        slider: prefs.score,
        transitions: transitions.map((t) => ({ ...t })),
        stings,
        lastSting,
        pendingSting: sting ? { ...sting, inSec: +(sting.due - performance.now() / 1000).toFixed(1) } : null,
        streak: merges.length,
        /** WebAudio nodes: the chain's (fixed, 0 while silent) and its notes in flight. */
        nodes: { chain: chain?.nodes ?? 0, notes: tally.nodes },
      };
    },
    enumerable: false,
    configurable: false,
  });
  Object.defineProperty(window, '__swarmScorePeak', {
    value: async (what: ScoreMood | 'sting' | 'sting:big') => {
      if (typeof OfflineAudioContext === 'undefined') return null;
      const rate = 44100;
      const isSting = what === 'sting' || what === 'sting:big';
      const m: ScoreMood = isSting ? 'calm' : what;
      const secs = barSeconds(m) * (isSting ? 3 : 4) + 2;
      const c = new OfflineAudioContext(1, Math.ceil(rate * secs), rate);
      const bus = c.createGain();
      bus.gain.value = LEVEL;
      bus.connect(c.destination);
      const ch = { bus } as Chain;
      const beat = barSeconds(m) / 4;
      for (let b = 0; b < (isSting ? 3 : 4); b++) for (const n of scoreBar(m, b)) note(c, ch, n, b * beat * 4, beat);
      if (isSting) for (const n of stingNotes(what === 'sting:big')) note(c, ch, n, beat * 4, beat);
      const data = (await c.startRendering()).getChannelData(0);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v));
      return { what, peak, limit: PEAK, audio: !!audio() };
    },
    enumerable: false,
    configurable: false,
  });
}
