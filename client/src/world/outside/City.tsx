import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useStore } from '../../store';
import { dayTime } from '../sky/useDayTime';
import { skyAt, sunDirection } from '../sky/time';
import { viewElevation } from '../layout';
import { carPose, carRoutes, CITY, cityLayout, CORRIDOR_HALF, MAX_CARS, type CityBox } from './cityLayout';

// The city around the building (cityLayout.ts says where everything is). Six draw calls: the buildings (one
// InstancedMesh with a shared window texture), roof bits as instanced boxes, cylinders and cones, the ground
// (streets, pavements, crossings, street lamps and headlight pools drawn in one shader) and the cars. All of it
// lights itself from the time of day (time.ts), not from the office's lights, and fades into the horizon colour
// with distance. The windows, lamps and headlights come on through one shared uniform (cityLights), so the
// evening costs nothing. Drawn after the office (renderOrder 1), so indoors the walls hide it before it shades.
// window.__swarmCity reports what's there, for QA.

/** The shared uniforms every city material reads; the useFrame below changes them, never React. */
const shared = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSun: { value: new THREE.Color() },
  uHemiSky: { value: new THREE.Color() },
  uHemiGround: { value: new THREE.Color() },
  uAmbient: { value: 0.18 },
  uHaze: { value: new THREE.Color() },
  uLights: { value: 0 },
};

const COMMON = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSun;
uniform vec3 uHemiSky;
uniform vec3 uHemiGround;
uniform float uAmbient;
uniform vec3 uHaze;
uniform float uLights;
varying vec3 vWorld;

// The office's three-step toon ramp (materials.ts) under the time of day's sun and sky.
vec3 toonLight(vec3 albedo, vec3 n) {
  float k = dot(n, uSunDir) * 0.5 + 0.5;
  float ramp = k < 0.3333 ? 0.43 : (k < 0.6667 ? 0.745 : 1.0);
  vec3 hemi = mix(uHemiGround, uHemiSky, n.y * 0.5 + 0.5) * 0.95;
  return albedo * (vec3(uAmbient) + hemi + uSun * ramp) * 0.3183099;
}

float hazeAt() {
  float h = clamp((distance(vWorld, cameraPosition) - 40.0) / 460.0, 0.0, 1.0);
  return h * (2.0 - h);
}
`;

// Tone-mapped like the office, then hazed towards the horizon; lights shine through the haze a little longer.
const FINISH = /* glsl */ `
  gl_FragColor = vec4(lit, 1.0);
  #include <tonemapping_fragment>
  float hz = hazeAt();
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, hz) + glow * pow(1.0 - hz, 0.7);
  #include <colorspace_fragment>
`;

// ---------- buildings ----------

const BUILDING_VERT = /* glsl */ `
attribute vec2 aWin;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vCol;
varying vec2 vWinUv;
varying vec4 vEdge;
varying float vSide;
varying float vLit;
void main() {
  vec3 s = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vec3 p = position;
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vCol = instanceColor;
  vLit = aWin.x;
  float px = floor(aWin.y / 4.0);
  float pz = mod(aWin.y, 4.0);
  if (abs(normal.y) > 0.5) {
    vSide = 0.0;
    vWinUv = vec2(0.0);
    vEdge = vec4(p.x * s.x, s.x * 0.5, p.z * s.z, s.z * 0.5);
  } else {
    // a whole number of window columns per face and one row per storey, from the corner up
    bool xFace = abs(normal.x) > 0.5;
    float along = xFace ? p.z : p.x;
    float size = xFace ? s.z : s.x;
    float cols = max(1.0, floor(size / 3.2 + 0.5));
    float rows = max(1.0, floor(s.y / 3.6 + 0.5));
    float face = xFace ? (normal.x > 0.0 ? 1.0 : 2.0) : (normal.z > 0.0 ? 0.0 : 3.0);
    vSide = 1.0;
    vWinUv = vec2((along + 0.5) * cols + px + face, p.y * rows + pz + face * 2.0);
    vEdge = vec4(along * size, size * 0.5, (p.y - 0.5) * s.y, s.y * 0.5);
  }
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const BUILDING_FRAG = /* glsl */ `
${COMMON}
uniform sampler2D uWindows;
varying vec3 vN;
varying vec3 vCol;
varying vec2 vWinUv;
varying vec4 vEdge;
varying float vSide;
varying float vLit;
void main() {
  vec3 albedo = vCol;
  vec3 glow = vec3(0.0);
  if (vSide > 0.5) {
    // r: window, g: the share of lights at which this window comes on, b: warm or cool bulb
    vec4 w = texture2D(uWindows, vWinUv * 0.25);
    float on = clamp((vLit * uLights - w.g) * 5.0, 0.0, 1.0) * w.r;
    vec3 glass = mix(vec3(0.12, 0.17, 0.26), uHemiSky * 0.6, 0.4);
    albedo = mix(albedo, glass, w.r * (1.0 - on * 0.6));
    glow = mix(vec3(1.0, 0.68, 0.32), vec3(0.95, 0.88, 0.7), w.b) * on * 0.9;
  } else {
    albedo *= 0.8;
  }
  // ink along the corners and the roofline, like the office's outlines
  float de = min(vEdge.y - abs(vEdge.x), vEdge.w - abs(vEdge.z));
  float ink = 1.0 - smoothstep(0.12, 0.12 + fwidth(de) * 1.5 + 1e-4, de);
  albedo = mix(albedo, vec3(0.12, 0.11, 0.17), ink * 0.55);
  vec3 lit = toonLight(albedo, normalize(vN));
  ${FINISH}
}
`;

/** One shared window grid: 4×4 windows, each with its own light-up threshold and bulb colour. */
function windowTexture() {
  const cells = 4;
  const px = 16;
  const size = cells * px;
  const data = new Uint8Array(size * size * 4);
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let cy = 0; cy < cells; cy++)
    for (let cx = 0; cx < cells; cx++) {
      const threshold = 13 + Math.floor(rand() * 242);
      const tint = rand() < 0.3 ? 255 : 0;
      for (let y = 0; y < px; y++)
        for (let x = 0; x < px; x++) {
          const i = ((cy * px + y) * size + cx * px + x) * 4;
          data[i] = x >= 3 && x < 13 && y >= 3 && y < 13 ? 255 : 0;
          data[i + 1] = threshold;
          data[i + 2] = tint;
          data[i + 3] = 255;
        }
    }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// ---------- roof bits, trees, the park ----------

const PROP_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vCol;
void main() {
  vec3 s = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * (normal / s));
  vCol = instanceColor;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const PROP_FRAG = /* glsl */ `
${COMMON}
varying vec3 vN;
varying vec3 vCol;
void main() {
  vec3 glow = vec3(0.0);
  vec3 lit = toonLight(vCol, normalize(vN));
  ${FINISH}
}
`;

// ---------- the ground ----------

const GROUND_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec2 vPos;
void main() {
  vPos = position.xz;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const GROUND_FRAG = /* glsl */ `
${COMMON}
uniform vec2 uFirstLine;
uniform vec2 uHomeHalf;
uniform vec2 uExtent;
uniform float uPitch;
uniform float uRings;
uniform float uRoadHalf;
uniform float uCorridor;
uniform vec4 uCars[${MAX_CARS}];
varying vec2 vPos;

// Distance to the nearest street centreline on one axis.
float streetDist(float a, float first) {
  float b = abs(a) - first;
  float k = clamp(floor(b / uPitch + 0.5), 0.0, uRings);
  return abs(b - k * uPitch);
}

void main() {
  vec2 p = vPos;
  float detail = 1.0 - smoothstep(90.0, 220.0, distance(vWorld, cameraPosition));
  vec3 col = vec3(0.6, 0.66, 0.46);
  vec3 glow = vec3(0.0);
  if (abs(p.x) < uExtent.x && abs(p.y) < uExtent.y) {
    float dx = streetDist(p.x, uFirstLine.x); // from a road running along z
    float dz = streetDist(p.y, uFirstLine.y); // from a road running along x
    bool roadZ = dx < uRoadHalf;
    bool roadX = dz < uRoadHalf;
    col = vec3(0.7, 0.67, 0.62);
    if (abs(p.x) < uHomeHalf.x && abs(p.y) < uHomeHalf.y) {
      vec2 f = abs(fract(p * 0.5) - 0.5);
      col = mix(vec3(0.85, 0.79, 0.68), vec3(0.76, 0.7, 0.6), step(0.46, max(f.x, f.y)) * detail);
    }
    float d = min(dx, dz);
    if (d < uCorridor) col = abs(d - uRoadHalf) < 0.2 ? vec3(0.58, 0.56, 0.54) : vec3(0.8, 0.77, 0.72);
    if (roadZ || roadX) col = vec3(0.3, 0.32, 0.37);
    float paint = 0.0;
    if (roadZ && dz > uCorridor) paint += step(dx, 0.12) * step(fract(p.y / 6.0), 0.5);
    if (roadX && dx > uCorridor) paint += step(dz, 0.12) * step(fract(p.x / 6.0), 0.5);
    if (roadZ && dz >= uRoadHalf && dz < uCorridor) paint += step(fract(p.x), 0.5);
    if (roadX && dx >= uRoadHalf && dx < uCorridor) paint += step(fract(p.y), 0.5);
    col = mix(col, vec3(0.93, 0.92, 0.86), min(paint, 1.0) * detail);

    // street lamps on both pavements every 18 m, out of the crossings
    float lamp = 0.0;
    float la = dx - (uRoadHalf + 1.0);
    float lb = (fract(p.y / 18.0) - 0.5) * 18.0;
    if (dz > uCorridor) lamp += exp(-(la * la + lb * lb) / 14.0) + exp(-(la * la + lb * lb) / 0.12);
    la = dz - (uRoadHalf + 1.0);
    lb = (fract(p.x / 18.0) - 0.5) * 18.0;
    if (dx > uCorridor) lamp += exp(-(la * la + lb * lb) / 14.0) + exp(-(la * la + lb * lb) / 0.12);
    glow += vec3(1.0, 0.76, 0.42) * lamp * 0.55;

    // headlight pools ahead of each car: xy = its front, zw = its heading
    float beam = 0.0;
    for (int i = 0; i < ${MAX_CARS}; i++) {
      vec4 c = uCars[i];
      vec2 rel = p - c.xy;
      float ahead = dot(rel, c.zw);
      float side = abs(dot(rel, vec2(-c.w, c.z)));
      if (ahead > 0.3 && ahead < 16.0) beam += (1.0 - ahead / 16.0) * (1.0 - smoothstep(0.5 + ahead * 0.15, 1.1 + ahead * 0.25, side));
    }
    glow += vec3(1.0, 0.93, 0.75) * beam * 0.5;
    glow *= uLights;
  }
  vec3 lit = toonLight(col, vec3(0.0, 1.0, 0.0));
  ${FINISH}
}
`;

// ---------- cars ----------

const CAR_VERT = /* glsl */ `
attribute float aPart;
attribute float aBus;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vCol;
varying vec3 vLocal;
varying float vPart;
void main() {
  vec3 p = position;
  // a bus's windows run its whole length
  if (aPart > 0.5 && aBus > 0.5) {
    p.z = (p.z + 0.04) / 0.26 * 0.47 - 0.01;
    p.x *= 1.15;
  }
  vLocal = p;
  vPart = aPart;
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vCol = instanceColor;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const CAR_FRAG = /* glsl */ `
${COMMON}
varying vec3 vN;
varying vec3 vCol;
varying vec3 vLocal;
varying float vPart;
void main() {
  vec3 albedo = vCol;
  vec3 glow = vec3(0.0);
  if (vPart > 0.5) {
    albedo = mix(vCol, vec3(0.16, 0.22, 0.32), 0.75);
  } else {
    vec2 q = vec2(abs(vLocal.x), vLocal.y);
    float lamp = step(0.2, q.x) * step(q.x, 0.46) * step(0.22, q.y) * step(q.y, 0.45);
    if (vLocal.z > 0.495) {
      albedo = mix(albedo, vec3(1.0, 0.95, 0.75), lamp);
      glow = vec3(1.0, 0.95, 0.8) * lamp * uLights * 1.6;
    } else if (vLocal.z < -0.495) {
      albedo = mix(albedo, vec3(0.7, 0.08, 0.08), lamp);
      glow = vec3(1.0, 0.12, 0.08) * lamp * uLights * 1.4;
    }
  }
  vec3 lit = toonLight(albedo, normalize(vN));
  ${FINISH}
}
`;

/** A car in a unit box: the body below, the cabin on top (aPart 1), +z is the front. */
function carGeometry() {
  const body = new THREE.BoxGeometry(1, 0.55, 1).translate(0, 0.275, 0);
  const cabin = new THREE.BoxGeometry(0.84, 0.45, 0.52).translate(0, 0.775, -0.04);
  body.setAttribute('aPart', new THREE.Float32BufferAttribute(new Array(body.attributes.position.count).fill(0), 1));
  cabin.setAttribute('aPart', new THREE.Float32BufferAttribute(new Array(cabin.attributes.position.count).fill(1), 1));
  const geo = mergeGeometries([body, cabin])!;
  body.dispose();
  cabin.dispose();
  return geo;
}

// ---------- building it ----------

const material = (vertexShader: string, fragmentShader: string, extra: Record<string, THREE.IUniform> = {}) =>
  new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: { ...shared, ...extra } });

/** Unit shapes standing on y = 0, scaled per instance to w × h × d. */
const unitBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: CityBox[]) {
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  items.forEach((b, i) => {
    m.makeScale(b.w, b.h, b.d).setPosition(b.x, b.y, b.z);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.setHex(b.color));
  });
  mesh.renderOrder = 1;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

function buildCity() {
  const layout = cityLayout();
  const routes = carRoutes();
  const windows = windowTexture();

  const buildingGeo = unitBox();
  buildingGeo.setAttribute('aWin', new THREE.InstancedBufferAttribute(new Float32Array(layout.buildings.flatMap((b) => [b.lit, b.pattern])), 2));
  const buildings = instanced(buildingGeo, material(BUILDING_VERT, BUILDING_FRAG, { uWindows: { value: windows } }), layout.buildings);

  const propMat = material(PROP_VERT, PROP_FRAG);
  const boxes = instanced(unitBox(), propMat, layout.boxes);
  const cylinders = instanced(new THREE.CylinderGeometry(0.5, 0.5, 1, 10).translate(0, 0.5, 0), propMat, layout.cylinders);
  const cones = instanced(new THREE.ConeGeometry(0.5, 1, 10).translate(0, 0.5, 0), propMat, layout.cones);

  const cars = routes.map(() => new THREE.Vector4(0, 1e5, 0, 1));
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1200, 1200).rotateX(-Math.PI / 2),
    material(GROUND_VERT, GROUND_FRAG, {
      uFirstLine: { value: new THREE.Vector2(CITY.homeHalfX + CORRIDOR_HALF, CITY.homeHalfZ + CORRIDOR_HALF) },
      uHomeHalf: { value: new THREE.Vector2(CITY.homeHalfX, CITY.homeHalfZ) },
      uExtent: { value: new THREE.Vector2(layout.extentX, layout.extentZ) },
      uPitch: { value: CITY.pitch },
      uRings: { value: CITY.rings },
      uRoadHalf: { value: CITY.roadHalf },
      uCorridor: { value: CORRIDOR_HALF },
      uCars: { value: [...cars, ...Array.from({ length: MAX_CARS - cars.length }, () => new THREE.Vector4(0, 1e5, 0, 1))] },
    }),
  );
  ground.renderOrder = 1;

  const carGeo = carGeometry();
  carGeo.setAttribute('aBus', new THREE.InstancedBufferAttribute(new Float32Array(routes.map((r) => (r.bus ? 1 : 0))), 1));
  const traffic = new THREE.InstancedMesh(carGeo, material(CAR_VERT, CAR_FRAG), routes.length);
  const c = new THREE.Color();
  routes.forEach((r, i) => traffic.setColorAt(i, c.setHex(r.color)));
  traffic.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  traffic.renderOrder = 1;
  traffic.frustumCulled = false; // its bounds would be the first frame's

  const meshes = [buildings, boxes, cylinders, cones, ground, traffic];
  return {
    layout,
    routes,
    meshes,
    traffic,
    cars,
    scales: routes.map((r) => new THREE.Vector3(r.w, r.h, r.len)),
    dispose() {
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      windows.dispose();
    },
  };
}

// ---------- the component ----------

const pose = { x: 0, z: 0, yaw: 0 };
const carMatrix = new THREE.Matrix4();
let lastT = -1;

/** The time of day into the shared uniforms. skyAt allocates, so only when the clock has moved on noticeably. */
function followSky() {
  const t = dayTime.t;
  if (Math.abs(t - lastT) < 1e-4) return;
  lastT = t;
  const sky = skyAt(t);
  const [x, y, z] = sunDirection(t);
  // by night the moon lights the city from the other side of the sky
  shared.uSunDir.value.set(y < 0 ? -x : x, Math.max(Math.abs(y), 0.15), y < 0 ? -z : z).normalize();
  shared.uSun.value.setHex(sky.sunColor).multiplyScalar(sky.sunIntensity);
  shared.uHemiSky.value.setHex(sky.hemiSky);
  shared.uHemiGround.value.setHex(sky.hemiGround);
  shared.uAmbient.value = sky.ambient;
  shared.uHaze.value.setHex(sky.horizon);
  shared.uLights.value = sky.cityLights;
}

let probe: { buildings: number; cars: number; elevation: number } = { buildings: 0, cars: 0, elevation: 0 };

/** The city around the building, at the current floor's height below you. Mounted once, in Game.tsx. */
export function City() {
  const floor = useStore((s) => s.floor);
  const top = useStore((s) => s.repos.reduce((m, r) => Math.max(m, r.floor), 0));
  const city = useMemo(buildCity, []);
  useEffect(() => () => city.dispose(), [city]);
  // A hair below street level, so the plaza never fights the lobby's floor.
  const elevation = viewElevation(floor, top);
  probe = { buildings: city.layout.buildings.length, cars: city.routes.length, elevation };

  useFrame(({ clock }) => {
    followSky();
    const time = clock.elapsedTime;
    const { traffic, routes, scales, cars } = city;
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i];
      carPose(r, time, pose);
      carMatrix.makeRotationY(pose.yaw).scale(scales[i]).setPosition(pose.x, 0, pose.z);
      traffic.setMatrixAt(i, carMatrix);
      const hx = Math.sin(pose.yaw);
      const hz = Math.cos(pose.yaw);
      cars[i].set(pose.x + (hx * r.len) / 2, pose.z + (hz * r.len) / 2, hx, hz);
    }
    traffic.instanceMatrix.needsUpdate = true;
  });

  return (
    <group position={[0, -elevation - 0.03, 0]}>
      {city.meshes.map((m) => (
        <primitive key={m.uuid} object={m} />
      ))}
    </group>
  );
}

// For QA: __swarmCity tells what the city holds and how far below you the street is.
if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmCity')) {
  Object.defineProperty(window, '__swarmCity', {
    get: () => ({ ...probe, drawCalls: 6, lights: shared.uLights.value }),
    enumerable: false,
    configurable: false,
  });
}
