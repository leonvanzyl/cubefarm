import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BatchSet, type BatchMaterials, type BatchSlot, type Look } from './batch';
import { batchGlow, batchToon, glow, toon } from './materials';
import { inkMaterial, Outlines, sizeInks } from './Outlines';

// The React side of batch.ts. <Batches> around a floor (or the lobby) draws the repeated parts inside it in instanced
// batches: Toon.tsx's boxes, cylinders and balls (desks, chairs, props) and people's body parts. A <Part> leaves an
// invisible stand-in mesh in the scene where it would have been. window.__swarmBatches reports the batches.

/** Parts further than this from the camera lose their ink outline (one pixel wide by then, and a floor is 32 m long). */
export const OUTLINE_RANGE = 24;

const MATERIALS: BatchMaterials = { toon: batchToon, glow: batchGlow, outline: inkMaterial };

const BatchContext = createContext<BatchSet | null>(null);

/** The batches of the floor this is drawn on; null outside one, where parts are plain meshes. */
export const useBatches = () => useContext(BatchContext);

const live = new Set<BatchSet>();
if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmBatches')) {
  Object.defineProperty(window, '__swarmBatches', { get: () => [...live].map((s) => s.stats()) });
}

export function Batches({ children }: { children: ReactNode }) {
  const gl = useThree((s) => s.gl);
  const set = useMemo(() => new BatchSet(MATERIALS), []);
  set.outlineRange = OUTLINE_RANGE;
  useEffect(() => {
    live.add(set);
    return () => {
      live.delete(set);
      set.dispose();
    };
  }, [set]);
  useFrame(({ camera }) => {
    set.camera = camera;
    sizeInks(gl);
  });
  return (
    <>
      <primitive object={set.root} />
      <BatchContext.Provider value={set}>{children}</BatchContext.Provider>
    </>
  );
}

type Vec3 = [number, number, number];

/**
 * One part drawn by the surrounding <Batches>: an invisible stand-in that moves, hides and is aimed at as the part would.
 * Outside <Batches> (a preview canvas) it is the plain mesh it stands for.
 */
export function Part({ look, color, position, rotation, scale }: { look: Look; color: string; position?: Vec3; rotation?: Vec3; scale?: Vec3 | number }) {
  const set = useBatches();
  if (!set) return <PlainPart look={look} color={color} position={position} rotation={rotation} scale={scale} />;
  return <StandIn set={set} look={look} color={color} position={position} rotation={rotation} scale={scale} />;
}

function PlainPart({ look, color, position, rotation, scale }: { look: Look; color: string; position?: Vec3; rotation?: Vec3; scale?: Vec3 | number }) {
  const material = look.material ?? (look.shading === 'glow' ? glow(color) : toon(color));
  return (
    <mesh geometry={look.geometry} material={material} position={position} rotation={rotation} scale={scale} castShadow={look.castShadow} receiveShadow={look.receiveShadow}>
      {look.outline > 0 && <Outlines thickness={look.outline} color="#1f1d2b" angle={look.crease} />}
    </mesh>
  );
}

function StandIn({ set, look, color, position, rotation, scale }: { set: BatchSet; look: Look; color: string; position?: Vec3; rotation?: Vec3; scale?: Vec3 | number }) {
  const ref = useRef<THREE.Mesh>(null);
  const slot = useRef<BatchSlot | null>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const s = set.add(look, ref.current, color);
    slot.current = s;
    return () => {
      s.remove();
      slot.current = null;
    };
    // the colour is set below, without leaving the batch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set, look]);
  useLayoutEffect(() => slot.current?.setColor(color), [color]);
  return <mesh ref={ref} geometry={look.geometry} position={position} rotation={rotation} scale={scale} visible={false} />;
}
