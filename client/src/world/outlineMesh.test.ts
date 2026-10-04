import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { attachOutline, detachOutline } from './outlineMesh';

const disposed = (g: THREE.BufferGeometry) => {
  const seen = { n: 0 };
  g.addEventListener('dispose', () => void seen.n++);
  return seen;
};

describe('outline meshes', () => {
  it('makes a creased copy of the parent geometry, and frees only that copy', () => {
    const parent = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const group = new THREE.Group();
    parent.add(group);
    const own = disposed(parent.geometry);
    const mesh = attachOutline(group, parent, new THREE.MeshBasicMaterial(), Math.PI);
    expect(group.children).toEqual([mesh]);
    expect(mesh.geometry).not.toBe(parent.geometry);
    const copy = disposed(mesh.geometry);

    // the parent is unmounted too: the group may already be out of the scene, the copy still gets freed
    parent.remove(group);
    detachOutline(group, Math.PI);
    expect(copy.n).toBe(1);
    expect(own.n).toBe(0);
    expect(group.children).toEqual([]);
  });

  it('borrows the parent geometry at angle 0 and never frees it', () => {
    const parent = new THREE.Mesh(new THREE.SphereGeometry(1));
    const group = new THREE.Group();
    const own = disposed(parent.geometry);
    const mesh = attachOutline(group, parent, new THREE.MeshBasicMaterial(), 0);
    expect(mesh.geometry).toBe(parent.geometry);
    detachOutline(group, 0);
    expect(own.n).toBe(0);
    expect(group.children).toEqual([]);
  });

  it('does nothing for an empty group', () => {
    expect(() => detachOutline(new THREE.Group(), Math.PI)).not.toThrow();
  });
});
