import { replay, type Op } from './record';

// The paint worker (#228): plays the main thread's recorded paintings (record.ts) onto OffscreenCanvases and sends
// each back as an ImageBitmap the texture uploads as it is (flipped and not premultiplied, as three.js expects a
// canvas). It loads the office's web fonts itself, since a worker can't see the page's, and repaints what it has
// painted once they arrive, as the main thread does when document.fonts is ready.

export type ToWorker =
  | { type: 'fonts'; css: string }
  | { type: 'paint'; id: number; w: number; h: number; ops: Op[]; images?: ImageBitmap[] }
  | { type: 'drop'; id: number };
export type FromWorker = { type: 'painted'; id: number; bitmap: ImageBitmap; ms: number } | { type: 'failed'; id: number; error: string } | { type: 'fontsReady' };

// The worker's global, typed by hand: the project compiles with the DOM's types, not the worker's.
const scope = self as unknown as {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  fonts: FontFaceSet;
};
const canvases = new Map<string, OffscreenCanvas>();
// Each texture's latest painting and the images it draws, to paint again when the fonts arrive.
const last = new Map<number, { w: number; h: number; ops: Op[]; images: ImageBitmap[] }>();

async function paint(id: number, w: number, h: number, ops: Op[], images: ImageBitmap[]) {
  const t0 = performance.now();
  const key = `${w}x${h}`;
  let canvas = canvases.get(key);
  if (!canvas) {
    canvas = new OffscreenCanvas(w, h);
    canvases.set(key, canvas);
  }
  canvas.width = w; // clears it and resets the context's state
  const ctx = canvas.getContext('2d')!;
  replay(ctx, ops, images);
  const bitmap = await createImageBitmap(canvas, { imageOrientation: 'flipY', premultiplyAlpha: 'none' });
  const msg: FromWorker = { type: 'painted', id, bitmap, ms: performance.now() - t0 };
  scope.postMessage(msg, [bitmap]);
}

/** Loads the faces a Google Fonts stylesheet lists, into this worker. */
async function loadFonts(cssUrl: string) {
  const css = cssUrl ? await fetch(cssUrl).then((r) => (r.ok ? r.text() : '')) : '';
  const loads: Promise<FontFace>[] = [];
  for (const block of css.match(/@font-face\s*{[^}]*}/g) ?? []) {
    const prop = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1].trim();
    const family = prop('font-family')?.replace(/['"]/g, '');
    const src = prop('src');
    if (!family || !src) continue;
    const face = new FontFace(family, src, { weight: prop('font-weight') ?? 'normal', style: prop('font-style') ?? 'normal', unicodeRange: prop('unicode-range') ?? 'U+0-10FFFF' });
    scope.fonts.add(face);
    loads.push(face.load());
  }
  await Promise.allSettled(loads);
}

scope.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'drop') {
    last.delete(m.id);
    return;
  }
  if (m.type === 'fonts') {
    void loadFonts(m.css)
      .catch(() => undefined)
      .then(() => {
        scope.postMessage({ type: 'fontsReady' });
        for (const [id, p] of last) void paint(id, p.w, p.h, p.ops, p.images).catch(() => undefined);
      });
    return;
  }
  const images = m.images ?? last.get(m.id)?.images ?? [];
  last.set(m.id, { w: m.w, h: m.h, ops: m.ops, images });
  paint(m.id, m.w, m.h, m.ops, images).catch((err: unknown) => scope.postMessage({ type: 'failed', id: m.id, error: String(err) }));
};
