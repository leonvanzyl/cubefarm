import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { EMOTE_EMOJI } from '../../../../shared/presence';
import type { VisitorHeld } from '../../../../shared/types';
import type { Agent } from '../../store';
import { appearanceFor } from '../appearance';
import { Batches } from '../Batched';
import { gait, type Gait, type Gesture } from '../body';
import { Character } from '../Character';
import { SANS, roundRect } from '../draw';
import { useCanvasTexture } from '../interact';
import { shade, toon } from '../materials';
import { bodyState, bodyTarget, placeBody, say, saying, seatBody, setHandMug } from '../people';
import { Box, Cyl } from '../Toon';
import { BALLS, BallLook } from '../toys/balls';
import { BLASTERS } from '../toys/darts';
import { CABIN, drawnVisitors, poseNow, presenceVersion, remoteOf, subscribePresence, type DrawnPose } from './presenceState';
import { EMOTE_GESTURE, EMOTE_MS, visitorLooks } from './presenceMath';

// The other people viewing the office, drawn as visitors: the office's own cartoon people (Character.tsx, wrapped, not
// changed) in their profile colour, with a lanyard, a floating name tag and a soft glow, walking where they walk and
// holding what they hold. presence.ts says where each one is; every frame, before Character.tsx steps its body, this
// puts the body exactly there (people.ts), so the walk cycle follows their real speed.

/** The people controller's id for a visitor (agents' ids never contain a colon). */
export const visitorBodyId = (id: string) => `visitor:${id}`;

const BASE: Agent = {
  id: '',
  name: '',
  repoId: '',
  role: 'agent',
  look: 'masculine',
  task: null,
  desk: 0,
  color: '#ef476f',
  hair: '#2b2118',
  skin: '#e0ac69',
  model: '',
  effort: '',
  cli: '',
  terminal: false,
  status: 'idle',
  issueNumber: null,
  issueTitle: null,
  branch: null,
  prNumber: null,
  prUrl: null,
  currentTool: null,
  startedAt: null,
  endedAt: null,
  costUsd: 0,
  turns: 0,
  browserUrl: null,
  hasScreenshot: false,
  screenshotAt: null,
  lastError: null,
  style: null,
  career: null,
};

/** A visitor as Character.tsx draws people: their colour on the shirt, a face and hair from their id. */
export function visitorAgent(id: string, name: string, color: string): Agent {
  return { ...BASE, ...visitorLooks(id), id: visitorBodyId(id), name, color };
}

/** Everyone else on this floor (and anyone still walking into the elevator). */
export function Visitors() {
  useSyncExternalStore(subscribePresence, presenceVersion);
  return (
    // in instanced batches of their own (world/Batched.tsx), with no shadows and no outlines far away, as below
    <Batches shadows={false} outlineRange={OUTLINE_FAR}>
      {drawnVisitors().map((id) => (
        <VisitorFigure key={id} id={id} />
      ))}
    </Batches>
  );
}

// ---------- one visitor ----------

const HIP_UP = 0.815; // Character.tsx: the hips' height standing
/** Further than this (metres), a visitor's ink outlines are left out: too thin to see, and each one is a draw call. */
const OUTLINE_FAR = 11;

const isOutline = (o: THREE.Object3D) => {
  const m = (o as THREE.Mesh).material;
  return m instanceof THREE.ShaderMaterial && m.side === THREE.BackSide && 'thickness' in m.uniforms;
};

/**
 * Visitors cost less to draw than the team: they cast no shadow (their glow grounds them) and lose their outlines at
 * a distance. Character.tsx is left as it is; this goes over what it drew. Returns the outline meshes found.
 */
function lighten(root: THREE.Object3D, outlines: THREE.Object3D[]) {
  outlines.length = 0;
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    o.castShadow = false;
    if (isOutline(o)) outlines.push(o);
  });
}

function VisitorFigure({ id }: { id: string }) {
  useSyncExternalStore(subscribePresence, presenceVersion); // their name, colour and what they hold
  const r = remoteOf(id);
  const name = r?.name ?? 'Visitor';
  const color = r?.color ?? '#ef476f';
  const held = r?.held ?? null; // replaced (not changed) when they pick something else up
  const vid = visitorBodyId(id);
  const agent = useMemo(() => visitorAgent(id, name, color), [id, name, color]);
  const height = useMemo(() => appearanceFor(agent).height, [agent]);
  const camera = useThree((s) => s.camera);
  const root = useRef<THREE.Group>(null);
  const extras = useRef<THREE.Group>(null);
  const lanyard = useRef<THREE.Group>(null);
  const m = useMemo(
    () => ({ at: { x: 0, z: 0, h: 0, p: 0 } as DrawnPose, lx: 0, lz: 0, lt: 0, speed: 0, g: { stride: 0, cadence: 0, bob: 0, lean: 0 } as Gait, outlines: [] as THREE.Object3D[], far: false, frame: 0 }),
    [],
  );
  // after every render (a mug or a ball may have come or gone), and now and then below for anything made later
  useEffect(() => {
    if (root.current) lighten(root.current, m.outlines);
    m.far = false;
  });

  // Stood where they are before Character.tsx's first frame, so nobody is seen getting up from a chair.
  useState(() => {
    const at = r ? poseNow(r, performance.now(), m.at) : null;
    placeBody(vid, at?.x ?? CABIN.x, at?.z ?? CABIN.z, at?.h ?? 0);
  });
  useEffect(
    () => () => {
      seatBody(vid);
      setHandMug(vid, null);
      say(vid, null);
    },
    [vid],
  );
  useEffect(() => setHandMug(vid, held?.k === 'mug' ? { id: held.id, sips: held.s ?? 0 } : null), [vid, held]);

  // Priority -1: before Character.tsx's frame steps the body from what's written here.
  useFrame(() => {
    const rr = remoteOf(id);
    const st = bodyState(vid);
    const target = bodyTarget(vid);
    const g = extras.current;
    if (!rr || !st || !target || !g || !root.current) return;
    const now = performance.now();
    const at = poseNow(rr, now, m.at);
    // no pose yet (just arrived on this floor, waiting for where they are), or gone into the elevator: not drawn
    root.current.visible = !!at;
    if (!at) {
      st.speed = 0;
      return;
    }
    // ground speed from how far they went since last frame, eased (it drives the walk cycle)
    const dt = m.lt ? (now - m.lt) / 1000 : 0;
    if (dt > 0) m.speed += (Math.min(8, Math.hypot(at.x - m.lx, at.z - m.lz) / dt) - m.speed) * Math.min(1, dt * 8);
    m.lx = at.x;
    m.lz = at.z;
    m.lt = now;
    st.stage = 'up';
    st.sit = 0;
    st.x = at.x;
    st.z = at.z;
    st.heading = at.h;
    st.speed = m.speed < 0.05 ? 0 : m.speed;
    target.mode = 'standing';
    target.x = at.x;
    target.z = at.z;
    target.heading = at.h;
    const e = rr.emote && now - rr.emote.at < EMOTE_MS ? rr.emote.e : null;
    target.gesture = (e ? EMOTE_GESTURE[e] : rr.held?.k === 'mug' ? 'mug' : rr.held ? 'hold' : 'none') as Gesture;
    const bubble = e ? EMOTE_EMOJI[e] : null;
    if ((saying(vid)?.text ?? null) !== bubble) say(vid, bubble);

    // Outlines off far away (with a little give either side, so they don't flicker at the edge).
    if (++m.frame % 60 === 0 && root.current) {
      lighten(root.current, m.outlines);
      m.far = false;
    }
    const d = Math.hypot(camera.position.x - at.x, camera.position.z - at.z);
    const far = m.far ? d > OUTLINE_FAR - 1 : d > OUTLINE_FAR + 1;
    if (far !== m.far) {
      m.far = far;
      for (const o of m.outlines) o.visible = !far;
    }

    // The lanyard and glow go where the body goes, leaning and bobbing with the walk as Character.tsx's torso does.
    g.position.set(at.x, 0, at.z);
    g.rotation.y = at.h;
    const l = lanyard.current;
    if (l) {
      const gt = gait(st.speed, m.g);
      const walk = Math.min(1, st.speed / 0.5);
      l.position.y = HIP_UP - gt.bob * walk * Math.sin(st.phase) ** 2;
      l.rotation.set(-gt.lean * walk, Math.sin(st.phase) * 0.1 * walk, 0);
    }
  }, -1);

  return (
    <group ref={root}>
      <Character agent={agent} carrying={<Carried held={held} />}>
        <VisitorTag name={name} color={color} />
      </Character>
      <group ref={extras}>
        <group ref={lanyard} scale={height}>
          <Lanyard color={color} />
        </group>
        <Glow color={color} />
      </group>
    </group>
  );
}

// ---------- what they carry (in Character.tsx's torso frame: facing -Z, shoulders at y 0.44) ----------

function Carried({ held }: { held: VisitorHeld | null }) {
  if (held?.k === 'ball') {
    const def = [...BALLS.office, ...BALLS.lobby].find((b) => b.id === held.id) ?? BALLS.office[0];
    return (
      <group position={[0, 0.22, -(0.22 + def.r)]}>
        <BallLook def={def} />
      </group>
    );
  }
  if (held?.k === 'blaster') {
    const b = BLASTERS.find((x) => x.id === held.id) ?? BLASTERS[0];
    // a foam blaster held level at the chest, pointing ahead
    return (
      <group position={[0.04, 0.2, -0.48]} scale={0.55}>
        <Box size={[0.16, 0.2, 0.62]} color={b.body} outline />
        <Cyl r={0.05} h={0.36} position={[0, 0.03, -0.46]} rotation={[Math.PI / 2, 0, 0]} color={b.trim} />
        <Box size={[0.1, 0.24, 0.12]} position={[0, -0.2, 0.18]} rotation={[0.3, 0, 0]} color={shade(b.body, -0.2)} />
        <Box size={[0.12, 0.16, 0.18]} position={[0, 0.16, -0.05]} color={b.foam} />
      </group>
    );
  }
  return null; // a mug goes in the hand (people.ts setHandMug); nothing else is drawn
}

// ---------- the lanyard, the glow and the name tag ----------

const STRAP = new THREE.CylinderGeometry(0.009, 0.009, 1, 6);
const strapGeo = (from: THREE.Vector3, to: THREE.Vector3) => {
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const dir = to.clone().sub(from);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return { mid, q, len: dir.length() };
};
// Torso space (hips at the origin; Character.tsx's torso is a capsule of radius 0.2 from y 0.18 to 0.42, plus caps).
const STRAP_COLOR = '#2b2d42'; // dark, so it shows on a shirt of their colour
const STRAPS = [-1, 1].map((s) => strapGeo(new THREE.Vector3(0.08 * s, 0.55, -0.17), new THREE.Vector3(0.028 * s, 0.33, -0.24)));

/** A dark strap round the neck and a white badge with a stripe of their colour. */
function Lanyard({ color }: { color: string }) {
  return (
    <group>
      {STRAPS.map((s, i) => (
        <mesh key={i} geometry={STRAP} material={toon(STRAP_COLOR)} position={s.mid} quaternion={s.q} scale={[1, s.len, 1]} />
      ))}
      <group position={[0, 0.28, -0.245]} rotation={[0.08, 0, 0]}>
        <Box size={[0.075, 0.1, 0.008]} color="#f8f9fa" shadow={false} />
        <Box size={[0.077, 0.026, 0.01]} position={[0, 0.03, 0]} color={color} shadow={false} />
      </group>
    </group>
  );
}

let glowTex: THREE.CanvasTexture | null = null;
/** A soft white blob, tinted per visitor. */
function glowTexture() {
  if (glowTex || typeof document === 'undefined') return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

const glows = new Map<string, THREE.Material>();
const noRaycast = () => undefined;

/** A soft pool of their colour round their feet: it marks a visitor out, and grounds them without a shadow. */
function Glow({ color }: { color: string }) {
  let m = glows.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map: glowTexture(), color, opacity: 0.7, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    glows.set(color, m);
  }
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} material={m} renderOrder={1} raycast={noRaycast}>
      <planeGeometry args={[1.6, 1.6]} />
    </mesh>
  );
}

/** Their name over their head, on a tag in their colour. Drawn on a canvas as text: a name can never be markup. */
export function drawVisitorTag(ctx: CanvasRenderingContext2D, w: number, h: number, name: string, color: string) {
  ctx.clearRect(0, 0, w, h);
  roundRect(ctx, 4, 4, w - 8, h - 8, (h - 8) / 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();
  ctx.textBaseline = 'middle';
  ctx.font = `36px ${SANS}`;
  ctx.fillText('🪪', 22, h / 2 + 2);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 40px ${SANS}`;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 4;
  let label = name;
  while (label.length > 2 && ctx.measureText(label).width > w - 100) label = `${label.slice(0, -2)}…`;
  ctx.fillText(label, 74, h / 2 + 2);
  ctx.shadowBlur = 0;
}

function VisitorTag({ name, color }: { name: string; color: string }) {
  const tex = useCanvasTexture(512, 96, (ctx) => drawVisitorTag(ctx, 512, 96, name, color), [name, color]);
  return (
    <Billboard>
      <mesh raycast={noRaycast}>
        <planeGeometry args={[1.15, 0.216]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </Billboard>
  );
}
