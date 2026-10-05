// Photo mode's arithmetic, pure: how big a shot is, how a supersampled shot is cut into tiles the canvas can render,
// what files are called, the caption's words and which gallery items go when it outgrows its memory.

/** The biggest shot a browser canvas reliably holds: 16384 a side and about 120 megapixels. */
export const MAX_SIDE = 16384;
export const MAX_PIXELS = 120e6;

export const SCALES = [1, 2, 4] as const;
export type ShotScale = (typeof SCALES)[number];

/**
 * A shot's size in pixels: the screen's real pixels (CSS size × device pixel ratio) times `scale`, shrunk to fit the
 * canvas limits. `scale` is what was actually used.
 */
export function shotSize(cssW: number, cssH: number, dpr: number, want: ShotScale): { width: number; height: number; scale: number } {
  const base = Math.max(1, dpr);
  let scale = base * want;
  scale = Math.min(scale, MAX_SIDE / Math.max(cssW, cssH), Math.sqrt(MAX_PIXELS / Math.max(1, cssW * cssH)));
  return { width: Math.max(1, Math.round(cssW * scale)), height: Math.max(1, Math.round(cssH * scale)), scale: scale / base };
}

export interface Tile {
  /** The part of the shot this tile fills (top-left origin, shot pixels). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where the rendered view starts (camera.setViewOffset): `margin` before the part, so blur and edges have context. */
  viewX: number;
  viewY: number;
}

/**
 * Cuts a `width`×`height` shot into tiles of the canvas's own size (`bufW`×`bufH`). Each tile renders `margin` extra
 * pixels round its part (effects that read neighbours stay seamless) and only its middle is kept.
 */
export function tiles(width: number, height: number, bufW: number, bufH: number, margin: number): Tile[] {
  const m = Math.max(0, Math.min(Math.floor(margin), Math.floor((Math.min(bufW, bufH) - 1) / 4)));
  const stepX = bufW - 2 * m;
  const stepY = bufH - 2 * m;
  const out: Tile[] = [];
  // A shot no bigger than the canvas needs no margin: one render, its edges are the shot's edges.
  if (width <= bufW && height <= bufH) return [{ x: 0, y: 0, w: width, h: height, viewX: 0, viewY: 0 }];
  for (let y = 0; y < height; y += stepY)
    for (let x = 0; x < width; x += stepX) out.push({ x, y, w: Math.min(stepX, width - x), h: Math.min(stepY, height - y), viewX: x - m, viewY: y - m });
  return out;
}

/** "acme/web" → "acme-web": safe in a file name on every OS. */
export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'office'
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

/** cubefarm-acme-web-2026-10-05-143022.png */
export function fileName(place: string, at: Date, ext: 'png' | 'webm'): string {
  const d = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `cubefarm-${slug(place)}-${d}.${ext}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The caption overlay: where (the floor's repo, or the lobby) and the date. */
export function caption(place: string, floor: number, at: Date): string {
  const where = floor === 0 ? `${place} · Lobby` : `${place} · Floor ${floor}`;
  return `${where} · ${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}`;
}

/** The time of day phase (0 = midnight) as a clock time, for the time-of-day slider. */
export function clockTime(t: number): string {
  const mins = Math.round((((t % 1) + 1) % 1) * 24 * 60) % (24 * 60);
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
}

/** The gallery's memory budget: shots and clips are kept in this tab only, and the oldest go first. */
export const GALLERY_BYTES = 200 * 1024 * 1024;

/** Which items (oldest first in `items`) to drop so the rest fit in `max` bytes; the newest always stays. */
export function overBudget<T extends { id: number; bytes: number }>(items: readonly T[], max = GALLERY_BYTES): number[] {
  let total = items.reduce((n, i) => n + i.bytes, 0);
  const drop: number[] = [];
  for (let i = 0; i < items.length - 1 && total > max; i++) {
    drop.push(items[i].id);
    total -= items[i].bytes;
  }
  return drop;
}

export const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
