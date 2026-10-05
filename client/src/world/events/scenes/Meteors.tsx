import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { placeAt, play } from '../../../ui/eventSfx';
import { seeded } from '../director';
import { eyeAbove, glowOut, inOut, sign, type SceneProps } from '../kit';

// A meteor shower at night: shooting stars streaking down the sky on the event's side, a dozen or so a minute and a
// flurry in the middle, each a glowing streak that grows a tail and burns out. A small pool of meshes, reused.

const POOL = 14;
const UP = new THREE.Vector3(0, 1, 0);

interface Meteor {
  born: number;
  life: number;
  x: number;
  y: number;
  z: number;
  dir: THREE.Vector3;
  speed: number;
  size: number;
}

export default function Meteors({ run, elevation }: SceneProps) {
  const pool = useRef<THREE.Group>(null);
  const s = sign(run.side);
  const sky = useMemo(() => {
    const meteors: Meteor[] = Array.from({ length: POOL }, () => ({ born: -10, life: 0, x: 0, y: 0, z: 0, dir: new THREE.Vector3(), speed: 0, size: 1 }));
    return { meteors, next: 1, rnd: seeded(run.seed), q: new THREE.Quaternion(), back: new THREE.Vector3() };
  }, [run.seed]);

  useFrame(() => {
    const t = run.t;
    const r = sky.rnd;
    // more in the middle of the shower
    while (t >= sky.next && t < run.seconds - 3) {
      const m = sky.meteors.find((x) => t - x.born > x.life);
      const rate = 0.9 + 2.2 * Math.exp(-(((t / run.seconds - 0.55) / 0.12) ** 2));
      sky.next += (-Math.log(1 - r() * 0.98) / rate) * 1.4;
      if (!m) continue;
      m.born = t;
      m.life = 0.7 + r() * 0.8;
      m.x = s * (180 + r() * 140);
      m.y = eyeAbove(elevation) + 50 + r() * 120;
      m.z = (r() - 0.5) * 420;
      m.dir.set(-s * r() * 0.3, -0.35 - r() * 0.35, r() < 0.5 ? 1 : -1).normalize();
      m.speed = 110 + r() * 80;
      m.size = 0.6 + r() * 0.8;
      if (r() < 0.3) {
        const heard = placeAt(m.x, m.y - elevation, m.z, 200);
        play('whoosh', { gain: heard.gain * inOut(t, run.seconds, 4), pan: heard.pan });
      }
    }
    const kids = pool.current?.children;
    if (!kids) return;
    for (let i = 0; i < POOL; i++) {
      const m = sky.meteors[i];
      const mesh = kids[i];
      const age = t - m.born;
      mesh.visible = age >= 0 && age < m.life;
      if (!mesh.visible) continue;
      const k = age / m.life;
      // the head races on; the tail grows, then the whole thing burns out
      const len = Math.min(age * m.speed, 30 + m.size * 10) * (1 - k * 0.5);
      const hx = m.x + m.dir.x * m.speed * age;
      const hy = m.y + m.dir.y * m.speed * age;
      const hz = m.z + m.dir.z * m.speed * age;
      mesh.position.set(hx - (m.dir.x * len) / 2, hy - (m.dir.y * len) / 2, hz - (m.dir.z * len) / 2);
      // the cone's point trails behind: a bright head and a thinning tail
      mesh.quaternion.copy(sky.q.setFromUnitVectors(UP, sky.back.copy(m.dir).negate()));
      const w = m.size * (1 - k * k);
      mesh.scale.set(w, Math.max(0.01, len), w);
    }
  });

  return (
    <group ref={pool}>
      {Array.from({ length: POOL }, (_, i) => (
        <mesh key={i} material={glowOut('#dfe9ff', { opacity: 0.85, add: true })} visible={false} frustumCulled={false}>
          <coneGeometry args={[0.9, 1, 6, 1, true]} />
        </mesh>
      ))}
    </group>
  );
}
