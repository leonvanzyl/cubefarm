// Medium and High: at night the monitors light up what's around them, with cheap fakes instead of a real light per
// screen: an additive pool of screen light on every desk and on the floor under the app monitor, and a soft wash on
// the face of whoever sits at a desk (lit from the screen's side, so the eyes and mouth stay dark). The pools share
// one radial texture and a material per colour, faded together by ScreenGlowDriver as night falls; by day and on Low
// they aren't drawn at all.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { bodyState } from '../people';
import { mix } from '../materials';
import { nightFactor } from '../sky/time';
import { dayTime } from '../sky/useDayTime';
import { isTierAtLeast } from './quality';
import { effectiveTier, useGfx } from './useGraphics';

/** Screen light: a cool white, leaning a little towards the floor's colour. */
const SCREEN = '#a9d4ff';
const POOL = { desk: 0.42, floor: 0.3 };
/** The most the face wash adds to the on-screen colour. */
const FACE = 0.2;

/** How dark it is, 0..1, as of the last frame (ScreenGlowDriver keeps it current while any glow is mounted). */
let night = nightFactor(dayTime.t);

let poolTexture: THREE.CanvasTexture | null = null;
/** A soft pool, brightest a third of the way in from the far (screen) edge. */
function poolMap() {
  if (poolTexture) return poolTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 42, 0, 64, 52, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.15)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  poolTexture = new THREE.CanvasTexture(c);
  poolTexture.colorSpace = THREE.SRGBColorSpace;
  return poolTexture;
}

const pools = new Map<string, { material: THREE.MeshBasicMaterial; strength: number }>();
function poolMaterial(color: string, strength: number) {
  const key = `${color}|${strength}`;
  let p = pools.get(key);
  if (!p) {
    const material = new THREE.MeshBasicMaterial({
      map: poolMap(),
      color: mix(SCREEN, color, 0.3),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    p = { material, strength };
    pools.set(key, p);
    fadePool(p);
  }
  return p.material;
}

function fadePool(p: { material: THREE.MeshBasicMaterial; strength: number }) {
  p.material.opacity = p.strength * night;
  p.material.visible = night > 0.02;
}

/** Mounted once in the Canvas: follows the time of day into every pool. */
export function ScreenGlowDriver() {
  const last = useRef(-1);
  useFrame(() => {
    if (dayTime.t === last.current) return;
    last.current = dayTime.t;
    night = nightFactor(dayTime.t);
    for (const p of pools.values()) fadePool(p);
  });
  return null;
}

const useGlowOn = () => useGfx((s) => isTierAtLeast(effectiveTier(s), 'medium'));
const noRaycast = () => null;

const poolGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

/** The pool of screen light on a desk top, in front of its monitor (desk space: the screen faces +z). */
export function DeskGlow({ color }: { color: string }) {
  if (!useGlowOn()) return null;
  return <mesh geometry={poolGeometry} material={poolMaterial(color, POOL.desk)} position={[0, 0.772, -0.04]} scale={[1.75, 1, 0.86]} raycast={noRaycast} />;
}

/** The pool under the big app monitor on the wall, spreading across the floor in front of it (its group's space). */
export function AppScreenGlow({ color, height }: { color: string; height: number }) {
  if (!useGlowOn()) return null;
  return <mesh geometry={poolGeometry} material={poolMaterial(color, POOL.floor)} position={[0, -height + 0.012, 1.7]} scale={[4.8, 1, 3.4]} raycast={noRaycast} />;
}

const FACE_VERT = /* glsl */ `
varying float vLit;
void main() {
  // lit from the screen in front (the face looks down -z), a little from above
  vLit = max(dot(normalize(normal), normalize(vec3(0.0, 0.25, -1.0))), 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Added straight onto the on-screen (sRGB) colour, so uColor is in sRGB too and nothing is encoded here.
const FACE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying float vLit;
void main() {
  gl_FragColor = vec4(uColor * (vLit * vLit * uStrength), 1.0);
}`;

/**
 * The screen's light on a seated person's face: the head drawn again, additively, over itself. Only while they sit at
 * their desk; it fades as they get up. Lives in the head's group, so it follows every nod.
 */
export function FaceGlow(props: { id: string; geometry: THREE.BufferGeometry }) {
  return useGlowOn() ? <FaceWash {...props} /> : null;
}

function FaceWash({ id, geometry }: { id: string; geometry: THREE.BufferGeometry }) {
  const ref = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: FACE_VERT,
        fragmentShader: FACE_FRAG,
        uniforms: { uColor: { value: new THREE.Color(SCREEN).convertLinearToSRGB() }, uStrength: { value: 0 } },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        // drawn over the head's own surface, behind anything in front of it (eyes, nose, glasses)
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const sit = bodyState(id)?.sit ?? 0;
    const k = FACE * night * sit;
    material.uniforms.uStrength.value = k;
    m.visible = k > 0.01;
  });
  return <mesh ref={ref} geometry={geometry} material={material} visible={false} raycast={noRaycast} />;
}
