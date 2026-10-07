// A merge's coins (#210): a little fountain of gold coins over the author's desk, just above the merge confetti (over
// the whiteboard when nobody on the floor wrote it), with a pling. One pooled InstancedMesh per floor, hidden and
// skipped while nothing flies.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { RepoView } from '../../../../shared/types';
import { coversView, useStore, type Agent } from '../../store';
import { reduceMotion } from '../../ui/a11y';
import { canBurst } from '../confetti';
import { BOARD, deskPosition } from '../layout';
import { toon } from '../materials';
import { pling } from './actions';
import { onReward } from './rewards';

const SLOTS = 2;
const COINS = 16;
const LIFE = 1.9;
const GRAVITY = 5.5;
const DELAY_MS = 250; // after the confetti has popped

let flying = 0;
let burstHere: ((agentId: string | null) => void) | null = null;
// window.__swarmCoins, for QA: bursts in the air right now, and burst(agentId?) one over that desk on this floor (no coins).
if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmCoins')) {
  Object.defineProperty(window, '__swarmCoins', { value: { active: () => flying, burst: (agentId?: string) => burstHere?.(agentId ?? null) }, enumerable: false });
}

export function CoinBurst({ repo, agents }: { repo: RepoView; agents: Agent[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const sim = useMemo(
    () => ({
      age: Array.from({ length: SLOTS }, () => -1),
      pos: new Float32Array(SLOTS * COINS * 3),
      vel: new Float32Array(SLOTS * COINS * 3),
      spin: new Float32Array(SLOTS * COINS),
      dummy: new THREE.Object3D(),
      geometry: new THREE.CylinderGeometry(0.075, 0.075, 0.016, 16).rotateX(Math.PI / 2),
    }),
    [],
  );
  useEffect(() => () => sim.geometry.dispose(), [sim]);

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    sim.dummy.scale.setScalar(0);
    sim.dummy.updateMatrix();
    for (let i = 0; i < SLOTS * COINS; i++) m.setMatrixAt(i, sim.dummy.matrix);
    m.instanceMatrix.needsUpdate = true;
    m.visible = false;
  }, [sim]);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const burst = (agentId: string | null) => {
      const a = agentId ? agentsRef.current.find((x) => x.id === agentId) : undefined;
      const desk = a && a.role !== 'ceo' ? deskPosition(a.desk) : null;
      const at = desk ? { x: desk.x, y: 2.1, z: desk.z } : { x: 0, y: BOARD.y + BOARD.h + 0.2, z: BOARD.z + 1.2 };
      timers.push(
        setTimeout(() => {
          pling({ x: at.x, y: at.y, z: at.z });
          const m = mesh.current;
          if (!m || !canBurst({ hidden: document.hidden, covered: coversView(useStore.getState().overlay), reducedMotion: reduceMotion() })) return;
          const s = sim.age.findIndex((x) => x < 0);
          if (s < 0) return;
          sim.age[s] = 0;
          for (let k = 0; k < COINS; k++) {
            const i = s * COINS + k;
            const ang = (k / COINS) * Math.PI * 2 + Math.random() * 0.4;
            const out = 0.5 + Math.random() * 0.9;
            sim.pos.set([at.x, at.y, at.z], i * 3);
            sim.vel.set([Math.cos(ang) * out, 2.4 + Math.random() * 1.6, Math.sin(ang) * out], i * 3);
            sim.spin[i] = 6 + Math.random() * 8;
          }
          m.visible = true;
        }, DELAY_MS),
      );
    };
    const off = onReward((r) => {
      if (r.repoId === repo.id) burst(r.agentId);
    });
    burstHere = burst;
    return () => {
      off();
      if (burstHere === burst) burstHere = null;
      timers.forEach(clearTimeout);
    };
  }, [repo.id, sim]);

  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m || !m.visible) return;
    const dt = Math.min(delta, 0.05);
    let live = 0;
    for (let s = 0; s < SLOTS; s++) {
      if (sim.age[s] < 0) continue;
      sim.age[s] += dt;
      const done = sim.age[s] >= LIFE;
      const size = done ? 0 : Math.min(1, (LIFE - sim.age[s]) / (LIFE * 0.35));
      for (let k = 0; k < COINS; k++) {
        const i = s * COINS + k;
        const j = i * 3;
        sim.vel[j + 1] -= GRAVITY * dt;
        sim.pos[j] += sim.vel[j] * dt;
        sim.pos[j + 1] += sim.vel[j + 1] * dt;
        sim.pos[j + 2] += sim.vel[j + 2] * dt;
        sim.dummy.position.set(sim.pos[j], sim.pos[j + 1], sim.pos[j + 2]);
        sim.dummy.rotation.set(0, sim.age[s] * sim.spin[i], 0.3);
        sim.dummy.scale.setScalar(size);
        sim.dummy.updateMatrix();
        m.setMatrixAt(i, sim.dummy.matrix);
      }
      if (done) sim.age[s] = -1;
      else live++;
    }
    flying = live;
    m.instanceMatrix.needsUpdate = true;
    if (!live) m.visible = false;
  });

  return <instancedMesh ref={mesh} args={[sim.geometry, toon('#ffd43b', { emissive: '#7a5a00', emissiveIntensity: 0.6 }), SLOTS * COINS]} frustumCulled={false} />;
}
