import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { noise, tone } from '../../../ui/sfx';
import { HALF_W } from '../../layout';
import { haloTexture } from './geo';

// Fireworks over the city beyond the side walls: rockets that climb and burst into falling, fading sparks. All of it is
// one Points draw call with a fixed pool of sparks (nothing is allocated while it runs), and silent and hidden when no
// show is on. The bangs go through the Outside sound group.

const BURSTS = 8;
const SPARKS = 90;
const POOL = BURSTS * (SPARKS + 1);
const COLORS = ['#ffd23f', '#ff5d8f', '#4cc9f0', '#06d6a0', '#c77dff', '#ff8c42', '#ffffff'];

interface Shell {
  age: number; // seconds since launch, < 0 while free
  rise: number; // seconds of climb before it bursts
  from: THREE.Vector3;
  at: THREE.Vector3;
  color: THREE.Color;
}

let launcher: ((n?: number) => void) | null = null;
let running = 0;

/** Starts a show of `seconds` (a rocket every second or so), if Fireworks is mounted. */
export function startFireworks(seconds: number) {
  running = Math.max(running, seconds);
  launcher?.(2);
}

/** Seconds of show left. */
export const fireworksLeft = () => running;

export function Fireworks() {
  const st = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(POOL * 3).fill(0);
    const col = new Float32Array(POOL * 3).fill(0);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({ size: 0.9, map: haloTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
    const shells: Shell[] = Array.from({ length: BURSTS }, () => ({ age: -1, rise: 1, from: new THREE.Vector3(), at: new THREE.Vector3(), color: new THREE.Color() }));
    const dirs = Array.from({ length: SPARKS }, () => new THREE.Vector3().randomDirection().multiplyScalar(0.7 + Math.random() * 0.3));
    return { geo, mat, shells, dirs, pos, col, next: 0, side: 1, tmp: new THREE.Color() };
  }, []);
  useEffect(() => () => [st.geo, st.mat].forEach((d) => d.dispose()), [st]);

  useEffect(() => {
    const launch = (n = 1) => {
      for (let k = 0; k < n; k++) {
        const sh = st.shells.find((s) => s.age < 0);
        if (!sh) return;
        st.side = -st.side;
        // low and near enough to see through the windows, over the nearer rooftops
        const x = st.side * (HALF_W + 9 + Math.random() * 18);
        const z = (Math.random() - 0.5) * 40;
        sh.age = 0;
        sh.rise = 1.1 + Math.random() * 0.6;
        sh.from.set(x, -8, z);
        sh.at.set(x + (Math.random() - 0.5) * 4, 4 + Math.random() * 8, z);
        sh.color.set(COLORS[Math.floor(Math.random() * COLORS.length)]);
        const pan = st.side * 0.6;
        tone({ name: 'newyear:whistle', group: 'outside', pan, type: 'sine', freq: 900, to: 2200, dur: sh.rise, peak: 0.012 });
        noise({ name: 'newyear:bang', group: 'outside', pan, at: sh.rise + 0.25, dur: 0.9, peak: 0.09, filter: 'lowpass', freq: 400, to: 90, q: 0.7, attack: 0.004 });
        noise({ name: 'newyear:crackle', group: 'outside', pan, at: sh.rise + 0.5, dur: 0.8, peak: 0.02, filter: 'highpass', freq: 5000, q: 0.5, attack: 0.05 });
      }
    };
    launcher = launch;
    return () => {
      if (launcher === launch) launcher = null;
    };
  }, [st]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const live = st.shells.some((s) => s.age >= 0);
    if (running > 0) {
      running = Math.max(0, running - dt);
      st.next -= dt;
      if (st.next <= 0) {
        st.next = 0.5 + Math.random() * 0.9;
        launcher?.(Math.random() < 0.25 ? 2 : 1);
      }
    } else if (!live) return;
    const { pos, col, dirs, tmp } = st;
    st.shells.forEach((sh, b) => {
      const base = b * (SPARKS + 1);
      if (sh.age < 0) {
        for (let i = 0; i <= SPARKS; i++) col.fill(0, (base + i) * 3, (base + i) * 3 + 3);
        return;
      }
      sh.age += dt;
      if (sh.age < sh.rise) {
        // the rocket: one bright spark climbing
        const k = sh.age / sh.rise;
        pos.set([sh.from.x + (sh.at.x - sh.from.x) * k, sh.from.y + (sh.at.y - sh.from.y) * (1 - (1 - k) ** 2), sh.from.z], base * 3);
        col.set([1, 0.85, 0.6], base * 3);
        for (let i = 1; i <= SPARKS; i++) col.fill(0, (base + i) * 3, (base + i) * 3 + 3);
        return;
      }
      const t = sh.age - sh.rise;
      if (t > 2.6) {
        sh.age = -1;
        return;
      }
      col.fill(0, base * 3, base * 3 + 3);
      const fade = Math.max(0, 1 - t / 2.6) ** 1.5;
      const spread = 6 * (1 - Math.exp(-t * 2.2));
      for (let i = 1; i <= SPARKS; i++) {
        const d = dirs[i - 1];
        pos.set([sh.at.x + d.x * spread, sh.at.y + d.y * spread - 1.6 * t * t, sh.at.z + d.z * spread], (base + i) * 3);
        tmp.copy(sh.color).multiplyScalar(fade * (0.7 + 0.3 * Math.sin(t * 30 + i)));
        col.set([tmp.r, tmp.g, tmp.b], (base + i) * 3);
      }
    });
    st.geo.attributes.position.needsUpdate = true;
    st.geo.attributes.color.needsUpdate = true;
  });

  return <points geometry={st.geo} material={st.mat} frustumCulled={false} />;
}
