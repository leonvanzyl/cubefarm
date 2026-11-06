import { useEffect, useMemo, useRef } from 'react';
import { createRoot, useFrame, type ReconcilerRoot, type RootStore } from '@react-three/fiber';
import * as THREE from 'three';
import type { AgentLook, AgentRole } from '../../../shared/types';
import type { AgentStyle } from '../../../shared/looks';
import { appearanceFor } from './appearance';
import { PARTS } from './characterParts';
import { blink, newFace, stepFace, type Expression } from './face';
import { HeadParts, INK, Sleeve, TorsoWear, applyFace, torsoWidth } from './Figure';
import { toon } from './materials';
import { Outlines } from './Outlines';
import { hashString } from './typing';

// The look editor's live preview (AgentSettings.tsx, AgentDesigner.tsx): a person standing and turning a little, drawn
// with the same parts as at their desk (Figure.tsx), blinking and trying on an expression now and then. They needn't
// exist yet: the preview draws the look it's given. One small renderer of its own, made the first time a preview opens
// and kept: its canvas moves into the newest preview showing (back to the one under it when that closes) and stops
// drawing when none is, so opening Setup again compiles nothing and leaves nothing behind.

/** Who to draw: an agent, a candidate in the lobby, or someone being designed. */
export interface PreviewWho {
  id: string;
  look: AgentLook;
  role: AgentRole;
  hair: string;
  skin: string;
  color: string;
  style: AgentStyle | null;
}

const SIZE = { width: 210, height: 280 };
const HIP_Y = 0.815; // standing (Character.tsx HIP.standY)
const HANG = { pitch: -1.42, yaw: 0.1 };
/** Shown in turn, each for a moment between stretches of their resting face. */
const SHOWN: Expression[] = ['joyful', 'puzzled', 'focused', 'surprised', 'sleepy', 'proud', 'stressed'];
const CYCLE_S = 5.5;
const SHOW_S = 1.8;

let shared: Promise<{ canvas: HTMLCanvasElement; root: ReconcilerRoot<HTMLCanvasElement> }> | null = null;

function previewRoot() {
  shared ??= (async () => {
    const canvas = document.createElement('canvas');
    const root = createRoot(canvas);
    await root.configure({
      size: { ...SIZE, top: 0, left: 0 },
      dpr: [1, 2],
      gl: { antialias: true, alpha: true },
      camera: { fov: 26, near: 0.1, far: 20, position: [0, 1.15, 3.25] },
      frameloop: 'never',
      onCreated: ({ camera }) => camera.lookAt(0, 1.1, 0),
    });
    return { canvas, root };
  })();
  return shared;
}

function Person({ who }: { who: PreviewWho }) {
  const look = useMemo(() => appearanceFor(who), [who]);
  const turn = useRef<THREE.Group>(null);
  const faceMesh = useRef<THREE.Mesh>(null);
  const face = useMemo(() => ({ s: newFace(), seed: hashString(who.id) % 10007 }), [who.id]);
  useFrame((_, delta) => {
    const t = performance.now() / 1000;
    if (turn.current) turn.current.rotation.y = Math.PI + Math.sin(t * 0.6) * 0.45; // facing the camera, swaying
    const showing = t % CYCLE_S > CYCLE_S - SHOW_S;
    stepFace(face.s, showing ? SHOWN[Math.floor(t / CYCLE_S) % SHOWN.length] : 'neutral', Math.min(delta, 0.1));
    applyFace(faceMesh, face.s, blink(t, face.seed));
  });
  const pants = toon('#3d4a6b');
  return (
    <>
      <hemisphereLight args={['#fffaf0', '#a48a6a', 0.95]} />
      <ambientLight intensity={0.2} />
      <directionalLight position={[1.5, 3, 4]} intensity={1.7} />
      <group ref={turn}>
        {[-0.11, 0.11].map((x) => (
          <group key={x} position={[x, HIP_Y, 0]}>
            <mesh geometry={PARTS.thigh} material={pants}>
              <Outlines thickness={0.012} color={INK} angle={0} />
            </mesh>
            <group position={[0, -0.32, 0]}>
              <mesh geometry={PARTS.shin} material={pants}>
                <Outlines thickness={0.012} color={INK} angle={0} />
              </mesh>
              <mesh geometry={PARTS.shoe} material={toon(INK)} />
            </group>
          </group>
        ))}
        <group position={[0, HIP_Y, 0]} scale={look.height}>
          <TorsoWear agent={who} look={look} busy={false} />
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.25 * torsoWidth(look), 0.44, 0]} rotation={[HANG.pitch, -s * HANG.yaw, 0]}>
              <Sleeve agent={who} look={look} />
            </group>
          ))}
          <group position={[0, 0.66, 0]}>
            <HeadParts agent={who} look={look} busy={false} face={faceMesh} />
          </group>
        </group>
      </group>
    </>
  );
}

interface Shown {
  host: HTMLDivElement;
  who: PreviewWho;
  size: { width: number; height: number };
}

/** The previews mounted, newest last: only the newest draws. */
const stack: Shown[] = [];
let live: { root: ReconcilerRoot<HTMLCanvasElement>; store: RootStore; canvas: HTMLCanvasElement } | null = null;

function draw() {
  const top = stack[stack.length - 1];
  void previewRoot().then(
    ({ canvas, root }) => {
      if (top !== stack[stack.length - 1]) return; // another one opened or closed meanwhile; it draws
      if (!top) {
        if (!live) return;
        live.store.getState().setFrameloop('never');
        live.root.render(null);
        live.canvas.remove();
        live = null;
        return;
      }
      if (canvas.parentElement !== top.host) top.host.appendChild(canvas);
      const store = root.render(<Person who={top.who} />);
      const st = store.getState();
      if (st.size.width !== top.size.width || st.size.height !== top.size.height) st.setSize(top.size.width, top.size.height);
      st.setFrameloop('always');
      live = { root, store, canvas };
    },
    (err) => console.warn('No look preview:', err),
  );
}

/** A live 3D preview of how `who` looks, following their look as it changes. One draws at a time: the newest. */
export function LookPreview({ who, label, size = SIZE }: { who: PreviewWho; label: string; size?: { width: number; height: number } }) {
  const host = useRef<HTMLDivElement>(null);
  const entry = useRef<Shown | null>(null);
  const key = JSON.stringify(who);
  useEffect(() => {
    if (!host.current) return;
    const e: Shown = { host: host.current, who, size };
    entry.current = e;
    stack.push(e);
    draw();
    return () => {
      stack.splice(stack.indexOf(e), 1);
      entry.current = null;
      draw();
    };
  }, [size.width, size.height]);
  useEffect(() => {
    const e = entry.current;
    if (!e || e.who === who) return;
    e.who = who;
    if (stack[stack.length - 1] === e) draw();
  }, [key]);
  return <div ref={host} className="look-preview" style={size} role="img" aria-label={label} />;
}
