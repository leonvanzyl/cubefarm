import * as THREE from 'three';
import type { FromWorker, ToWorker } from './paint.worker';
import { record, type Recording } from './record';

// Canvas textures painted off the main thread (#228): desk monitors, name tags, the whiteboard, signs and every other
// texture made with useCanvasTexture. Where the browser has OffscreenCanvas in workers, a painting is recorded here
// (record.ts) and played in the paint worker, which sends back an ImageBitmap; a texture never has more than one
// painting in the worker, so a busy monitor's frames don't queue up, only its latest waits. Until the worker has the
// office's fonts, for a painter a recording can't carry, without OffscreenCanvas, or if the worker fails, it paints
// on its canvas here as it always did. `?paint=main` keeps everything here, for comparing. window.__swarmPaint counts
// what was painted where.

type Draw = (ctx: CanvasRenderingContext2D) => void;

const stats = { mode: 'main' as 'starting' | 'worker' | 'main', sent: 0, painted: 0, onMain: 0, failed: 0, workerMs: 0, recordMs: 0 };
const live = new Map<number, PaintedTexture>();
if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmPaint')) {
  Object.defineProperty(window, '__swarmPaint', { get: () => ({ ...stats, textures: live.size, workerMs: Math.round(stats.workerMs), recordMs: Math.round(stats.recordMs) }) });
}

let worker: Worker | null | undefined; // undefined: not started yet; null: not available here
let ready = false; // the worker has the fonts: paintings go to it
let measurer: CanvasRenderingContext2D | null = null;
let nextId = 1;

function canUseWorker() {
  try {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return false;
    if (/[?&]paint=main\b/.test(location.search)) return false;
    return !!new OffscreenCanvas(1, 1).getContext('2d');
  } catch {
    return false;
  }
}

function startWorker() {
  if (worker !== undefined) return;
  worker = null;
  if (!canUseWorker()) return;
  try {
    const w = new Worker(new URL('./paint.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<FromWorker>) => received(e.data);
    // A worker that can't run (a blocked script, a crash): everything paints here from now on.
    w.onerror = () => {
      worker = null;
      ready = false;
      stats.mode = 'main';
      for (const t of [...live.values()]) t.toMain();
    };
    worker = w;
    stats.mode = 'starting';
    const css = document.querySelector<HTMLLinkElement>('link[href*="fonts.googleapis.com/css"]')?.href;
    post({ type: 'fonts', css: css ?? '' });
  } catch {
    worker = null;
  }
}

function post(msg: ToWorker, transfer: Transferable[] = []) {
  worker?.postMessage(msg, transfer);
}

function received(m: FromWorker) {
  if (m.type === 'fontsReady') {
    ready = true;
    stats.mode = 'worker';
    return;
  }
  const t = live.get(m.id);
  if (m.type === 'failed') {
    stats.failed++;
    t?.toMain();
    return;
  }
  stats.painted++;
  stats.workerMs += m.ms;
  if (t) t.show(m.bitmap);
  else m.bitmap.close();
}

/** A texture whose picture is painted by a draw function, in the paint worker when it can be. */
export class PaintedTexture {
  readonly texture: THREE.Texture;
  private readonly id = nextId++;
  private readonly canvas: HTMLCanvasElement;
  private mainOnly = false;
  private busy = false;
  private waiting: Recording | null = null;
  private sentImages: CanvasImageSource[] = [];
  private last: Draw | null = null;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.texture = new THREE.Texture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    startWorker();
    if (worker) live.set(this.id, this);
    else this.mainOnly = true;
  }

  /** Paints the picture `draw` makes: in the worker (it shows a frame or two later) or here, at once. */
  paint(draw: Draw) {
    this.last = draw;
    if (!this.mainOnly && worker && ready) {
      const t0 = performance.now();
      measurer ??= document.createElement('canvas').getContext('2d');
      const rec = measurer ? record(this.w, this.h, draw, measurer) : null;
      stats.recordMs += performance.now() - t0;
      if (rec) {
        if (this.busy) this.waiting = rec;
        else void this.send(rec);
        return;
      }
      this.mainOnly = true; // a painter a recording can't carry: this one paints here from now on
      live.delete(this.id);
    }
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.w, this.h);
    draw(ctx);
    this.showCanvas();
    stats.onMain++;
  }

  private async send(rec: Recording) {
    this.busy = true;
    stats.sent++;
    // the pictures it draws (a screenshot) go along only when they changed
    const same = rec.images.length === this.sentImages.length && rec.images.every((img, i) => img === this.sentImages[i]);
    let images: ImageBitmap[] | undefined;
    if (!same) {
      try {
        images = await Promise.all(rec.images.map((img) => createImageBitmap(img as ImageBitmapSource)));
      } catch {
        return this.toMain();
      }
      this.sentImages = rec.images;
    }
    if (this.mainOnly || !worker) return void images?.forEach((b) => b.close());
    post({ type: 'paint', id: this.id, w: this.w, h: this.h, ops: rec.ops, images }, images ?? []);
  }

  /** A painting came back from the worker. */
  show(bitmap: ImageBitmap) {
    this.busy = false;
    if (this.mainOnly) return void bitmap.close();
    const old = this.texture.image;
    this.texture.image = bitmap;
    this.texture.flipY = false; // the worker flipped it already: WebGL doesn't flip an ImageBitmap
    this.texture.needsUpdate = true;
    if (old instanceof ImageBitmap) old.close();
    const next = this.waiting;
    this.waiting = null;
    if (next) void this.send(next);
  }

  private showCanvas() {
    const old = this.texture.image;
    this.texture.image = this.canvas;
    this.texture.flipY = true;
    this.texture.needsUpdate = true;
    if (old instanceof ImageBitmap) old.close();
  }

  /** Paints here from now on (the worker failed, or failed this painting). */
  toMain() {
    this.mainOnly = true;
    this.busy = false;
    this.waiting = null;
    if (live.delete(this.id)) post({ type: 'drop', id: this.id });
    if (this.last) this.paint(this.last);
  }

  dispose() {
    if (live.delete(this.id)) post({ type: 'drop', id: this.id });
    const img = this.texture.image;
    if (img instanceof ImageBitmap) img.close();
    this.texture.dispose();
  }
}
