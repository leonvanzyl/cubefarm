import * as THREE from 'three';
import { markBloom } from '../gfx/bloomMarks';
import { cityHaze } from '../outside/City';

// What every world event's scene shares: toon materials that light like the office's but fade into the city's haze
// with distance (the scene's own fog would swallow anything past 70 m), glowing ones for lights and sparks, and a few
// pure easing helpers. Materials are cached and shared across scenes (a handful in all); geometries belong to scenes.

// The office's three-step ramp (materials.ts).
const ramp = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
ramp.minFilter = THREE.NearestFilter;
ramp.magFilter = THREE.NearestFilter;
ramp.generateMipmaps = false;
ramp.needsUpdate = true;

/** How much of the city's haze reaches the events: a little less than the buildings get, so they stand out. */
const HAZE = 0.4;

function hazed<T extends THREE.Material>(m: T): T {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHaze = cityHaze.uHaze;
    shader.uniforms.uHazeRange = cityHaze.uHazeRange;
    shader.vertexShader = `varying float vHazeDist;\n${shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vHazeDist = length(mvPosition.xyz);')}`;
    shader.fragmentShader = `uniform vec3 uHaze;\nuniform vec2 uHazeRange;\nvarying float vHazeDist;\n${shader.fragmentShader.replace(
      '#include <colorspace_fragment>',
      `float hz = clamp((vHazeDist - uHazeRange.x) / (uHazeRange.y - uHazeRange.x), 0.0, 1.0);\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, hz * (2.0 - hz) * ${HAZE.toFixed(2)});\n  #include <colorspace_fragment>`,
    )}`;
  };
  return m;
}

const cache = new Map<string, THREE.Material>();

/** A cel-shaded colour for an event's body, lit by the office's light (sun, sky, moon) and hazed with distance. */
export function toonOut(color: string, opts: { emissive?: string; emissiveIntensity?: number; opacity?: number; side?: THREE.Side } = {}): THREE.Material {
  const key = `t|${color}|${opts.emissive ?? ''}|${opts.emissiveIntensity ?? ''}|${opts.opacity ?? ''}|${opts.side ?? ''}`;
  let m = cache.get(key);
  if (!m) {
    m = hazed(
      new THREE.MeshToonMaterial({
        color,
        gradientMap: ramp,
        fog: false,
        emissive: opts.emissive ?? '#000000',
        emissiveIntensity: opts.emissiveIntensity ?? 1,
        transparent: opts.opacity !== undefined && opts.opacity < 1,
        opacity: opts.opacity ?? 1,
        side: opts.side ?? THREE.FrontSide,
      }),
    );
    cache.set(key, m);
  }
  return m;
}

/** A flat, self-lit colour (lights, flames, beams, sparks): additive when `add`, never fogged or tone mapped, and glowing under the graphics' bloom. */
export function glowOut(color: string, opts: { opacity?: number; add?: boolean } = {}): THREE.MeshBasicMaterial {
  const key = `g|${color}|${opts.opacity ?? ''}|${opts.add ? 1 : 0}`;
  let m = cache.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = markBloom(new THREE.MeshBasicMaterial({
      color,
      fog: false,
      toneMapped: false,
      transparent: opts.opacity !== undefined || !!opts.add,
      opacity: opts.opacity ?? 1,
      depthWrite: !(opts.opacity !== undefined || opts.add),
      blending: opts.add ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    cache.set(key, m);
  }
  return m;
}

// ---------- easing ----------

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const smooth = (x: number) => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** 0 → 1 over [a, b] of t, eased. */
export const span = (t: number, a: number, b: number) => smooth((t - a) / (b - a));
/** Fades in over the first `fade` seconds and out over the last, 0-1. */
export const inOut = (t: number, seconds: number, fade = 3) => Math.min(clamp01(t / fade), clamp01((seconds - t) / fade));

/** -1 for the west side, 1 for the east. */
export const sign = (side: 'west' | 'east') => (side === 'west' ? -1 : 1);

/** What every scene gets: its run (read `run.t` in the frame loop) and how far above the street your floor is. */
export interface SceneProps {
  run: import('./eventsState').EventRun;
  /** Street level is y 0 in a scene; your floor is this far above it (the scene's group is lowered by it). */
  elevation: number;
}

/** Your eye's height above the street. */
export const eyeAbove = (elevation: number) => elevation + 1.65;
