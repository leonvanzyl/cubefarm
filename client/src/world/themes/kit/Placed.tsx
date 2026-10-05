import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import type { ThemeId } from '../../../../../shared/themes';
import type { DecorSlot } from '../../layout';
import { placeDecor, type DecorItem } from '../themes';
import { paintedToon } from './geo';

// Drawing a theme's decorations: the same prop in many slots is one InstancedMesh (fifteen desk pumpkins, one draw
// call), and each kind of item gets the list of slots it fills on this floor.

export interface Spot {
  x: number;
  y: number;
  z: number;
  rotY: number;
  /** The slot's id, for things that differ per slot. */
  id: string;
}

const spotOf = (s: DecorSlot): Spot => ({ x: s.x, y: s.y, z: s.z, rotY: s.rotY, id: s.id });

/** `geometry` drawn at every spot (scaled by `scale`), as one instanced mesh. Frees the geometry when it goes. */
export function Placed({
  geometry,
  at,
  material = paintedToon(),
  scale = 1,
  shadow = true,
  renderOrder,
}: {
  geometry: THREE.BufferGeometry;
  at: readonly Spot[];
  material?: THREE.Material;
  scale?: number | ((s: Spot) => number);
  shadow?: boolean;
  renderOrder?: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    at.forEach((s, i) => {
      o.position.set(s.x, s.y, s.z);
      o.rotation.set(0, s.rotY, 0);
      o.scale.setScalar(typeof scale === 'function' ? scale(s) : scale);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [at, scale]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  if (!at.length) return null;
  return <instancedMesh key={at.length} ref={ref} args={[geometry, material, at.length]} castShadow={shadow} receiveShadow renderOrder={renderOrder} />;
}

/** One geometry at one spot (a showpiece: the tree, the gravestone). */
export function Single({ geometry, at, material = paintedToon(), children }: { geometry: THREE.BufferGeometry; at: Spot; material?: THREE.Material; children?: ReactNode }) {
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <group position={[at.x, at.y, at.z]} rotation={[0, at.rotY, 0]}>
      <mesh geometry={geometry} material={material} castShadow receiveShadow />
      {children}
    </group>
  );
}

export type ItemRenderers = Partial<Record<DecorItem, (props: { at: Spot[] }) => ReactNode>>;

/** Every decoration theme `id` puts on a floor kind, each kind of item drawn by its renderer. */
export function Decor({ id, kind, items }: { id: ThemeId; kind: 'office' | 'lobby'; items: ItemRenderers }) {
  const groups = useMemo(() => {
    const by = new Map<DecorItem, Spot[]>();
    for (const { slot, item } of placeDecor(id, kind)) by.set(item, [...(by.get(item) ?? []), spotOf(slot)]);
    return [...by];
  }, [id, kind]);
  return (
    <>
      {groups.map(([item, at]) => {
        const Draw = items[item];
        return Draw ? <Draw key={item} at={at} /> : null;
      })}
    </>
  );
}
