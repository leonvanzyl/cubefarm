// A photo mode clip: every frame photo mode draws is copied onto a 2D canvas (at most 1920 wide, with the overlay on
// top) whose stream MediaRecorder encodes with the office's sound, off the main thread, into WebM in memory.
import { drawOverlay, hasOverlay, type OverlayOptions } from './overlay';

export interface ClipOptions {
  /** The 3D view's canvas: copied each frame, straight after photo mode has drawn it. */
  source: HTMLCanvasElement;
  fps: 30 | 60;
  seconds: number;
  overlay: OverlayOptions;
  audio: MediaStream | null;
  type: string;
  /** Called once the clip reaches its length. */
  onLimit: () => void;
}

export interface Clip {
  readonly width: number;
  readonly height: number;
  /** Copies the frame just drawn into the clip. */
  draw(): void;
  /** Seconds recorded so far. */
  elapsed(): number;
  /** Ends the clip and hands back the file. */
  stop(): Promise<Blob>;
}

const MAX_W = 1920;

export function startClip(o: ClipOptions): Clip {
  const k = Math.min(1, MAX_W / Math.max(1, o.source.width));
  // even sizes: some encoders refuse odd ones
  const width = Math.max(2, Math.round((o.source.width * k) / 2) * 2);
  const height = Math.max(2, Math.round((o.source.height * k) / 2) * 2);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  let layer: HTMLCanvasElement | null = null;
  if (hasOverlay(o.overlay)) {
    layer = document.createElement('canvas');
    layer.width = width;
    layer.height = height;
    drawOverlay(layer.getContext('2d')!, width, height, { ...o.overlay, guides: false });
  }
  // Nothing is drawn yet: the 3D view can only be copied straight after photo mode draws it (its next frame).
  const stream = canvas.captureStream(o.fps);
  // a copy of the office's sound, so stopping the clip leaves the shared one running
  const sound = o.audio?.getAudioTracks().map((t) => t.clone()) ?? [];
  for (const t of sound) stream.addTrack(t);
  const pixels = width * height * o.fps;
  const recorder = new MediaRecorder(stream, {
    mimeType: o.type,
    videoBitsPerSecond: Math.round(Math.min(16e6, Math.max(2.5e6, pixels * 0.09))),
    audioBitsPerSecond: 128_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const done = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: o.type.split(';')[0] }));
    recorder.onerror = () => reject(new Error('the recording failed'));
  });
  recorder.start(1000);
  const started = performance.now();
  const limit = setTimeout(o.onLimit, o.seconds * 1000);
  let stopped = false;

  return {
    width,
    height,
    draw() {
      if (stopped) return;
      ctx.drawImage(o.source, 0, 0, width, height);
      if (layer) ctx.drawImage(layer, 0, 0);
    },
    elapsed: () => (performance.now() - started) / 1000,
    stop() {
      if (!stopped) {
        stopped = true;
        clearTimeout(limit);
        if (recorder.state !== 'inactive') recorder.stop();
        const release = () => {
          for (const t of stream.getTracks()) t.stop();
        };
        done.then(release, release);
      }
      return done;
    },
  };
}
