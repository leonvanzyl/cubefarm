// Captions (Settings → Accessibility): short lines for important sounds, with an arrow towards where each came from,
// and the CEO's messages written out as they're read aloud. Sounds arrive from sfx.ts's recorder (every sound the
// office makes passes through it), the CEO's voice from voiceMessages.ts. Alarms are also read out by screen readers,
// captions on or off (the other alert cues come with a toast, which screen readers already hear). CaptionStrip.tsx draws them; window.__swarmCaptions keeps the last 30 shown, for QA and e2e.

import { create } from 'zustand';
import { CEO_ID } from '../../../shared/types';
import { needsManager } from '../qaCard';
import { useStore } from '../store';
import { GONG } from '../world/layout';
import { getA11y } from './a11y';
import { announce } from './announce';
import { admitCaption, arrowFor, arrowForPan, captionFor, captionMs, estimateSpeechMs, newCaptionGate, spokenChars, withArrow, wordEnd, type CaptionPriority } from './captionRules';
import { listenerAt, listenerFacing, onSoundRecorded, type Vec3 } from './sfx';

export interface CaptionLine {
  id: number;
  text: string;
  priority: CaptionPriority;
}

/** A message being read aloud: what's said, and enough timing to know how far along it is. */
export interface SpeechCaption {
  id: number;
  who: string;
  text: string;
  /** performance.now() when it (or its current clip) started, and how long that runs (ms). */
  partStart: number;
  partMs: number;
  part: number;
  parts: number;
  /** Where a browser voice says it is (a character index), when it says. */
  boundary: number | null;
  /** performance.now() when it finished: it stays up a moment, whole. */
  endedAt: number | null;
}

export const useCaptions = create<{ lines: CaptionLine[]; speech: SpeechCaption | null }>(() => ({ lines: [], speech: null }));

const MAX_LINES = 3;
const SPEECH_LINGER_MS = 2500;

interface ShownRecord {
  text: string;
  priority: CaptionPriority | 'speech';
  at: number;
}
const shown: ShownRecord[] = [];
function remember(text: string, priority: ShownRecord['priority']) {
  shown.push({ text, priority, at: performance.now() });
  if (shown.length > 30) shown.splice(0, shown.length - 30);
}

let seq = 1;

function addLine(text: string, priority: CaptionPriority) {
  const id = seq++;
  remember(text, priority);
  useCaptions.setState((s) => ({ lines: [...s.lines, { id, text, priority }].slice(-MAX_LINES) }));
  setTimeout(() => useCaptions.setState((s) => ({ lines: s.lines.filter((l) => l.id !== id) })), captionMs(priority));
}

// ---------- sounds ----------

const gate = newCaptionGate();

/** The arrow from the listener towards `p`, on the ground plane (looking up or down doesn't turn it). */
function arrowTo(p: Vec3): string {
  const e = listenerAt();
  const { fwd } = listenerFacing();
  const len = Math.hypot(fwd.x, fwd.z) || 1;
  const fx = fwd.x / len;
  const fz = fwd.z / len;
  const dx = p.x - e.x;
  const dz = p.z - e.z;
  return arrowFor(dx * -fz + dz * fx, dx * fx + dz * fz);
}

/** Where a sound that plays everywhere comes from, for its arrow: the gong hangs by the whiteboard. */
function anchorOf(name: string): Vec3 | null {
  if (name === 'gong' && useStore.getState().floor !== 0) return { x: GONG.x, y: GONG.y, z: GONG.z };
  return null;
}

/** What an alarm is about: mission control's newest alarm, else the first PR waiting on the manager. */
function alarmDetail(): string | undefined {
  const { ops, qa } = useStore.getState();
  const last = ops.alarms[ops.alarms.length - 1];
  if (last) return last.kind === 'pr' && last.prNumber !== null ? `PR #${last.prNumber} needs you` : last.text.split(':')[0];
  const q = Object.values(qa).find((r) => needsManager(r));
  return q ? `PR #${q.prNumber} needs you` : undefined;
}

async function detailOf(name: string): Promise<string | undefined> {
  if (name.includes('alarm')) return alarmDetail();
  if (name.startsWith('jukebox:')) {
    const { SONGS } = await import('../world/jukeboxSongs');
    return SONGS.find((s) => `jukebox:${s.id}` === name)?.title;
  }
  return undefined;
}

/** Captions a sound by its name (as sfx.ts records it), from `pos` when it has one, else by its stereo `pan`. */
export function captionSound(name: string, pos: Vec3 | null = null, pan = 0) {
  const info = captionFor(name);
  if (!info) return;
  const on = getA11y().captions;
  const alarm = info.key === 'alarm';
  if (!on && !alarm) return;
  if (!admitCaption(gate, info, performance.now())) return;
  const at = pos ?? anchorOf(name);
  const arrow = at ? arrowTo(at) : arrowForPan(pan);
  void detailOf(name).then((detail) => {
    const text = captionFor(name, detail)?.text ?? info.text;
    if (alarm) announce(text.replace(/^\[|\]$/g, ''), 'assertive');
    if (on) addLine(withArrow(text, arrow), info.priority);
  });
}

onSoundRecorded((rec, heard) => {
  if (heard) captionSound(rec.name, rec.at, rec.pan);
});

// ---------- the CEO's voice ----------

const ceoName = () => useStore.getState().agents[CEO_ID]?.name ?? 'CEO';

/**
 * A message started being read aloud: `text` is what's said (speechText). `clipMs` is the clip's length when it's a
 * recording; without one (the browser's voice) the timing is estimated, then follows the voice's word boundaries.
 */
export function speechStarted(id: number, text: string, clipMs: number | null, parts = 1) {
  if (!getA11y().captions || !text) return;
  remember(`${ceoName()}: ${text}`, 'speech');
  useCaptions.setState({
    speech: { id, who: ceoName(), text, partStart: performance.now(), partMs: clipMs ?? estimateSpeechMs(text), part: 0, parts: Math.max(1, parts), boundary: null, endedAt: null },
  });
}

/** The next clip of a long recorded message started. */
export function speechClip(id: number, part: number, parts: number, clipMs: number) {
  const s = useCaptions.getState().speech;
  if (s?.id === id) useCaptions.setState({ speech: { ...s, part, parts: Math.max(1, parts), partStart: performance.now(), partMs: clipMs } });
}

/** A browser voice reached the word at `charIndex`. */
export function speechWord(id: number, charIndex: number) {
  const s = useCaptions.getState().speech;
  if (s?.id === id) useCaptions.setState({ speech: { ...s, boundary: charIndex } });
}

/** The message finished (or was stopped): it stays up, whole, for a moment. */
export function speechEnded(id: number) {
  const s = useCaptions.getState().speech;
  if (s?.id !== id) return;
  useCaptions.setState({ speech: { ...s, endedAt: performance.now() } });
  setTimeout(() => {
    if (useCaptions.getState().speech?.id === id) useCaptions.setState({ speech: null });
  }, SPEECH_LINGER_MS);
}

/** How many characters of the message have been said by `now`. */
export function spokenSoFar(s: SpeechCaption, now: number): number {
  if (s.endedAt !== null) return s.text.length;
  if (s.boundary !== null) return wordEnd(s.text, s.boundary);
  const inPart = Math.min(1, Math.max(0, (now - s.partStart) / Math.max(1, s.partMs)));
  return spokenChars(s.text, (s.part + inPart) * 1000, s.parts * 1000);
}

if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__swarmCaptions', {
    configurable: true,
    enumerable: false,
    value: {
      shown,
      get lines() {
        return useCaptions.getState().lines.map((l) => l.text);
      },
      get speech() {
        const s = useCaptions.getState().speech;
        return s ? { id: s.id, text: s.text, said: s.text.slice(0, spokenSoFar(s, performance.now())), ended: s.endedAt !== null } : null;
      },
    },
  });
}
