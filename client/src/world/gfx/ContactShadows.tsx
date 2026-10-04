// High's soft contact shadows. Furniture: the floor is photographed from underneath, its depth turned into a darkness
// that fades with height and blurred (drei's ContactShadows technique), baked again every few seconds with the people
// and anything else that wanders (userData.person / .moving: the dog, the roomba) hidden, so it costs one transparent
// quad a frame. People: a soft blob under everyone, moved with them every frame
// (one instanced draw).
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js';
import { FLOOR_D, FLOOR_W } from '../layout';
import { liveBodies } from '../people';

/** What the shadow photo sees: the undersides of everything up to this height (rugs and decals face up, so it can't). */
const FAR = 1.1;
const RES: [number, number] = [1024, 768];
const BAKE_MS = 8_000;
const OPACITY = 0.45;
const MAX_PEOPLE = 48;

const noRaycast = () => null;

/** Darker the nearer the floor, as drei's ContactShadows draws it; depth-tested, so the lowest thing over a spot wins. */
function shadowDepthMaterial() {
  const m = new THREE.MeshDepthMaterial();
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('vec4( vec3( 1.0 - fragCoordZ ), opacity );', 'vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * 0.85 );');
  };
  return m;
}

/** Skipped by the bake: people (they get blobs), things that move about, see-through things (glass, halos, tags) and the shadows themselves. */
function skipInBake(o: THREE.Object3D) {
  if (o.userData.person || o.userData.moving || o.userData.contactShadow) return true;
  const m = (o as THREE.Mesh).material as THREE.Material | undefined;
  if ((o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite) return true;
  return !!m && !Array.isArray(m) && m.transparent && !m.depthWrite;
}

function FurnitureShadows() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const bake = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(RES[0], RES[1]);
    const blurTarget = new THREE.WebGLRenderTarget(RES[0], RES[1], { depthBuffer: false });
    target.texture.generateMipmaps = blurTarget.texture.generateMipmaps = false;
    // Looking straight up from the floor, the image's right is +x and its top +z; the floor quad flips v to match.
    const camera = new THREE.OrthographicCamera(-FLOOR_W / 2, FLOOR_W / 2, FLOOR_D / 2, -FLOOR_D / 2, 0, FAR);
    camera.position.set(0, -0.005, 0);
    camera.up.set(0, 0, 1);
    camera.lookAt(0, 1, 0);
    camera.updateMatrixWorld();
    target.texture.repeat.set(1, -1);
    target.texture.offset.set(0, 1);
    const h = new THREE.ShaderMaterial(HorizontalBlurShader);
    const v = new THREE.ShaderMaterial(VerticalBlurShader);
    h.depthTest = v.depthTest = false;
    const quad = new FullScreenQuad(h);
    return { target, blurTarget, camera, depth: shadowDepthMaterial(), quad, h, v, hidden: [] as THREE.Object3D[] };
  }, []);
  useEffect(
    () => () => {
      for (const d of [bake.target, bake.blurTarget, bake.depth, bake.quad, bake.h, bake.v]) d.dispose();
    },
    [bake],
  );

  const blur = (amount: number) => {
    const { quad, h, v, target, blurTarget } = bake;
    quad.material = h;
    h.uniforms.tDiffuse.value = target.texture;
    h.uniforms.h.value = amount / RES[0];
    gl.setRenderTarget(blurTarget);
    quad.render(gl);
    quad.material = v;
    v.uniforms.tDiffuse.value = blurTarget.texture;
    v.uniforms.v.value = amount / RES[1];
    gl.setRenderTarget(target);
    quad.render(gl);
  };

  const last = useRef(-Infinity);
  useFrame(() => {
    const now = performance.now();
    if (now - last.current < BAKE_MS) return;
    last.current = now;
    const { hidden, target, camera, depth } = bake;
    // the whole scene: the city and the sky are far outside the camera's box, so they draw nothing
    scene.traverse((o) => {
      if (o.visible && skipInBake(o)) {
        o.visible = false;
        hidden.push(o);
      }
    });
    const background = scene.background;
    const override = scene.overrideMaterial;
    const shadows = gl.shadowMap.autoUpdate;
    const prevTarget = gl.getRenderTarget();
    const autoClear = gl.autoClear;
    const clearAlpha = gl.getClearAlpha();
    const clearColor = gl.getClearColor(new THREE.Color());
    scene.background = null;
    scene.overrideMaterial = depth;
    gl.shadowMap.autoUpdate = false;
    try {
      gl.setRenderTarget(target);
      gl.setClearColor(0x000000, 0);
      gl.clear(true, true, false);
      gl.autoClear = false;
      gl.render(scene, camera);
      blur(3);
      blur(1.2);
    } finally {
      for (const o of hidden) o.visible = true;
      hidden.length = 0;
      scene.background = background;
      scene.overrideMaterial = override;
      gl.shadowMap.autoUpdate = shadows;
      gl.autoClear = autoClear;
      gl.setClearColor(clearColor, clearAlpha);
      gl.setRenderTarget(prevTarget);
    }
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, 0]} raycast={noRaycast} userData={{ contactShadow: true }} renderOrder={-1}>
      <planeGeometry args={[FLOOR_W, FLOOR_D]} />
      <meshBasicMaterial map={bake.target.texture} transparent opacity={OPACITY} depthWrite={false} toneMapped={false} fog={false} />
    </mesh>
  );
}

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.38)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.2)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function PeopleBlobs() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const parts = useMemo(
    () => ({
      geometry: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      material: new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, toneMapped: false, fog: false }),
      m: new THREE.Matrix4(),
    }),
    [],
  );
  useEffect(
    () => () => {
      parts.geometry.dispose();
      parts.material.map?.dispose();
      parts.material.dispose();
    },
    [parts],
  );
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    let i = 0;
    for (const b of liveBodies().values()) {
      if (i >= MAX_PEOPLE) break;
      // a wider, softer patch under a chair than under someone standing
      const size = 0.62 + 0.2 * b.sit;
      parts.m.makeScale(size, 1, size).setPosition(b.x, 0.009, b.z);
      mesh.setMatrixAt(i++, parts.m);
    }
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[parts.geometry, parts.material, MAX_PEOPLE]} frustumCulled={false} raycast={noRaycast} userData={{ contactShadow: true }} />;
}

export function ContactShadows() {
  return (
    <>
      <FurnitureShadows />
      <PeopleBlobs />
    </>
  );
}
