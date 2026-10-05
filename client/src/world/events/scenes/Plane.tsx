import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { loop, placeAt } from '../../../ui/eventSfx';
import { seeded } from '../director';
import { eyeAbove, inOut, lerp, sign, toonOut, type SceneProps } from '../kit';

// An airliner crossing high over the city, left to right or back, with two contrails puffing out behind its engines
// that linger, spread and fade after it has gone, and its distant rumble swelling as it passes. The trail is one
// instanced mesh of puffs laid where the engines were; the plane is a dozen boxes and cylinders.

const CROSS = 44; // seconds to cross
const PUFFS = 260;
const EVERY = CROSS / (PUFFS / 2); // seconds between puffs, two engines each time
const LINGER = 26; // seconds a puff lasts

export default function Plane({ run, elevation }: SceneProps) {
  const plane = useRef<THREE.Group>(null);
  const trail = useRef<THREE.InstancedMesh>(null);
  const s = sign(run.side);
  const path = useMemo(() => {
    const r = seeded(run.seed);
    const dir = r() < 0.5 ? 1 : -1;
    return { dir, x: s * (290 + r() * 50), y: eyeAbove(elevation) + 70 + r() * 20, z0: -dir * 430, z1: dir * 430, livery: ['#e63946', '#1d3557', '#2a9d8f', '#f4a261'][Math.floor(r() * 4)] };
  }, [run.seed, s, elevation]);
  const scratch = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), v: new THREE.Vector3(), sc: new THREE.Vector3(), born: new Float32Array(PUFFS).fill(-1), pos: new Float32Array(PUFFS * 3), next: 0 }), []);

  useLayoutEffect(() => {
    const m = trail.current;
    if (!m) return;
    scratch.m.makeScale(0, 0, 0);
    for (let i = 0; i < PUFFS; i++) m.setMatrixAt(i, scratch.m);
    m.instanceMatrix.needsUpdate = true;
  }, [scratch]);

  const sound = useMemo(() => ({ jet: null as ReturnType<typeof loop> | null }), []);
  useEffect(() => {
    sound.jet = loop('jet');
    return () => sound.jet?.stop(1.5);
  }, [sound]);

  useFrame(() => {
    const t = run.t;
    const k = Math.min(1, t / CROSS);
    const z = lerp(path.z0, path.z1, k);
    const g = plane.current;
    if (g) {
      g.visible = t < CROSS;
      g.position.set(path.x, path.y, z);
      g.rotation.y = path.dir > 0 ? 0 : Math.PI;
    }
    // a pair of puffs every EVERY seconds while it flies, behind each engine
    const m = trail.current;
    if (!m) return;
    while (t < CROSS && scratch.next * EVERY <= t && scratch.next < PUFFS / 2) {
      const pz = lerp(path.z0, path.z1, Math.min(1, (scratch.next * EVERY) / CROSS)) - path.dir * 14;
      for (const side of [0, 1]) {
        const i = scratch.next * 2 + side;
        scratch.born[i] = scratch.next * EVERY;
        scratch.pos[i * 3] = path.x + (side ? 7 : -7);
        scratch.pos[i * 3 + 1] = path.y - 1;
        scratch.pos[i * 3 + 2] = pz;
      }
      scratch.next++;
    }
    for (let i = 0; i < PUFFS; i++) {
      const born = scratch.born[i];
      if (born < 0) continue;
      const age = t - born;
      // spreads as it ages, and thins away at the end
      const size = age > LINGER ? 0 : (2.2 + age * 0.25) * Math.min(1, (LINGER - age) / 6) * Math.min(1, age * 3 + 0.3);
      scratch.v.set(scratch.pos[i * 3], scratch.pos[i * 3 + 1] - age * 0.15, scratch.pos[i * 3 + 2]);
      scratch.sc.set(size, size * 0.8, size * 1.6);
      m.setMatrixAt(i, scratch.m.compose(scratch.v, scratch.q, scratch.sc));
    }
    m.instanceMatrix.needsUpdate = true;
    const heard = placeAt(path.x, path.y - elevation, z, 160);
    sound.jet?.set(heard.gain * inOut(t, CROSS, 6), heard.pan, 0.9 + 0.2 * (1 - k));
  });

  const white = toonOut('#f4f6fa');
  return (
    <group>
      <group ref={plane} scale={1.15}>
        {/* fuselage along +z (its nose), wings, tail */}
        <mesh material={white} rotation-x={Math.PI / 2}>
          <capsuleGeometry args={[2.1, 30, 6, 12]} />
        </mesh>
        {[-2.02, 2.02].map((x) => (
          <mesh key={x} material={toonOut('#2b3a55')} position={[x, 0.6, 1]}>
            <boxGeometry args={[0.12, 0.45, 22]} />
          </mesh>
        ))}
        <mesh material={white} position={[0, -0.6, -1]}>
          <boxGeometry args={[34, 0.5, 5]} />
        </mesh>
        <mesh material={toonOut(path.livery)} position={[0, 4.2, -14.5]}>
          <boxGeometry args={[0.6, 6.5, 4.5]} />
        </mesh>
        <mesh material={white} position={[0, 1, -15]}>
          <boxGeometry args={[12, 0.4, 3]} />
        </mesh>
        {[-7, 7].map((x) => (
          <mesh key={x} material={toonOut('#9aa3b5')} position={[x, -1.8, 0.8]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[1, 1, 4.5, 10]} />
          </mesh>
        ))}
      </group>
      <instancedMesh ref={trail} args={[undefined, undefined, PUFFS]} material={toonOut('#ffffff', { opacity: 0.85 })} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
      </instancedMesh>
    </group>
  );
}
