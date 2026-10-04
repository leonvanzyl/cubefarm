import { EMOTES, INTERP_MS, SEND_MS, wrapAngle } from '../../../../shared/presence';
import type { AgentLook, EmoteId, VisitorHeld, VisitorPose } from '../../../../shared/types';

// The pure side of presence in the browser (presence.ts): easing between the poses others send, deciding when to
// send ours, the emote wheel's slices, what a ping points at, and how a visitor looks. Tested in presenceMath.test.ts.

// ---------- easing between poses ----------

/** A pose as received: `t` is performance.now() when it arrived. */
export interface Sample {
  t: number;
  x: number;
  z: number;
  h: number;
  p: number;
}

/** Samples kept per visitor; at 10 a second that's three seconds, far more than the INTERP_MS needed. */
const KEEP = 30;
/**
 * A pose this long after the one before means they stood still meanwhile (only changes are sent). Long enough that a
 * sender drawing only a few frames a second still reads as walking.
 */
const STILL_MS = 600;

/**
 * Adds a pose. After a pause, the previous pose is repeated just before it, so they walk off from where they stood
 * over one send interval instead of drifting there over the whole pause.
 */
export function pushSample(samples: Sample[], s: Sample, interp = INTERP_MS) {
  const last = samples[samples.length - 1];
  if (last && s.t <= last.t) s.t = last.t + 1; // the clocks' offset moved: keep time running forwards
  if (last && s.t - last.t > STILL_MS) samples.push({ ...last, t: s.t - interp });
  samples.push(s);
  if (samples.length > KEEP) samples.splice(0, samples.length - KEEP);
}

/** Never further behind than this, however unevenly poses come. */
const MAX_DELAY = 400;

/**
 * Puts others' poses on this tab's clock. Each pose carries the time it was sent on the sender's clock; the quickest
 * recent arrival gives the offset between the two clocks, so a pose's place in time is when it was sent (plus that
 * offset), not when a busy tab got round to reading it. `gap` follows how far apart they're sent (100 ms, or a slow
 * sender's frames) and `late` how much later than the quickest the rest arrive; drawing waits for both (renderDelay),
 * so there's always a next pose to ease towards, on a choppy connection or a slow machine too.
 */
export interface PoseClock {
  offsets: { at: number; v: number }[];
  late: number;
  gap: number;
  lastSent: number | null;
}

export const newClock = (): PoseClock => ({ offsets: [], late: 0, gap: INTERP_MS, lastSent: null });

/** Up at once, down slowly: a hiccup is allowed for straight away and forgotten gradually. */
const follow = (cur: number, v: number) => (v > cur ? v : cur + (v - cur) * 0.05);

/** Where on this tab's clock a pose sent at `sent` (the sender's clock) belongs; it arrived at `now`. */
export function poseTime(c: PoseClock, sent: number, now: number) {
  const v = now - sent;
  c.offsets.push({ at: now, v });
  while (c.offsets.length > 1 && now - c.offsets[0].at > 3000) c.offsets.shift();
  let off = Infinity;
  for (const o of c.offsets) off = Math.min(off, o.v);
  c.late = follow(c.late, v - off);
  if (c.lastSent !== null && sent - c.lastSent < STILL_MS) c.gap = follow(c.gap, sent - c.lastSent);
  c.lastSent = sent;
  return sent + off;
}

/** How far in the past to draw someone: about INTERP_MS, more while their poses come further apart or late. */
export const renderDelay = (c: PoseClock) => Math.min(MAX_DELAY, Math.max(INTERP_MS, c.gap + c.late + 20));

/** Drops samples nobody will ease from again (all but the last one before time t). */
export function pruneSamples(samples: Sample[], t: number) {
  let i = 0;
  while (i + 1 < samples.length && samples[i + 1].t <= t) i++;
  if (i > 0) samples.splice(0, i);
}

/** Where someone was at time t, eased between the two poses around it (held at either end). Writes into `out`. */
export function sampleAt(samples: Sample[], t: number, out: Sample): Sample | null {
  const n = samples.length;
  if (!n) return null;
  let a = samples[0];
  let b = a;
  if (t >= samples[n - 1].t) a = b = samples[n - 1];
  else if (t > a.t) {
    for (let i = 1; i < n; i++) {
      if (samples[i].t >= t) {
        a = samples[i - 1];
        b = samples[i];
        break;
      }
    }
  }
  const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
  out.t = t;
  out.x = a.x + (b.x - a.x) * k;
  out.z = a.z + (b.z - a.z) * k;
  out.h = wrapAngle(a.h + wrapAngle(b.h - a.h) * k);
  out.p = a.p + (b.p - a.p) * k;
  return out;
}

// ---------- sending ours ----------

export const heldKey = (h: VisitorHeld | null) => (h ? `${h.k}:${h.id}:${h.s ?? ''}` : '');

/** Whether two poses differ enough to be worth sending (a centimetre, about half a degree). */
export function poseChanged(a: VisitorPose, b: VisitorPose) {
  return (
    a.f !== b.f ||
    Math.abs(a.x - b.x) > 0.01 ||
    Math.abs(a.z - b.z) > 0.01 ||
    Math.abs(wrapAngle(a.h - b.h)) > 0.01 ||
    Math.abs(a.p - b.p) > 0.02 ||
    heldKey(a.held) !== heldKey(b.held)
  );
}

/** At most every SEND_MS, and only when it changed. `last` is what was sent last and when (null: nothing yet). */
export function shouldSend(last: { pose: VisitorPose; at: number } | null, next: VisitorPose, now: number, gap = SEND_MS) {
  if (!last) return true;
  return now - last.at >= gap && poseChanged(last.pose, next);
}

// ---------- rates, for the probe ----------

/** Counts something (messages, bytes) over the last two seconds. */
export class RateMeter {
  private hits: { t: number; n: number }[] = [];
  add(n: number, now: number) {
    this.hits.push({ t: now, n });
    this.trim(now);
  }
  perSecond(now: number) {
    this.trim(now);
    return this.hits.reduce((s, h) => s + h.n, 0) / 2;
  }
  private trim(now: number) {
    let i = 0;
    while (i < this.hits.length && now - this.hits[i].t >= 2000) i++;
    if (i) this.hits.splice(0, i);
  }
}

// ---------- the emote wheel ----------

/** The wheel's slices, clockwise from the top. */
export const WHEEL: readonly EmoteId[] = EMOTES;

/**
 * Which slice the mouse points at, from how far it moved since the wheel opened (screen pixels, y down). Inside the
 * dead zone, none.
 */
export function wheelPick(dx: number, dy: number, deadZone = 28): EmoteId | null {
  if (Math.hypot(dx, dy) < deadZone) return null;
  const turn = Math.atan2(dx, -dy); // 0 up, clockwise
  const slice = (Math.PI * 2) / WHEEL.length;
  const i = Math.round(turn / slice);
  return WHEEL[((i % WHEEL.length) + WHEEL.length) % WHEEL.length];
}

/** Where slice i sits on a wheel of radius r (screen pixels from the middle, y down). */
export function wheelSpot(i: number, r: number) {
  const a = (i * Math.PI * 2) / WHEEL.length;
  return { x: Math.sin(a) * r, y: -Math.cos(a) * r };
}

/** The gesture (body.ts) each emote plays. */
export const EMOTE_GESTURE = { wave: 'wave', thumbs: 'thumbs', clap: 'clap', point: 'reach', laugh: 'nod' } as const satisfies Record<EmoteId, string>;
/** How long an emote plays (ms). */
export const EMOTE_MS = 2400;

// ---------- pings ----------

/** The crosshair's target, as much of it as a ping needs (store.ts Focus). */
export interface PingFocus {
  id: string;
  action: { kind: string; toyId?: string; agentId?: string };
}

/** What a ping points at, in words ("the whiteboard"), from what the crosshair was on; '' for a spot on the floor. */
export function pingNoun(focus: PingFocus | null, nameOf: (agentId: string) => string | undefined = () => undefined): string {
  if (!focus) return '';
  const a = focus.action;
  switch (a.kind) {
    case 'kanban':
    case 'card':
      return 'the whiteboard';
    case 'terminal': {
      const name = a.agentId ? nameOf(a.agentId) : undefined;
      return name ? `${name}'s desk` : 'this desk';
    }
    case 'hire':
      return 'an empty desk';
    case 'app':
      return 'the app monitor';
    case 'elevator':
      return 'the elevator';
    case 'manager':
      return "the manager's desk";
    case 'coffee':
      return 'the coffee machine';
    case 'jukebox':
      return 'the jukebox';
    case 'phone':
      return focus.id === 'ceo-visit' ? 'the CEO' : focus.id.startsWith('candidate-') ? 'a candidate' : 'this';
    case 'pickup': {
      const toy = a.toyId ?? '';
      if (toy.startsWith('blaster')) return 'a blaster';
      if (toy.includes('mug')) return 'a mug';
      if (toy === 'basketball') return 'the basketball';
      return toy.endsWith('ball') ? `the ${toy.replace(/-ball$/, '')} ball` : 'this';
    }
    case 'poke':
      return a.toyId === 'gong' ? 'the gong' : a.toyId === 'roomba' ? 'the roomba' : 'this';
    default:
      return 'this';
  }
}

// ---------- how a visitor looks ----------

const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#d9a066'];
const HAIRS = ['#2b2118', '#4a3123', '#a0522d', '#e2b866', '#1f1d2b', '#b55239', '#d8d8d8'];

function hash(s: string) {
  let n = 2166136261;
  for (let i = 0; i < s.length; i++) n = Math.imul(n ^ s.charCodeAt(i), 16777619) >>> 0;
  return n;
}

/** A visitor's face and hair, picked from their id, so they look the same to everyone. */
export function visitorLooks(id: string): { look: AgentLook; skin: string; hair: string } {
  const n = hash(id);
  return { look: n % 2 ? 'feminine' : 'masculine', skin: SKINS[(n >>> 3) % SKINS.length], hair: HAIRS[(n >>> 7) % HAIRS.length] };
}
