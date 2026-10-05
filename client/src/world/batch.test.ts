import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BatchSet, look, type BatchMaterials } from './batch';

const MATERIALS: BatchMaterials = { toon: new THREE.MeshBasicMaterial(), glow: new THREE.MeshBasicMaterial(), glowNight: new THREE.MeshBasicMaterial(), outline: () => new THREE.MeshBasicMaterial() };
const box = new THREE.BoxGeometry(1, 1, 1);
const ball = new THREE.SphereGeometry(0.5, 8, 6);

function office() {
  const scene = new THREE.Scene();
  const set = new BatchSet(MATERIALS);
  scene.add(set.root);
  const stand = (parent: THREE.Object3D, x: number) => {
    const m = new THREE.Mesh(box);
    m.visible = false;
    m.position.x = x;
    parent.add(m);
    return m;
  };
  return { scene, set, stand };
}

const batchMeshes = (set: BatchSet) => set.root.children as THREE.InstancedMesh[];
const at = (m: THREE.InstancedMesh, i: number) => new THREE.Matrix4().fromArray(m.instanceMatrix.array, i * 16);

describe('instanced batches', () => {
  it('draw every stand-in of a look as one instanced mesh, where the stand-in is, in its colour', () => {
    const { scene, set, stand } = office();
    const desk = new THREE.Group();
    desk.position.set(0, 0, 5);
    scene.add(desk);
    const a = stand(desk, 1);
    const b = stand(scene, -2);
    const solid = look(box, { castShadow: true, receiveShadow: true });
    set.add(solid, a, '#ff0000');
    const slotB = set.add(solid, b, '#0000ff');
    set.add(look(ball), stand(scene, 3), '#00ff00');
    scene.updateMatrixWorld();
    set.sync();

    const [boxes, balls] = batchMeshes(set);
    expect(batchMeshes(set)).toHaveLength(2);
    expect(boxes.count).toBe(2);
    expect(boxes.castShadow && boxes.receiveShadow).toBe(true);
    expect(new THREE.Vector3().setFromMatrixPosition(at(boxes, 0)).toArray()).toEqual([1, 0, 5]);
    expect(new THREE.Vector3().setFromMatrixPosition(at(boxes, 1)).toArray()).toEqual([-2, 0, 0]);
    expect(Array.from(boxes.instanceColor!.array.slice(0, 6))).toEqual([1, 0, 0, 0, 0, 1]);
    expect(balls.count).toBe(1);

    slotB.setColor('#ffffff');
    desk.position.z = 7; // the group moves: so does its part
    scene.updateMatrixWorld();
    set.sync();
    expect(at(boxes, 0).elements[14]).toBe(7);
    expect(Array.from(boxes.instanceColor!.array.slice(3, 6))).toEqual([1, 1, 1]);
    expect(set.stats()).toEqual({ batches: 2, instances: 3, outlined: 0 });
  });

  it('leave out parts whose group is hidden or that were removed', () => {
    const { scene, set, stand } = office();
    const legs = new THREE.Group();
    scene.add(legs);
    const l = look(box);
    set.add(l, stand(legs, 0), '#fff');
    const gone = set.add(l, stand(scene, 1), '#fff');
    set.add(l, stand(scene, 2), '#fff');
    legs.visible = false;
    gone.remove();
    scene.updateMatrixWorld();
    set.sync();
    const [boxes] = batchMeshes(set);
    expect(boxes.count).toBe(1);
    expect(at(boxes, 0).elements[12]).toBe(2);
  });

  it('grow past their first size, and outline only the parts near the camera', () => {
    const { scene, set, stand } = office();
    const inked = look(box, { outline: 0.018, crease: Math.PI });
    for (let i = 0; i < 40; i++) set.add(inked, stand(scene, i), '#fff');
    const camera = new THREE.PerspectiveCamera();
    scene.add(camera);
    set.camera = camera;
    set.outlineRange = 10;
    scene.updateMatrixWorld();
    set.sync();
    const [boxes, ink] = batchMeshes(set);
    expect(boxes.count).toBe(40);
    expect(boxes.instanceMatrix.count).toBeGreaterThanOrEqual(40);
    expect(ink.count).toBe(11); // x = 0 to 10
    expect(ink.geometry).not.toBe(box); // creased normals for the hull
  });

  it('draw every shown part wherever the camera looks, and leave syncing to the render: no per-pass hooks', () => {
    const { scene, set, stand } = office();
    const l = look(box, { castShadow: true, outline: 0.018 });
    set.add(l, stand(scene, 0), '#f00');
    const behind = stand(scene, 0);
    behind.position.z = 20;
    set.add(l, behind, '#00f');
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.z = 10; // looking down -z: the first box ahead, the second behind
    scene.add(camera);
    set.camera = camera;
    scene.updateMatrixWorld();
    set.sync();
    const [boxes, ink] = batchMeshes(set);
    // The shadow pass and the view share one upload a render, so both see every part, in the same slots.
    expect(boxes.count).toBe(2);
    expect(at(boxes, 1).elements[14]).toBe(20);
    expect(Array.from(boxes.instanceColor!.array.slice(3, 6))).toEqual([0, 0, 1]);
    // three.js calls these before or between passes: a sync from either would reach the screen a pass late
    for (const m of [boxes, ink]) {
      expect(m.onBeforeRender).toBe(THREE.Object3D.prototype.onBeforeRender);
      expect(m.onBeforeShadow).toBe(THREE.Object3D.prototype.onBeforeShadow);
    }
  });
});
