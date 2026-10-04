import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { MAX_DPR } from '../../perf';
import { BALCONY_OUT, HALF_D, ROOF_HUT, WALL_T } from '../layout';
import { nightFactor, skyAt, type SkyPalette } from '../sky/time';
import { dayTime } from '../sky/useDayTime';
import { seeded, weatherSky } from './weatherRules';
import { weather } from './weatherState';

// Rain and snow outside: streaks or flakes in a box that travels with you, a little ahead of where you look, every one
// placed and moved in the vertex shader from a fixed seed and the clock (so the frame loop only sets a few uniforms),
// wrapped round the box (so they stay put as it moves), faded at its edges and close to your eyes, and never inside the
// building's column (its rooms and its covered balconies). Past the box a band of rain or snow, scrolling on a cylinder
// round you, carries it to the haze. How many are drawn follows how hard it's coming down, capped (they cost the most
// on software rendering), and fewer when the adaptive resolution has stepped down. Two draw calls, none in a clear sky.

/** The box of rain round the camera, metres, and how far ahead of you its middle is: out through the windows from the middle of a floor. */
const BOX = new THREE.Vector3(40, 26, 40);
const AHEAD = 12;
const MAX = { rain: 1200, snow: 1400 };
/** The building and its balconies: no rain or snow in there. */
const HOLE = new THREE.Vector2(BALCONY_OUT - 0.1, HALF_D + WALL_T + 0.05);
/** The hut over the elevator on the roof (and the cabin under it): dry inside. */
const HUT = new THREE.Vector4(ROOF_HUT.minX - 0.1, ROOF_HUT.maxX + 0.1, ROOF_HUT.minZ - 0.1, ROOF_HUT.maxZ + 0.1);
/** The weather's clock wraps after this many seconds, so the shader's float maths stays precise all day. */
const WRAP = 600;

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uCam;
uniform vec3 uEye;
uniform vec3 uBox;
uniform vec2 uHole;
uniform float uRoof;
uniform vec4 uHut;
uniform float uHutTop;
uniform float uGround;
uniform float uTime;
uniform float uFall;
uniform vec2 uWind;
uniform vec2 uSize;
uniform float uSnow;
varying float vAlpha;
varying vec2 vUv;
void main() {
  float speed = uFall * (0.8 + 0.4 * aSeed.w);
  vec3 vel = vec3(uWind.x, -speed, uWind.y);
  vec3 p = aSeed.xyz * uBox + vel * uTime;
  p = uCam + mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
  // snow flutters as it falls
  p.x += uSnow * sin(uTime * (0.7 + aSeed.w) + aSeed.y * 40.0) * 0.45;
  p.z += uSnow * cos(uTime * (0.5 + aSeed.w * 0.6) + aSeed.x * 40.0) * 0.45;
  vec3 d = abs(p - uCam) / (uBox * 0.5);
  // faded out at the box's edges, and right in front of your eyes, where a streak would fill the screen
  float near = length(p - uEye);
  vAlpha = (1.0 - smoothstep(0.65, 1.0, max(d.x, max(d.y, d.z)))) * smoothstep(3.0, 6.0, near);
  // the building's column is dry below its roof; up on the roof, only the hut is
  bool inside = abs(p.x) < uHole.x && abs(p.z) < uHole.y && p.y < uRoof;
  bool hut = p.x > uHut.x && p.x < uHut.y && p.z > uHut.z && p.z < uHut.w && p.y < uHutTop;
  if (inside || hut || p.y < uGround || vAlpha <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vUv = position.xy + 0.5;
  if (uSnow > 0.5) {
    // a flake: a little square facing the camera
    vec4 mv = viewMatrix * vec4(p, 1.0);
    mv.xy += position.xy * uSize.x * (0.7 + 0.6 * aSeed.w);
    gl_Position = projectionMatrix * mv;
  } else {
    // a streak along its fall, turned to face the camera
    vec3 dir = normalize(vel);
    vec3 side = normalize(cross(dir, normalize(cameraPosition - p)));
    vec3 w = p + side * position.x * uSize.x + dir * position.y * uSize.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSnow;
varying float vAlpha;
varying vec2 vUv;
void main() {
  float a;
  if (uSnow > 0.5) a = 1.0 - smoothstep(0.25, 0.5, length(vUv - 0.5));
  else a = (1.0 - abs(vUv.x - 0.5) * 2.0) * smoothstep(0.0, 0.35, vUv.y);
  gl_FragColor = vec4(uColor, a * vAlpha * uOpacity);
}`;

// The curtain: a cylinder round the camera, beyond the box, with the rain (or snow) scrolling down it.
const CURTAIN_VERT = /* glsl */ `
varying vec2 vUv;
varying float vH;
void main() {
  vUv = uv;
  vH = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const CURTAIN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uSnow;
uniform float uLean;
varying vec2 vUv;
varying float vH;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 p = vec2(vUv.x * 900.0, vUv.y * 60.0);
  p.x += p.y * uLean;
  float a;
  if (uSnow > 0.5) {
    p.y += uTime * 1.2;
    vec2 c = floor(p * vec2(0.5, 1.0));
    vec2 f = fract(p * vec2(0.5, 1.0)) - 0.5;
    f.x += sin(uTime + hash(c) * 6.0) * 0.2;
    a = step(0.55, hash(c)) * (1.0 - smoothstep(0.08, 0.2, length(f)));
  } else {
    p.y += uTime * 14.0;
    float col = floor(p.x);
    float h = hash(vec2(col, 1.0));
    float y = fract(p.y * 0.12 + h * 7.0);
    a = step(0.45, h) * smoothstep(0.0, 0.25, y) * (1.0 - smoothstep(0.25, 0.5, y)) * (1.0 - abs(fract(p.x) - 0.5) * 2.0);
  }
  // thickest at eye level, thinning out up and down
  a *= 1.0 - smoothstep(8.0, 16.0, abs(vH));
  gl_FragColor = vec4(uColor, a * uOpacity);
}`;

const palette = {} as SkyPalette;

/** `elevation`: how far your floor is above the street; `roof`: how far the roof deck is above your floor (0 up there). */
export function Precipitation({ elevation, roof, onRoof }: { elevation: number; roof: number; onRoof: boolean }) {
  const gl = useThree((s) => s.gl);
  const stuff = useMemo(() => {
    const make = (count: number, seed: number) => {
      const quad = new THREE.PlaneGeometry(1, 1);
      const g = new THREE.InstancedBufferGeometry();
      g.index = quad.index;
      g.setAttribute('position', quad.getAttribute('position'));
      const rnd = seeded(seed);
      const seeds = new Float32Array(count * 4);
      for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
      g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
      g.instanceCount = 0;
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uCam: { value: new THREE.Vector3() },
          uEye: { value: new THREE.Vector3() },
          uBox: { value: BOX },
          uHole: { value: HOLE },
          uRoof: { value: 0 },
          uHut: { value: HUT },
          uHutTop: { value: -1e5 },
          uGround: { value: 0 },
          uTime: { value: 0 },
          uFall: { value: 9 },
          uWind: { value: new THREE.Vector2() },
          uSize: { value: new THREE.Vector2(0.02, 0.7) },
          uSnow: { value: 0 },
          uColor: { value: new THREE.Color() },
          uOpacity: { value: 0.5 },
        },
      });
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      return { g, mat, mesh, quad };
    };
    const rain = make(MAX.rain, 31);
    const snow = make(MAX.snow, 47);
    snow.mat.uniforms.uSnow.value = 1;
    snow.mat.uniforms.uFall.value = 1.1;
    snow.mat.uniforms.uSize.value.set(0.13, 0.13);
    const curtainGeo = new THREE.CylinderGeometry(42, 42, 32, 48, 1, true);
    const curtainMat = new THREE.ShaderMaterial({
      vertexShader: CURTAIN_VERT,
      fragmentShader: CURTAIN_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      uniforms: { uColor: { value: new THREE.Color() }, uOpacity: { value: 0 }, uTime: { value: 0 }, uSnow: { value: 0 }, uLean: { value: 0 } },
    });
    const curtain = new THREE.Mesh(curtainGeo, curtainMat);
    curtain.frustumCulled = false;
    curtain.renderOrder = 2;
    return { rain, snow, curtain, curtainGeo, curtainMat, color: new THREE.Color(), centre: new THREE.Vector3() };
  }, []);

  useEffect(
    () => () => {
      for (const p of [stuff.rain, stuff.snow]) {
        p.g.dispose();
        p.quad.dispose();
        p.mat.dispose();
      }
      stuff.curtainGeo.dispose();
      stuff.curtainMat.dispose();
    },
    [stuff],
  );

  useFrame(({ camera }) => {
    const m = weather.mix;
    // fewer when the adaptive resolution has stepped down (perf.tsx): the frame is struggling
    const full = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const quality = 0.55 + 0.45 * Math.min(1, gl.getPixelRatio() / full);
    const t = weather.clock % WRAP;
    // lit by the sky: pale grey by day, dim blue at night, white for a moment in a flash
    const p = weatherSky(skyAt(dayTime.t, palette), m);
    const night = nightFactor(dayTime.t);
    stuff.color.setHex(p.hemiSky).multiplyScalar(0.55 + 0.4 * (1 - night) + weather.flash * 0.6);

    // the box's middle: a little ahead of you, level
    camera.getWorldDirection(stuff.centre);
    stuff.centre.y = 0;
    stuff.centre.normalize().multiplyScalar(AHEAD).add(camera.position);
    const windX = 2.5 * m.wind;
    const windZ = 1.2 * m.wind;
    for (let k = 0; k < 2; k++) {
      const snow = k === 1;
      const part = snow ? stuff.snow : stuff.rain;
      const amount = snow ? m.snow : m.rain;
      const n = amount > 0.01 ? Math.round((snow ? MAX.snow : MAX.rain) * Math.min(1, amount) * quality) : 0;
      part.g.instanceCount = n;
      part.mesh.visible = n > 0;
      if (!n) continue;
      const u = part.mat.uniforms;
      (u.uCam.value as THREE.Vector3).copy(stuff.centre);
      (u.uEye.value as THREE.Vector3).copy(camera.position);
      u.uGround.value = -elevation;
      u.uRoof.value = roof;
      u.uHutTop.value = onRoof ? ROOF_HUT.h + 0.2 : -1e5;
      u.uTime.value = t;
      (u.uWind.value as THREE.Vector2).set(windX * (snow ? 0.5 : 1), windZ * (snow ? 0.5 : 1));
      (u.uColor.value as THREE.Color).copy(stuff.color);
      u.uOpacity.value = snow ? 0.9 : 0.32 + 0.2 * amount;
      if (!snow) u.uFall.value = 8 + 5 * m.storm;
    }

    const curtain = Math.max(m.rain, m.snow);
    stuff.curtain.visible = curtain > 0.02;
    if (stuff.curtain.visible) {
      stuff.curtain.position.set(camera.position.x, camera.position.y, camera.position.z);
      const cu = stuff.curtainMat.uniforms;
      cu.uOpacity.value = (m.snow > m.rain ? 0.55 : 0.22) * Math.min(1, curtain);
      cu.uSnow.value = m.snow > m.rain ? 1 : 0;
      cu.uTime.value = t;
      cu.uLean.value = 0.15 * m.wind;
      (cu.uColor.value as THREE.Color).copy(stuff.color);
    }
  });

  return (
    <group>
      <primitive object={stuff.rain.mesh} />
      <primitive object={stuff.snow.mesh} />
      <primitive object={stuff.curtain} />
    </group>
  );
}
