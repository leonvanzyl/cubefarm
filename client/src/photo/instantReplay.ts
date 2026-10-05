// Instant replay: while it's on, the 3D view and the office's sound are recorded all the time (MediaRecorder encodes
// off the main thread) into a ring that keeps only about the last 15 seconds (webmRing.ts). I saves them as a WebM
// download and into photo mode's gallery. Off by default: it costs memory and some encoding.
import { useStore } from '../store';
import { soundStream } from '../ui/sfx';
import { addToGallery, here } from './gallery';
import { officeCanvas } from './gate';
import { download } from './media';
import { fileName } from './shots';
import { createRing, heldBytes, heldMs, pushChunk, replayParts, type WebmRing } from './webmRing';

export const REPLAY_MS = 15_000;

interface Running {
  recorder: MediaRecorder;
  stream: MediaStream;
  ring: WebmRing;
  /** Chunks are parsed one after another, in order. */
  queue: Promise<void>;
  /** Waiting for the next chunk to be parsed (a save flushes the encoder first). */
  flushed: (() => void)[];
}

let run: Running | null = null;
let error: string | null = null;

/** VP8 first: it's the cheapest to keep encoding all day. */
function replayType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const t of ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']) if (MediaRecorder.isTypeSupported(t)) return t;
  return null;
}

export function startReplay() {
  if (run) return;
  const canvas = officeCanvas();
  const type = replayType();
  if (!canvas || typeof canvas.captureStream !== 'function' || !type) {
    error = "This browser can't record the office (it needs MediaRecorder with WebM).";
    return;
  }
  try {
    const stream = canvas.captureStream(30);
    for (const t of soundStream()?.getAudioTracks() ?? []) stream.addTrack(t.clone());
    // A keyframe every second, so a replay can start close to 15 s back (Chromium; others ignore it).
    const options = { mimeType: type, videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 96_000, videoKeyFrameIntervalDuration: 1000 } as MediaRecorderOptions;
    const recorder = new MediaRecorder(stream, options);
    const r: Running = { recorder, stream, ring: createRing(REPLAY_MS), queue: Promise.resolve(), flushed: [] };
    recorder.ondataavailable = (e) => {
      const data = e.data;
      r.queue = r.queue
        .then(async () => {
          if (data.size) pushChunk(r.ring, new Uint8Array(await data.arrayBuffer()));
        })
        .then(() => {
          for (const fn of r.flushed.splice(0)) fn();
        });
    };
    recorder.onerror = () => {
      error = 'Instant replay stopped: the browser could not keep recording.';
      stopReplay();
    };
    recorder.start(1000);
    run = r;
    error = null;
  } catch (err) {
    error = `Instant replay could not start: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export function stopReplay() {
  const r = run;
  run = null;
  if (!r) return;
  if (r.recorder.state !== 'inactive') r.recorder.stop();
  for (const t of r.stream.getTracks()) t.stop();
  for (const fn of r.flushed.splice(0)) fn();
}

/** For window.__swarmPhoto.replay. */
export function replayState() {
  return { running: !!run, seconds: run ? Math.round(heldMs(run.ring) / 100) / 10 : 0, bytes: run ? heldBytes(run.ring) : 0, error: run?.ring.failed ?? error };
}

/** Saves the last 15 seconds as a download and into the gallery. */
export async function saveReplay(): Promise<{ name: string; bytes: number; seconds: number } | null> {
  const r = run;
  const toast = useStore.getState().pushToast;
  if (!r) {
    toast('error', error ?? 'Instant replay is not running.');
    return null;
  }
  // flush what the encoder holds, so the replay ends now
  await new Promise<void>((resolve) => {
    r.flushed.push(resolve);
    if (r.recorder.state === 'recording') r.recorder.requestData();
    else resolve();
  });
  const parts = replayParts(r.ring, REPLAY_MS);
  if (!parts) {
    toast('info', r.ring.failed ? `Instant replay can't read this browser's recording (${r.ring.failed}).` : 'Nothing to replay yet: give it a second.');
    return null;
  }
  const blob = new Blob(parts as BlobPart[], { type: 'video/webm' });
  const seconds = Math.min(heldMs(r.ring), REPLAY_MS + 5000) / 1000;
  const name = fileName(here().label, new Date(), 'webm');
  const canvas = officeCanvas();
  const item = addToGallery(blob, { kind: 'replay', name, width: canvas?.width ?? 0, height: canvas?.height ?? 0, seconds });
  download(item.url, name);
  toast('success', `🎬 Saved the last ${Math.round(seconds)} s as ${name}`);
  return { name, bytes: blob.size, seconds };
}
