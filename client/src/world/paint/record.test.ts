import { describe, expect, it } from 'vitest';
import { record, replay } from './record';

/** A stand-in 2D context that writes down every call and property set, so a replay can be compared with the real thing. */
function logger() {
  const log: unknown[][] = [];
  let gradients = 0;
  let state: Record<string, unknown> = { textAlign: 'start' };
  const stack: Record<string, unknown>[] = [];
  const target: Record<string, unknown> = {
    canvas: { width: 100, height: 50 },
    createLinearGradient: (...a: number[]) => {
      const g = { n: gradients++, stops: [] as unknown[] };
      log.push(['createLinearGradient', ...a]);
      return { ...g, addColorStop: (o: number, c: string) => void log.push(['addColorStop', g.n, o, c]) };
    },
    measureText: (t: string) => ({ width: t.length * 10 }),
    save: () => {
      stack.push({ ...state });
      log.push(['save']);
    },
    restore: () => {
      state = stack.pop() ?? state;
      log.push(['restore']);
    },
  };
  const ctx = new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      if (prop in state) return state[prop];
      return (...args: unknown[]) => void log.push([prop, ...args.map((a) => (a && typeof a === 'object' && 'n' in a ? `gradient ${(a as { n: number }).n}` : a))]);
    },
    set(_, prop: string, v) {
      state[prop] = v;
      log.push(['=', prop, v && typeof v === 'object' && 'n' in v ? `gradient ${(v as { n: number }).n}` : v]);
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}

/** A painter like draw.ts's: text laid out with measureText, a gradient, paths and a picture. */
function sign(ctx: CanvasRenderingContext2D, picture?: CanvasImageSource) {
  const g = ctx.createLinearGradient(0, 0, 100, 50);
  g.addColorStop(0, '#20224a');
  g.addColorStop(1, '#3a1f4d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.font = '700 20px Fredoka';
  const w = ctx.measureText('hello').width;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('hello', 50 - w / 2, 25);
  ctx.restore();
  ctx.beginPath();
  ctx.roundRect(4, 4, 20, 10, 3);
  ctx.setLineDash([2, 3]);
  ctx.stroke();
  if (picture) ctx.drawImage(picture, 1, 2, 30, 20);
  ctx.fillText(ctx.textAlign, 0, 40); // a property read back after restore
}

describe('recorded painting', () => {
  it('replays exactly what painting directly does, measuring text with a real context', () => {
    const direct = logger();
    const picture = { width: 64, height: 40 } as unknown as CanvasImageSource;
    sign(direct.ctx, picture);

    const measured: string[] = [];
    const measure = { measureText: (t: string) => ({ width: t.length * 10 }) } as unknown as CanvasRenderingContext2D;
    const spy = new Proxy(measure, {
      set(t, p: string, v) {
        if (p === 'font') measured.push(v);
        (t as unknown as Record<string, unknown>)[p] = v;
        return true;
      },
    });
    const rec = record(100, 50, (ctx) => sign(ctx, picture), spy);
    expect(rec).not.toBeNull();
    expect(rec!.images).toEqual([picture]);
    expect(measured).toEqual(['700 20px Fredoka']);

    const replayed = logger();
    replay(replayed.ctx, rec!.ops, rec!.images);
    expect(replayed.log).toEqual(direct.log);
    // the recording is plain data, ready to post to a worker
    expect(JSON.parse(JSON.stringify(rec!.ops))).toEqual(rec!.ops);
  });

  it("gives up on what a recording can't carry, so the texture paints on the main thread", () => {
    const measure = { measureText: () => ({ width: 0 }) } as unknown as CanvasRenderingContext2D;
    expect(record(10, 10, (ctx) => void ctx.getImageData(0, 0, 1, 1), measure)).toBeNull();
    expect(record(10, 10, (ctx) => void (ctx.fillStyle = ctx.createPattern({} as CanvasImageSource, 'repeat')!), measure)).toBeNull();
    expect(record(10, 10, (ctx) => ctx.fill({} as Path2D), measure)).toBeNull();
    expect(record(10, 10, (ctx) => ctx.fill('evenodd'), measure)?.ops).toEqual([['m', 'fill', ['evenodd']]]);
    expect(() => record(10, 10, () => {
      throw new Error('a bug in the painter');
    }, measure)).toThrow('a bug in the painter');
  });
});
