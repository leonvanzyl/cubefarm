import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { heart } from './geo';

// A confetti burst anywhere on the floor (a present, the birthday cake, the end of the song): one pooled instanced
// mesh per theme, hidden while nothing flies. Merges on office floors keep their own (MergeConfetti.tsx).

const PIECES = 120;
const LIFE = 2.6;

let fire: ((x: number, y: number, z: number, colors: readonly string[]) => void) | null = null;

/** Throws confetti from (x, y, z) in `colors`, if a theme's Burst is mounted. */
export function burstAt(x: number, y: number, z: number, colors: readonly string[]) {
  fire?.(x, y, z, colors);
}

export function Burst({ shape = 'paper' }: { shape?: 'paper' | 'heart' }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const sim = useMemo(
    () => ({
      geo: shape === 'heart' ? heart(0.09) : new THREE.PlaneGeometry(0.1, 0.06),
      mat: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }),
      pos: new Float32Array(PIECES * 3),
      vel: new Float32Array(PIECES * 3),
      rot: new Float32Array(PIECES * 3),
      age: -1,
      o: new THREE.Object3D(),
      c: new THREE.Color(),
    }),
    [shape],
  );
  useEffect(() => () => [sim.geo, sim.mat].forEach((d) => d.dispose()), [sim]);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    sim.o.scale.setScalar(0);
    sim.o.updateMatrix();
    for (let i = 0; i < PIECES; i++) {
      m.setMatrixAt(i, sim.o.matrix);
      m.setColorAt(i, sim.c.set('#ffffff'));
    }
    m.visible = false;
  }, [sim]);
  useEffect(() => {
    const go = (x: number, y: number, z: number, colors: readonly string[]) => {
      const m = ref.current;
      if (!m) return;
      for (let i = 0; i < PIECES; i++) {
        const a = Math.random() * Math.PI * 2;
        const out = 0.5 + Math.random() * 1.8;
        sim.pos.set([x, y, z], i * 3);
        sim.vel.set([Math.cos(a) * out, 2.4 + Math.random() * 2.4, Math.sin(a) * out], i * 3);
        sim.rot.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
        m.setColorAt(i, sim.c.set(colors[i % colors.length]));
      }
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      sim.age = 0;
      m.visible = true;
    };
    fire = go;
    return () => {
      if (fire === go) fire = null;
    };
  }, [sim]);
  useFrame((_, delta) => {
    const m = ref.current;
    if (!m || sim.age < 0) return;
    const dt = Math.min(delta, 0.05);
    sim.age += dt;
    const size = sim.age >= LIFE ? 0 : Math.min(1, (LIFE - sim.age) / (LIFE * 0.4));
    const drag = Math.exp(-1.6 * dt);
    for (let i = 0; i < PIECES; i++) {
      const j = i * 3;
      sim.vel[j] *= drag;
      sim.vel[j + 2] *= drag;
      sim.vel[j + 1] = Math.max(sim.vel[j + 1] * drag - 3.2 * dt, -0.9);
      const flutter = Math.sin(sim.age * 7 + i) * 0.4;
      sim.pos[j] += (sim.vel[j] + flutter) * dt;
      sim.pos[j + 1] = Math.max(0.02, sim.pos[j + 1] + sim.vel[j + 1] * dt);
      sim.pos[j + 2] += (sim.vel[j + 2] + flutter * 0.6) * dt;
      sim.rot[j] += 7 * dt;
      sim.rot[j + 2] += 5 * dt;
      sim.o.position.set(sim.pos[j], sim.pos[j + 1], sim.pos[j + 2]);
      sim.o.rotation.set(sim.rot[j], sim.rot[j + 1], sim.rot[j + 2]);
      sim.o.scale.setScalar(size);
      sim.o.updateMatrix();
      m.setMatrixAt(i, sim.o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
    if (sim.age >= LIFE) {
      sim.age = -1;
      m.visible = false;
    }
  });
  return <instancedMesh ref={ref} args={[sim.geo, sim.mat, PIECES]} frustumCulled={false} />;
}
