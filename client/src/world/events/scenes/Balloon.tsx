import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { placeAt, play } from '../../../ui/eventSfx';
import { seeded } from '../director';
import { eyeAbove, glowOut, inOut, lerp, sign, toonOut, type SceneProps } from '../kit';

// A hot-air balloon drifting slowly across the view, rising a little as it goes, its striped envelope swaying gently
// over the basket, and every few seconds the burner roaring with a lick of flame.

const GORES = 10;
const PALETTES = [
  ['#e63946', '#f1faee', '#ffb703'],
  ['#2a9d8f', '#e9c46a', '#f4a261'],
  ['#7209b7', '#f72585', '#4cc9f0'],
];

export default function Balloon({ run, elevation }: SceneProps) {
  const balloon = useRef<THREE.Group>(null);
  const flame = useRef<THREE.Mesh>(null);
  const s = sign(run.side);
  const p = useMemo(() => {
    const r = seeded(run.seed);
    const dir = r() < 0.5 ? 1 : -1;
    return { dir, x: s * (105 + r() * 35), y: eyeAbove(elevation) + 18 + r() * 8, palette: PALETTES[Math.floor(r() * PALETTES.length)], burns: { next: 3 + r() * 3, until: 0 } };
  }, [run.seed, s, elevation]);

  useFrame(() => {
    const t = run.t;
    const g = balloon.current;
    if (!g) return;
    const k = t / run.seconds;
    const x = p.x + Math.sin(t * 0.13) * 4;
    const y = p.y + k * 12 + Math.sin(t * 0.4) * 0.8;
    const z = lerp(-p.dir * 160, p.dir * 160, k);
    g.position.set(x, y, z);
    g.rotation.z = Math.sin(t * 0.5) * 0.04;
    g.rotation.y = t * 0.05;
    if (t >= p.burns.next) {
      p.burns.until = t + 1.4;
      p.burns.next = t + 6 + Math.random() * 5;
      const heard = placeAt(x, y - elevation, z, 90);
      play('burner', { gain: heard.gain * inOut(t, run.seconds, 4), pan: heard.pan });
    }
    if (flame.current) {
      const on = t < p.burns.until;
      flame.current.visible = on;
      if (on) flame.current.scale.set(1, 0.8 + Math.sin(t * 40) * 0.25, 1);
    }
  });

  return (
    <group ref={balloon}>
      {Array.from({ length: GORES }, (_, i) => (
        <mesh key={i} material={toonOut(p.palette[i % p.palette.length])} position={[0, 15, 0]} scale={[1, 1.15, 1]}>
          <sphereGeometry args={[9, 3, 14, (i * Math.PI * 2) / GORES, (Math.PI * 2) / GORES]} />
        </mesh>
      ))}
      <mesh material={toonOut(p.palette[0], { side: THREE.DoubleSide })} position={[0, 4.6, 0]}>
        <cylinderGeometry args={[4.4, 1.4, 4, 16, 1, true]} />
      </mesh>
      {[0, 1, 2, 3].map((i) => {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        return (
          <mesh key={i} material={toonOut('#6b4a33')} position={[Math.cos(a) * 1.1, 1.5, Math.sin(a) * 1.1]}>
            <cylinderGeometry args={[0.04, 0.04, 2.4, 4]} />
          </mesh>
        );
      })}
      <mesh material={toonOut('#a1683a')} position={[0, -0.3, 0]}>
        <boxGeometry args={[2, 1.3, 2]} />
      </mesh>
      <mesh ref={flame} material={glowOut('#ffb347', { add: true })} position={[0, 3.1, 0]} visible={false}>
        <coneGeometry args={[0.5, 2.2, 10]} />
      </mesh>
    </group>
  );
}
