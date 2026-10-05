// Shared presence (#223): everyone viewing the office appears in it as a visitor. Each /ws client that entered the 3D
// office sends its pose, emotes and pings (cleaned by shared/presence.ts); the hub relays them to the others on the
// same floor, at most FLOOR_CAP visitors a floor, and keeps nothing on disk. Who hears whom (the interest rules) and
// how often are the pure functions at the top, tested in presence.test.ts. In the demo, fake visitors
// (demoVisitors.ts) wander the floor the last real visitor is on.

import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import { DEMO_FAKES, FLOOR_CAP, MAX_FAKES, MAX_MESSAGE, cleanName, parsePresenceEvent } from '../shared/presence.ts';
import type { ServerEvent, VisitorPose, VisitorView } from '../shared/types.ts';
import { fakeProfile, newWalker, poseOf, stepWalker, type Walker } from './demoVisitors.ts';

/** away: not in the office · watching: in it, on `floor`, but not appearing · visible: appearing at `pose`. */
export type Mode = 'away' | 'watching' | 'visible';

export interface Peer {
  id: string;
  /** Join order: the first FLOOR_CAP visible on a floor are the ones drawn. */
  seq: number;
  name: string;
  color: string;
  mode: Mode;
  floor: number | null;
  pose: VisitorPose | null;
  /** When its pose was last relayed, and whether a newer one waits for the next tick. */
  relayedAt: number;
  dirty: boolean;
  emoteAt: number;
  pingAt: number;
  send: (data: string) => void;
  /** One of the demo's fake visitors (demoVisitors.ts): it sends and receives nothing. */
  walker: Walker | null;
}

/** A pose relayed at most this often per visitor (the browser sends every 100 ms at most; this absorbs jitter). */
export const RELAY_GAP_MS = 80;
export const EMOTE_GAP_MS = 400;
export const PING_GAP_MS = 700;
const TICK_MS = 100;

// ---------- the rules (pure) ----------

/** The visitors drawn on `floor`: those appearing there, in join order, the first `cap`. */
export function visibleOn(peers: Iterable<Peer>, floor: number, cap = FLOOR_CAP): Peer[] {
  const here: Peer[] = [];
  for (const p of peers) if (p.mode === 'visible' && p.floor === floor) here.push(p);
  return here.sort((a, b) => a.seq - b.seq).slice(0, cap);
}

/**
 * Who hears what `sender` does (its pose, emotes, pings): everyone else in the office on the same floor, as long as
 * the sender is one of the floor's drawn visitors. Other floors, the start screen and fakes hear nothing.
 */
export function recipients(peers: Iterable<Peer>, sender: Peer, cap = FLOOR_CAP): Peer[] {
  if (sender.mode !== 'visible' || sender.floor === null) return [];
  const all = [...peers];
  if (!visibleOn(all, sender.floor, cap).includes(sender)) return [];
  return all.filter((p) => p !== sender && !p.walker && p.mode !== 'away' && p.floor === sender.floor);
}

/** Everyone appearing in the office, on any floor, in join order: the people list each browser shows (minus itself). */
export function roster(peers: Iterable<Peer>): VisitorView[] {
  return [...peers]
    .filter((p) => p.mode === 'visible' && p.floor !== null)
    .sort((a, b) => a.seq - b.seq)
    .map((p) => ({ id: p.id, name: p.name, color: p.color, floor: p.floor! }));
}

/** Whether something rate-limited may happen again: `last` was the previous time, `gap` the least time between. */
export const due = (last: number, now: number, gap: number) => now - last >= gap;

// ---------- the hub ----------

export interface HubOptions {
  /** Run the demo's fake visitors (DEMO_FAKES of them to start with). */
  demo?: boolean;
  now?: () => number;
  /** Tick on a timer (flush held-back poses, walk the fakes); tests call tick() themselves. */
  timer?: boolean;
}

export class PresenceHub {
  private peers = new Map<string, Peer>();
  private seq = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastTick = 0;
  /** The floor the most recent real visitor moved on: where the fakes go. */
  private liveFloor: number | null = null;
  private readonly now: () => number;
  private readonly demo: boolean;
  private readonly useTimer: boolean;

  constructor(opts: HubOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.demo = opts.demo ?? false;
    this.useTimer = opts.timer ?? true;
    if (this.demo) this.setFakes(DEMO_FAKES);
  }

  /** A browser connected on /ws: its messages come here, and it hears the others. */
  attach(ws: WebSocket) {
    const peer = this.join((data) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const size = Array.isArray(data) ? data.reduce((n, b) => n + b.length, 0) : data instanceof ArrayBuffer ? data.byteLength : data.length;
      if (size <= MAX_MESSAGE * 4) this.receive(peer, data.toString());
    });
    ws.on('close', () => this.leave(peer));
  }

  join(send: (data: string) => void): Peer {
    const peer = this.add({ send, walker: null });
    this.sendRoster(peer);
    this.ensureTimer();
    return peer;
  }

  leave(peer: Peer) {
    if (!this.peers.has(peer.id)) return;
    this.move(peer, 'away', null, null);
    this.peers.delete(peer.id);
    if (![...this.peers.values()].some((p) => !p.walker)) this.stopTimer();
  }

  /** A message from a browser (anything: it's parsed and cleaned here). */
  receive(peer: Peer, raw: unknown) {
    const msg = parsePresenceEvent(raw);
    if (!msg || !this.peers.has(peer.id)) return;
    const now = this.now();
    switch (msg.type) {
      case 'hello':
        if (peer.name === msg.name && peer.color === msg.color) return;
        peer.name = msg.name;
        peer.color = msg.color;
        if (peer.mode === 'visible') this.broadcastRoster();
        return;
      case 'pose': {
        const { type: _type, ...pose } = msg;
        this.liveFloor = pose.f;
        this.move(peer, 'visible', pose.f, pose);
        return;
      }
      case 'watch':
        this.liveFloor = msg.f;
        this.move(peer, 'watching', msg.f, null);
        return;
      case 'away':
        this.move(peer, 'away', null, null);
        return;
      case 'emote':
        if (!due(peer.emoteAt, now, EMOTE_GAP_MS)) return;
        peer.emoteAt = now;
        this.toFloor(peer, { type: 'visitorEmote', id: peer.id, e: msg.e });
        return;
      case 'ping':
        if (!due(peer.pingAt, now, PING_GAP_MS)) return;
        peer.pingAt = now;
        this.toFloor(peer, { type: 'visitorPing', id: peer.id, x: msg.x, y: msg.y, z: msg.z, label: msg.label });
        return;
      case 'fakes':
        if (this.demo) this.setFakes(msg.n);
        return;
    }
  }

  /** Held-back poses go out, and the fakes take a step. Runs every TICK_MS while anyone is connected. */
  tick() {
    const now = this.now();
    const dt = this.lastTick ? Math.min(0.5, (now - this.lastTick) / 1000) : TICK_MS / 1000;
    this.lastTick = now;
    for (const p of this.peers.values()) {
      if (p.walker) this.stepFake(p, dt);
      else if (p.dirty && due(p.relayedAt, now, RELAY_GAP_MS)) this.relayNow(p);
    }
  }

  /** The demo's fake visitors: how many wander about (0 to MAX_FAKES). */
  setFakes(n: number) {
    const fakes = [...this.peers.values()].filter((p) => p.walker);
    const want = Math.max(0, Math.min(MAX_FAKES, Math.round(n)));
    for (let i = fakes.length; i < want; i++) {
      const look = fakeProfile(i);
      const fake = this.add({ send: () => undefined, walker: newWalker(i) });
      fake.name = cleanName(look.name);
      fake.color = look.color;
    }
    for (const f of fakes.slice(want)) {
      this.move(f, 'away', null, null);
      this.peers.delete(f.id);
    }
  }

  /** What the probe and tests see: everyone, by mode and floor. */
  state() {
    return [...this.peers.values()].map((p) => ({ id: p.id, name: p.name, mode: p.mode, floor: p.floor, fake: !!p.walker }));
  }

  stop() {
    this.stopTimer();
  }

  // ---------- inside ----------

  private add(opts: { send: (data: string) => void; walker: Walker | null }): Peer {
    const peer: Peer = {
      id: crypto.randomBytes(4).toString('hex'),
      seq: this.seq++,
      name: cleanName(''),
      color: '#ef476f',
      mode: 'away',
      floor: null,
      pose: null,
      relayedAt: 0,
      dirty: false,
      emoteAt: 0,
      pingAt: 0,
      ...opts,
    };
    this.peers.set(peer.id, peer);
    return peer;
  }

  /** Someone arrives on, leaves or moves about a floor, or (dis)appears. */
  private move(peer: Peer, mode: Mode, floor: number | null, pose: VisitorPose | null) {
    if (peer.mode === mode && peer.floor === floor) {
      if (pose) {
        peer.pose = pose;
        this.relay(peer);
      }
      return;
    }
    const wasVisible = peer.mode === 'visible';
    const arrived = mode !== 'away' && (floor !== peer.floor || peer.mode === 'away');
    const touched = [peer.floor, floor].filter((f): f is number => f !== null);
    const shownBefore = new Set(touched.flatMap((f) => visibleOn(this.peers.values(), f)));
    peer.mode = mode;
    peer.floor = floor;
    peer.pose = pose;
    peer.dirty = false;
    // the floor's list first, so browsers know someone changed floors before their first pose there
    if (wasVisible || mode === 'visible') this.broadcastRoster();
    if (arrived && !peer.walker) this.catchUp(peer);
    if (pose) this.relayNow(peer);
    // someone left a full floor: whoever was 17th steps into view
    for (const f of touched) for (const p of visibleOn(this.peers.values(), f)) if (p !== peer && !shownBefore.has(p) && p.pose) this.relayNow(p);
  }

  private relay(peer: Peer) {
    if (due(peer.relayedAt, this.now(), RELAY_GAP_MS)) this.relayNow(peer);
    else peer.dirty = true;
  }

  private relayNow(peer: Peer) {
    peer.relayedAt = this.now();
    peer.dirty = false;
    if (peer.pose) this.toFloor(peer, { type: 'visitorPose', id: peer.id, ...peer.pose });
  }

  private toFloor(sender: Peer, ev: ServerEvent) {
    const to = recipients(this.peers.values(), sender);
    if (!to.length) return;
    const msg = JSON.stringify(ev);
    for (const p of to) p.send(msg);
  }

  /** Someone just arrived on a floor: where everyone drawn there stands. */
  private catchUp(peer: Peer) {
    if (peer.floor === null) return;
    for (const p of visibleOn(this.peers.values(), peer.floor)) {
      if (p !== peer && p.pose) peer.send(JSON.stringify({ type: 'visitorPose', id: p.id, ...p.pose } satisfies ServerEvent));
    }
  }

  private sendRoster(peer: Peer, all = roster(this.peers.values())) {
    if (peer.walker) return;
    peer.send(JSON.stringify({ type: 'visitors', you: peer.id, visitors: all.filter((v) => v.id !== peer.id) } satisfies ServerEvent));
  }

  private broadcastRoster() {
    const all = roster(this.peers.values());
    for (const p of this.peers.values()) this.sendRoster(p, all);
  }

  private stepFake(p: Peer, dt: number) {
    const w = p.walker!;
    const step = stepWalker(w, dt, this.liveFloor, Math.random);
    if (w.floor === null) return;
    if (step.moved || p.floor !== w.floor) this.move(p, 'visible', w.floor, poseOf(w));
    if (step.emote) this.toFloor(p, { type: 'visitorEmote', id: p.id, e: step.emote });
    if (step.ping) this.toFloor(p, { type: 'visitorPing', id: p.id, ...step.ping });
  }

  private ensureTimer() {
    if (this.timer || !this.useTimer) return;
    this.lastTick = 0;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
