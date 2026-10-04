import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { placeAt, play } from '../../../ui/eventSfx';
import { markBloom } from '../../gfx/bloomMarks';
import { seeded } from '../director';
import { eyeAbove, sign, type SceneProps } from '../kit';

// A fireworks show over the city at night: rockets streak up from the streets and burst into spheres, rings and golden
// willows of sparks that fall and fade, building to a finale. Every spark is one point in a single draw call, moved
// in the vertex shader from where and when it was launched (the frame loop only writes the new ones), with a whistle
// as each goes up and the boom arriving a moment after the flash, as far away as it is.

const SLOTS = 2400;
const GRAVITY = -6;
const ATTRS = ['position', 'aVel', 'aColor', 'aTime', 'aSize'] as const;
const PALETTE = ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#ff70a6', '#ffffff', '#c77dff', '#4cc9f0'];

const VERT = /* glsl */ `
attribute vec3 aVel;
attribute vec3 aColor;
attribute vec2 aTime; // start, life
attribute float aSize;
uniform float uTime;
uniform float uScale;
varying vec3 vColor;
varying float vFade;
void main() {
  float age = uTime - aTime.x;
  if (age < 0.0 || age > aTime.y) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  // air drag slows the sparks, then gravity takes them
  float drag = (1.0 - exp(-1.6 * age)) / 1.6;
  vec3 p = position + aVel * drag + vec3(0.0, ${GRAVITY.toFixed(1)} * 0.5 * age * age, 0.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float k = age / aTime.y;
  vFade = (1.0 - k * k) * (0.75 + 0.25 * sin(age * 30.0 + aSize * 50.0));
  vColor = aColor;
  gl_PointSize = aSize * uScale / max(1.0, -mv.z);
}`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vFade;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.1, 0.5, r)) * vFade;
  gl_FragColor = vec4(vColor * (1.0 + (1.0 - smoothstep(0.0, 0.2, r))), a);
}`;

interface Launch {
  at: number;
  x: number;
  y: number;
  z: number;
  shape: 'sphere' | 'ring' | 'willow';
  color: THREE.Color;
  color2: THREE.Color;
  sparks: number;
  done: boolean;
}

export default function Fireworks({ run, elevation }: SceneProps) {
  const gl = useThree((st) => st.gl);
  const s = sign(run.side);
  const show = useMemo(() => {
    const r = seeded(run.seed);
    const launches: Launch[] = [];
    const add = (at: number, big = false) => {
      const shape = r() < 0.2 ? 'willow' : r() < 0.35 ? 'ring' : 'sphere';
      const c = PALETTE[Math.floor(r() * PALETTE.length)];
      launches.push({
        at,
        x: s * (140 + r() * 90),
        y: eyeAbove(elevation) + 22 + r() * 30,
        z: (r() - 0.5) * 260,
        shape,
        color: new THREE.Color(shape === 'willow' ? '#ffcf6b' : c),
        color2: new THREE.Color(r() < 0.4 ? PALETTE[Math.floor(r() * PALETTE.length)] : c),
        sparks: big ? 140 : 70 + Math.floor(r() * 50),
        done: false,
      });
    };
    for (let t = 2; t < run.seconds - 12; t += 0.9 + r() * 1.3) add(t);
    // the finale
    for (let i = 0; i < 9; i++) add(run.seconds - 11 + i * 0.35 + r() * 0.2, true);
    launches.sort((a, b) => a.at - b.at);

    const geo = new THREE.BufferGeometry();
    const attr = (size: number) => new THREE.BufferAttribute(new Float32Array(SLOTS * size), size).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr(3));
    geo.setAttribute('aVel', attr(3));
    geo.setAttribute('aColor', attr(3));
    geo.setAttribute('aTime', attr(2));
    geo.setAttribute('aSize', attr(1));
    (geo.attributes.aTime.array as Float32Array).fill(-1000);
    const mat = markBloom(new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uScale: { value: 400 } },
    }));
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 5;
    return { launches, geo, mat, points, next: 0, slot: 0, rnd: seeded(run.seed + 1) };
  }, [run.seed, run.seconds, s, elevation]);
  useEffect(
    () => () => {
      show.geo.dispose();
      show.mat.dispose();
    },
    [show],
  );

  /** Writes one spark into the next slot of the ring. */
  const spark = (x: number, y: number, z: number, vx: number, vy: number, vz: number, c: THREE.Color, start: number, life: number, size: number) => {
    const i = show.slot;
    show.slot = (show.slot + 1) % SLOTS;
    const a = show.geo.attributes;
    const pos = a.position.array as Float32Array;
    const vel = a.aVel.array as Float32Array;
    const col = a.aColor.array as Float32Array;
    const time = a.aTime.array as Float32Array;
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    vel[i * 3] = vx;
    vel[i * 3 + 1] = vy;
    vel[i * 3 + 2] = vz;
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    time[i * 2] = start;
    time[i * 2 + 1] = life;
    (a.aSize.array as Float32Array)[i] = size;
  };

  useFrame(({ camera }) => {
    const t = run.t;
    const cam = camera as THREE.PerspectiveCamera;
    show.mat.uniforms.uTime.value = t;
    show.mat.uniforms.uScale.value = (gl.domElement.height * 0.5) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    let wrote = false;
    while (show.next < show.launches.length && show.launches[show.next].at <= t) {
      const L = show.launches[show.next++];
      const rise = 1.5 + show.rnd() * 0.4;
      const burst = L.at + rise;
      // the rocket and its little trail, up to where it bursts (the speed that gets there through the drag and gravity)
      const up = (L.y - 0.5 * GRAVITY * rise * rise) / ((1 - Math.exp(-1.6 * rise)) / 1.6);
      for (let k = 0; k < 6; k++) spark(L.x, 0, L.z, 0, up, 0, L.color, L.at + k * 0.04, rise - k * 0.04, k ? 0.9 : 1.6);
      const r = show.rnd;
      for (let k = 0; k < L.sparks; k++) {
        let vx: number;
        let vy: number;
        let vz: number;
        if (L.shape === 'ring') {
          const a = (k / L.sparks) * Math.PI * 2;
          vx = Math.cos(a) * 0.25;
          vy = Math.cos(a) * 0.9;
          vz = Math.sin(a);
        } else {
          // a random direction on the sphere
          const u = r() * 2 - 1;
          const a = r() * Math.PI * 2;
          const q = Math.sqrt(1 - u * u);
          vx = Math.cos(a) * q;
          vy = u;
          vz = Math.sin(a) * q;
        }
        const speed = L.shape === 'willow' ? 14 : 25 + r() * 6;
        spark(L.x, L.y, L.z, vx * speed, vy * speed + (L.shape === 'willow' ? 3 : 0), vz * speed, k % 2 ? L.color2 : L.color, burst, L.shape === 'willow' ? 3.6 : 2 + r() * 0.6, L.shape === 'willow' ? 2.4 : 3.2);
      }
      wrote = true;
      const heard = placeAt(L.x, L.y - elevation, L.z, 220);
      play('launch', { gain: heard.gain, pan: heard.pan, pitch: 0.85 + show.rnd() * 0.3 });
      // the bang comes as far behind the flash as the burst is away
      const away = Math.hypot(L.x - camera.position.x, L.y - elevation - camera.position.y, L.z - camera.position.z) / 343;
      play('boom', { gain: heard.gain, pan: heard.pan, delay: rise + away });
      if (L.shape !== 'ring') play('crackle', { gain: heard.gain * 0.8, pan: heard.pan, delay: rise + away + 0.5 });
    }
    if (wrote) for (const name of ATTRS) show.geo.attributes[name].needsUpdate = true;
  });

  return <primitive object={show.points} />;
}
