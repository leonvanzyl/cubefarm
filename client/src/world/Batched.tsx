import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode, type Ref } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BatchSet, look, type BatchMaterials, type BatchSlot, type Look } from './batch';
import { batchGlow, batchGlowNight, batchToon, glow, toon } from './materials';
import { inkMaterial, Outlines, sizeInks } from './Outlines';

// The React side of batch.ts. <Batches> around a floor (or the lobby, the roof) draws the repeated parts inside it in
// instanced batches: Toon.tsx's boxes, cylinders and balls (desks, chairs, props) and people's parts (Figure.tsx). A
// <Part> leaves an invisible stand-in mesh in the scene where it would have been. Parts of people and of things that
// wander (the dog, the roomba) go in batches of their own, flagged like their owners, so High's contact-shadow bake
// (gfx/ContactShadows.tsx) still leaves them out. window.__swarmBatches reports the batches; `?batch=off` draws every
// part as its own mesh, as before, for comparing.

/** Parts further than this from the camera lose their ink outline (a pixel wide by then, and a floor is 32 m long). */
export const OUTLINE_RANGE = 24;

const MATERIALS: BatchMaterials = { toon: batchToon, glow: batchGlow, glowNight: batchGlowNight, outline: inkMaterial };

interface Sets {
  /** Furniture and props: they stay put. */
  still: BatchSet;
  /** Parts under a person or a wandering thing (userData.person / .moving). */
  moving: BatchSet;
}

const BatchContext = createContext<Sets | null>(null);

/** The batches of the floor this is drawn on; null outside one, where parts are plain meshes. */
export const useBatches = () => useContext(BatchContext);

const live = new Set<Sets>();
if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmBatches')) {
  Object.defineProperty(window, '__swarmBatches', { get: () => [...live].map((s) => ({ still: s.still.stats(), moving: s.moving.stats() })) });
}

const off = typeof location !== 'undefined' && /[?&]batch=off\b/.test(location.search);

interface ScopeProps {
  children: ReactNode;
  /** False: nothing inside casts a shadow (visitors). */
  shadows?: boolean;
  /** Ink outlines are left off beyond this many metres. */
  outlineRange?: number;
}

export function Batches(props: ScopeProps) {
  return off ? <>{props.children}</> : <BatchScope {...props} />;
}

function BatchScope({ children, shadows = true, outlineRange = OUTLINE_RANGE }: ScopeProps) {
  const gl = useThree((s) => s.gl);
  const sets = useMemo<Sets>(() => {
    const moving = new BatchSet(MATERIALS);
    moving.root.userData.moving = true;
    return { still: new BatchSet(MATERIALS), moving };
  }, []);
  sets.still.outlineRange = sets.moving.outlineRange = outlineRange;
  sets.still.shadows = sets.moving.shadows = shadows;
  useEffect(() => {
    live.add(sets);
    return () => {
      live.delete(sets);
      sets.still.dispose();
      sets.moving.dispose();
    };
  }, [sets]);
  useFrame(({ camera }) => {
    sets.still.camera = sets.moving.camera = camera;
    sizeInks(gl);
  });
  return (
    <>
      <primitive object={sets.still.root} />
      <primitive object={sets.moving.root} />
      <BatchContext.Provider value={sets}>{children}</BatchContext.Provider>
    </>
  );
}

type Vec3 = [number, number, number];
interface PartProps {
  look: Look;
  color: string;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3 | number;
  /** The stand-in (or, outside <Batches>, the mesh): for a face's morph weights. */
  ref?: Ref<THREE.Mesh>;
}

/**
 * One part drawn by the surrounding <Batches>: an invisible stand-in that moves, hides and is aimed at as the part would.
 * Outside <Batches> (a preview canvas) it is the plain mesh it stands for.
 */
export function Part(props: PartProps) {
  const sets = useBatches();
  return sets ? <StandIn sets={sets} {...props} /> : <PlainPart {...props} />;
}

function PlainPart({ look: l, color, position, rotation, scale, ref }: PartProps) {
  const material = l.material ?? (l.shading === 'toon' ? toon(color) : glow(color, l.shading === 'glowNight' ? 'night' : 'always'));
  return (
    <mesh ref={ref} geometry={l.geometry} material={material} position={position} rotation={rotation} scale={scale} castShadow={l.castShadow} receiveShadow={l.receiveShadow}>
      {l.outline > 0 && <Outlines thickness={l.outline} color="#1f1d2b" angle={l.crease} />}
    </mesh>
  );
}

/** Marks a stand-in: never drawn itself, but clicks and aims that skip hidden things must still find it (camera/picking.ts). */
export const STAND_IN = { standIn: true };

/** Whether a part belongs with the movers: under a person, the dog, the roomba. */
function onMover(o: THREE.Object3D) {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData.person || p.userData.moving) return true;
  return false;
}

function StandIn({ sets, look: l, color, position, rotation, scale, ref }: PartProps & { sets: Sets }) {
  const mesh = useRef<THREE.Mesh>(null);
  const slot = useRef<BatchSlot | null>(null);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const s = (onMover(mesh.current) ? sets.moving : sets.still).add(l, mesh.current, color);
    slot.current = s;
    return () => {
      s.remove();
      slot.current = null;
    };
    // the colour is set below, without leaving the batch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sets, l]);
  useLayoutEffect(() => slot.current?.setColor(color), [color]);
  const setRef = useCallback(
    (m: THREE.Mesh | null) => {
      mesh.current = m;
      if (typeof ref === 'function') ref(m);
      else if (ref) (ref as { current: THREE.Mesh | null }).current = m;
    },
    [ref],
  );
  return <mesh ref={setRef} geometry={l.geometry} position={position} rotation={rotation} scale={scale} visible={false} userData={STAND_IN} />;
}

/**
 * A mesh of shared geometry in a flat toon colour (people's parts, characterParts.ts), with an ink outline of
 * `outline` thickness if it has one: an instance in the floor's batches, or a plain mesh outside them.
 */
export function Piece({ geometry, color, outline = 0, castShadow = false, ...rest }: Omit<PartProps, 'look'> & { geometry: THREE.BufferGeometry; outline?: number; castShadow?: boolean }) {
  return <Part look={look(geometry, { outline, castShadow })} color={color} {...rest} />;
}
