// The voice settings' previews and tests: one at a time, at the master volume, and following M (mute) while they play.
import { getAudioPrefs, subscribeAudio } from './sfx';
import { playbackVolume } from './voicePicker';

let stopCurrent: (() => void) | null = null;

/** Stops the preview or test that's playing, if any. */
export function stopVoice() {
  stopCurrent?.();
}

/** Plays a clip (a URL, or audio fetched from the office). Resolves false when it couldn't play. */
export function playClip(src: string | Blob): Promise<boolean> {
  stopVoice();
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  const el = new Audio(url);
  const level = () => {
    el.volume = playbackVolume(getAudioPrefs());
  };
  level();
  const unsubscribe = subscribeAudio(level);
  return new Promise((resolve) => {
    let over = false;
    const done = (ok: boolean) => {
      if (over) return;
      over = true;
      unsubscribe();
      el.pause();
      if (typeof src !== 'string') URL.revokeObjectURL(url);
      if (stopCurrent === stop) stopCurrent = null;
      resolve(ok);
    };
    const stop = () => done(true);
    stopCurrent = stop;
    el.onended = () => done(true);
    el.onerror = () => done(false);
    el.play().catch(() => done(false));
  });
}

/** Says `text` in the browser's own voice called `voiceName` (its default when there's none). */
export function speakLine(text: string, voiceName: string): Promise<boolean> {
  stopVoice();
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!synth) return Promise.resolve(false);
  const u = new SpeechSynthesisUtterance(text);
  const v = synth.getVoices().find((x) => x.name === voiceName);
  if (v) {
    u.voice = v;
    u.lang = v.lang;
  }
  u.volume = playbackVolume(getAudioPrefs());
  // An utterance's volume is fixed once it starts, so muting mid-sentence stops it instead.
  const unsubscribe = subscribeAudio(() => getAudioPrefs().muted && stopVoice());
  return new Promise((resolve) => {
    let over = false;
    const done = (ok: boolean) => {
      if (over) return;
      over = true;
      unsubscribe();
      if (stopCurrent === stop) stopCurrent = null;
      resolve(ok);
    };
    const stop = () => {
      done(true);
      synth.cancel();
    };
    stopCurrent = stop;
    u.onend = () => done(true);
    u.onerror = (e) => done(e.error === 'interrupted' || e.error === 'canceled');
    synth.cancel(); // anything left over would queue ahead of the test
    synth.speak(u);
  });
}
