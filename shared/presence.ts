// Shared presence (#223): everyone viewing the office appears in it as a visitor. The limits both sides agree on, and
// the cleaning applied to everything a browser sends over /ws: the server never trusts a name, colour or number it's
// given, and the client cleans what it shows again. Names are only ever drawn as text (React, canvas), never as HTML.

import type { EmoteId, PresenceEvent, VisitorHeld, VisitorPose } from './types.ts';

/** Longest name, in characters (code points). */
export const NAME_MAX = 24;
/** Longest ping label ("the whiteboard"), in characters. */
export const LABEL_MAX = 40;
/** Visitors drawn, and relayed, per floor. */
export const FLOOR_CAP = 16;
/** A browser sends its pose at most this often, and only when it changed. */
export const SEND_MS = 100;
/** Others are drawn this far in the past, so there are always two poses to ease between. */
export const INTERP_MS = 100;
/** The demo's fake visitors: how many at most, and how many it starts with. */
export const MAX_FAKES = 16;
export const DEMO_FAKES = 2;
/** Inbound /ws messages longer than this are ignored without being parsed. */
export const MAX_MESSAGE = 1024;

export const DEFAULT_NAME = 'Visitor';
/** Profile colours to pick from (Settings → Profile); a new browser gets one at random. */
export const VISITOR_COLORS = ['#ef476f', '#f78c6b', '#ffd166', '#06d6a0', '#118ab2', '#8338ec', '#ff70a6', '#3a86ff'] as const;

export const EMOTES: readonly EmoteId[] = ['wave', 'thumbs', 'clap', 'point', 'laugh'];
export const EMOTE_EMOJI: Record<EmoteId, string> = { wave: '👋', thumbs: '👍', clap: '👏', point: '👉', laugh: '😂' };
export const EMOTE_LABEL: Record<EmoteId, string> = { wave: 'Wave', thumbs: 'Thumbs up', clap: 'Clap', point: 'Point', laugh: 'Laugh' };

/** Where anyone can be: a floor, its balconies and the elevator cabin, with room to spare. Floor -1 is the roof. */
export const BOUNDS = { x: 24, zMin: -16, zMax: 18, yMin: -1, yMax: 5, floorMin: -1, floorMax: 200 };

const HELD_KINDS: readonly VisitorHeld['k'][] = ['ball', 'mug', 'blaster'];

/**
 * Text someone typed, made safe to show anywhere as text: control, format (bidi overrides, zero-width) and private-use
 * characters go, runs of whitespace become one space, piles of combining marks are cut to two, and it's capped at
 * `max` characters. Angle brackets and quotes stay: rendering escapes them.
 */
export function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  const text = raw
    .slice(0, max * 8) // a huge string isn't worth normalising
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/(\p{M}{2})\p{M}+/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(text).slice(0, max).join('').trim();
}

/** A visitor's name: cleaned and capped, or the fallback when nothing is left. */
export const cleanName = (raw: unknown, fallback = DEFAULT_NAME) => cleanText(raw, NAME_MAX) || fallback;

export const cleanLabel = (raw: unknown) => cleanText(raw, LABEL_MAX);

/** A #rrggbb colour (lower case), or the fallback. */
export const cleanColor = (raw: unknown, fallback: string = VISITOR_COLORS[0]) => (typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : fallback);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round = (n: number, places: number) => {
  const k = 10 ** places;
  return Math.round(n * k) / k;
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** An angle wrapped into (-PI, PI]. */
export function wrapAngle(a: number) {
  const t = a % (Math.PI * 2);
  return t > Math.PI ? t - Math.PI * 2 : t <= -Math.PI ? t + Math.PI * 2 : t;
}

export const isFloor = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= BOUNDS.floorMin && (v as number) <= BOUNDS.floorMax;

/** What a visitor holds, if it's a kind others can draw; anything else is "nothing". */
export function cleanHeld(raw: unknown): VisitorHeld | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { k?: unknown; id?: unknown; s?: unknown };
  if (!HELD_KINDS.includes(r.k as VisitorHeld['k']) || typeof r.id !== 'string' || !/^[A-Za-z0-9:_-]{1,40}$/.test(r.id)) return null;
  const held: VisitorHeld = { k: r.k as VisitorHeld['k'], id: r.id };
  if (held.k === 'mug') held.s = finite(r.s) ? clamp(Math.round(r.s), 0, 3) : 0;
  return held;
}

/** A pose from a browser, checked and rounded (centimetres, milliradians); null when it isn't one. */
export function cleanPose(raw: { ts?: unknown; f?: unknown; x?: unknown; z?: unknown; h?: unknown; p?: unknown; held?: unknown }): VisitorPose | null {
  if (!finite(raw.ts) || !isFloor(raw.f) || !finite(raw.x) || !finite(raw.z) || !finite(raw.h) || !finite(raw.p)) return null;
  return {
    ts: Math.round(clamp(raw.ts, 0, 1e13)),
    f: raw.f,
    x: round(clamp(raw.x, -BOUNDS.x, BOUNDS.x), 2),
    z: round(clamp(raw.z, BOUNDS.zMin, BOUNDS.zMax), 2),
    h: round(wrapAngle(raw.h), 3),
    p: round(clamp(raw.p, -1.6, 1.6), 3),
    held: cleanHeld(raw.held),
  };
}

/** A presence message from a browser on /ws, validated and cleaned; null for anything else (ignored here). */
export function parsePresenceEvent(raw: unknown): PresenceEvent | null {
  let m: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > MAX_MESSAGE) return null;
    try {
      m = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!m || typeof m !== 'object') return null;
  const r = m as Record<string, unknown>;
  switch (r.type) {
    case 'hello':
      return { type: 'hello', name: cleanName(r.name), color: cleanColor(r.color) };
    case 'pose': {
      const pose = cleanPose(r);
      return pose && { type: 'pose', ...pose };
    }
    case 'watch':
      return isFloor(r.f) ? { type: 'watch', f: r.f } : null;
    case 'away':
      return { type: 'away' };
    case 'emote':
      return EMOTES.includes(r.e as EmoteId) ? { type: 'emote', e: r.e as EmoteId } : null;
    case 'ping': {
      if (!finite(r.x) || !finite(r.y) || !finite(r.z)) return null;
      return {
        type: 'ping',
        x: round(clamp(r.x, -BOUNDS.x, BOUNDS.x), 2),
        y: round(clamp(r.y, BOUNDS.yMin, BOUNDS.yMax), 2),
        z: round(clamp(r.z, BOUNDS.zMin, BOUNDS.zMax), 2),
        label: cleanLabel(r.label),
      };
    }
    case 'fakes':
      return Number.isInteger(r.n) ? { type: 'fakes', n: clamp(r.n as number, 0, MAX_FAKES) } : null;
    default:
      return null;
  }
}
