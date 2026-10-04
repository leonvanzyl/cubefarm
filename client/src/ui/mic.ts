// The 🎙: talking instead of typing (docs/voice.md). One listening session at a time, in whichever message box asked
// (MicButton.tsx registers them): the browser's speech recognition fills the box as you speak, or a recording goes to
// ElevenLabs through the office and comes back as text. Holding the 🎙 or V talks, a tap listens until you stop
// talking, and the phone's hands-free conversation opens the mic after the CEO's spoken reply. The mic is only ever on
// while one of those shows its pulsing 🎙; while it is, the jukebox and the CEO's voice dip and cues wait (sfx.ts).
// The rules are pure (micSilence.ts, handsFree.ts, micKeys.ts, micText.ts); window.__swarmMic is the probe.
import { create } from 'zustand';
import { CLIP_MAX_BYTES, clipProblem } from '../../../shared/clipLimits';
import type { ListenProvider } from '../../../shared/types';
import { api } from '../api';
import { useStore } from '../store';
import { isConfirmOpen } from './Confirm';
import { HANDS_FREE_IDLE, handsFree, type HandsFree, type HandsFreeEvent, type Room } from './handsFree';
import { closesMic, HOLD_MS, isTalkKey, type KeyPlace } from './micKeys';
import { freshEars, heardLevel, heardWords, listenRules, sendsWhenDone, verdict, type Ears, type MicMode } from './micSilence';
import { cantListen, micErrorLine, phrasesText, withTranscript, type MicCaps, type Phrase } from './micText';
import { holdMusicDuck } from './music';
import { getAudioPrefs, listenChime, setMicOpen, subscribeAudio } from './sfx';

export type MicState = 'idle' | 'listening' | 'transcribing' | 'error';

/** What the 🎙 buttons show. */
export interface MicView {
  state: MicState;
  mode: MicMode | null;
  /** The message box listening (or that last failed). */
  target: string | null;
  /** The microphone itself is on: listening shows a moment before it is. */
  live: boolean;
  /** The hands-free phone is chiming before it listens. */
  chiming: boolean;
}

export const useMic = create<MicView>(() => ({ state: 'idle', mode: null, target: null, live: false, chiming: false }));

/** A message box with a 🎙. */
export interface MicTarget {
  id: string;
  kind: 'phone' | 'agent' | 'console';
  /** The box's form: a key in a field of this form is a key in the box. */
  form(): HTMLFormElement | null;
  text(): string;
  setText(text: string): void;
  send(text: string): void;
  disabled(): boolean;
}

const targets = new Map<string, MicTarget>(); // oldest first

/** Adds a message box; returns its removal (which stops any listening there). */
export function registerTarget(t: MicTarget): () => void {
  targets.delete(t.id);
  targets.set(t.id, t);
  return () => {
    if (targets.get(t.id) !== t) return;
    targets.delete(t.id);
    if (session?.target.id === t.id) cancel('gone');
  };
}

// ---------- what this browser can do ----------

interface RecognitionResultLike {
  isFinal: boolean;
  0?: { transcript: string };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((e: { results: ArrayLike<RecognitionResultLike> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionClass = new () => Recognition;

let fakeOn = false;
const browserRecognition = (): RecognitionClass | null => {
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
const recognitionClass = (): RecognitionClass | null => (fakeOn ? FakeRecognition : browserRecognition());

export function micCaps(): MicCaps {
  return {
    recognition: !!recognitionClass(),
    recorder: typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
  };
}

const listening = () => useStore.getState().settings.listen ?? { provider: 'off' as ListenProvider, autoSend: false, handsFree: false };

/** Why the 🎙 can't listen now, or '' when it can. */
export function micProblem(): string {
  const { provider } = listening();
  return provider === 'off' ? '' : cantListen(provider, micCaps(), useStore.getState().voiceKeySet);
}

// ---------- one listening session ----------

interface Hearing {
  /** Finish: the last words (or the recording) still arrive. */
  stop(): void;
  /** Drop it all. */
  abort(): void;
}

interface Session {
  n: number;
  target: MicTarget;
  mode: MicMode;
  provider: Exclude<ListenProvider, 'off'>;
  /** The box's text before listening. */
  base: string;
  transcript: string;
  /** Null until the mic is live. */
  ears: Ears | null;
  hearing: Hearing | null;
  began: number;
  finishing: boolean;
  release: (() => void) | null;
  tick: ReturnType<typeof setInterval>;
}

/** One listening session, for window.__swarmMic. */
export interface MicRecord {
  provider: Exclude<ListenProvider, 'off'>;
  mode: MicMode;
  start: number;
  end: number | null;
  transcript: string;
  /** sent, put in the box, nothing heard, stopped (Esc, M, typing, the box went away) or an error. */
  outcome: 'sent' | 'filled' | 'nothing' | 'stopped' | 'error' | null;
}

let session: Session | null = null;
let sessions = 0;
const history: MicRecord[] = [];
let record: MicRecord | null = null;
let lastTranscript = '';
let lastError = '';
/** The browser lets the office use the mic (it said so, or a session got a live mic): hands-free never asks unprompted. */
let micAllowed = false;
let askedToAllow = false;
const STARTUP_MS = 10_000; // a mic that never comes on (a permission prompt left open) gives up

const set = (patch: Partial<MicView>) => useMic.setState(patch);

/** Starts listening in box `id`. A held 🎙 or V, a tap, or the hands-free phone. */
export function listen(id: string, mode: MicMode) {
  const target = targets.get(id);
  if (!target || session || target.disabled()) return;
  const { provider } = listening();
  if (provider === 'off') return;
  const why = cantListen(provider, micCaps(), useStore.getState().voiceKeySet);
  if (why) return void explain(why, id);
  const n = ++sessions;
  const s: Session = {
    n,
    target,
    mode,
    provider,
    base: target.text(),
    transcript: '',
    ears: null,
    hearing: null,
    began: performance.now(),
    finishing: false,
    release: quiet(),
    tick: setInterval(() => check(n), 100),
  };
  session = s;
  record = { provider, mode, start: s.began, end: null, transcript: '', outcome: null };
  history.push(record);
  if (history.length > 30) history.splice(0, history.length - 30);
  lastError = '';
  set({ state: 'listening', mode, target: id, live: false, chiming: false });
  if (provider === 'browser') s.hearing = recognise(n);
  else void recordClip(n);
}

/** The press became a tap: keep listening until you stop talking. */
export function keepListening(id: string) {
  if (session?.target.id !== id || session.mode !== 'hold') return;
  session.mode = 'tap';
  if (record) record.mode = 'tap';
  set({ mode: 'tap' });
}

/** Finish listening in box `id` (a released 🎙, a second tap): what was said still arrives. */
export function finishListening(id?: string) {
  if (session && (!id || session.target.id === id)) finish();
}

/** Stop listening in box `id` without sending (a message sent by hand, Esc). */
export function stopListening(id?: string, why: 'stopped' | 'gone' = 'stopped') {
  if (session && (!id || session.target.id === id)) cancel(why);
}

/** The session the mic is in, if it's still `n`. */
const live = (n: number) => (session?.n === n ? session : null);

function check(n: number) {
  const s = live(n);
  if (!s || s.finishing) return;
  const now = performance.now();
  if (!s.ears) {
    if (now - s.began > STARTUP_MS) cancel('stopped');
    return;
  }
  const v = verdict(s.ears, now, listenRules(s.mode, listening().autoSend));
  if (v === 'no-speech') cancel('nothing');
  else if (v !== 'listening') finish();
}

/** The mic is live. */
function started(n: number) {
  const s = live(n);
  if (!s || s.ears) return;
  s.ears = freshEars(performance.now());
  micAllowed = true;
  set({ live: true });
}

function heard(n: number, text: string, speaking: boolean) {
  const s = live(n);
  if (!s) return;
  if (!s.ears) started(n);
  if (speaking && s.ears) s.ears = heardWords(s.ears, performance.now());
  s.transcript = text;
  if (record) record.transcript = text;
  lastTranscript = text;
  s.target.setText(withTranscript(s.base, text));
}

function finish() {
  const s = session;
  if (!s || s.finishing) return;
  s.finishing = true;
  if (!s.hearing) return deliver(s);
  s.hearing.stop();
  // A recognition that never says it ended still delivers what it heard.
  const n = s.n;
  setTimeout(() => {
    if (live(n) && s.provider === 'browser') deliver(s);
  }, 2500);
}

/** Listening is over: put the words in the box, and send them when the rules say so. */
function deliver(s: Session) {
  if (session !== s) return;
  const words = s.transcript.trim();
  const text = withTranscript(s.base, words);
  if (words) s.target.setText(text);
  const send = !!words && sendsWhenDone(s.mode, listening().autoSend) && !s.target.disabled();
  close(words ? (send ? 'sent' : 'filled') : 'nothing');
  if (send) {
    s.target.setText('');
    s.target.send(text);
  }
}

function cancel(why: 'stopped' | 'gone' | 'nothing') {
  const s = session;
  if (!s) return;
  s.hearing?.abort();
  close(why === 'nothing' ? 'nothing' : 'stopped');
}

/** Listening went wrong: `line` says why, or null when it simply stopped (what was heard still counts). */
function fail(n: number, line: string | null) {
  const s = live(n);
  if (!s) return;
  if (!line) {
    // Stopped, or nothing said: whatever was heard still counts.
    if (s.transcript) deliver(s);
    else close('nothing');
    return;
  }
  s.hearing?.abort();
  lastError = line;
  close('error');
  useStore.getState().pushToast('error', line);
  set({ state: 'error', target: s.target.id });
  setTimeout(() => useMic.getState().state === 'error' && !session && set({ state: 'idle', target: null }), 3000);
}

function close(outcome: NonNullable<MicRecord['outcome']>) {
  const s = session;
  if (!s) return;
  session = null;
  clearInterval(s.tick);
  s.release?.();
  s.release = null;
  if (record) {
    record.end = performance.now();
    record.outcome = outcome;
    record = null;
  }
  set({ state: 'idle', mode: null, target: null, live: false });
  if (s.mode === 'handsfree') {
    if (outcome !== 'sent') listenChime(false);
    step({ type: 'closed' });
  }
}

function explain(line: string, id: string) {
  lastError = line;
  useStore.getState().pushToast('info', line);
  set({ state: 'error', target: id });
  setTimeout(() => useMic.getState().state === 'error' && !session && set({ state: 'idle', target: null }), 3000);
}

/** While the mic listens: the jukebox, other sounds and the CEO's voice dip, the browser's voice pauses, cues wait. */
function quiet(): () => void {
  const unduck = holdMusicDuck();
  setMicOpen(true);
  const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  const paused = !!synth?.speaking && !synth.paused;
  if (paused) synth!.pause();
  return () => {
    unduck();
    setMicOpen(false);
    if (paused) synth!.resume();
  };
}

// ---------- the browser's recognition ----------

function recognise(n: number): Hearing | null {
  const R = recognitionClass();
  if (!R) {
    queueMicrotask(() => fail(n, micProblem() || micErrorLine('audio-capture')));
    return null;
  }
  const r = new R();
  r.lang = navigator.language || 'en-US';
  r.continuous = true;
  r.interimResults = true;
  let error = '';
  r.onstart = () => started(n);
  r.onresult = (e) => {
    const phrases: Phrase[] = Array.from(e.results, (x) => ({ transcript: x[0]?.transcript ?? '', final: x.isFinal }));
    const { text, speaking } = phrasesText(phrases);
    heard(n, text, speaking);
  };
  r.onerror = (e) => {
    error = e.error;
  };
  r.onend = () => {
    const s = live(n);
    if (!s) return;
    if (error) fail(n, micErrorLine(error));
    else deliver(s); // stopped by us, or the browser stopped by itself after a quiet
  };
  try {
    r.start();
  } catch {
    queueMicrotask(() => fail(n, micErrorLine('audio-capture')));
    return null;
  }
  return { stop: () => r.stop(), abort: () => r.abort() };
}

// ---------- recording for ElevenLabs ----------

const RECORDER_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];

async function recordClip(n: number) {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (err) {
    return fail(n, micErrorLine((err as DOMException)?.name || 'audio-capture'));
  }
  const off = () => stream.getTracks().forEach((t) => t.stop());
  const s = live(n);
  if (!s || s.finishing) return off(); // let go before the mic came on
  const type = RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t));
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  } catch {
    off();
    return fail(n, micErrorLine('audio-capture'));
  }
  const chunks: Blob[] = [];
  let bytes = 0;
  let aborted = false;
  const levels = meter(stream, (level) => {
    const cur = live(n);
    if (cur?.ears) cur.ears = heardLevel(cur.ears, level, performance.now());
  });
  rec.ondataavailable = (e) => {
    chunks.push(e.data);
    bytes += e.data.size;
    if (bytes > CLIP_MAX_BYTES * 0.95) finish(); // the cap is near: send what there is
  };
  rec.onstop = () => {
    off();
    levels();
    const cur = live(n);
    if (!cur || aborted) return;
    void transcribe(cur, new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' }), performance.now() - (cur.ears?.start ?? cur.began));
  };
  s.hearing = {
    stop: () => rec.state !== 'inactive' && rec.stop(),
    abort: () => {
      aborted = true;
      if (rec.state !== 'inactive') rec.stop();
      else off();
    },
  };
  rec.start(1000);
  started(n);
}

/** Microphone levels (RMS) about 20 times a second, for the silence detector. Returns its stop. */
function meter(stream: MediaStream, onLevel: (rms: number) => void): () => void {
  let ctx: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  try {
    ctx = new AudioContext();
    void ctx.resume().catch(() => undefined);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser); // never to the speakers
    const buf = new Float32Array(analyser.fftSize);
    timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const x of buf) sum += x * x;
      onLevel(Math.sqrt(sum / buf.length));
    }, 50);
  } catch {
    // no levels: a tap ends when you tap again, and nothing is lost
  }
  return () => {
    if (timer) clearInterval(timer);
    void ctx?.close().catch(() => undefined);
  };
}

async function transcribe(s: Session, clip: Blob, ms: number) {
  if (s.mode === 'handsfree' && s.ears?.lastSpeech == null) return close('nothing'); // nobody spoke: don't pay to hear silence
  const bad = clipProblem({ bytes: clip.size, ms, type: clip.type });
  if (bad) return fail(s.n, `🎙️ ${bad.message}`);
  set({ state: 'transcribing', live: false });
  s.release?.(); // the mic is off: sounds come back while the text is on its way
  s.release = null;
  try {
    const res = await fetch('/api/voice/transcribe', { method: 'POST', headers: { 'Content-Type': clip.type, 'X-Clip-Ms': String(Math.round(ms)) }, body: clip });
    const data = (await res.json().catch(() => ({}))) as { text?: unknown; error?: unknown };
    if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
    if (session !== s) return; // stopped meanwhile
    s.transcript = typeof data.text === 'string' ? data.text : '';
    lastTranscript = s.transcript;
    if (record) record.transcript = s.transcript;
    deliver(s);
  } catch (err) {
    if (session === s) fail(s.n, `🎙️ ${(err as Error).message}`);
  }
}

// ---------- the hands-free phone ----------

let hf: HandsFree = HANDS_FREE_IDLE;
let hfTimer: ReturnType<typeof setTimeout> | null = null;

const phoneTarget = () => [...targets.values()].reverse().find((t) => t.kind === 'phone') ?? null;

function room(): Room {
  const st = useStore.getState();
  const l = listening();
  const o = st.overlay;
  const phone = phoneTarget();
  return {
    enabled: l.handsFree && l.provider !== 'off' && st.settings.voice.provider !== 'off' && !micProblem() && micAllowed,
    phoneChat: o?.kind === 'phone' && (o.tab ?? 'chat') === 'chat' && !!phone && !phone.disabled() && document.visibilityState === 'visible' && !isConfirmOpen(),
    micFree: !session,
    draft: !!phone?.text().trim(),
    muted: getAudioPrefs().muted,
  };
}

function step(ev: HandsFreeEvent) {
  const r = handsFree(hf, ev);
  hf = r.state;
  set({ chiming: hf.kind === 'chime' });
  if (hfTimer && hf.kind !== 'chime') {
    clearTimeout(hfTimer);
    hfTimer = null;
  }
  if (r.effect === 'chime') {
    listenChime(true);
    hfTimer = setTimeout(() => {
      hfTimer = null;
      step({ type: 'tick', now: performance.now(), room: room() });
    }, Math.max(0, (hf.kind === 'chime' ? hf.until : 0) - performance.now()));
  }
  if (r.effect === 'open') {
    const phone = phoneTarget();
    if (phone) listen(phone.id, 'handsfree');
    if (!session) step({ type: 'closed' });
  }
}

/** voiceMessages.ts: a CEO message read aloud in this tab ended by itself, with nothing else waiting to be read. */
export function replyEnded() {
  const r = room();
  if (listening().handsFree && !micAllowed && r.phoneChat && !askedToAllow) {
    // The browser hasn't been asked for the mic yet, and hands-free never asks out of the blue.
    askedToAllow = true;
    useStore.getState().pushToast('info', '🎧 Hold 🎙️ once to let the office use your microphone, then hands-free can listen.');
  }
  step({ type: 'reply-ended', now: performance.now(), room: r });
}

/** Why hands-free can't be turned on now, or ''. */
export function handsFreeProblem(ceoName: string): string {
  return micProblem() || (useStore.getState().settings.voice.provider === 'off' ? `Hands-free needs ${ceoName}'s voice: turn on Speak messages in Settings → Voice.` : '');
}

/** The hands-free switch (the phone's 🎧, Settings → Voice). Turning it on asks for the mic now, from the click. */
export async function setHandsFree(on: boolean, ceoName: string) {
  const why = on ? handsFreeProblem(ceoName) : '';
  if (why) return useStore.getState().pushToast('info', why);
  if (on && !(await allowMic())) return;
  await api.updateSettings({ listen: { ...listening(), handsFree: on } }).catch(() => undefined);
}

/** Asks for the microphone (once per page at most), so hands-free never asks later unprompted. */
async function allowMic(): Promise<boolean> {
  if (micAllowed) return true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    micAllowed = true;
    return true;
  } catch (err) {
    const line = micErrorLine((err as DOMException)?.name || 'audio-capture');
    if (line) useStore.getState().pushToast('error', line);
    return false;
  }
}

// ---------- keys ----------

let vPress: { target: MicTarget; key: string; box: HTMLInputElement | HTMLTextAreaElement | null; timer: ReturnType<typeof setTimeout> } | null = null;
let vTalking = false;

/** Where a key landed, and the message box it talks into ('none': the newest box on screen). */
function placeOf(el: EventTarget | null): { place: KeyPlace; target: MicTarget | null; box: HTMLInputElement | HTMLTextAreaElement | null } {
  const e = el as HTMLElement | null;
  if (e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || e.isContentEditable)) {
    const box = e as HTMLInputElement | HTMLTextAreaElement;
    const target = e.tagName !== 'SELECT' && box.form ? ([...targets.values()].find((t) => t.form() === box.form) ?? null) : null;
    return target && !box.disabled && !box.readOnly ? { place: 'mic-box', target, box } : { place: 'field', target: null, box: null };
  }
  const newest = [...targets.values()].reverse().find((t) => !t.disabled()) ?? null;
  return { place: 'none', target: newest, box: null };
}

/** Types the "v" a short press held back, at the caret, as if it had been typed (React hears an input event). */
function typeHeldV() {
  const p = vPress;
  if (!p) return;
  vPress = null;
  clearTimeout(p.timer);
  const box = p.box;
  if (!box || document.activeElement !== box) return;
  if (!document.execCommand('insertText', false, p.key)) {
    box.setRangeText(p.key, box.selectionStart ?? box.value.length, box.selectionEnd ?? box.value.length, 'end');
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function onKeyDown(e: KeyboardEvent) {
  if (e.code === 'KeyV' && e.repeat && (vPress || vTalking)) return void e.preventDefault();
  if (vPress && e.code !== 'KeyV') typeHeldV(); // typing on: the v comes first
  const { place, target, box } = placeOf(e.target);
  const s = session;
  if (s) {
    if (closesMic(e, s.mode === 'handsfree', place)) {
      e.preventDefault();
      e.stopImmediatePropagation(); // Esc stops listening; it doesn't also close the phone or the panel
      cancel('stopped');
    }
    return;
  }
  if (hf.kind === 'chime' && closesMic(e, true, place)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    step({ type: 'closed' });
    return;
  }
  if (e.repeat || !target || !isTalkKey(e, place) || isConfirmOpen() || listening().provider === 'off') return;
  e.preventDefault(); // held back: a tap types it on release
  vPress = {
    target,
    key: e.key,
    box,
    timer: setTimeout(() => {
      vPress = null;
      vTalking = true;
      listen(target.id, 'hold');
    }, HOLD_MS),
  };
}

function onKeyUp(e: KeyboardEvent) {
  if (e.code !== 'KeyV') return;
  if (vPress) typeHeldV();
  else if (vTalking) {
    vTalking = false;
    if (session?.mode === 'hold') finish();
  }
}

/** Typing in the box while it listens: the keyboard takes over. */
function onInput(e: Event) {
  const s = session;
  const el = e.target as HTMLInputElement | null;
  if (s && el?.form && el.form === s.target.form()) cancel('stopped');
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('input', onInput, true);
  // V's release can't be heard once the window loses focus: finish a V hold, forget a pending V. (The 🎙 button
  // captures the pointer, so its release still arrives.)
  window.addEventListener('blur', () => {
    if (vPress) {
      clearTimeout(vPress.timer);
      vPress = null;
    }
    if (vTalking && session?.mode === 'hold') finish();
    vTalking = false;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      stopListening();
      if (hf.kind === 'chime') step({ type: 'closed' });
    }
  });
  // Muting (M, or the sound settings) closes a mic that opened on its own.
  let wasMuted = getAudioPrefs().muted;
  subscribeAudio(() => {
    const muted = getAudioPrefs().muted;
    if (muted && !wasMuted && session && session.mode !== 'hold') cancel('stopped');
    wasMuted = muted;
  });
  // Whether the browser already lets the office use the mic (from an earlier visit).
  void navigator.permissions
    ?.query({ name: 'microphone' as PermissionName })
    .then((p) => {
      micAllowed ||= p.state === 'granted';
      p.addEventListener('change', () => (micAllowed = p.state === 'granted'));
    })
    .catch(() => undefined);
}

// ---------- the probe ----------

/** A stand-in for the browser's recognition (headless browsers have no mic): __swarmMic.say() is what it hears. */
let fakeLive: FakeRecognition | null = null;
class FakeRecognition implements Recognition {
  lang = '';
  continuous = false;
  interimResults = false;
  onstart: Recognition['onstart'] = null;
  onresult: Recognition['onresult'] = null;
  onerror: Recognition['onerror'] = null;
  onend: Recognition['onend'] = null;
  phrases: RecognitionResultLike[] = [];
  start() {
    fakeLive = this;
    setTimeout(() => this.onstart?.(), 30);
  }
  stop() {
    this.end();
  }
  abort() {
    this.end();
  }
  private end() {
    if (fakeLive !== this) return;
    fakeLive = null;
    setTimeout(() => this.onend?.(), 30);
  }
  say(text: string, final: boolean) {
    this.phrases = [...this.phrases.filter((p) => p.isFinal), { isFinal: final, 0: { transcript: text } }];
    this.onresult?.({ results: this.phrases });
  }
}

const probe = {
  get state(): MicState {
    return useMic.getState().state;
  },
  get mode() {
    return useMic.getState().mode;
  },
  /** The microphone itself is on (listening can show a moment before it is). */
  get live() {
    return useMic.getState().live;
  },
  get provider(): ListenProvider {
    return listening().provider;
  },
  /** The last words heard (or transcribed). */
  get transcript() {
    return lastTranscript;
  },
  get error() {
    return lastError;
  },
  get supported() {
    return micCaps();
  },
  get handsFree() {
    return hf.kind;
  },
  /** Every session: provider, mode, start/end (performance.now()), transcript and outcome. */
  history,
  /** Use a fake recognition instead of the browser's (for tests: there's no mic). */
  fake(on = true) {
    fakeOn = on;
    if (on) micAllowed = true;
  },
  /** What the mic hears now: words for the (fake) recognition, `final` once they're settled; or speech for a recording. */
  say(text: string, final = true) {
    const s = session;
    if (!s) return false;
    if (s.provider === 'elevenlabs') {
      if (s.ears) s.ears = heardWords(s.ears, performance.now());
      return true;
    }
    if (!fakeLive) return false;
    fakeLive.say(text, false);
    if (final) fakeLive.say(text, true);
    return true;
  },
};
(window as unknown as Record<string, unknown>).__swarmMic = probe;
