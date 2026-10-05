import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Instanced drawing for the many repeated parts of a floor (#228): fifteen desks, chairs and people are the same few
// shapes in different colours, so each shape, however many there are of it, costs one draw call (and one for its ink
// outline, one in the shadow pass). Every part keeps an invisible stand-in mesh where it always was in the scene, so
// it still moves with its group, hides with it and is hit by the player's aim; the batch copies the stand-ins' world
// matrices and colours into its instances just before drawing, after three.js has updated the scene's matrices for the
// frame, without allocating. As three.js culls whole meshes, a batch leaves out the instances outside the view (in
// the shadow pass, none: shadows may fall from out of view). Outlines are left off parts beyond `outlineRange`. A geometry with morph
// targets (a face) gets each instance's weights from its stand-in's morphTargetInfluences.

/** Cel-shaded like toon(), or unlit like glow() (glowNight: one that blooms only after dark, gfx/bloomMarks.ts). */
export type Shading = 'toon' | 'glow' | 'glowNight';

/** What a batch draws: one geometry with one kind of material, outline and shadows. Made by `look()`, which caches. */
export interface Look {
  readonly key: string;
  readonly geometry: THREE.BufferGeometry;
  readonly shading: Shading;
  /** Ink outline thickness in Outlines.tsx's units; 0 for none. */
  readonly outline: number;
  /** The outline's normals smoothed across edges up to this angle (Outlines.tsx), so a box's hull has no gaps. */
  readonly crease: number;
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
  /** A material of its own instead of the shading's (a shared texture, say); it must be white, and only used in batches. */
  readonly material?: THREE.Material;
}

const looks = new Map<string, Look>();

export function look(geometry: THREE.BufferGeometry, opts: Partial<Omit<Look, 'key' | 'geometry'>> = {}): Look {
  const l = { geometry, shading: opts.shading ?? 'toon', outline: opts.outline ?? 0, crease: opts.crease ?? 0, castShadow: opts.castShadow ?? false, receiveShadow: opts.receiveShadow ?? false, material: opts.material };
  const key = `${geometry.uuid}|${l.shading}|${l.outline}|${l.crease}|${+l.castShadow}${+l.receiveShadow}|${l.material?.uuid ?? ''}`;
  let found = looks.get(key);
  if (!found) {
    found = { key, ...l };
    looks.set(key, found);
  }
  return found;
}

/** The materials batches draw with: white, so each instance's colour is its own. */
export interface BatchMaterials {
  toon: THREE.Material;
  glow: THREE.Material;
  glowNight: THREE.Material;
  outline(thickness: number): THREE.Material;
}

export interface BatchSlot {
  setColor(color: THREE.ColorRepresentation): void;
  remove(): void;
}

interface Slot {
  obj: THREE.Object3D;
  color: THREE.Color;
}

const sphere = new THREE.Sphere();
const viewProjection = new THREE.Matrix4();

/** Shown when it and every group above it are (the stand-in itself is never drawn, so its own flag doesn't count). */
function shown(obj: THREE.Object3D) {
  let p = obj.parent;
  if (!p) return false;
  while (p) {
    if (!p.visible) return false;
    p = p.parent;
  }
  return true;
}

const START = 16;

class Batch {
  mesh: THREE.InstancedMesh;
  outline: THREE.InstancedMesh | null = null;
  slots: Slot[] = [];
  private outlineGeometry: THREE.BufferGeometry | null = null;

  constructor(
    readonly look: Look,
    private set: BatchSet,
    private materials: BatchMaterials,
  ) {
    this.mesh = this.make(START);
    if (look.outline) {
      this.outlineGeometry = look.crease ? toCreasedNormals(look.geometry, look.crease) : look.geometry;
      this.outline = this.makeOutline(START);
    }
  }

  private make(capacity: number) {
    const m = new THREE.InstancedMesh(this.look.geometry, this.look.material ?? this.materials[this.look.shading], capacity);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    m.count = 0;
    m.castShadow = this.look.castShadow && this.set.shadows;
    m.receiveShadow = this.look.receiveShadow;
    m.frustumCulled = false; // it spans the floor; the bounds of the instances would need working out every frame
    m.matrixAutoUpdate = false;
    m.raycast = () => undefined; // the stand-ins are what the player's aim hits
    m.onBeforeShadow = m.onBeforeRender = this.set.hook;
    const morphs = this.look.geometry.morphAttributes.position?.length ?? 0;
    if (morphs) m.morphTexture = new THREE.DataTexture(new Float32Array((morphs + 1) * capacity), morphs + 1, capacity, THREE.RedFormat, THREE.FloatType);
    this.set.root.add(m);
    return m;
  }

  private makeOutline(capacity: number) {
    const o = new THREE.InstancedMesh(this.outlineGeometry!, this.materials.outline(this.look.outline), capacity);
    o.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    o.count = 0;
    o.frustumCulled = false;
    o.matrixAutoUpdate = false;
    o.raycast = () => undefined;
    o.onBeforeRender = this.set.hook;
    this.set.root.add(o);
    return o;
  }

  add(slot: Slot) {
    this.slots.push(slot);
    const capacity = this.mesh.instanceMatrix.count;
    if (this.slots.length <= capacity) return;
    // full: twice the room (the old buffers are dropped; sync fills the new ones before the next draw)
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.mesh = this.make(capacity * 2);
    if (this.outline) {
      this.outline.removeFromParent();
      this.outline.dispose();
      this.outline = this.makeOutline(capacity * 2);
    }
  }

  remove(slot: Slot) {
    const i = this.slots.indexOf(slot);
    if (i < 0) return;
    this.slots[i] = this.slots[this.slots.length - 1];
    this.slots.pop();
  }

  sync(eye: THREE.Vector3 | null, range2: number, frustum: THREE.Frustum | null) {
    const m = this.mesh;
    const bounds = this.look.geometry.boundingSphere ?? (this.look.geometry.computeBoundingSphere(), this.look.geometry.boundingSphere!);
    const { x: cx, y: cy, z: cz } = bounds.center;
    const mats = m.instanceMatrix.array as Float32Array;
    const cols = m.instanceColor!.array as Float32Array;
    const o = this.outline;
    const omats = o ? (o.instanceMatrix.array as Float32Array) : null;
    const morph = m.morphTexture ? (m.morphTexture.image.data as Float32Array) : null;
    const len = morph ? m.morphTexture!.image.width : 0;
    const relative = this.look.geometry.morphTargetsRelative;
    let n = 0;
    let k = 0;
    for (const s of this.slots) {
      if (!shown(s.obj)) continue;
      const e = s.obj.matrixWorld.elements;
      if (frustum) {
        // the part's bounds where it stands, as three's own culling would test a mesh
        sphere.center.set(e[0] * cx + e[4] * cy + e[8] * cz + e[12], e[1] * cx + e[5] * cy + e[9] * cz + e[13], e[2] * cx + e[6] * cy + e[10] * cz + e[14]);
        sphere.radius = bounds.radius * Math.sqrt(Math.max(e[0] * e[0] + e[1] * e[1] + e[2] * e[2], e[4] * e[4] + e[5] * e[5] + e[6] * e[6], e[8] * e[8] + e[9] * e[9] + e[10] * e[10]));
        if (!frustum.intersectsSphere(sphere)) continue;
      }
      mats.set(e, n * 16);
      cols[n * 3] = s.color.r;
      cols[n * 3 + 1] = s.color.g;
      cols[n * 3 + 2] = s.color.b;
      if (morph) {
        // as InstancedMesh.setMorphAt writes them: the base weight, then each target's
        const w = (s.obj as THREE.Mesh).morphTargetInfluences;
        let sum = 0;
        for (let i = 1; i < len; i++) {
          const v = w?.[i - 1] ?? 0;
          morph[n * len + i] = v;
          sum += v;
        }
        morph[n * len] = relative ? 1 : 1 - sum;
      }
      n++;
      if (omats) {
        const dx = e[12] - (eye?.x ?? e[12]);
        const dy = e[13] - (eye?.y ?? e[13]);
        const dz = e[14] - (eye?.z ?? e[14]);
        if (dx * dx + dy * dy + dz * dz <= range2) omats.set(e, k++ * 16);
      }
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor!.needsUpdate = true;
    if (m.morphTexture) m.morphTexture.needsUpdate = true;
    if (o) {
      o.count = k;
      o.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.outline?.removeFromParent();
    this.outline?.dispose();
    if (this.outlineGeometry && this.outlineGeometry !== this.look.geometry) this.outlineGeometry.dispose();
  }
}

/** Every batch of one scope (an office floor, the lobby): their meshes live under `root`, which sits at the origin. */
export class BatchSet {
  readonly root = new THREE.Group();
  /** The viewer's camera, for the outline distance; set each frame (Batched.tsx). */
  camera: THREE.Camera | null = null;
  /** Parts further than this from the camera are drawn without their ink outline. */
  outlineRange = Infinity;
  /** False: no part of this set casts a shadow, whatever its look says (visitors, grounded by their glow instead). */
  shadows = true;
  private batches = new Map<string, Batch>();
  private synced = '';
  private eye = new THREE.Vector3();
  private frustum = new THREE.Frustum();

  constructor(private materials: BatchMaterials) {
    this.root.name = 'batches';
  }

  /**
   * Called by three.js just before it draws any batch mesh: onBeforeShadow (renderer, object, camera, shadow camera…)
   * or onBeforeRender (renderer, scene, camera, geometry…). The first call of each pass syncs them all: for the shadow
   * pass every instance, for a view only those in its frustum.
   */
  readonly hook = (renderer: THREE.WebGLRenderer, _scene: unknown, camera: THREE.Camera, shadowCamera?: unknown) => {
    const shadow = (shadowCamera as THREE.Camera | undefined)?.isCamera === true;
    const key = `${renderer.info.render.frame}:${shadow ? 'shadow' : camera.id}`;
    if (key === this.synced) return;
    this.synced = key;
    this.sync(shadow ? null : camera);
  };

  /** Draws `obj` (an invisible stand-in placed in the scene) as an instance of `look`, in `color`. */
  add(l: Look, obj: THREE.Object3D, color: THREE.ColorRepresentation): BatchSlot {
    let batch = this.batches.get(l.key);
    if (!batch) {
      batch = new Batch(l, this, this.materials);
      this.batches.set(l.key, batch);
    }
    const slot: Slot = { obj, color: new THREE.Color(color) };
    batch.add(slot);
    const b = batch;
    return {
      setColor: (c) => void slot.color.set(c),
      remove: () => b.remove(slot),
    };
  }

  /** Copies every stand-in's world matrix and colour into its batch: only those `view` can see, when given. */
  sync(view: THREE.Camera | null = null) {
    const eye = this.camera ? this.eye.setFromMatrixPosition(this.camera.matrixWorld) : null;
    const range2 = this.outlineRange * this.outlineRange;
    const frustum = view ? this.frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse)) : null;
    for (const b of this.batches.values()) b.sync(eye, range2, frustum);
  }

  /** How many batches and drawn instances there are (window.__swarmBatches). */
  stats() {
    let instances = 0;
    let outlined = 0;
    for (const b of this.batches.values()) {
      instances += b.mesh.count;
      outlined += b.outline?.count ?? 0;
    }
    return { batches: this.batches.size, instances, outlined };
  }

  dispose() {
    for (const b of this.batches.values()) b.dispose();
    this.batches.clear();
  }
}
