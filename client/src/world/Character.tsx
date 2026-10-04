import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Outlines } from './Outlines';
import type { Agent } from '../store';
import { ACCENTS, appearanceFor } from './appearance';
import { WALK_SPEED, gait, newBodyState, smooth, stepBody, type BodyTarget, type Gait, type Gesture } from './body';
import { PARTS } from './characterParts';
import { fidgetProgress, fidgetWeight, newDeskLife, play, stepDeskLife, wake, type Fidget, type Mood } from './fidgets';
import { malletHolder } from './gongRunner';
import { isCelebrating } from './gongState';
import { mix, shade, toon } from './materials';
import { bodyTarget, handMug, seatBody, setBody, subscribeMugs, trackBody } from './people';
import { takeReaction, trackLife } from './reactionFeed';
import { SpeechBubble } from './SpeechBubble';
import { MugLook, mugColor } from './toys/mugLook';
import { Ball, Cyl } from './Toon';
import { TAP_PHASE, burstLevel, handLift, mouseDip, poseFor, tapSpeed, typingSeed, type PoseName } from './typing';
import { useHitReaction } from './useHitReaction';
import { Zzz } from './Zzz';
import { cheerVoice } from '../ui/cheerRules';
import { cheerFrom } from '../ui/cheerSfx';
import { hearBody, hearing } from '../ui/peopleSounds';

// A cartoon developer. Origin is the floor under the chair; they face -Z (toward the desk). Seated by default; the
// people controller (people.ts, body.ts) can get them up, walk them about and sit them back down. `children` (the
// name tag) float over the desk while seated and over their head while up.

type Arm = { pitch: number; yaw: number }; // yaw > 0 swings the hand toward the body's centre line
type Pose = { l: Arm; r: Arm; lean: number; headPitch: number; headYaw: number; type: number; mouse: number };

const KEYS: Arm = { pitch: -0.34, yaw: 0.26 };
const POSES: Record<PoseName, Pose> = {
  typing: { l: KEYS, r: KEYS, lean: 0.1, headPitch: -0.02, headYaw: 0, type: 1, mouse: 0 },
  browsing: { l: KEYS, r: { pitch: -0.4, yaw: -0.22 }, lean: 0.06, headPitch: 0.05, headYaw: 0.04, type: 0.25, mouse: 1 },
  // Arm pitch rotates the arm (which points along -Z) up from horizontal: 0 = straight ahead, +PI/2 = straight up.
  // The poses below are chosen so hands never pass through the head (radius 0.2, ~0.22 above the shoulders).
  thinking: { l: KEYS, r: { pitch: 0.55, yaw: 0.95 }, lean: 0.02, headPitch: 0.1, headYaw: -0.12, type: 0.3, mouse: 0 }, // hand under the chin
  relaxed: { l: { pitch: -0.9, yaw: 0.35 }, r: { pitch: -0.9, yaw: 0.35 }, lean: -0.1, headPitch: 0.06, headYaw: 0, type: 0, mouse: 0 }, // hands in the lap
  cheer: { l: { pitch: 1.45, yaw: -0.35 }, r: { pitch: 1.45, yaw: -0.35 }, lean: -0.05, headPitch: 0.2, headYaw: 0, type: 0, mouse: 0 }, // arms up in a V
  slump: { l: { pitch: -1.35, yaw: -0.15 }, r: { pitch: -1.35, yaw: -0.15 }, lean: 0.25, headPitch: -0.45, headYaw: 0, type: 0, mouse: 0 }, // arms dangling
};

const clone = (p: Pose): Pose => ({ ...p, l: { ...p.l }, r: { ...p.r } });
const lerp = THREE.MathUtils.lerp;
const INK = '#1f1d2b';
// Glasses frames, picked by the same accent index as hats and stripes.
const FRAMES = ['#1f1d2b', '#7f5539', '#1f1d2b', '#c1121f', '#355070', '#1f1d2b'];

// Hips go from the seat (y 0.5) to the top of straight legs; the knee is `thigh` below the hip (characterParts.ts).
const HIP = { x: 0.11, seatY: 0.5, seatZ: -0.04, standY: 0.815, thigh: 0.32 };
// Where they step out to when they get up (chair-space): beside the chair, in front of it. The chair rolls back.
const STAND = { x: 0.62, z: -0.1 };
const CHAIR_ROLL = 0.18;
const TAG_SEATED: [number, number, number] = [0, 1.98, -1.12]; // over the desk, where it has always been
const HANG: Arm = { pitch: -1.42, yaw: -0.1 };
// A mug in the right hand (arm space: the hand is at z -0.5), kept upright whatever the arm does, tipped to the lips for a sip.
const HAND_MUG = { at: [0, -0.02, -0.52] as [number, number, number], ahead: -0.07, scale: 1.3, sipTilt: 1.0 };
// Arm targets for each gesture (null: that arm keeps walking or idling). Pitch and yaw as in POSES.
const GESTURES: Record<Gesture, { l: Arm | null; r: Arm | null; head: number }> = {
  none: { l: null, r: null, head: 0 },
  reach: { l: null, r: { pitch: 1.05, yaw: 0.05 }, head: 0.15 }, // touch the board
  post: { l: null, r: { pitch: 1.05, yaw: 0.05 }, head: 0.15 }, // a reach that's silent: StickyNotes.tsx plays its sticky's own sounds
  hold: { l: { pitch: -0.45, yaw: 0.4 }, r: { pitch: -0.45, yaw: 0.4 }, head: -0.05 }, // carry something in front
  sip: { l: null, r: { pitch: 0.7, yaw: 0.85 }, head: 0.25 }, // cup to the mouth
  stretch: { l: { pitch: 1.55, yaw: 0.22 }, r: { pitch: 1.55, yaw: 0.22 }, head: 0.3 }, // arms overhead
  stoop: { l: { pitch: -1.0, yaw: 0.3 }, r: { pitch: -1.0, yaw: 0.3 }, head: -0.5 }, // reach down for something on the floor
  shoot: { l: { pitch: 1.2, yaw: 0.35 }, r: { pitch: 1.2, yaw: 0.35 }, head: 0.35 }, // ball overhead, eyes on the hoop
  toss: { l: { pitch: 0.35, yaw: 0.3 }, r: { pitch: 0.35, yaw: 0.3 }, head: 0.05 }, // arms out where the ball went
  catch: { l: { pitch: -0.1, yaw: 0.1 }, r: { pitch: -0.1, yaw: 0.1 }, head: 0.1 }, // hands out, ready
  shrug: { l: { pitch: -0.7, yaw: -0.75 }, r: { pitch: -0.7, yaw: -0.75 }, head: -0.12 }, // palms out: oh well
  mug: { l: null, r: { pitch: -0.75, yaw: 0.3 }, head: -0.05 }, // a mug held in front
  tap: { l: null, r: { pitch: -0.3, yaw: 0.05 }, head: -0.3 }, // a hand on the counter: the dispenser, the machine
  chat: { l: { pitch: -0.55, yaw: -0.45 }, r: { pitch: -0.75, yaw: 0.3 }, head: 0.08 }, // mug in one hand, the other talking
  cheer: { l: POSES.cheer.l, r: POSES.cheer.r, head: POSES.cheer.headPitch }, // the seated cheer's arms up in a V
  wave: { l: null, r: { pitch: 1.25, yaw: -0.3 }, head: 0.1 }, // a hand up beside the head, waving (below)
  talk: { l: null, r: { pitch: -0.3, yaw: 0.45 }, head: 0.05 }, // a hand out in front, moving as they talk
  // the gong (gongRunner.ts): a hand out for the mallet on its hook, raised back over the shoulder, then brought down
  // onto the disc (then the cheer above)
  take: { l: null, r: { pitch: 0.75, yaw: -0.3 }, head: 0.1 },
  windup: { l: { pitch: 0.2, yaw: 0.3 }, r: { pitch: 2.1, yaw: 0.05 }, head: 0.1 },
  strike: { l: { pitch: -0.6, yaw: 0.2 }, r: { pitch: -0.25, yaw: 0.25 }, head: 0 },
};
// A merge party on their floor (gongState.ts) beats any gesture: arms up in a V, standing or walking, mug or not.
const PARTY_ARMS = { l: POSES.cheer.l, r: POSES.cheer.r, head: POSES.cheer.headPitch };

// ---------- little life at the desk (fidgets.ts) ----------
// Each fidget is drawn as a seated pose laid over the status pose: arms it takes over (weight 1) and head, lean and
// twist offsets. `lw`/`rw` say how much of each arm it takes; yaw > 0 swings a hand toward the centre line, as above.
type Overlay = { l: Arm; r: Arm; lw: number; rw: number; lean: number; leanW: number; pitch: number; pitchW: number; yaw: number; roll: number; twist: number; spin: number };
const MUG_REACH: Arm = { pitch: -0.12, yaw: -0.55 };
const MUG_DRINK: Arm = { pitch: 0.55, yaw: 0.7 };
const ramp = (p: number, a: number, b: number) => smooth(Math.min(1, Math.max(0, (p - a) / (b - a))));
const setArm = (a: Arm, pitch: number, yaw: number) => {
  a.pitch = pitch;
  a.yaw = yaw;
};

/** Writes fidget `f`'s pose at progress p (0 to 1; seconds asleep for a doze) and time t into `o`. */
function fidgetPose(f: Fidget | null, p: number, t: number, toward: number, o: Overlay) {
  o.lw = o.rw = o.leanW = o.pitchW = o.yaw = o.roll = o.twist = o.spin = 0;
  switch (f) {
    case 'leanBack': // hands behind the head, rocking a little
      setArm(o.l, 2.45, 0.75);
      setArm(o.r, 2.45, 0.75);
      o.lw = o.rw = o.leanW = o.pitchW = 1;
      o.lean = -0.2 + Math.sin(t * 1.4) * 0.025;
      o.pitch = 0.14;
      break;
    case 'spin': // a swivel one way, then the other
      o.spin = Math.sin(p * Math.PI * 2) * 0.55;
      o.yaw = -o.spin * 0.5;
      break;
    case 'phone': // both hands in front of the chest, head down, a thumb tapping
      setArm(o.l, -0.3, 0.6);
      setArm(o.r, -0.26 + (Math.sin(t * 11) > 0.4 ? 0.04 : 0), 0.55);
      o.lw = o.rw = o.pitchW = o.leanW = 1;
      o.pitch = -0.42;
      o.lean = 0.05;
      break;
    case 'sip': {
      // reach for the mug, bring it up, a sip with the head back, and put it down again
      const up = ramp(p, 0.3, 0.45) - ramp(p, 0.62, 0.77);
      setArm(o.r, MUG_REACH.pitch + (MUG_DRINK.pitch - MUG_REACH.pitch) * up, MUG_REACH.yaw + (MUG_DRINK.yaw - MUG_REACH.yaw) * up);
      o.rw = 1;
      o.twist = -0.32 * (1 - up);
      o.lean = 0.16 * (1 - up);
      o.leanW = 1;
      o.pitch = 0.28 * up;
      o.pitchW = up;
      break;
    }
    case 'doze': // head droops, breathing slow, with a little nod now and then
      o.pitch = -0.6 + Math.sin(p * 0.9) * 0.05 + (Math.sin(p * 0.37) > 0.97 ? 0.12 : 0);
      o.pitchW = 1;
      o.roll = 0.16;
      o.lean = 0.08;
      o.leanW = 1;
      break;
    case 'neckRoll': {
      const a = p * Math.PI * 2.4;
      o.pitch = Math.sin(a) * 0.24 - 0.05;
      o.pitchW = 1;
      o.roll = Math.cos(a) * 0.3;
      break;
    }
    case 'shoulders': // the left arm pulled across the chest, looking away from it
      setArm(o.l, 0.05, 1.35);
      o.lw = 1;
      o.yaw = 0.3;
      o.twist = -0.12;
      break;
    case 'scratch': // a hand on top of the head, scratching
      setArm(o.r, 1.42 + Math.sin(t * 17) * 0.06, 0.6 + Math.sin(t * 17 + 1) * 0.05);
      o.rw = 1;
      o.roll = -0.14;
      o.pitch = 0.04;
      o.pitchW = 1;
      break;
    case 'facepalm': // hand to the forehead, head down, a slow shake
      setArm(o.r, 0.73, 0.6);
      o.rw = 1;
      o.pitch = -0.3;
      o.pitchW = 1;
      o.yaw = Math.sin(t * 5) * 0.12;
      o.lean = 0.12;
      o.leanW = 1;
      break;
    case 'fistPump': // three quick pumps
      setArm(o.r, 1.15 + Math.max(0, Math.sin(p * Math.PI * 6)) * 0.45, -0.15);
      o.rw = 1;
      o.pitch = 0.18;
      o.pitchW = 1;
      o.lean = -0.06;
      o.leanW = 1;
      break;
    case 'wave': {
      // turn toward them and wave with the near hand
      const side = toward > 0 ? o.l : o.r;
      setArm(side, 1.3, -0.3 + Math.sin(t * 10) * 0.35);
      if (toward > 0) o.lw = 1;
      else o.rw = 1;
      o.yaw = Math.max(-1.1, Math.min(1.1, toward * 0.7));
      o.twist = Math.max(-0.4, Math.min(0.4, toward * 0.3));
      o.pitch = 0.08;
      o.pitchW = 1;
      break;
    }
  }
  return o;
}

/**
 * `carrying` is drawn in their hands while they hold something (the 'hold' gesture), in the torso's frame, which
 * faces -Z with the shoulders at y 0.44.
 */
export function Character({
  agent,
  chair,
  mug,
  carrying,
  children,
}: {
  agent: Agent;
  chair?: RefObject<THREE.Object3D | null>;
  /** The desk mug they sip from (moved into their hand and back). */
  mug?: RefObject<THREE.Object3D | null>;
  carrying?: ReactNode;
  children?: ReactNode;
}) {
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const cur = useRef<Pose>(clone(POSES.relaxed));
  // From the id, so the typing sounds tap in time with these hands.
  const seed = useMemo(() => typingSeed(agent.id), [agent.id]);
  const lastTool = useRef({ name: null as string | null, at: 0 });
  const look = useMemo(() => appearanceFor(agent), [agent.id, agent.look, agent.role]);
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const seatedLegs = useRef<THREE.Group>(null);
  const legs = useRef<THREE.Group>(null);
  const hipL = useRef<THREE.Group>(null);
  const hipR = useRef<THREE.Group>(null);
  const kneeL = useRef<THREE.Group>(null);
  const kneeR = useRef<THREE.Group>(null);
  const tag = useRef<THREE.Group>(null);
  const mallet = useRef<THREE.Group>(null);
  const bubbleLift = useRef<THREE.Group>(null);
  const held = useRef<THREE.Group>(null);
  const chairZ = useRef<number | null>(null);
  const handCup = useRef<THREE.Group>(null);
  const carried = useSyncExternalStore(subscribeMugs, () => handMug(agent.id));
  // Everything the body needs between frames, made once: the walk state, a gait to write into and the gesture arms.
  const move = useMemo(
    () => ({ s: newBodyState(), g: { stride: 0, cadence: 0, bob: 0, lean: 0 } as Gait, placed: false, gl: 0, gr: 0, gh: 0, l: { ...HANG }, r: { ...HANG } }),
    [],
  );
  // Their merge cheer (cheerSfx.ts): their own voice, whether they were cheering last frame and where their head is.
  const voice = useMemo(() => ({ v: cheerVoice(agent.id, agent.look), party: false, head: new THREE.Vector3() }), [agent.id, agent.look]);
  // Fidgets: the schedule, the pose it writes, the stretch's body target, who they wave to and the mug's rest spot.
  const life = useMemo(
    () => ({
      s: newDeskLife(agent.id, performance.now() / 1000, mug != null),
      o: { l: { ...HANG }, r: { ...HANG }, lw: 0, rw: 0, lean: 0, leanW: 0, pitch: 0, pitchW: 0, yaw: 0, roll: 0, twist: 0, spin: 0 } as Overlay,
      stretch: null as BodyTarget | null,
      tx: 0,
      tz: 0,
      toward: 0,
      browse: 0,
      rest: null as THREE.Vector3 | null,
      held: false,
      v: new THREE.Vector3(),
    }),
    [agent.id, mug],
  );
  const asleep = useRef(false);
  const phone = useRef<THREE.Group>(null);
  const grip = useRef<THREE.Group>(null);
  const hit = useHitReaction(agent.id, body);
  if (agent.currentTool) lastTool.current = { name: agent.currentTool, at: performance.now() };
  useEffect(() => trackBody(agent.id, move.s), [agent.id, move]);
  useEffect(() => trackLife(agent.id, life.s), [agent.id, life]);
  // Leaving mid-stretch (another floor): don't leave them standing.
  useEffect(
    () => () => {
      if (life.stretch && bodyTarget(agent.id) === life.stretch) seatBody(agent.id);
    },
    [agent.id, life],
  );
  useEffect(() => hearing(agent.id), [agent.id]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const now = performance.now();
    const t = now / 1000 + seed;
    const party = isCelebrating(agent.repoId, now); // a PR on this floor just merged: everyone cheers, busy or not
    if (party && !voice.party && head.current) {
      // the arms go up: a "woo!" from their head
      head.current.getWorldPosition(voice.head);
      cheerFrom(voice.v, voice.head.x, voice.head.y, voice.head.z);
    }
    voice.party = party;

    // ---------- where the body is ----------
    const st = move.s;
    const r0 = root.current;
    const goal = bodyTarget(agent.id);
    if (r0) {
      if (!move.placed) {
        r0.updateWorldMatrix(true, false);
        move.placed = true;
      }
      const te = r0.matrixWorld.elements;
      st.seatX = te[12];
      st.seatZ = te[14];
      st.seatHeading = Math.atan2(te[8], te[10]);
      st.standX = te[0] * STAND.x + te[8] * STAND.z + te[12];
      st.standZ = te[2] * STAND.x + te[10] * STAND.z + te[14];
      stepBody(st, goal ?? null, dt);
      const b = body.current;
      if (b && st.stage === 'seated') {
        b.position.set(0, 0, 0);
        b.rotation.y = 0;
      } else if (b) {
        // world to chair-space (the chair's frame is only ever turned about Y)
        const dx = st.x - te[12];
        const dz = st.z - te[14];
        b.position.set(te[0] * dx + te[2] * dz, 0, te[8] * dx + te[10] * dz);
        b.rotation.y = st.heading - st.seatHeading;
      }
      const gesture = st.stage === 'up' ? (goal?.gesture ?? 'none') : 'none';
      const holding = st.stage === 'up' && malletHolder() === agent.id;
      // the one with the mallet plays out their own strike and pose (gongRunner.ts); the party is for everyone else
      const g = party && !holding ? PARTY_ARMS : GESTURES[gesture];
      const kg = 1 - Math.exp(-dt * 6);
      if (g.l) Object.assign(move.l, g.l);
      if (g.r) Object.assign(move.r, g.r);
      if (gesture === 'wave') move.r.yaw += Math.sin(t * 9) * 0.4;
      if (gesture === 'talk') {
        move.r.pitch += Math.sin(t * 4.3) * 0.18;
        move.r.yaw += Math.sin(t * 2.6) * 0.2;
      }
      if (held.current) held.current.visible = gesture === 'hold';
      move.gl += ((g.l ? 1 : 0) - move.gl) * kg;
      move.gr += ((g.r ? 1 : 0) - move.gr) * kg;
      move.gh += (g.head - move.gh) * kg;
      hearBody(agent.id, st, st.stage === 'up' ? (goal?.gesture ?? 'none') : 'none', dt, te[13]);
      if (mallet.current) mallet.current.visible = holding;
    }
    const seated = st.stage === 'seated';
    const k = smooth(st.sit); // 1 seated, 0 standing
    const up = 1 - k;
    const gt = gait(st.speed, move.g);
    const walk = Math.min(1, st.speed / 0.5);
    const swing = Math.sin(st.phase) * gt.stride * walk;
    const bob = -gt.bob * walk * Math.sin(st.phase) ** 2;
    if (chair?.current) {
      chairZ.current ??= chair.current.position.z;
      chair.current.position.z = chairZ.current + CHAIR_ROLL * up;
    }

    // ---------- the seated pose ----------
    const busy = agent.status === 'working' || agent.status === 'preparing';
    const cheering = party || (agent.status === 'done' && agent.endedAt != null && Date.now() - agent.endedAt < 7000);
    const name: PoseName = party ? 'cheer' : poseFor(agent.status, agent.currentTool, lastTool.current.name, now - lastTool.current.at, cheering);
    const target = POSES[name];
    const c = cur.current;
    const k5 = 1 - Math.exp(-dt * 5);
    for (const side of ['l', 'r'] as const) {
      c[side].pitch += (target[side].pitch - c[side].pitch) * k5;
      c[side].yaw += (target[side].yaw - c[side].yaw) * k5;
    }
    for (const key of ['lean', 'headPitch', 'headYaw', 'type', 'mouse'] as const) c[key] += (target[key] - c[key]) * k5;

    // Typing comes in bursts: fast alternating taps, then a short pause to read.
    const burst = burstLevel(t);
    const tap = c.type * burst * 0.1;
    const speed = tapSpeed(agent.status);
    const tapL = handLift(t, speed, TAP_PHASE.l) * tap;
    const tapR = handLift(t, speed, TAP_PHASE.r) * tap * (1 - c.mouse);
    const driftL = Math.sin(t * 3.1) * 0.05 * c.type;
    const driftR = Math.sin(t * 2.7 + 1) * 0.05 * c.type;
    // Mouse hand: small glides plus a click now and then.
    const glide = Math.sin(t * 1.9) * 0.06 * c.mouse;
    const click = mouseDip(t) * c.mouse;
    const wave = cheering ? Math.sin(t * 9) * 0.35 : 0;
    const waveUp = party ? wave * up : 0; // up and partying, they wave too

    // Longer arms on taller people: tip them down a touch so hands still land on the keyboard.
    const reach = -(look.height - 1) * 0.55;
    // Hit by a toy: jolt back with hands up, then look at the player, laid over the pose above.
    const h = hit.pose(now);
    const jolt = h.flinch * 0.55;

    // ---------- little life at the desk: fidgets and reactions laid over the seated pose ----------
    const ls = life.s;
    const sec = now / 1000;
    const queued = takeReaction(agent.id);
    if (queued) {
      play(ls, queued.fidget, sec);
      if (r0) {
        // which way the one they wave to sits, as a turn of the head (> 0: to their left)
        const te = r0.matrixWorld.elements;
        const dx = queued.x - te[12];
        const dz = queued.z - te[14];
        life.toward = Math.atan2(-(te[0] * dx + te[2] * dz), -(te[8] * dx + te[10] * dz));
      }
    }
    if (h.w > 0) wake(ls, sec);
    const mine = goal != null && goal === life.stretch;
    const mood: Mood =
      (goal && !mine) || cheering || agent.status === 'preparing' || agent.status === 'error'
        ? 'busy'
        : busy
          ? name === 'browsing'
            ? 'browsing'
            : name === 'thinking'
              ? 'thinking'
              : 'working'
          : 'idle';
    stepDeskLife(ls, mood, sec);
    const p = fidgetProgress(ls, sec);
    // The stretch gets them up (body.ts) for a moment and sits them back down.
    if (ls.fidget === 'stretch' && p < 0.8) {
      if (!life.stretch && !goal && seated && p < 0.2) {
        setBody(agent.id, { mode: 'standing', x: st.standX, z: st.standZ, heading: st.seatHeading, speed: WALK_SPEED, gesture: 'stretch' });
        life.stretch = bodyTarget(agent.id) ?? null;
      }
    } else if (life.stretch) {
      if (bodyTarget(agent.id) === life.stretch) seatBody(agent.id);
      life.stretch = null;
    }
    const fw = fidgetWeight(ls, sec);
    const o = fidgetPose(fw > 0 ? ls.fidget : null, p, t, life.toward, life.o);
    const wl = o.lw * fw;
    const wr = o.rw * fw;
    // browsing: lean in closer to the screen, slowly
    life.browse += ((name === 'browsing' ? 1 : 0) - life.browse) * (1 - Math.exp(-dt * 1.2));
    asleep.current = seated && ls.fidget === 'doze' && fw > 0.5;
    if (phone.current) phone.current.visible = seated && ls.fidget === 'phone' && fw > 0.35;
    if (seated && body.current) body.current.rotation.y = o.spin * fw;
    if (chair?.current) chair.current.rotation.y = seated ? o.spin * fw : 0;

    // ---------- blended with the standing / walking pose (k = 1: exactly the seated pose) ----------
    // Up, the arms hang and swing against the legs, unless a gesture has them busy.
    const idle = Math.sin(t * 1.1) * 0.03 * (1 - walk);
    const lp = (HANG.pitch - swing * 1.1 + idle) * (1 - move.gl) + move.l.pitch * move.gl;
    const ly = HANG.yaw * (1 - move.gl) + move.l.yaw * move.gl;
    const rp = (HANG.pitch + swing * 1.1 + idle) * (1 - move.gr) + move.r.pitch * move.gr;
    const ry = HANG.yaw * (1 - move.gr) + move.r.yaw * move.gr;
    if (armL.current && armR.current) {
      armL.current.rotation.set(lerp(c.l.pitch + reach + tapL, o.l.pitch, wl) * k + lp * up + jolt, lerp(-(c.l.yaw + driftL) + wave, -o.l.yaw, wl) * k - ly * up + waveUp, 0);
      armR.current.rotation.set(
        lerp(c.r.pitch + reach + tapR - click, o.r.pitch, wr) * k + rp * up + jolt,
        lerp(c.r.yaw + driftR * (1 - c.mouse) + glide - wave, o.r.yaw, wr) * k + ry * up - waveUp,
        0,
      );
      const cup = handCup.current;
      if (cup) {
        // undo the arm's turn (XYZ, so inverted as YXZ) so the mug stays upright, then tip it for a sip
        const sip = !party && goal?.gesture === 'sip' ? move.gr * HAND_MUG.sipTilt : 0;
        cup.rotation.set(sip - armR.current.rotation.x, -armR.current.rotation.y, 0, 'YXZ');
        cup.visible = !seated;
      }
    }
    if (torso.current) {
      const breathe = Math.sin(t * 1.6) * 0.015;
      const lean = lerp(c.lean, o.lean, o.leanW * fw) + life.browse * 0.1;
      torso.current.rotation.x = (-lean + breathe + (busy ? Math.sin(t * 9) * 0.006 * burst : 0)) * k + (breathe - gt.lean * walk) * up + h.flinch * 0.2;
      // shoulders turn against the hips while walking
      torso.current.rotation.y = h.twist * h.w + Math.sin(st.phase) * 0.1 * walk * up + o.twist * fw * k;
      // a slow weight shift from foot to foot while standing, a little sway while walking
      torso.current.rotation.z = (Math.sin(t * 0.5) * 0.03 * (1 - walk) + Math.sin(st.phase) * 0.035 * walk) * up;
      // taller people sit a touch further forward so their back stays clear of the chair
      torso.current.position.set(0, HIP.seatY * k + (HIP.standY + bob) * up, -(look.height - 1) * 0.25 * k);
    }
    if (seatedLegs.current) seatedLegs.current.visible = seated;
    if (legs.current) legs.current.visible = !seated;
    if (!seated && hipL.current && hipR.current && kneeL.current && kneeR.current) {
      // Knees bend as each leg swings forward; standing, one knee eases while the weight is on the other foot.
      const lift = 0.3 + gt.stride;
      const shift = Math.sin(t * 0.5) * 0.15 * (1 - walk);
      const bendL = -(Math.max(0, Math.cos(st.phase)) * lift * walk + Math.max(0, shift) + 0.04);
      const bendR = -(Math.max(0, -Math.cos(st.phase)) * lift * walk + Math.max(0, -shift) + 0.04);
      const hy = HIP.seatY * k + (HIP.standY + bob) * up;
      const hz = HIP.seatZ * k;
      hipL.current.position.set(-HIP.x, hy, hz);
      hipR.current.position.set(HIP.x, hy, hz);
      hipL.current.rotation.x = (Math.PI / 2) * k + (swing - bendL * 0.4) * up;
      hipR.current.rotation.x = (Math.PI / 2) * k + (-swing - bendR * 0.4) * up;
      kneeL.current.rotation.x = (-Math.PI / 2) * k + bendL * up;
      kneeR.current.rotation.x = (-Math.PI / 2) * k + bendR * up;
    }
    if (bubbleLift.current) bubbleLift.current.position.y = (HIP.standY - HIP.seatY) * up; // a "hey!" by the head, sat or standing
    if (tag.current) {
      const [tx, ty, tz] = TAG_SEATED;
      tag.current.position.set(tx * k, ty * k + (HIP.standY + look.height * 0.86 + 0.26) * up, tz * k);
    }
    if (head.current) {
      // Every few seconds, glance down at the keyboard; while setting up, look around.
      const glance = busy && Math.sin(t * 0.55 + 2) > 0.92 ? -0.22 : 0;
      const gaze = agent.status === 'preparing' ? Math.sin(t * 1.3) * 0.5 : Math.sin(t * 0.4) * 0.08;
      const pitch = lerp(c.headPitch + glance + (busy ? Math.sin(t * 4.5) * 0.02 * burst : 0), o.pitch, o.pitchW * fw) * k + (Math.sin(t * 0.3) * 0.05 + move.gh) * up;
      const yaw = (gaze + c.headYaw + o.yaw * fw) * k + Math.sin(t * 0.4) * 0.15 * (1 - walk) * up;
      head.current.rotation.set(pitch + (h.headPitch - pitch) * h.w, yaw + (h.headYaw - yaw) * h.w, ((name === 'thinking' ? 0.12 : 0) + o.roll * fw) * k * (1 - h.w));
    }
    // A sip: the desk mug slides into the hand, goes up to the mouth tipped toward them, and back down.
    const m = mug?.current;
    if (m) {
      const hold = ls.fidget === 'sip' && seated ? ramp(p, 0.2, 0.3) - ramp(p, 0.78, 0.88) : 0;
      if (hold > 0 && grip.current && m.parent) {
        life.rest ??= m.position.clone();
        grip.current.getWorldPosition(life.v);
        m.parent.worldToLocal(life.v);
        m.position.lerpVectors(life.rest, life.v, hold);
        m.rotation.x = 0.7 * (ramp(p, 0.3, 0.45) - ramp(p, 0.62, 0.77));
        life.held = true;
      } else if (life.held && life.rest) {
        m.position.copy(life.rest);
        m.rotation.x = 0;
        life.held = false;
      }
    }
  });

  const skin = toon(agent.skin);
  const isQa = agent.role === 'qa';
  const isCeo = agent.role === 'ceo';
  const feminine = agent.look === 'feminine';
  const busy = agent.status === 'working' || agent.status === 'preparing';
  // QA testers wear a white lab coat; their personal colour shows on the collar and badge.
  // The CEO wears a navy suit; their colour is the tie.
  const shirt = toon(isQa ? '#f8f9fa' : isCeo ? '#2b2d42' : agent.color);
  const hair = toon(look.hair === 'buzz' ? mix(agent.hair, agent.skin, 0.35) : agent.hair);
  const dark = toon(INK);
  const pants = toon('#3d4a6b');
  const accent = ACCENTS[look.accent];
  const sad = agent.status === 'error';
  const hairGeo = PARTS.hair[look.hair];
  const facialGeo = PARTS.facialHair[look.facialHair];
  const glassesGeo = PARTS.glasses[look.glasses];
  const hatGeo = PARTS.headwear[look.headwear];
  const outfit = PARTS.outfit[look.outfit];
  const outlinedHair = look.hair !== 'buzz' && look.hair !== 'bald';
  const clip = feminine && look.headwear === 'none' && ['long', 'ponytail', 'bun', 'sidePart', 'curls'].includes(look.hair);
  const phones = look.headphones && (
    <>
      <mesh geometry={PARTS.headphones.shell} material={toon('#2b2d42')} castShadow />
      <mesh geometry={PARTS.headphones.covers} material={toon(shade(agent.color, 0.12))} />
    </>
  );

  return (
    <group ref={root}>
      <group ref={body}>
        <group ref={bubbleLift}>{hit.bubble}</group>
        <Zzz on={asleep} position={[0.16, 1.34, -0.14]} />
        {/* seated legs don't move, so both are one mesh; getting up swaps in jointed ones */}
        <group ref={seatedLegs}>
          <mesh geometry={PARTS.legs} material={pants} castShadow>
            <Outlines thickness={0.012} color={INK} angle={0} />
          </mesh>
          <mesh geometry={PARTS.shoes} material={dark} castShadow />
        </group>
        <group ref={legs} visible={false}>
          {[
            { hip: hipL, knee: kneeL, x: -HIP.x },
            { hip: hipR, knee: kneeR, x: HIP.x },
          ].map(({ hip, knee, x }) => (
            <group key={x} ref={hip} position={[x, HIP.seatY, HIP.seatZ]} rotation={[Math.PI / 2, 0, 0]}>
              <mesh geometry={PARTS.thigh} material={pants} castShadow>
                <Outlines thickness={0.012} color={INK} angle={0} />
              </mesh>
              <group ref={knee} position={[0, -HIP.thigh, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <mesh geometry={PARTS.shin} material={pants} castShadow>
                  <Outlines thickness={0.012} color={INK} angle={0} />
                </mesh>
                <mesh geometry={PARTS.shoe} material={dark} castShadow />
              </group>
            </group>
          ))}
        </group>

        <group ref={torso} position={[0, 0.5, -(look.height - 1) * 0.25]} scale={look.height}>
          <group scale={[look.shoulders, 1, 1]}>
            <mesh position={[0, 0.3, 0]} geometry={PARTS.torso} material={shirt} castShadow>
              <Outlines thickness={0.015} color={INK} angle={0} />
            </mesh>
            {look.outfit !== 'sweater' && (
              <mesh position={[0, 0.5, -0.02]} rotation={[Math.PI / 2, 0, 0]} geometry={PARTS.collar} material={toon(isCeo ? '#f8f9fa' : shade(agent.color, -0.15))} />
            )}
            {outfit.main && <mesh geometry={outfit.main} material={toon(shade(agent.color, -0.08))} castShadow />}
            {outfit.trim && (
              <mesh geometry={outfit.trim} material={toon(look.outfit === 'stripe' ? accent : look.outfit === 'hoodie' ? '#f8f9fa' : shade(agent.color, -0.14))} />
            )}
            {isCeo && (
              <>
                {/* white shirt front, tie and knot */}
                <mesh position={[0, 0.36, -0.192]} geometry={PARTS.shirtFront} material={toon('#f8f9fa')} />
                <mesh position={[0, 0.33, -0.206]} geometry={PARTS.tie} material={toon(agent.color)} />
                <mesh position={[0, 0.445, -0.206]} geometry={PARTS.tieKnot} material={toon(shade(agent.color, -0.2))} />
              </>
            )}
            {isQa && (
              <>
                {/* lab coat front opening + badge */}
                <mesh position={[0, 0.27, -0.196]} geometry={PARTS.coatOpening} material={toon(agent.color)} />
                <mesh position={[0.1, 0.38, -0.19]} rotation={[0.1, 0, 0]} geometry={PARTS.badge} material={toon('#ffd166')} />
              </>
            )}
            {!busy && phones && (
              // resting around the neck
              <group position={[0, 0.49, -0.09]} rotation={[Math.PI / 2 - 0.5, 0, 0]} scale={0.74}>
                {phones}
              </group>
            )}
          </group>

          {/* arms pivot at the shoulders */}
          {[
            { ref: armL, x: -0.25 },
            { ref: armR, x: 0.25 },
          ].map(({ ref, x }) => (
            <group key={x} ref={ref} position={[x * look.shoulders, 0.44, 0]}>
              <mesh position={[0, 0, -0.24]} rotation={[Math.PI / 2, 0, 0]} geometry={PARTS.sleeve} material={shirt} castShadow>
                <Outlines thickness={0.012} color={INK} angle={0} />
              </mesh>
              <mesh position={[0, 0, -0.5]} geometry={PARTS.hand} material={skin} castShadow />
              {ref === armR && (
                <>
                  {/* where a mug sits in the hand, and the phone they check */}
                  <group ref={grip} position={[0, 0.03, -0.56]} />
                  <group ref={phone} position={[-0.03, 0.06, -0.52]} rotation={[0.7, -0.55, 0]} visible={false}>
                    <mesh geometry={PARTS.phone} material={dark} />
                    <mesh geometry={PARTS.phoneScreen} material={toon('#8ecae6', { emissive: '#8ecae6', emissiveIntensity: 0.5 })} />
                  </group>
                  {carried && (
                    <group ref={handCup} position={HAND_MUG.at} visible={false}>
                      <group position={[0, 0, HAND_MUG.ahead]} rotation={[0, -Math.PI / 2, 0]} scale={HAND_MUG.scale}>
                        <MugLook color={mugColor(carried.id)} sips={carried.sips} shadow={false} />
                      </group>
                    </group>
                  )}
                  {/* the gong's mallet, in the right hand while they have it (gongRunner.ts); the handle tips up from the fist */}
                  <group ref={mallet} position={[0, 0, -0.5]} rotation={[0.5, 0, 0]} visible={false}>
                    <Cyl r={0.025} h={0.55} position={[0, 0, -0.27]} rotation={[Math.PI / 2, 0, 0]} color="#f1d19b" shadow={false} />
                    <Ball r={0.12} position={[0, 0, -0.56]} color="#e76f51" outline shadow={false} />
                    <Cyl r={0.125} h={0.05} position={[0, 0, -0.56]} rotation={[Math.PI / 2, 0, 0]} color="#f4a261" shadow={false} />
                  </group>
                </>
              )}
            </group>
          ))}

          <group ref={head} position={[0, 0.66, 0]}>
            <mesh geometry={PARTS.head} material={skin} castShadow>
              <Outlines thickness={0.015} color={INK} angle={0} />
            </mesh>
            {hairGeo && (
              <mesh geometry={hairGeo} material={hair} castShadow={outlinedHair}>
                {outlinedHair && <Outlines thickness={0.012} color={INK} angle={0} />}
              </mesh>
            )}
            <mesh geometry={PARTS.ears} material={skin} />
            <mesh geometry={PARTS.eyes} material={dark} />
            <mesh position={[0, -0.02, -0.2]} geometry={PARTS.nose} material={toon(shade(agent.skin, -0.08))} />
            <mesh position={[0, sad ? -0.1 : -0.075, -0.175]} rotation={[0.25, 0, sad ? 0 : Math.PI]} geometry={PARTS.mouth} material={dark} />
            {facialGeo && <mesh geometry={facialGeo} material={toon(look.facialHair === 'stubble' ? mix(agent.skin, agent.hair, 0.3) : agent.hair)} />}
            {feminine && (
              <>
                <mesh geometry={PARTS.lashes} material={dark} />
                <mesh geometry={PARTS.cheeks} material={toon('#ff9aa2')} />
              </>
            )}
            {clip && (
              <mesh position={[0.15, 0.13, -0.08]} rotation={[0, 0, 0.5]} geometry={PARTS.hairClip} material={toon(isQa ? '#ff9f68' : shade(agent.color, 0.15))} />
            )}
            {/* QA's round inspector glasses stay part of the uniform */}
            {isQa && <mesh geometry={PARTS.inspectorGlasses} material={dark} />}
            {glassesGeo && <mesh geometry={glassesGeo} material={toon(FRAMES[look.accent])} />}
            {hatGeo && (
              <mesh geometry={hatGeo} material={toon(look.accent === 0 ? shade(agent.color, -0.2) : accent)} castShadow>
                <Outlines thickness={0.012} color={INK} angle={0} />
              </mesh>
            )}
            {busy && phones}
          </group>
          {carrying && (
            <group ref={held} visible={false}>
              {carrying}
            </group>
          )}
        </group>
        {/* just above their name tag */}
        <SpeechBubble id={agent.id} y={HIP.standY + look.height * 0.86 + 0.4} />
        {children && (
          <group ref={tag} position={TAG_SEATED}>
            {children}
          </group>
        )}
      </group>
    </group>
  );
}
