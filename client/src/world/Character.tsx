import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Outlines } from '@react-three/drei';
import type { Agent } from '../store';
import { ACCENTS, appearanceFor } from './appearance';
import { gait, newBodyState, smooth, stepBody, type Gait, type Gesture } from './body';
import { PARTS } from './characterParts';
import { isCelebrating } from './gongState';
import { mix, shade, toon } from './materials';
import { bodyTarget, trackBody } from './people';
import { useHitReaction } from './useHitReaction';
import { hearBody, hearing } from '../ui/peopleSounds';

// A cartoon developer. Origin is the floor under the chair; they face -Z (toward the desk). Seated by default; the
// people controller (people.ts, body.ts) can get them up, walk them about and sit them back down. `children` (the
// name tag) float over the desk while seated and over their head while up.

type Arm = { pitch: number; yaw: number }; // yaw > 0 swings the hand toward the body's centre line
type Pose = { l: Arm; r: Arm; lean: number; headPitch: number; headYaw: number; type: number; mouse: number };
type PoseName = 'typing' | 'browsing' | 'thinking' | 'relaxed' | 'cheer' | 'slump';

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
// Arm targets for each gesture (null: that arm keeps walking or idling). Pitch and yaw as in POSES.
const GESTURES: Record<Gesture, { l: Arm | null; r: Arm | null; head: number }> = {
  none: { l: null, r: null, head: 0 },
  reach: { l: null, r: { pitch: 1.05, yaw: 0.05 }, head: 0.15 }, // touch the board
  hold: { l: { pitch: -0.45, yaw: 0.4 }, r: { pitch: -0.45, yaw: 0.4 }, head: -0.05 }, // carry something in front
  sip: { l: null, r: { pitch: 0.7, yaw: 0.85 }, head: 0.25 }, // cup to the mouth
};
// A merge party on their floor (gongState.ts) beats any gesture: arms up in a V, standing or walking, mug or not.
const PARTY_ARMS = { l: POSES.cheer.l, r: POSES.cheer.r, head: POSES.cheer.headPitch };

export function Character({ agent, chair, children }: { agent: Agent; chair?: RefObject<THREE.Object3D | null>; children?: ReactNode }) {
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const cur = useRef<Pose>(clone(POSES.relaxed));
  const seed = useRef(Math.random() * 100);
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
  const chairZ = useRef<number | null>(null);
  // Everything the body needs between frames, made once: the walk state, a gait to write into and the gesture arms.
  const move = useMemo(
    () => ({ s: newBodyState(), g: { stride: 0, cadence: 0, bob: 0, lean: 0 } as Gait, placed: false, gl: 0, gr: 0, gh: 0, l: { ...HANG }, r: { ...HANG } }),
    [],
  );
  const hit = useHitReaction(agent.id, body);
  if (agent.currentTool) lastTool.current = { name: agent.currentTool, at: performance.now() };
  useEffect(() => trackBody(agent.id, move.s), [agent.id, move]);
  useEffect(() => hearing(agent.id), [agent.id]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const now = performance.now();
    const t = now / 1000 + seed.current;
    const party = isCelebrating(agent.repoId, now); // a PR on this floor just merged: everyone cheers, busy or not

    // ---------- where the body is ----------
    const st = move.s;
    const r0 = root.current;
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
      const goal = bodyTarget(agent.id);
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
      const g = party ? PARTY_ARMS : GESTURES[st.stage === 'up' ? (goal?.gesture ?? 'none') : 'none'];
      const kg = 1 - Math.exp(-dt * 6);
      if (g.l) Object.assign(move.l, g.l);
      if (g.r) Object.assign(move.r, g.r);
      move.gl += ((g.l ? 1 : 0) - move.gl) * kg;
      move.gr += ((g.r ? 1 : 0) - move.gr) * kg;
      move.gh += (g.head - move.gh) * kg;
      hearBody(agent.id, st, st.stage === 'up' ? (goal?.gesture ?? 'none') : 'none', dt, te[13]);
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
    // A little hysteresis so poses don't flicker between quick tool calls.
    const sinceTool = now - lastTool.current.at;
    const browsing = lastTool.current.name?.startsWith('mcp__playwright') && sinceTool < 4000;
    const name: PoseName = party ? 'cheer' : busy
      ? agent.status === 'preparing'
        ? 'typing'
        : browsing
          ? 'browsing'
          : !agent.currentTool && sinceTool > 2500
            ? 'thinking'
            : 'typing'
      : agent.status === 'error'
        ? 'slump'
        : cheering
          ? 'cheer'
          : 'relaxed';
    const target = POSES[name];
    const c = cur.current;
    const k5 = 1 - Math.exp(-dt * 5);
    for (const side of ['l', 'r'] as const) {
      c[side].pitch += (target[side].pitch - c[side].pitch) * k5;
      c[side].yaw += (target[side].yaw - c[side].yaw) * k5;
    }
    for (const key of ['lean', 'headPitch', 'headYaw', 'type', 'mouse'] as const) c[key] += (target[key] - c[key]) * k5;

    // Typing comes in bursts: fast alternating taps, then a short pause to read.
    const burst = Math.sin(t * 0.8) + Math.sin(t * 2.1) * 0.6 > -0.35 ? 1 : 0.15;
    const tap = c.type * burst * 0.1;
    const speed = agent.status === 'preparing' ? 10 : 19;
    const tapL = Math.max(0, Math.sin(t * speed)) * tap;
    const tapR = Math.max(0, Math.sin(t * speed + 2.4)) * tap * (1 - c.mouse);
    const driftL = Math.sin(t * 3.1) * 0.05 * c.type;
    const driftR = Math.sin(t * 2.7 + 1) * 0.05 * c.type;
    // Mouse hand: small glides plus a click now and then.
    const glide = Math.sin(t * 1.9) * 0.06 * c.mouse;
    const click = (Math.sin(t * 5.3) > 0.93 ? 0.04 : 0) * c.mouse;
    const wave = cheering ? Math.sin(t * 9) * 0.35 : 0;
    const waveUp = party ? wave * up : 0; // up and partying, they wave too

    // Longer arms on taller people: tip them down a touch so hands still land on the keyboard.
    const reach = -(look.height - 1) * 0.55;
    // Hit by a toy: jolt back with hands up, then look at the player, laid over the pose above.
    const h = hit.pose(now);
    const jolt = h.flinch * 0.55;

    // ---------- blended with the standing / walking pose (k = 1: exactly the seated pose) ----------
    // Up, the arms hang and swing against the legs, unless a gesture has them busy.
    const idle = Math.sin(t * 1.1) * 0.03 * (1 - walk);
    const lp = (HANG.pitch - swing * 1.1 + idle) * (1 - move.gl) + move.l.pitch * move.gl;
    const ly = HANG.yaw * (1 - move.gl) + move.l.yaw * move.gl;
    const rp = (HANG.pitch + swing * 1.1 + idle) * (1 - move.gr) + move.r.pitch * move.gr;
    const ry = HANG.yaw * (1 - move.gr) + move.r.yaw * move.gr;
    if (armL.current && armR.current) {
      armL.current.rotation.set((c.l.pitch + reach + tapL) * k + lp * up + jolt, (-(c.l.yaw + driftL) + wave) * k - ly * up + waveUp, 0);
      armR.current.rotation.set((c.r.pitch + reach + tapR - click) * k + rp * up + jolt, (c.r.yaw + driftR * (1 - c.mouse) + glide - wave) * k + ry * up - waveUp, 0);
    }
    if (torso.current) {
      const breathe = Math.sin(t * 1.6) * 0.015;
      torso.current.rotation.x = (-c.lean + breathe + (busy ? Math.sin(t * 9) * 0.006 * burst : 0)) * k + (breathe - gt.lean * walk) * up + h.flinch * 0.2;
      // shoulders turn against the hips while walking
      torso.current.rotation.y = h.twist * h.w + Math.sin(st.phase) * 0.1 * walk * up;
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
    if (tag.current) {
      const [tx, ty, tz] = TAG_SEATED;
      tag.current.position.set(tx * k, ty * k + (HIP.standY + look.height * 0.86 + 0.26) * up, tz * k);
    }
    if (head.current) {
      // Every few seconds, glance down at the keyboard; while setting up, look around.
      const glance = busy && Math.sin(t * 0.55 + 2) > 0.92 ? -0.22 : 0;
      const gaze = agent.status === 'preparing' ? Math.sin(t * 1.3) * 0.5 : Math.sin(t * 0.4) * 0.08;
      const pitch = (c.headPitch + glance + (busy ? Math.sin(t * 4.5) * 0.02 * burst : 0)) * k + (Math.sin(t * 0.3) * 0.05 + move.gh) * up;
      const yaw = (gaze + c.headYaw) * k + Math.sin(t * 0.4) * 0.15 * (1 - walk) * up;
      head.current.rotation.set(pitch + (h.headPitch - pitch) * h.w, yaw + (h.headYaw - yaw) * h.w, (name === 'thinking' ? 0.12 : 0) * k * (1 - h.w));
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
        {hit.bubble}
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
        </group>
        {children && (
          <group ref={tag} position={TAG_SEATED}>
            {children}
          </group>
        )}
      </group>
    </group>
  );
}
