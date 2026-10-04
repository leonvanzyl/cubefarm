import { useEffect, useMemo, useRef } from 'react';
import { createRoot, useFrame, type ReconcilerRoot, type RootStore } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { appearanceFor } from './appearance';
import { PARTS } from './characterParts';
import { blink, newFace, stepFace, type Expression } from './face';
import { HeadParts, INK, Sleeve, TorsoWear, applyFace, torsoWidth } from './Figure';
import { toon } from './materials';
import { Outlines } from './Outlines';
import { hashString } from './typing';

// The look editor's live preview (AgentSettings.tsx): the agent standing and turning a little, drawn with the same
// parts as at their desk (Figure.tsx), blinking and trying on an expression now and then. One small renderer of its
// own, made the first time a preview opens and kept: its canvas moves into whichever preview is showing and stops
// drawing when none is, so opening Setup again compiles nothing and leaves nothing behind.

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

function Person({ id }: { id: string }) {
  const agent = useStore((s) => s.agents[id]);
  const look = useMemo(() => (agent ? appearanceFor(agent) : null), [agent]);
  const turn = useRef<THREE.Group>(null);
  const faceMesh = useRef<THREE.Mesh>(null);
  const face = useMemo(() => ({ s: newFace(), seed: hashString(id) % 10007 }), [id]);
  useFrame((_, delta) => {
    const t = performance.now() / 1000;
    if (turn.current) turn.current.rotation.y = Math.PI + Math.sin(t * 0.6) * 0.45; // facing the camera, swaying
    const showing = t % CYCLE_S > CYCLE_S - SHOW_S;
    stepFace(face.s, showing ? SHOWN[Math.floor(t / CYCLE_S) % SHOWN.length] : 'neutral', Math.min(delta, 0.1));
    applyFace(faceMesh, face.s, blink(t, face.seed));
  });
  if (!agent || !look) return null;
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
          <TorsoWear agent={agent} look={look} busy={false} />
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 0.25 * torsoWidth(look), 0.44, 0]} rotation={[HANG.pitch, -s * HANG.yaw, 0]}>
              <Sleeve agent={agent} look={look} />
            </group>
          ))}
          <group position={[0, 0.66, 0]}>
            <HeadParts agent={agent} look={look} busy={false} face={faceMesh} />
          </group>
        </group>
      </group>
    </>
  );
}

/** A live 3D preview of how agent `id` looks, following their look as it changes. One shows at a time. */
export function LookPreview({ id, label }: { id: string; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    let shown: { root: ReconcilerRoot<HTMLCanvasElement>; store: RootStore; canvas: HTMLCanvasElement } | null = null;
    previewRoot().then(
      ({ canvas, root }) => {
        if (!live || !host.current) return;
        host.current.appendChild(canvas);
        const store = root.render(<Person id={id} />);
        store.getState().setFrameloop('always');
        shown = { root, store, canvas };
      },
      (err) => console.warn('No look preview:', err),
    );
    return () => {
      live = false;
      if (!shown) return;
      shown.store.getState().setFrameloop('never');
      shown.root.render(null);
      shown.canvas.remove();
    };
  }, [id]);
  return <div ref={host} className="look-preview" style={SIZE} role="img" aria-label={label} />;
}
