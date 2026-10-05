import { Outlines } from './Outlines';
import type { ReactNode } from 'react';
import * as THREE from 'three';
import { look } from './batch';
import { Part, useBatches } from './Batched';
import { toon } from './materials';

// Small building blocks so furniture reads like a cartoon: flat toon shading + ink outlines. Inside <Batches> (an
// office floor, the lobby) each one is drawn as an instance of its shape (batch.ts), so a floor of identical desks and
// chairs costs a few draw calls; anywhere else, or with children inside, it is its own mesh as before.

type Vec3 = [number, number, number];

interface Common {
  position?: Vec3;
  rotation?: Vec3;
  color: string;
  outline?: boolean;
  shadow?: boolean;
  children?: ReactNode;
}

const INK = '#1f1d2b';
const OUTLINE = 0.018;

// One geometry per size, shared by every batched part of that size (never disposed: a floor has a few dozen sizes).
const shapes = new Map<string, THREE.BufferGeometry>();
function shape(key: string, make: () => THREE.BufferGeometry) {
  let g = shapes.get(key);
  if (!g) {
    g = make();
    shapes.set(key, g);
  }
  return g;
}

export function Box({ size, position, rotation, color, outline = false, shadow = true, children }: Common & { size: Vec3 }) {
  const batches = useBatches();
  if (batches && !children) {
    const g = shape(`box${size.join()}`, () => new THREE.BoxGeometry(...size));
    return <Part look={look(g, { outline: outline ? OUTLINE : 0, crease: Math.PI, castShadow: shadow, receiveShadow: true })} color={color} position={position} rotation={rotation} />;
  }
  return (
    <mesh position={position} rotation={rotation} castShadow={shadow} receiveShadow material={toon(color)}>
      <boxGeometry args={size} />
      {outline && <Outlines thickness={OUTLINE} color={INK} />}
      {children}
    </mesh>
  );
}

export function Cyl({
  r,
  rTop,
  h,
  position,
  rotation,
  color,
  outline = false,
  shadow = true,
  seg = 20,
}: Common & { r: number; rTop?: number; h: number; seg?: number }) {
  const batches = useBatches();
  if (batches) {
    const g = shape(`cyl${rTop ?? r},${r},${h},${seg}`, () => new THREE.CylinderGeometry(rTop ?? r, r, h, seg));
    return <Part look={look(g, { outline: outline ? OUTLINE : 0, crease: Math.PI, castShadow: shadow, receiveShadow: true })} color={color} position={position} rotation={rotation} />;
  }
  return (
    <mesh position={position} rotation={rotation} castShadow={shadow} receiveShadow material={toon(color)}>
      <cylinderGeometry args={[rTop ?? r, r, h, seg]} />
      {outline && <Outlines thickness={OUTLINE} color={INK} />}
    </mesh>
  );
}

export function Ball({ r, position, scale, color, outline = false, shadow = true }: Common & { r: number; scale?: Vec3 }) {
  const batches = useBatches();
  if (batches) {
    const g = shape(`ball${r}`, () => new THREE.SphereGeometry(r, 20, 14));
    return <Part look={look(g, { outline: outline ? OUTLINE : 0, crease: Math.PI, castShadow: shadow })} color={color} position={position} scale={scale} />;
  }
  return (
    <mesh position={position} scale={scale} castShadow={shadow} material={toon(color)}>
      <sphereGeometry args={[r, 20, 14]} />
      {outline && <Outlines thickness={OUTLINE} color={INK} />}
    </mesh>
  );
}

export function Capsule({ r, len, position, rotation, color, outline = false }: Common & { r: number; len: number }) {
  const batches = useBatches();
  if (batches) {
    const g = shape(`capsule${r},${len}`, () => new THREE.CapsuleGeometry(r, len, 6, 14));
    return <Part look={look(g, { outline: outline ? 0.015 : 0, crease: Math.PI, castShadow: true })} color={color} position={position} rotation={rotation} />;
  }
  return (
    <mesh position={position} rotation={rotation} castShadow material={toon(color)}>
      <capsuleGeometry args={[r, len, 6, 14]} />
      {outline && <Outlines thickness={0.015} color={INK} />}
    </mesh>
  );
}
