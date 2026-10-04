import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// The mesh behind an ink outline (Outlines.tsx), kept apart from React so making and freeing it can be tested.

/**
 * Puts the outline mesh for `parent` into `group` (detach the old one first): the parent's own geometry when `angle` is 0,
 * else a copy with normals smoothed across edges up to that angle, so a box's hull has no gaps at its corners.
 */
export function attachOutline(group: THREE.Object3D, parent: THREE.Mesh, material: THREE.Material, angle: number) {
  const mesh = new THREE.Mesh(angle ? toCreasedNormals(parent.geometry, angle) : parent.geometry, material);
  group.add(mesh);
  return mesh;
}

/** Takes the outline mesh out of `group` and frees the geometry it made (never the parent's, which it only borrows). */
export function detachOutline(group: THREE.Object3D, angle: number) {
  const mesh = group.children[0] as THREE.Mesh | undefined;
  if (!mesh) return;
  if (angle) mesh.geometry.dispose();
  group.remove(mesh);
}
