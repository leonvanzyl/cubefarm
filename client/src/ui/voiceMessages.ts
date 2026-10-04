// Phone messages read aloud the moment they arrive (docs/voice.md): ElevenLabs' clip through sfx.ts's 'voice' group,
// or the browser's own voice. One at a time and in order, other sounds ducked meanwhile, and one office tab per
// message (voiceClaim.ts). The store loads this on the first message to speak, so it isn't in the main bundle. window.__swarmVoice records what was read, for QA and e2e.
import { speechText } from '../../../shared/speech';
import type { PhoneMessage, VoiceProvider } from '../../../shared/types';
import { useStore } from '../store';
import { sliderGain } from './audioPrefs';
import { holdMusicDuck } from './music';
import { audio, chirp, duckOthers, getAudioPrefs, groupOutput, subscribeAudio } from './sfx';
import { wonVoice } from './voiceClaim';
import { enqueue, nextUp, type Queued } from './voiceQueue';

/** One message read aloud, for window.__swarmVoice. Times are performance.now(); end is null while it plays. */
export interface SpokenRecord {
  id: number;
  provider: Exclude<VoiceProvider, 'off'>;
  start: number;
  end: number | null;
  /** How loud it started (master × voice level, 0 while muted). */
  volume: number;
}

const spoken: SpokenRecord[] = [];
(window as unknown as Record<string, unknown>).__swarmVoice = spoken;

/** A live message to read aloud, claimed by the store at `arrived`: queued once the claim wait is over, if it won. */
export function speakMessage(message: PhoneMessage, arrived: number, wait: number) {
  setTimeout(
    () => {
      if (!wonVoice(message.id)) return;
      queue = enqueue(queue, { message, arrived });
      void pump();
    },
    Math.max(0, arrived + wait - Date.now()),
  );
}

// ---------- the queue ----------

let queue: Queued[] = [];
let stopCurrent: (() => void) | null = null;
let busy = false;

/** Stops the message being read (the HUD's speaking indicator); the next one waiting follows. */
export function stopSpeaking() {
  stopCurrent?.();
}

const level = () => {
  const p = getAudioPrefs();
  return p.muted ? 0 : sliderGain(p.volume) * sliderGain(p.voice);
};

async function pump() {
  if (busy) return;
  busy = true;
  try {
    for (;;) {
      const { next, rest } = nextUp(queue, Date.now());
      queue = rest;
      if (!next) break;
      await read(next.message);
    }
  } finally {
    busy = false;
  }
}

let warned = false;

async function read(m: PhoneMessage) {
  const { settings, voiceKeySet } = useStore.getState();
  const { provider, voiceName } = settings.voice;
  if (provider === 'off') return; // turned off while it waited
  const now: { rec: SpokenRecord | null; unduckMusic?: () => void } = { rec: null };
  const began = () => {
    now.rec = { id: m.id, provider, start: performance.now(), end: null, volume: level() };
    spoken.push(now.rec);
    if (spoken.length > 50) spoken.splice(0, spoken.length - 50);
    useStore.setState({ voiceSpeaking: m.id });
    duckOthers(true);
    now.unduckMusic = holdMusicDuck();
  };
  try {
    if (provider === 'browser') await speak(speechText(m.text), voiceName, began);
    else if (!voiceKeySet) throw new Error('no ElevenLabs key is saved');
    else await playClip(m.id, began);
  } catch (err) {
    // No key, ElevenLabs being down, no voice in this browser: the message still rings, just without words.
    if (!now.rec) chirp();
    if (!warned) {
      warned = true;
      console.warn(`[voice] couldn't read message ${m.id} aloud: ${(err as Error).message}`);
    }
  } finally {
    stopCurrent = null;
    if (now.rec) {
      now.rec.end = performance.now();
      duckOthers(false);
      now.unduckMusic?.();
      useStore.setState({ voiceSpeaking: null });
    }
  }
}

// ---------- ElevenLabs ----------

/** Fetches the message's clip and plays it through the 'voice' group, so the master volume, M and its slider apply. */
async function playClip(id: number, began: () => void) {
  let stopped = false;
  stopCurrent = () => void (stopped = true);
  const res = await fetch(`/api/voice/messages/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.arrayBuffer();
  if (stopped) return;
  const a = audio();
  const out = groupOutput('voice');
  if (!a || !out) throw new Error('audio is unavailable');
  const buffer = await a.ctx.decodeAudioData(data);
  if (stopped) return;
  const src = a.ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(out);
  await new Promise<void>((resolve) => {
    // A suspended context (a background tab, a headless browser) never ends the clip: don't let it stall the queue.
    const deadline = setTimeout(() => resolve(), (buffer.duration + 2) * 1000);
    src.onended = () => {
      clearTimeout(deadline);
      resolve();
    };
    stopCurrent = () => {
      try {
        src.stop();
      } catch {
        resolve(); // never started
      }
    };
    src.start();
    began();
  });
  src.disconnect();
}

// ---------- the browser's voice ----------

/** The browser's voices, waiting briefly for them to load the first time (they arrive asynchronously). */
async function browserVoices(synth: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  if (synth.getVoices().length) return synth.getVoices();
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 1000);
    synth.addEventListener('voiceschanged', () => (clearTimeout(t), resolve()), { once: true });
  });
  return synth.getVoices();
}

/** Says `text` in the voice called `voiceName` (the browser's default when it's gone). Rejects when it can't. */
async function speak(text: string, voiceName: string, began: () => void) {
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') throw new Error("this browser can't speak");
  if (!text) return;
  const u = new SpeechSynthesisUtterance(text);
  const v = (await browserVoices(synth)).find((x) => x.name === voiceName);
  if (v) {
    u.voice = v;
    u.lang = v.lang;
  }
  u.volume = level();
  await new Promise<void>((resolve, reject) => {
    // An utterance's volume is fixed once it starts, so muting stops it instead; a stuck engine gets a deadline.
    const unsubscribe = subscribeAudio(() => getAudioPrefs().muted && stop());
    const deadline = setTimeout(() => stop(), 20_000 + text.length * 150);
    let over = false;
    const done = (err?: string) => {
      if (over) return;
      over = true;
      clearTimeout(deadline);
      unsubscribe();
      if (err) reject(new Error(err));
      else resolve();
    };
    const stop = () => {
      done();
      synth.cancel();
    };
    stopCurrent = stop;
    u.onstart = began;
    u.onend = () => done();
    u.onerror = (e) => done(e.error === 'interrupted' || e.error === 'canceled' ? undefined : `speech failed: ${e.error}`);
    synth.speak(u);
  });
}
