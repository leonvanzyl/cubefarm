// What photo mode draws over the picture with a 2D canvas: the polaroid's white frame, the logo stamp, the floor and
// date caption and (on screen only) rule-of-thirds guides. The same code draws the preview over the 3D view, the
// finished shot at its full size and every frame of a clip, so they all match. Sizes follow the picture's height.

export interface OverlayOptions {
  frame: boolean;
  stamp: string | null;
  caption: string | null;
  guides: boolean;
}

/** The polaroid's border: even on three sides and deeper at the bottom, as fractions of the shorter side. */
export function frameInsets(w: number, h: number): { side: number; top: number; bottom: number } {
  const s = Math.min(w, h);
  return { side: Math.round(s * 0.045), top: Math.round(s * 0.045), bottom: Math.round(s * 0.16) };
}

const FONT = "Fredoka, 'Segoe UI', system-ui, sans-serif";

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draws the overlay onto a `w`×`h` canvas (already holding the picture, or transparent for the preview). */
export function drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, o: OverlayOptions) {
  const unit = Math.min(w, h) / 100;
  let inner = { x: 0, y: 0, w, h };
  ctx.save();
  if (o.frame) {
    const f = frameInsets(w, h);
    inner = { x: f.side, y: f.top, w: w - 2 * f.side, h: h - f.top - f.bottom };
    ctx.fillStyle = '#f7f3ea';
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.rect(inner.x, inner.y, inner.w, inner.h);
    ctx.fill('evenodd');
    // a faint shadow where the print meets the paper
    ctx.strokeStyle = 'rgba(60, 50, 30, 0.18)';
    ctx.lineWidth = Math.max(1, unit * 0.25);
    ctx.strokeRect(inner.x, inner.y, inner.w, inner.h);
  }

  if (o.guides) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = Math.max(1, unit * 0.12);
    ctx.beginPath();
    for (const k of [1 / 3, 2 / 3]) {
      ctx.moveTo(inner.x + inner.w * k, inner.y);
      ctx.lineTo(inner.x + inner.w * k, inner.y + inner.h);
      ctx.moveTo(inner.x, inner.y + inner.h * k);
      ctx.lineTo(inner.x + inner.w, inner.y + inner.h * k);
    }
    ctx.stroke();
  }

  if (o.caption) {
    if (o.frame) {
      // handwritten-ish on the polaroid's deep bottom border
      const f = frameInsets(w, h);
      ctx.fillStyle = '#3a3226';
      ctx.font = `600 ${Math.round(f.bottom * 0.3)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(o.caption, w / 2, h - f.bottom / 2, w - 2 * f.side);
    } else {
      const size = Math.round(unit * 3.2);
      ctx.font = `600 ${size}px ${FONT}`;
      const tw = Math.min(ctx.measureText(o.caption).width, inner.w * 0.7);
      const pad = size * 0.55;
      const x = inner.x + unit * 3;
      const y = inner.y + inner.h - unit * 3 - size - pad;
      ctx.fillStyle = 'rgba(20, 20, 30, 0.55)';
      roundRect(ctx, x, y, tw + pad * 2, size + pad * 1.4, size * 0.45);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(o.caption, x + pad, y + (size + pad * 1.4) / 2, tw);
    }
  }

  if (o.stamp) {
    const size = Math.round(unit * 3.4);
    ctx.font = `700 ${size}px ${FONT}`;
    const label = `✻ ${o.stamp}`;
    const tw = Math.min(ctx.measureText(label).width, inner.w * 0.5);
    const pad = size * 0.5;
    const bw = tw + pad * 2;
    const bh = size + pad * 1.3;
    const x = inner.x + inner.w - unit * 3 - bw;
    const y = o.frame ? inner.y + unit * 3 : inner.y + inner.h - unit * 3 - bh;
    ctx.fillStyle = 'rgba(255, 250, 240, 0.92)';
    ctx.strokeStyle = '#1f1d2b';
    ctx.lineWidth = Math.max(1, size * 0.12);
    roundRect(ctx, x, y, bw, bh, bh * 0.35);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ff8a5b';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('✻', x + pad, y + bh / 2);
    ctx.fillStyle = '#1f1d2b';
    ctx.fillText(o.stamp, x + pad + ctx.measureText('✻ ').width, y + bh / 2, tw - ctx.measureText('✻ ').width);
  }
  ctx.restore();
}

/** Whether there's anything to draw onto a saved picture (guides never are). */
export const hasOverlay = (o: OverlayOptions) => o.frame || !!o.stamp || !!o.caption;
