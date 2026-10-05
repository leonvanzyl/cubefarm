// Canvas painting as data (#228): the office's painters (draw.ts and the rest) draw onto a recording 2D context on the
// main thread, which only notes what they do; the paint worker replays the notes onto an OffscreenCanvas, where the
// text shaping and rasterising happen. Text measuring is answered on the spot by a real context, since painters lay
// text out with it. Anything a recording can't carry (pixel reads, patterns, paths as objects) marks it unsupported,
// and that texture is painted on the main thread as before.

/** One step: a property set, a method call, a gradient made or given a colour stop. */
export type Op = ['s', string, Value] | ['m', string, Value[]] | ['g', number, 'linear' | 'radial', number[]] | ['gs', number, number, string];
export type Value = string | number | boolean | null | number[] | { g: number } | { img: number };

/** A recorded painting: its steps, and the images it draws (by number), to send along. */
export interface Recording {
  ops: Op[];
  images: CanvasImageSource[];
}

// What a context starts with, for painters that read a property back.
const DEFAULTS: Record<string, unknown> = {
  fillStyle: '#000000',
  strokeStyle: '#000000',
  font: '10px sans-serif',
  textAlign: 'start',
  textBaseline: 'alphabetic',
  direction: 'inherit',
  lineWidth: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  miterLimit: 10,
  lineDashOffset: 0,
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
  shadowBlur: 0,
  shadowColor: 'rgba(0, 0, 0, 0)',
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  imageSmoothingEnabled: true,
  imageSmoothingQuality: 'low',
  letterSpacing: '0px',
  wordSpacing: '0px',
  fontKerning: 'auto',
  textRendering: 'auto',
  filter: 'none',
};

const DRAWING = new Set([
  'fillRect', 'clearRect', 'strokeRect', 'fillText', 'strokeText', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'rect',
  'roundRect', 'quadraticCurveTo', 'bezierCurveTo', 'fill', 'stroke', 'clip', 'save', 'restore', 'translate', 'rotate', 'scale', 'transform',
  'setTransform', 'resetTransform', 'setLineDash', 'drawImage', 'reset',
]);

class Unsupported extends Error {}

/**
 * Runs `draw` against a recording context the size of `w`×`h`. `measure` is a real context for measureText. Returns
 * null when the painter did something a recording can't replay.
 */
export function record(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, measure: CanvasRenderingContext2D): Recording | null {
  const ops: Op[] = [];
  const images: CanvasImageSource[] = [];
  let state: Record<string, unknown> = { ...DEFAULTS };
  const stack: Record<string, unknown>[] = [];
  let lineDash: number[] = [];
  let gradients = 0;
  const canvas = { width: w, height: h };

  const value = (v: unknown): Value => {
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
    if (Array.isArray(v) && v.every((x) => typeof x === 'number')) return [...v];
    if (v && typeof v === 'object' && 'g' in v && typeof (v as { g: unknown }).g === 'number') return { g: (v as { g: number }).g };
    throw new Unsupported();
  };
  const image = (v: unknown): Value => {
    if (v && typeof v === 'object' && (typeof ImageBitmap === 'undefined' || !(v instanceof ImageBitmap)) && !('width' in v)) throw new Unsupported();
    let i = images.indexOf(v as CanvasImageSource);
    if (i < 0) i = images.push(v as CanvasImageSource) - 1;
    return { img: i };
  };
  const gradient = (kind: 'linear' | 'radial', args: number[]) => {
    const id = gradients++;
    ops.push(['g', id, kind, args]);
    return { g: id, addColorStop: (offset: number, color: string) => void ops.push(['gs', id, offset, color]) };
  };

  const methods: Record<string, (...args: unknown[]) => unknown> = {
    measureText: (text) => {
      measure.font = state.font as string;
      measure.letterSpacing = state.letterSpacing as string;
      return measure.measureText(String(text));
    },
    createLinearGradient: (...a) => gradient('linear', a as number[]),
    createRadialGradient: (...a) => gradient('radial', a as number[]),
    getLineDash: () => [...lineDash],
    save: () => {
      stack.push({ ...state, lineDash });
      ops.push(['m', 'save', []]);
    },
    restore: () => {
      const s = stack.pop();
      if (s) {
        lineDash = s.lineDash as number[];
        state = s;
      }
      ops.push(['m', 'restore', []]);
    },
    setLineDash: (d) => {
      lineDash = [...(d as number[])];
      ops.push(['m', 'setLineDash', [value(d)]]);
    },
    reset: () => {
      state = { ...DEFAULTS };
      stack.length = 0;
      lineDash = [];
      ops.push(['m', 'reset', []]);
    },
  };

  const ctx = new Proxy(
    {},
    {
      get(_, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop === 'canvas') return canvas;
        if (prop in methods) return methods[prop];
        if (DRAWING.has(prop)) {
          return (...args: unknown[]) => {
            if (prop === 'drawImage') ops.push(['m', prop, [image(args[0]), ...args.slice(1).map(value)]]);
            else if ((prop === 'fill' || prop === 'stroke' || prop === 'clip') && args[0] !== undefined && typeof args[0] !== 'string') throw new Unsupported();
            else ops.push(['m', prop, args.map(value)]);
          };
        }
        if (prop in DEFAULTS) return state[prop];
        throw new Unsupported(); // getImageData, createPattern, isPointInPath…
      },
      set(_, prop, v) {
        if (typeof prop !== 'string' || !(prop in DEFAULTS)) throw new Unsupported();
        const val = value(v);
        state[prop] = v;
        ops.push(['s', prop, val]);
        return true;
      },
    },
  ) as CanvasRenderingContext2D;

  try {
    draw(ctx);
  } catch (err) {
    if (err instanceof Unsupported) return null;
    throw err;
  }
  return { ops, images };
}

/** Plays a recording onto a real context (in the paint worker). `images` are the bitmaps its drawImage steps use. */
export function replay(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, ops: readonly Op[], images: readonly CanvasImageSource[]) {
  const gradients: CanvasGradient[] = [];
  const real = (v: Value): unknown => (v && typeof v === 'object' && !Array.isArray(v) ? ('g' in v ? gradients[v.g] : images[v.img]) : v);
  const props = ctx as unknown as Record<string, unknown>;
  const calls = ctx as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const op of ops) {
    switch (op[0]) {
      case 's':
        props[op[1]] = real(op[2]);
        break;
      case 'm':
        calls[op[1]](...op[2].map(real));
        break;
      case 'g':
        gradients[op[1]] = op[2] === 'linear' ? ctx.createLinearGradient(...(op[3] as [number, number, number, number])) : ctx.createRadialGradient(...(op[3] as [number, number, number, number, number, number]));
        break;
      case 'gs':
        gradients[op[1]].addColorStop(op[2], op[3]);
        break;
    }
  }
}
