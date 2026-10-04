// Room acoustics, live: one shared reverb for the space you're in. Every sound group but the voice and the outside sends
// a little into it (sfx.ts), and its echo comes back through the bus, so footsteps, chatter, toys, the jukebox and the
// gong all sit in the same room. Two convolvers take turns: settling into a new space (through a door, into the
// elevator) writes its impulse (acoustics.ts) into the idle one and cross-fades, and the old one is cut off once
// silent, so the cost stays at two convolvers however many sounds play. A timer follows the listener (not the frame
// loop, which stops behind a panel), and tells sfx.ts which space each sound is in, so walls muffle the ones behind them.

import { doorOpen } from '../world/doors';
import { SIDES, type Side } from '../world/layout';
import { FADE, ROOM_SENDS, ROOM_SOUND, fillImpulse, newRoomTracker, occlusion, roomAt, trackRoom, zoneAt, type Room, type Zone } from './acoustics';
import { listenerAt, recordSfx, roomBus, setOccluder, type Vec3 } from './sfx';

type FloorKind = 'office' | 'lobby';

const TICK_MS = 100;
/** How long after a cross-fade the old room's convolver is cut off: its gain is 0 by then and its tail gone. */
const UNHOOK_AFTER = FADE + 0.4;

interface Slot {
  conv: ConvolverNode;
  gain: GainNode;
  fed: boolean;
}

interface Graph {
  ctx: BaseAudioContext;
  input: AudioNode;
  slots: [Slot, Slot];
  active: 0 | 1;
  nodes: number;
}

let graph: Graph | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let kind: FloorKind = 'office';
const tracker = newRoomTracker();
let here: Room = 'office';
let zone: Zone = 'floor';
let switches = 0;
/** The last few rooms the reverb moved to, for the probe. */
const history: { room: Room; at: number }[] = [];
const impulses = new Map<Room, AudioBuffer>();
let impulseRate = 0;
const open: Record<Side, number> = { west: 0, east: 0 };

/** The floor you're on came into view: the reverb follows you there, starting in the room you're in. */
export function startRoom(floorKind: FloorKind) {
  kind = floorKind;
  tracker.room = null;
  tracker.pending = null;
  setOccluder(occlude);
  if (!timer) timer = setInterval(tick, TICK_MS);
  tick();
}

/** The floor's gone: stop following (the next floor starts afresh). */
export function stopRoom() {
  if (timer) clearInterval(timer);
  timer = null;
  setOccluder(null);
}

/** How the walls between you and a sound at `pos` muffle it (sfx.ts calls this for every sound placed in the world). */
function occlude(pos: Vec3, d: number) {
  return occlusion(zone, zoneAt(kind, pos.x, pos.z), d, open);
}

function tick() {
  const ear = listenerAt();
  const now = performance.now() / 1000;
  for (const side of SIDES) open[side] = doorOpen(side);
  here = roomAt(kind, ear.x, ear.z);
  zone = zoneAt(kind, ear.x, ear.z);
  const g = getGraph();
  // Before audio starts, the room is followed for the probe; the first one heard is set straight away.
  const to = trackRoom(tracker, here, now);
  if (to) move(g, to, switches === 0 || !g);
}

/** Moves the reverb to `room`: its impulse into the idle convolver, then a cross-fade (or a cut, at the start). */
function move(g: Graph | null, room: Room, cut: boolean) {
  switches++;
  history.push({ room, at: Math.round(performance.now()) });
  if (history.length > 10) history.shift();
  const rec = recordSfx(`room:${room}`, { peak: 0, played: !!g });
  rec.room = room;
  rec.wet = ROOM_SOUND[room].wet;
  if (!g) return;
  try {
    const from = g.slots[g.active];
    const toIdx = (1 - g.active) as 0 | 1;
    const to = g.slots[toIdx];
    to.conv.buffer = impulse(g.ctx, room);
    if (!to.fed) {
      g.input.connect(to.conv);
      to.fed = true;
    }
    const t = g.ctx.currentTime;
    const fade = cut ? 0.05 : FADE;
    ramp(to.gain.gain, ROOM_SOUND[room].wet, t, fade);
    ramp(from.gain.gain, 0, t, fade);
    g.active = toIdx;
    setTimeout(() => {
      // Still idle? Cut it off, so it costs nothing until the next move.
      if (graph === g && g.slots[g.active] !== from && from.fed) {
        try {
          g.input.disconnect(from.conv);
        } catch {
          // already gone
        }
        from.fed = false;
      }
    }, UNHOOK_AFTER * 1000);
  } catch {
    // audio is optional
  }
}

function ramp(p: AudioParam, v: number, t: number, secs: number) {
  p.cancelScheduledValues(t);
  p.setValueAtTime(p.value, t);
  p.linearRampToValueAtTime(v, t + secs);
}

/** A room's impulse response, written once per audio context. */
function impulse(c: BaseAudioContext, room: Room): AudioBuffer {
  if (impulseRate !== c.sampleRate) {
    impulses.clear();
    impulseRate = c.sampleRate;
  }
  let buf = impulses.get(room);
  if (!buf) {
    const data = fillImpulse(ROOM_SOUND[room], c.sampleRate, Math.random);
    buf = c.createBuffer(data.length, data[0].length, c.sampleRate);
    data.forEach((ch, i) => buf!.getChannelData(i).set(ch));
    impulses.set(room, buf);
  }
  return buf;
}

/** The two convolvers between the room's send and the bus, built once the audio context is running. */
function getGraph(): Graph | null {
  const r = roomBus();
  if (!r) return null;
  if (graph?.ctx === r.input.context) return graph;
  try {
    const c = r.input.context;
    const slot = (): Slot => {
      const conv = c.createConvolver();
      conv.normalize = false; // the impulses carry unit energy already
      const gain = c.createGain();
      gain.gain.value = 0;
      conv.connect(gain).connect(r.output);
      return { conv, gain, fed: false };
    };
    graph = { ctx: c, input: r.input, slots: [slot(), slot()], active: 0, nodes: 4 };
    // The first room is set at once, without a fade.
    tracker.room = null;
    switches = 0;
    return graph;
  } catch {
    return null;
  }
}

// ---------- probe ----------

// window.__swarmRoom: the space you're in and its reverb, for QA (a fresh snapshot per read). Room changes are also
// recorded in window.__swarmSfx as room:… entries.
if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmRoom')) {
  Object.defineProperty(window, '__swarmRoom', {
    get: () => {
      const g = graph;
      const active = g ? g.slots[g.active] : null;
      return {
        running: timer !== null,
        kind,
        /** Where you stand, and the room the reverb is in (it follows a moment later, then cross-fades). */
        here,
        zone,
        room: tracker.room,
        wet: tracker.room ? ROOM_SOUND[tracker.room].wet : 0,
        /** The reverb's live return level (mid-fade it's on its way to `wet`), and whether the other convolver is still fading out. */
        level: active ? +active.gain.gain.value.toFixed(3) : 0,
        fading: g ? g.slots.every((s) => s.fed) : false,
        sends: { ...ROOM_SENDS },
        switches,
        history: history.map((h) => ({ ...h })),
        /** WebAudio nodes the reverb holds: fixed (two convolvers and their gains) however many sounds play. */
        nodes: g?.nodes ?? 0,
        convolversFed: g ? g.slots.filter((s) => s.fed).length : 0,
        doors: { ...open },
      };
    },
    enumerable: false,
    configurable: false,
  });
}
