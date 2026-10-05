// The browser's side of shared presence (#223; the server's is server/presence.ts): who else is in the office and
// where (eased a little behind their latest poses: presenceMath.ts), what they hold, their emotes and pings, and what
// this tab tells the others about itself. Plain module state read every frame by Presence.tsx, so a pose never
// re-renders React; the store keeps only the list (store.visitors) for the HUD. window.__swarmPresence is the probe.

import { EMOTE_EMOJI, FLOOR_CAP } from '../../../../shared/presence';
import type { EmoteId, PresenceEvent, ServerEvent, VisitorHeld, VisitorPose } from '../../../../shared/types';
import { sendWs, wsOpens, wsTraffic } from '../../net';
import { HALF_D, SPAWN } from '../layout';
import { EMOTE_MS, RateMeter, heldKey, newClock, poseTime, pruneSamples, pushSample, renderDelay, sampleAt, shouldSend, type PoseClock, type Sample } from './presenceMath';
import { useProfile } from './profile';

/** Inside the elevator cabin, and just outside its doors: where riders vanish and appear. */
export const CABIN = { x: 0, z: HALF_D + 0.9 };
const DOOR = { x: SPAWN.x, z: SPAWN.z };
/** How fast someone walks into the elevator when they leave the floor, and how long walking out of it takes. */
const LIFT_SPEED = 2.2;
export const ARRIVE_MS = 1200;
const PING_MS = 5000;
const MAX_PINGS = 8;

export interface Remote {
  id: string;
  name: string;
  color: string;
  floor: number;
  samples: Sample[];
  clock: PoseClock;
  held: VisitorHeld | null;
  emote: { e: EmoteId; at: number } | null;
  /** Off to another floor: walking into the elevator from where they stood, since `at` (performance.now()). */
  leaving: { x: number; z: number; h: number; at: number } | null;
  /** Coming from another floor: 'pending' until their first pose here, then walking out of the cabin since `at`. */
  arriving: 'pending' | { at: number } | null;
}

export interface Ping {
  key: number;
  name: string;
  color: string;
  x: number;
  y: number;
  z: number;
  label: string;
  /** performance.now() when it arrived. */
  at: number;
  mine: boolean;
}

const remotes = new Map<string, Remote>();
let order: string[] = []; // the server's list order (join order): the first FLOOR_CAP on a floor are drawn
let you = '';
let floorHere = Number.NaN; // the floor this tab shows (-1 is the roof, so nothing yet is NaN)
let drawn: string[] = [];
let pings: Ping[] = [];
let pingSeq = 0;
let lastEmote: { id: string; name: string; e: EmoteId; at: number } | null = null;
let myEmote: { e: EmoteId; at: number } | null = null;
let version = 0;
const listeners = new Set<() => void>();
const meters = {
  posesIn: new RateMeter(),
  posesOut: new RateMeter(),
  bytesIn: new RateMeter(),
  bytesOut: new RateMeter(),
  presenceIn: new RateMeter(),
  seen: { in: 0, out: 0, presence: 0 },
};

/** Something drawn changed (who's here, what they hold, the pings): React redraws; poses never come through here. */
function bump() {
  drawn = drawnNow();
  version++;
  for (const fn of listeners) fn();
}

function drawnNow() {
  const here = order.filter((id) => remotes.get(id)?.floor === floorHere).slice(0, FLOOR_CAP);
  const leaving = [...remotes.values()].filter((r) => r.leaving && !here.includes(r.id)).map((r) => r.id);
  return [...here, ...leaving];
}

export function subscribePresence(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export const presenceVersion = () => version;
export const drawnVisitors = (): readonly string[] => drawn;
export const remoteOf = (id: string) => remotes.get(id);
export const activePings = (): readonly Ping[] => pings;
export const myLastEmote = () => myEmote;

// ---------- from the server (store.ts apply) ----------

/** The office's list of visitors changed: someone arrived, left, changed floors or renamed. */
export function takeRoster(ev: Extract<ServerEvent, { type: 'visitors' }>, myFloor: number) {
  setFloorHere(myFloor);
  you = ev.you;
  const now = performance.now();
  const seen = new Set<string>();
  for (const v of ev.visitors) {
    seen.add(v.id);
    const r = remotes.get(v.id);
    if (!r) {
      remotes.set(v.id, { ...v, samples: [], clock: newClock(), held: null, emote: null, leaving: null, arriving: null });
      continue;
    }
    r.name = v.name;
    r.color = v.color;
    if (r.floor === v.floor) continue;
    if (r.floor === floorHere) startLeaving(r, now);
    else if (v.floor === floorHere) {
      r.leaving = null;
      r.arriving = 'pending';
    }
    r.samples = [];
    r.floor = v.floor;
  }
  for (const id of remotes.keys()) if (!seen.has(id)) remotes.delete(id); // gone: they vanish at once
  order = ev.visitors.map((v) => v.id);
  bump();
}

export function takePose(ev: Extract<ServerEvent, { type: 'visitorPose' }>, myFloor: number) {
  setFloorHere(myFloor);
  const r = remotes.get(ev.id);
  if (!r || ev.f !== floorHere) return;
  const now = performance.now();
  meters.posesIn.add(1, now);
  let changed = false;
  if (r.floor !== ev.f) {
    r.floor = ev.f;
    r.samples = [];
    changed = true;
  }
  if (r.leaving) {
    r.leaving = null; // came straight back
    changed = true;
  }
  if (r.arriving === 'pending') r.arriving = { at: now };
  pushSample(r.samples, { t: poseTime(r.clock, ev.ts, now), x: ev.x, z: ev.z, h: ev.h, p: ev.p });
  if (heldKey(r.held) !== heldKey(ev.held)) {
    r.held = ev.held;
    changed = true;
  }
  if (changed) bump();
}

export function takeEmote(ev: Extract<ServerEvent, { type: 'visitorEmote' }>) {
  const r = remotes.get(ev.id);
  if (!r) return;
  r.emote = { e: ev.e, at: performance.now() };
  lastEmote = { id: r.id, name: r.name, e: ev.e, at: Date.now() };
}

export function takePing(ev: Extract<ServerEvent, { type: 'visitorPing' }>) {
  const r = remotes.get(ev.id);
  addPing({ name: r?.name ?? 'Someone', color: r?.color ?? '#ffd166', x: ev.x, y: ev.y, z: ev.z, label: ev.label, mine: false });
}

/** This tab moved to another floor: everyone here is placed afresh from the poses the server sends on arrival. */
export function setFloorHere(f: number) {
  if (f === floorHere) return;
  floorHere = f;
  for (const r of remotes.values()) {
    r.samples = [];
    r.leaving = null;
    r.arriving = null;
  }
  pings = [];
  bump();
}

function addPing(p: Omit<Ping, 'key' | 'at'>) {
  pings = [...pings.slice(-(MAX_PINGS - 1)), { ...p, key: ++pingSeq, at: performance.now() }];
  bump();
}

// ---------- where someone is now ----------

export interface DrawnPose {
  x: number;
  z: number;
  h: number;
  p: number;
}

const tmp: Sample = { t: 0, x: 0, z: 0, h: 0, p: 0 };

function startLeaving(r: Remote, now: number) {
  const at = sampleAt(r.samples, now - renderDelay(r.clock), tmp);
  r.leaving = at ? { x: at.x, z: at.z, h: at.h, at: now } : null;
}

/** Walking into the elevator: along to the doors (unless already there), then into the cabin. Null once inside. */
function leavingPose(l: NonNullable<Remote['leaving']>, now: number, out: DrawnPose): DrawnPose | null {
  const legs = l.z > DOOR.z - 0.3 ? [l, CABIN] : [l, DOOR, CABIN];
  let left = ((now - l.at) / 1000) * LIFT_SPEED;
  for (let i = 1; i < legs.length; i++) {
    const a = legs[i - 1];
    const b = legs[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= len || i === legs.length - 1) {
      const k = len > 0 ? Math.min(1, left / len) : 1;
      if (left > len + 0.4) return null; // inside, and the doors have shut on them
      out.x = a.x + (b.x - a.x) * k;
      out.z = a.z + (b.z - a.z) * k;
      out.h = len > 0.01 ? Math.atan2(-(b.x - a.x), -(b.z - a.z)) : l.h;
      out.p = 0;
      return out;
    }
    left -= len;
  }
  return null;
}

/**
 * Where a visitor is drawn at `now` (performance.now()): eased renderDelay behind their poses, walking out of the
 * elevator for ARRIVE_MS after coming up, or into it when leaving. Null: not to be drawn (yet, or any more).
 */
export function poseNow(r: Remote, now: number, out: DrawnPose): DrawnPose | null {
  if (r.leaving) return leavingPose(r.leaving, now, out);
  const behind = now - renderDelay(r.clock);
  const s = sampleAt(r.samples, behind, tmp);
  if (!s) return null;
  pruneSamples(r.samples, behind);
  out.x = s.x;
  out.z = s.z;
  out.h = s.h;
  out.p = s.p;
  const arriving = r.arriving;
  if (arriving && arriving !== 'pending') {
    const k = (now - arriving.at) / ARRIVE_MS;
    if (k >= 1) r.arriving = null;
    else {
      const e = k * k * (3 - 2 * k);
      const x = CABIN.x + (s.x - CABIN.x) * e;
      const z = CABIN.z + (s.z - CABIN.z) * e;
      if (k < 0.8) out.h = Math.atan2(-(s.x - CABIN.x), -(s.z - CABIN.z));
      out.x = x;
      out.z = z;
    }
  }
  return out;
}

/** Once a frame (Presence.tsx): finished elevator walks, expired pings and emotes, and the probe's rates. */
export function tickPresence(now: number) {
  let changed = false;
  for (const r of remotes.values()) {
    if (r.leaving && now - r.leaving.at > 9000) r.leaving = null; // a walk never takes this long
    if (r.leaving && !leavingPose(r.leaving, now, { x: 0, z: 0, h: 0, p: 0 })) {
      r.leaving = null;
      changed = true;
    }
    if (r.emote && now - r.emote.at > EMOTE_MS) r.emote = null;
  }
  if (pings.length && now - pings[0].at > PING_MS) {
    pings = pings.filter((p) => now - p.at <= PING_MS);
    changed = true;
  }
  if (changed) bump();
  meters.bytesIn.add(wsTraffic.in - meters.seen.in, now);
  meters.bytesOut.add(wsTraffic.out - meters.seen.out, now);
  meters.presenceIn.add(wsTraffic.presence - meters.seen.presence, now);
  meters.seen = { ...wsTraffic };
}

// ---------- what this tab sends ----------

const out = {
  socket: 0,
  hello: '',
  mode: '' as '' | 'away' | 'watch' | 'pose',
  watching: Number.NaN,
  floor: Number.NaN,
  floorAt: 0,
  last: null as { pose: VisitorPose; at: number } | null,
};

const send = (msg: PresenceEvent) => sendWs(msg);

/** This tab as it stands: in the office or not, on which floor, and where (null while it can't say). */
export interface SelfState {
  started: boolean;
  floor: number;
  pose: VisitorPose | null;
}

/**
 * Every frame (Presence.tsx): tells the server what changed. Nothing before you enter the office; "Appear to others"
 * off, only the floor (so you still see the others); otherwise your pose, at most every SEND_MS and only when it moved.
 */
export function syncSelf(s: SelfState, now: number) {
  if (out.socket !== wsOpens()) {
    // a new socket: the server forgot this tab, so tell it everything again
    out.socket = wsOpens();
    out.hello = '';
    out.mode = '';
    out.last = null;
  }
  if (!s.started) {
    if ((out.mode === 'pose' || out.mode === 'watch') && send({ type: 'away' })) out.mode = 'away';
    return;
  }
  const { name, color, appear } = useProfile.getState();
  const hello = `${name}\n${color}`;
  if (hello !== out.hello && send({ type: 'hello', name, color })) out.hello = hello;
  if (s.floor !== out.floor) {
    out.floor = s.floor;
    out.floorAt = now;
  }
  if (!appear) {
    if ((out.mode !== 'watch' || out.watching !== s.floor) && send({ type: 'watch', f: s.floor })) {
      out.mode = 'watch';
      out.watching = s.floor;
      out.last = null;
    }
    return;
  }
  // Just off the elevator, the camera is still where you stood upstairs for a frame or two.
  if (now - out.floorAt < 150 || !s.pose) return;
  if (out.mode !== 'pose') out.last = null;
  if (!shouldSend(out.last, s.pose, now)) return;
  if (!send({ type: 'pose', ...s.pose })) return;
  out.mode = 'pose';
  out.last = { pose: s.pose, at: now };
  meters.posesOut.add(1, now);
}

/** Plays an emote for the others on your floor (and shows it to you). */
export function emote(e: EmoteId) {
  myEmote = { e, at: performance.now() };
  lastEmote = { id: you || 'me', name: useProfile.getState().name, e, at: Date.now() };
  if (useProfile.getState().appear) send({ type: 'emote', e });
  bump();
}

/** Drops a ping where you look: the others on the floor see it (and so do you). */
export function ping(x: number, y: number, z: number, label: string) {
  const { name, color, appear } = useProfile.getState();
  addPing({ name, color, x, y, z, label, mine: true });
  if (appear) send({ type: 'ping', x, y, z, label });
}

// ---------- the probe ----------

let follow: { start: (id: string) => boolean; stop: () => void; current: () => string | null } | null = null;

/** The follow cam (follow.ts) plugs in here, for the HUD's people list and the probe. */
export function setFollower(f: typeof follow) {
  follow = f;
}

export const followVisitor = (id: string) => follow?.start(id) ?? false;
export const stopFollowing = () => follow?.stop();
export const following = () => follow?.current() ?? null;

const round = (n: number) => Math.round(n * 100) / 100;

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__swarmPresence = {
    /** This tab: its id on the server, profile and what it last told the server. */
    me: () => ({ id: you, ...useProfile.getState(), set: undefined, mode: out.mode || 'away', floor: floorHere }),
    /** The office's list of other visitors (any floor). */
    roster: () => order.map((id) => remotes.get(id)).filter(Boolean).map((r) => ({ id: r!.id, name: r!.name, color: r!.color, floor: r!.floor })),
    /** Who is drawn on this floor right now, where, holding what and doing what. */
    visible: () => {
      const now = performance.now();
      const p: DrawnPose = { x: 0, z: 0, h: 0, p: 0 };
      return drawn.map((id) => {
        const r = remotes.get(id)!;
        const at = poseNow(r, now, p);
        return {
          id,
          name: r.name,
          x: at ? round(at.x) : null,
          z: at ? round(at.z) : null,
          heading: at ? round(at.h) : null,
          held: r.held,
          emote: r.emote ? EMOTE_EMOJI[r.emote.e] : null,
          leaving: !!r.leaving,
          arriving: !!r.arriving,
        };
      });
    },
    /** Messages and bytes a second, over the last two seconds: presence's bytes in, and everything on /ws in and out. */
    rates: () => {
      const now = performance.now();
      return {
        posesInPerSec: meters.posesIn.perSecond(now),
        posesOutPerSec: meters.posesOut.perSecond(now),
        presenceBytesInPerSec: meters.presenceIn.perSecond(now),
        bytesInPerSec: meters.bytesIn.perSecond(now),
        bytesOutPerSec: meters.bytesOut.perSecond(now),
      };
    },
    lastEmote: () => lastEmote,
    pings: () => pings.map((p) => ({ name: p.name, label: p.label, x: p.x, y: p.y, z: p.z, mine: p.mine })),
    /** Settings → Profile's "Appear to others". */
    appear: (on: boolean) => useProfile.getState().set({ appear: on }),
    /** The demo's fake visitors: how many wander about (0–16). */
    fakes: (n: number) => send({ type: 'fakes', n }),
    emote: (e: EmoteId) => emote(e),
    ping: (x: number, y: number, z: number, label = '') => ping(x, y, z, label),
    follow: (id: string) => followVisitor(id),
    unfollow: () => stopFollowing(),
    following: () => following(),
  };
}
