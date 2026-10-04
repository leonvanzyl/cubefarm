import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import { placeAt, play } from '../../../ui/eventSfx';
import { seeded } from '../director';
import { eyeAbove, inOut, lerp, sign, toonOut, type SceneProps } from '../kit';

// A giant inflatable rubber duck floating past over the rooftops like a runaway parade balloon: bobbing, turning this
// way and that, and squeaking now and then.

const SIZE = 22;

export default function Duck({ run, elevation }: SceneProps) {
  const duck = useRef<THREE.Group>(null);
  const s = sign(run.side);
  const p = useMemo(() => {
    const r = seeded(run.seed);
    return { dir: r() < 0.5 ? 1 : -1, x: s * (115 + r() * 30), y: eyeAbove(elevation) + 6 + r() * 6, next: 4 + r() * 4 };
  }, [run.seed, s, elevation]);

  useFrame(() => {
    const t = run.t;
    const g = duck.current;
    if (!g) return;
    const z = lerp(-p.dir * 175, p.dir * 175, t / run.seconds);
    const y = p.y + Math.sin(t * 0.8) * 1.6;
    g.position.set(p.x + Math.sin(t * 0.21) * 6, y, z);
    // mostly heading on, turning to look at the building now and then
    g.rotation.set(Math.sin(t * 0.9) * 0.05, (p.dir > 0 ? 0 : Math.PI) + Math.sin(t * 0.33) * 0.5, Math.sin(t * 0.7) * 0.06);
    if (t >= p.next) {
      p.next = t + 7 + Math.random() * 6;
      const heard = placeAt(g.position.x, y - elevation, z, 110);
      play('squeak', { gain: heard.gain * inOut(t, run.seconds, 3), pan: heard.pan, pitch: 0.8 + Math.random() * 0.3 });
    }
  });

  const yellow = toonOut('#ffd23f');
  const orange = toonOut('#ff8c1a');
  const ink = toonOut('#1f1d2b');
  return (
    <group ref={duck}>
      <group scale={SIZE}>
        <mesh material={yellow} scale={[1, 0.78, 1.25]}>
          <sphereGeometry args={[0.5, 22, 16]} />
        </mesh>
        <mesh material={yellow} position={[0, 0.18, -0.6]} rotation-x={-0.9}>
          <coneGeometry args={[0.2, 0.4, 14]} />
        </mesh>
        {[-1, 1].map((x) => (
          <mesh key={x} material={yellow} position={[x * 0.44, 0.08, -0.05]} scale={[0.35, 0.6, 1]}>
            <sphereGeometry args={[0.3, 14, 10]} />
          </mesh>
        ))}
        <mesh material={yellow} position={[0, 0.58, 0.36]}>
          <sphereGeometry args={[0.32, 20, 14]} />
        </mesh>
        <mesh material={orange} position={[0, 0.5, 0.68]} scale={[1.1, 0.42, 1]}>
          <sphereGeometry args={[0.16, 14, 10]} />
        </mesh>
        {[-1, 1].map((x) => (
          <group key={x}>
            <mesh material={ink} position={[x * 0.14, 0.68, 0.6]}>
              <sphereGeometry args={[0.05, 10, 8]} />
            </mesh>
            <mesh material={toonOut('#ffffff')} position={[x * 0.13, 0.7, 0.645]}>
              <sphereGeometry args={[0.015, 6, 4]} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}
