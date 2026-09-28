import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Outlines } from '@react-three/drei';
import type { Agent } from '../store';
import { ACCENTS, appearanceFor } from './appearance';
import { PARTS } from './characterParts';
import { mix, shade, toon } from './materials';
import { useHitReaction } from './useHitReaction';

// A seated cartoon developer. Origin is the floor under the chair; they face -Z (toward the desk).

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

export function Character({ agent }: { agent: Agent }) {
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const cur = useRef<Pose>(clone(POSES.relaxed));
  const seed = useRef(Math.random() * 100);
  const lastTool = useRef({ name: null as string | null, at: 0 });
  const look = useMemo(() => appearanceFor(agent), [agent.id, agent.look, agent.role]);
  const root = useRef<THREE.Group>(null);
  const hit = useHitReaction(agent.id, root);
  if (agent.currentTool) lastTool.current = { name: agent.currentTool, at: performance.now() };

  useFrame((_, dt) => {
    const now = performance.now();
    const t = now / 1000 + seed.current;
    const busy = agent.status === 'working' || agent.status === 'preparing';
    const cheering = agent.status === 'done' && agent.endedAt != null && Date.now() - agent.endedAt < 7000;
    // A little hysteresis so poses don't flicker between quick tool calls.
    const sinceTool = now - lastTool.current.at;
    const browsing = lastTool.current.name?.startsWith('mcp__playwright') && sinceTool < 4000;
    const name: PoseName = busy
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
    const k = 1 - Math.exp(-dt * 5);
    for (const side of ['l', 'r'] as const) {
      c[side].pitch += (target[side].pitch - c[side].pitch) * k;
      c[side].yaw += (target[side].yaw - c[side].yaw) * k;
    }
    for (const key of ['lean', 'headPitch', 'headYaw', 'type', 'mouse'] as const) c[key] += (target[key] - c[key]) * k;

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

    // Longer arms on taller people: tip them down a touch so hands still land on the keyboard.
    const reach = -(look.height - 1) * 0.55;
    // Hit by a toy: jolt back with hands up, then look at the player, laid over the pose above.
    const h = hit.pose(now);
    const jolt = h.flinch * 0.55;
    if (armL.current && armR.current) {
      armL.current.rotation.set(c.l.pitch + reach + tapL + jolt, -(c.l.yaw + driftL) + wave, 0);
      armR.current.rotation.set(c.r.pitch + reach + tapR - click + jolt, c.r.yaw + driftR * (1 - c.mouse) + glide - wave, 0);
    }
    if (torso.current) {
      torso.current.rotation.x = -c.lean + Math.sin(t * 1.6) * 0.015 + (busy ? Math.sin(t * 9) * 0.006 * burst : 0) + h.flinch * 0.2;
      torso.current.rotation.y = h.twist * h.w;
    }
    if (head.current) {
      // Every few seconds, glance down at the keyboard; while setting up, look around.
      const glance = busy && Math.sin(t * 0.55 + 2) > 0.92 ? -0.22 : 0;
      const gaze = agent.status === 'preparing' ? Math.sin(t * 1.3) * 0.5 : Math.sin(t * 0.4) * 0.08;
      const pitch = c.headPitch + glance + (busy ? Math.sin(t * 4.5) * 0.02 * burst : 0);
      const yaw = gaze + c.headYaw;
      head.current.rotation.set(pitch + (h.headPitch - pitch) * h.w, yaw + (h.headYaw - yaw) * h.w, (name === 'thinking' ? 0.12 : 0) * (1 - h.w));
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
      {hit.bubble}
      {/* legs never move, so both are one mesh */}
      <mesh geometry={PARTS.legs} material={toon('#3d4a6b')} castShadow>
        <Outlines thickness={0.012} color={INK} angle={0} />
      </mesh>
      <mesh geometry={PARTS.shoes} material={dark} castShadow />

      {/* taller people sit a touch further forward so their back stays clear of the chair */}
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
    </group>
  );
}
