import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { doorOpen } from '../doors';
import { BALCONY, BALCONY_OUT, DECKING, HALF_W, ROOF_EDGE, SIDE_DOOR, SIDE_OPENINGS, SIDES, WALL_T, WINDOW, sideSign } from '../layout';
import { merged } from '../shapes';
import { nightFactor, skyAt, type SkyPalette } from '../sky/time';
import { dayTime } from '../sky/useDayTime';
import { weatherSky } from './weatherRules';
import { weather } from './weatherState';

// The weather on the floor you're on: raindrops running down the outside of the side windows and the glass doors
// (the doors' fade as they slide open), frost creeping up the panes in snow, and on the balconies (or the lobby's
// patio) the wet: the slab darkening, puddles shining with the sky, rings rippling out in them while it rains, and
// snow drifting in from the railing. Up on the roof there's no glass, and the whole deck (paving and decking) gets
// wet or snowed on. Two draw calls at most, all in shaders; the frame loop sets a handful of uniforms.

type FloorKind = 'office' | 'lobby' | 'roof';

const HASH = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}`;

// ---------- the glass ----------

const GLASS_VERT = /* glsl */ `
attribute float aSide;
attribute float aDoor;
varying vec2 vP;
varying vec2 vUv;
varying float vSide;
varying float vDoor;
void main() {
  vUv = uv;
  vSide = aSide;
  vDoor = aDoor;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vP = vec2(w.z * aSide, w.y);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const GLASS_FRAG = /* glsl */ `
${HASH}
uniform float uRain;
uniform float uSnow;
uniform float uTime;
uniform vec2 uOpen;
uniform vec3 uLight;
varying vec2 vP;
varying vec2 vUv;
varying float vSide;
varying float vDoor;
void main() {
  // columns of drops a few centimetres apart, each sliding down at its own pace and wiggling a little
  float cols = 16.0;
  float col = floor(vP.x * cols);
  float h = hash(vec2(col, vSide * 3.1));
  float run = step(h, 0.15 + 0.85 * uRain) * step(0.03, uRain);
  float y = vP.y + uTime * (0.18 + h * 0.5) + h * 11.0;
  float cell = fract(y / 1.3);
  float x = fract(vP.x * cols) - 0.5 + sin(vP.y * 6.0 + h * 9.0) * 0.15;
  float drop = 1.0 - smoothstep(0.1, 0.24, length(vec2(x, (cell - 0.06) * 14.0)));
  float trail = (1.0 - smoothstep(0.03, 0.09, abs(x))) * smoothstep(0.06, 0.5, cell) * (1.0 - cell) * 0.7;
  // beads that sit still, more of them the harder it rains
  vec2 q = vP * 30.0;
  vec2 qi = floor(q);
  float bead = step(1.0 - uRain * 0.3, hash(qi + 7.0)) * (1.0 - smoothstep(0.15, 0.3, length(fract(q) - 0.5 - (vec2(hash(qi + 3.0), hash(qi + 5.0)) - 0.5) * 0.4)));
  float wet = max((drop + trail) * run, bead * 0.8);
  // frost up from the bottom and in from the sides
  float edge = min(min(vUv.x, 1.0 - vUv.x) * 2.0, vUv.y);
  float frost = uSnow * (1.0 - smoothstep(0.0, 0.32, edge + (noise(vP * 9.0) - 0.5) * 0.18));
  float a = max(wet * 0.55, frost * 0.75);
  // the doors' glass slides away with them
  float open = vSide < 0.0 ? uOpen.x : uOpen.y;
  a *= 1.0 - vDoor * open;
  vec3 tint = mix(uLight * 1.25, uLight * 1.35 + 0.15, frost);
  gl_FragColor = vec4(tint, a);
}`;

/** A plane over every window pane and glass door of a floor's side walls, a centimetre outside the glass. */
function glassGeometry(kind: FloorKind) {
  const parts: THREE.BufferGeometry[] = [];
  if (kind === 'roof') return new THREE.BufferGeometry();
  const add = (side: (typeof SIDES)[number], z: number, y: number, w: number, h: number, door: number) => {
    const s = sideSign(side);
    const g = new THREE.PlaneGeometry(w, h).rotateY((s * Math.PI) / 2).translate(s * (HALF_W + WALL_T / 2 + 0.015), y, z);
    const n = g.attributes.position.count;
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(new Array(n).fill(s), 1));
    g.setAttribute('aDoor', new THREE.Float32BufferAttribute(new Array(n).fill(door), 1));
    parts.push(g);
  };
  for (const side of SIDES) {
    const { door, windows } = SIDE_OPENINGS[kind][side];
    for (const z of windows) add(side, z, WINDOW.y, WINDOW.w, WINDOW.h, 0);
    add(side, door, SIDE_DOOR.h / 2, SIDE_DOOR.half * 2, SIDE_DOOR.h, 1);
  }
  return merged(parts);
}

// ---------- the balcony floor ----------

const FLOOR_VERT = /* glsl */ `
attribute float aOut;
varying vec2 vP;
varying float vOut;
void main() {
  vOut = aOut;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vP = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FLOOR_FRAG = /* glsl */ `
${HASH}
uniform float uWet;
uniform float uRain;
uniform float uSnow;
uniform float uTime;
uniform vec3 uSky;
uniform vec3 uLight;
varying vec2 vP;
varying float vOut;
void main() {
  float n = noise(vP * 0.8) * 0.65 + noise(vP * 2.2 + 7.0) * 0.35;
  // the rain blows in under the balcony above: wettest out by the railing
  float reach = mix(0.45, 1.0, vOut);
  float damp = uWet * 0.32 * reach;
  float puddle = smoothstep(0.6, 0.66, n + 0.14 * vOut - (1.0 - uWet) * 0.25) * smoothstep(0.25, 0.6, uWet);
  vec3 col = vec3(0.0);
  float a = damp;
  // puddles shine with the sky
  col = mix(col, uSky * 1.15, puddle);
  a = max(a, puddle * 0.62);
  // rings spreading in the puddles while it rains, each cell's own drop at its own moment
  vec2 c = vP * 3.0;
  vec2 ci = floor(c);
  vec2 f = fract(c) - 0.5 - (vec2(hash(ci), hash(ci + 1.7)) - 0.5) * 0.5;
  float phase = fract(uTime * (0.6 + hash(ci + 4.2) * 0.8) + hash(ci + 3.1));
  float ring = (1.0 - smoothstep(0.0, 0.035, abs(length(f) - phase * 0.42))) * (1.0 - phase) * step(hash(ci + 9.3), uRain * 0.9);
  col += uLight * ring * puddle * 0.9;
  a = max(a, ring * puddle * 0.7);
  // snow settling, in from the railing first
  float snow = smoothstep(0.0, 0.12, uSnow * (0.55 + 0.6 * vOut) - (1.0 - n) * 0.45);
  col = mix(col, uLight * 1.1, snow);
  a = max(a, snow * 0.96);
  gl_FragColor = vec4(col, a);
}`;

/** The roof: the paving inside the parapet and the decking's top, a few millimetres up, all of it out in the open (out = 1). */
function roofGeometry() {
  const { x, z, t } = ROOF_EDGE;
  const open = (g: THREE.BufferGeometry) => g.setAttribute('aOut', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(1), 1));
  const deckW = DECKING.maxX - DECKING.minX;
  const deckD = DECKING.maxZ - DECKING.minZ;
  return merged([
    open(new THREE.PlaneGeometry(2 * (x - t), 2 * (z - t)).rotateX(-Math.PI / 2).translate(0, 0.008, 0)),
    open(new THREE.PlaneGeometry(deckW, deckD).rotateX(-Math.PI / 2).translate((DECKING.minX + DECKING.maxX) / 2, 0.068, (DECKING.minZ + DECKING.maxZ) / 2)),
  ]);
}

/** The balcony floors (or the patio) between the wall and the railing, a few millimetres up, out = 0 at the wall to 1 at the railing. */
function floorGeometry(kind: FloorKind) {
  if (kind === 'roof') return roofGeometry();
  const inner = HALF_W + WALL_T;
  const outer = BALCONY_OUT - BALCONY.railT;
  const len = BALCONY.maxZ - BALCONY.minZ - BALCONY.railT * 2;
  const mid = (BALCONY.maxZ + BALCONY.minZ) / 2;
  return merged(
    SIDES.map((side) => {
      const s = sideSign(side);
      const g = new THREE.PlaneGeometry(outer - inner, len).rotateX(-Math.PI / 2).translate((s * (inner + outer)) / 2, 0.006, mid);
      const pos = g.attributes.position;
      const out = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) out[i] = (Math.abs(pos.getX(i)) - inner) / (outer - inner);
      g.setAttribute('aOut', new THREE.BufferAttribute(out, 1));
      return g;
    }),
  );
}

const palette = {} as SkyPalette;

export function WetGlass({ kind }: { kind: FloorKind }) {
  const stuff = useMemo(() => {
    const glass = new THREE.Mesh(
      glassGeometry(kind),
      new THREE.ShaderMaterial({
        vertexShader: GLASS_VERT,
        fragmentShader: GLASS_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { uRain: { value: 0 }, uSnow: { value: 0 }, uTime: { value: 0 }, uOpen: { value: new THREE.Vector2() }, uLight: { value: new THREE.Color() } },
      }),
    );
    glass.renderOrder = 2;
    const floor = new THREE.Mesh(
      floorGeometry(kind),
      new THREE.ShaderMaterial({
        vertexShader: FLOOR_VERT,
        fragmentShader: FLOOR_FRAG,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        uniforms: { uWet: { value: 0 }, uRain: { value: 0 }, uSnow: { value: 0 }, uTime: { value: 0 }, uSky: { value: new THREE.Color() }, uLight: { value: new THREE.Color() } },
      }),
    );
    return { glass, floor };
  }, [kind]);
  useEffect(
    () => () => {
      for (const m of [stuff.glass, stuff.floor]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    },
    [stuff],
  );

  useFrame(() => {
    const m = weather.mix;
    const p = weatherSky(skyAt(dayTime.t, palette), m);
    const light = 0.35 + 0.65 * (1 - nightFactor(dayTime.t)) + weather.flash;
    const t = weather.clock % 600;
    const g = (stuff.glass.material as THREE.ShaderMaterial).uniforms;
    g.uRain.value = Math.max(m.rain, weather.wet * 0.25);
    g.uSnow.value = Math.max(m.snow * 0.7, weather.snow * 0.8);
    g.uTime.value = t;
    (g.uOpen.value as THREE.Vector2).set(doorOpen('west'), doorOpen('east'));
    (g.uLight.value as THREE.Color).setHex(p.hemiSky).multiplyScalar(light * 0.8);
    stuff.glass.visible = kind !== 'roof' && (g.uRain.value > 0.01 || g.uSnow.value > 0.01);
    const f = (stuff.floor.material as THREE.ShaderMaterial).uniforms;
    f.uWet.value = weather.wet * (1 - weather.snow);
    f.uRain.value = m.rain;
    f.uSnow.value = weather.snow;
    f.uTime.value = t;
    (f.uSky.value as THREE.Color).setHex(p.horizon).multiplyScalar(0.6 + 0.4 * light);
    (f.uLight.value as THREE.Color).setHex(p.hemiSky).multiplyScalar(light * 0.85);
    stuff.floor.visible = f.uWet.value > 0.005 || f.uSnow.value > 0.005;
  });

  return (
    <group>
      <primitive object={stuff.glass} />
      <primitive object={stuff.floor} />
    </group>
  );
}
