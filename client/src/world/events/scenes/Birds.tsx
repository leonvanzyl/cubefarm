import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { loop, placeAt, play } from '../../../ui/eventSfx';
import { BALCONY_OUT } from '../../layout';
import { seeded } from '../director';
import { eyeAbove, inOut, lerp, sign, toonOut, type SceneProps } from '../kit';

// A flock of birds sweeping past the windows, just beyond the balconies at your floor's height: each bird keeps its own
// place in the loose flock, wobbling and flapping out of step, the whole flock swooping as it goes. Three instanced
// meshes (bodies and each side's wings), the wingbeats and the odd chirp.

const BIRDS = 26;
const ONE = new THREE.Vector3(1, 1, 1);
const CROSS = 22;

export default function Birds({ run, elevation }: SceneProps) {
  const bodies = useRef<THREE.InstancedMesh>(null);
  const left = useRef<THREE.InstancedMesh>(null);
  const right = useRef<THREE.InstancedMesh>(null);
  const s = sign(run.side);
  const flock = useMemo(() => {
    const r = seeded(run.seed);
    const dir = r() < 0.5 ? 1 : -1;
    const birds = Array.from({ length: BIRDS }, () => ({ dx: (r() - 0.5) * 5, dy: (r() - 0.5) * 3.5, dz: (r() - 0.5) * 11, phase: r() * 6.28, rate: 10 + r() * 4, wob: r() * 6.28 }));
    return { dir, x: s * (BALCONY_OUT + 7 + r() * 5), y: eyeAbove(elevation) + 1 + r() * 2.5, birds };
  }, [run.seed, s, elevation]);
  const m = useMemo(() => ({ body: new THREE.Matrix4(), wing: new THREE.Matrix4(), tmp: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), p: new THREE.Vector3(), shape: new THREE.Vector3(1, 0.85, 1.8), chirpAt: 1 }), []);
  const sound = useMemo(() => ({ flap: null as ReturnType<typeof loop> | null }), []);
  useEffect(() => {
    sound.flap = loop('flap');
    return () => sound.flap?.stop(0.6);
  }, [sound]);

  useFrame(() => {
    const t = run.t;
    const b = bodies.current;
    const l = left.current;
    const rr = right.current;
    if (!b || !l || !rr) return;
    const k = Math.min(1, t / CROSS);
    const cz = lerp(-flock.dir * 95, flock.dir * 95, k);
    // a swoop down and up as they pass, drifting in towards the glass and back out
    const cy = flock.y + Math.sin(k * Math.PI * 2) * 2.5;
    const cx = flock.x - s * Math.sin(k * Math.PI) * 3;
    const heading = flock.dir > 0 ? 0 : Math.PI;
    for (let i = 0; i < BIRDS; i++) {
      const bird = flock.birds[i];
      const wob = Math.sin(t * 1.7 + bird.wob);
      m.p.set(cx + bird.dx + wob * 0.6, cy + bird.dy + Math.sin(t * 2.3 + bird.wob) * 0.5, cz + bird.dz);
      m.e.set(0.08 * wob, heading + 0.15 * wob, 0.2 * wob);
      m.q.setFromEuler(m.e);
      m.body.compose(m.p, m.q, m.shape);
      b.setMatrixAt(i, m.body);
      m.body.compose(m.p, m.q, ONE);
      const flap = 0.15 + Math.sin(t * bird.rate + bird.phase) * 0.55;
      // each wing: hinged at the body, out to its side
      m.wing.makeRotationZ(-flap).premultiply(m.body);
      l.setMatrixAt(i, m.wing.multiply(m.tmp.makeTranslation(-0.26, 0, 0)));
      m.wing.makeRotationZ(flap).premultiply(m.body);
      rr.setMatrixAt(i, m.wing.multiply(m.tmp.makeTranslation(0.26, 0, 0)));
    }
    b.instanceMatrix.needsUpdate = true;
    l.instanceMatrix.needsUpdate = true;
    rr.instanceMatrix.needsUpdate = true;
    const heard = placeAt(cx, cy - elevation, cz, 25);
    const fade = inOut(t, CROSS + 2, 2);
    sound.flap?.set(heard.gain * fade, heard.pan);
    if (t >= m.chirpAt && t < CROSS) {
      m.chirpAt = t + 0.7 + Math.random() * 1.6;
      play('chirps', { gain: heard.gain * fade, pan: heard.pan + (Math.random() - 0.5) * 0.4 });
    }
  });

  const ink = toonOut('#3d405b');
  return (
    <group>
      <instancedMesh ref={bodies} args={[undefined, undefined, BIRDS]} material={ink} frustumCulled={false}>
        <sphereGeometry args={[0.1, 8, 6]} />
      </instancedMesh>
      <instancedMesh ref={left} args={[undefined, undefined, BIRDS]} material={ink} frustumCulled={false}>
        <boxGeometry args={[0.48, 0.015, 0.16]} />
      </instancedMesh>
      <instancedMesh ref={right} args={[undefined, undefined, BIRDS]} material={ink} frustumCulled={false}>
        <boxGeometry args={[0.48, 0.015, 0.16]} />
      </instancedMesh>
    </group>
  );
}
