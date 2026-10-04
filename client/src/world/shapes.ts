import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Many static pieces as one geometry, so they cost one draw call: wall pieces round the windows, window frames,
// balcony railings on every floor, planters and benches.

type V3 = [number, number, number];

/** An axis-aligned box: its size and the middle of it. */
export interface BoxSpec {
  size: V3;
  at: V3;
}

/** Merges the parts into one geometry and disposes of them. */
export function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = (parts.length && mergeGeometries(parts)) || new THREE.BufferGeometry();
  for (const p of parts) p.dispose();
  return g;
}

export const boxesGeometry = (boxes: BoxSpec[]) => merged(boxes.map(({ size, at }) => new THREE.BoxGeometry(...size).translate(...at)));
