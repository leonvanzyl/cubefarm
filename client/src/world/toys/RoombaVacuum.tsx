import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useBeforePhysicsStep } from '@react-three/rapier';
import * as THREE from 'three';
import { slurp } from '../../ui/sfx';
import { toon } from '../materials';
import { floorDarts, removeDart } from './darts';
import { ROOMBA, type Roomba } from './roombaBrain';
import { PICKUP, countVacuumed, toVacuum } from './vacuum';

// The roomba vacuuming foam darts off the floor: a few times a second the darts it's over are taken out of the
// physics world at once, and a stand-in for each shrinks into the roomba with a slurp.

const SLOTS = 8; // darts shrinking at the same time; more than this and the oldest vanishes early
const MOUTH_Y = 0.05;

interface Ghost {
  from: THREE.Vector3;
  q: THREE.Quaternion;
  color: string;
  since: number;
}

export function Vacuum({ brain }: { brain: Roomba }) {
  const tick = useRef(0);
  const ghosts = useRef<Ghost[]>([]);
  const slots = useRef<(THREE.Group | null)[]>([]);
  const foam = useRef<(THREE.Mesh | null)[]>([]);
  const geo = useMemo(
    () => ({
      foam: new THREE.CylinderGeometry(0.026, 0.026, 0.15, 8),
      tip: new THREE.CylinderGeometry(0.035, 0.026, 0.03, 10).translate(0, 0.09, 0),
    }),
    [],
  );
  useEffect(
    () => () => {
      geo.foam.dispose();
      geo.tip.dispose();
    },
    [geo],
  );

  useBeforePhysicsStep(() => {
    if (++tick.current % 4) return;
    const picked = toVacuum(brain.state, brain.x, brain.z, floorDarts(), ROOMBA.r);
    let got = 0;
    for (const d of picked) {
      if (!removeDart(d.id)) continue;
      got++;
      ghosts.current.push({ from: new THREE.Vector3(d.x, d.y, d.z), q: new THREE.Quaternion(d.q.x, d.q.y, d.q.z, d.q.w), color: d.color, since: performance.now() });
    }
    if (!got) return;
    countVacuumed(got);
    if (ghosts.current.length > SLOTS) ghosts.current.splice(0, ghosts.current.length - SLOTS);
    slurp({ x: brain.x, y: MOUTH_Y, z: brain.z });
  });

  const mouth = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const now = performance.now();
    ghosts.current = ghosts.current.filter((g) => now - g.since < PICKUP.animMs);
    mouth.set(brain.x, MOUTH_Y, brain.z);
    for (let i = 0; i < SLOTS; i++) {
      const s = slots.current[i];
      if (!s) continue;
      const g = ghosts.current[i];
      s.visible = !!g;
      if (!g) continue;
      const t = (now - g.since) / PICKUP.animMs;
      s.position.lerpVectors(g.from, mouth, t * t);
      s.quaternion.copy(g.q);
      s.scale.setScalar(Math.max(0.01, 1 - t));
      const m = foam.current[i];
      if (m) m.material = toon(g.color);
    }
  });

  return Array.from({ length: SLOTS }, (_, i) => (
    <group key={i} ref={(g) => void (slots.current[i] = g)} visible={false}>
      <mesh ref={(m) => void (foam.current[i] = m)} geometry={geo.foam} material={toon('#ffffff')} />
      <mesh geometry={geo.tip} material={toon('#ffd166')} />
    </group>
  ));
}
