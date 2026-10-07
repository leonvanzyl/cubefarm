// Confetti over an agent's desk when their PR merges (over the Kanban board when nobody on the floor
// wrote it), and over the floor's gong when a merge strikes it (gongState.ts). One pooled InstancedMesh per
// floor: a few slots of flat paper bits, hidden and skipped entirely while no burst is flying. With reduced
// motion (Settings → Accessibility) a burst is a soft glow that swells and fades on the spot instead.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { RepoView } from '../../../shared/types';
import { coversView, useStore, type Agent } from '../store';
import { reduceMotion } from '../ui/a11y';
import { burstKind, onMerge } from './confetti';
import { markBloom } from './gfx/bloomMarks';
import { onGongParty } from './gongState';
import { BOARD, GONG, deskPosition } from './layout';
import { PIZZA_CONFETTI, ritualLook } from './ritualLook';
import { useThemeConfetti } from './themes/active';
import { heart } from './themes/kit/geo';

const SLOTS = 3; // bursts at once
const PIECES = 90; // per burst
const LIFE = 2.4; // seconds
const GRAVITY = 3.2;
const DRAG = 1.6;
const PALETTE = ['#ff5d8f', '#ffd23f', '#3bceac', '#3a86ff', '#ff8c42', '#9b5de5'];

interface Slot {
  key: string | null; // the desk (agent id), 'board' or 'gong' while flying, null when free
  age: number;
  glow: boolean; // a glow rather than confetti
}

interface Controller {
  active: () => number;
  glowing: () => number;
  burst: (agentId?: string) => void;
}

let controller: Controller | null = null;

// window.__swarmConfetti: for QA and Playwright. burst() goes over that agent's desk on this floor,
// over the gong for burst('gong'), or over the Kanban board; glowing() counts the reduced-motion glows among active().
if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmConfetti')) {
  Object.defineProperty(window, '__swarmConfetti', {
    value: { active: () => controller?.active() ?? 0, glowing: () => controller?.glowing() ?? 0, burst: (agentId?: string) => controller?.burst(agentId) },
    enumerable: false,
  });
}

const GLOW_SIZE = 3; // metres across

/** A soft round glow, white in the middle: tinted per floor by its sprite's colour. */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function MergeConfetti({ repo, agents }: { repo: RepoView; agents: Agent[] }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const glows = useRef<(THREE.Sprite | null)[]>([]);
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  // a holiday theme's colours (and Valentine's hearts) in place of the usual
  const themed = useThemeConfetti();

  // Everything the frame loop touches is allocated once here.
  const sim = useMemo(() => {
    const n = SLOTS * PIECES;
    return {
      slots: Array.from({ length: SLOTS }, (): Slot => ({ key: null, age: 0, glow: false })),
      pos: new Float32Array(n * 3),
      vel: new Float32Array(n * 3),
      rot: new Float32Array(n * 3),
      spin: new Float32Array(n * 3),
      phase: new Float32Array(n),
      dummy: new THREE.Object3D(),
      colors: (themed?.colors ?? [...PALETTE, repo.color]).map((c) => new THREE.Color(c)),
      pizza: PIZZA_CONFETTI.map((c) => new THREE.Color(c)),
      geometry: themed?.shape === 'heart' ? heart(0.1) : new THREE.PlaneGeometry(0.1, 0.06),
      material: markBloom(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false })),
      glowMaterials: Array.from(
        { length: SLOTS },
        () =>
          new THREE.SpriteMaterial({
            color: new THREE.Color(repo.color).lerp(new THREE.Color('#ffd166'), 0.7),
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          }),
      ),
    };
  }, [repo.color, themed]);
  const glowMap = useMemo(glowTexture, []);
  useLayoutEffect(() => {
    for (const m of sim.glowMaterials) m.map = glowMap;
  }, [sim, glowMap]);

  useEffect(
    () => () => {
      sim.geometry.dispose();
      sim.material.dispose();
      for (const m of sim.glowMaterials) m.dispose();
    },
    [sim],
  );
  useEffect(() => () => glowMap.dispose(), [glowMap]);

  // Hide every piece and create the colour attribute before the first draw, so the shader includes it.
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    sim.dummy.scale.setScalar(0);
    sim.dummy.updateMatrix();
    for (let i = 0; i < SLOTS * PIECES; i++) {
      m.setMatrixAt(i, sim.dummy.matrix);
      m.setColorAt(i, sim.colors[i % sim.colors.length]);
    }
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor!.needsUpdate = true;
    m.visible = false;
  }, [sim]);

  useEffect(() => {
    const active = () => sim.slots.filter((s) => s.key).length;
    const glowing = () => sim.slots.filter((s) => s.key && s.glow).length;

    const burst = (agentId?: string | null) => {
      const gong = agentId === 'gong';
      const m = mesh.current;
      const kind = burstKind({ hidden: document.hidden, covered: coversView(useStore.getState().overlay), reducedMotion: reduceMotion() });
      if (!m || !kind) return;
      const author = agentId ? agentsRef.current.find((a) => a.id === agentId && a.role !== 'ceo') : undefined;
      const key = author?.id ?? (gong ? 'gong' : 'board');
      if (sim.slots.some((s) => s.key === key)) return; // one per desk
      const s = sim.slots.findIndex((x) => !x.key);
      if (s < 0) return; // full: dropped, never queued
      const at = author ? { ...deskPosition(author.desk), y: 1.5 } : gong ? { x: GONG.x, z: GONG.z + 0.3, y: GONG.h + 0.1 } : { x: 0, z: BOARD.z + 1.2, y: BOARD.y + BOARD.h * 0.6 };
      if (kind === 'glow') {
        const g = glows.current[s];
        if (!g) return;
        sim.slots[s] = { key, age: 0, glow: true };
        g.position.set(at.x, at.y, at.z);
        g.scale.setScalar(GLOW_SIZE);
        sim.glowMaterials[s].opacity = 0;
        g.visible = true;
        return;
      }
      sim.slots[s] = { key, age: 0, glow: false };
      const colors = ritualLook.pizza ? sim.pizza : sim.colors; // Friday pizza: the party's in pizza colours
      for (let k = 0; k < PIECES; k++) {
        const i = s * PIECES + k;
        const a = Math.random() * Math.PI * 2;
        const out = 0.6 + Math.random() * 1.6;
        sim.pos.set([at.x + (Math.random() - 0.5) * 0.3, at.y, at.z + (Math.random() - 0.5) * 0.3], i * 3);
        // the gong stands against the north wall: its burst goes out into the room, not through the wall
        sim.vel.set([Math.cos(a) * out, 2.6 + Math.random() * 2.2, gong ? Math.abs(Math.sin(a)) * out + 0.2 : Math.sin(a) * out], i * 3);
        sim.rot.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
        sim.spin.set([(Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14], i * 3);
        sim.phase[i] = Math.random() * Math.PI * 2;
        m.setColorAt(i, colors[Math.floor(Math.random() * colors.length)]);
      }
      m.instanceColor!.needsUpdate = true;
      m.visible = true;
    };

    // A panel that covers the view stops the frame loop: drop bursts in the air rather than finish them later.
    const unsub = useStore.subscribe((s) => {
      const m = mesh.current;
      if (!m || !coversView(s.overlay) || !sim.slots.some((x) => x.key)) return;
      for (const g of glows.current) if (g) g.visible = false;
      sim.dummy.scale.setScalar(0);
      sim.dummy.updateMatrix();
      for (let i = 0; i < SLOTS * PIECES; i++) m.setMatrixAt(i, sim.dummy.matrix);
      m.instanceMatrix.needsUpdate = true;
      for (const slot of sim.slots) slot.key = null;
      m.visible = false;
    });

    const off = onMerge((b) => {
      if (b.repoId === repo.id) burst(b.agentId);
    });
    const offGong = onGongParty((repoId) => {
      if (repoId === repo.id) burst('gong');
    });
    controller = { active, glowing, burst };
    return () => {
      off();
      offGong();
      unsub();
      if (controller?.burst === burst) controller = null;
    };
  }, [sim, repo.id]);

  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m) return;
    const dt = Math.min(delta, 0.05);
    const { slots, pos, vel, rot, spin, phase, dummy } = sim;
    // the glows swell in and fade out on the spot: nothing moves
    for (let s = 0; s < SLOTS; s++) {
      const slot = slots[s];
      if (!slot.key || !slot.glow) continue;
      slot.age += dt;
      const g = glows.current[s];
      if (slot.age >= LIFE || !g) {
        slot.key = null;
        if (g) g.visible = false;
        continue;
      }
      sim.glowMaterials[s].opacity = Math.sin((Math.PI * slot.age) / LIFE);
    }
    if (!m.visible) return;
    let flying = 0;
    for (let s = 0; s < SLOTS; s++) {
      const slot = slots[s];
      if (!slot.key || slot.glow) continue;
      slot.age += dt;
      const done = slot.age >= LIFE;
      // Full size for the first 60% of the flight, then shrink away.
      const size = done ? 0 : Math.min(1, (LIFE - slot.age) / (LIFE * 0.4));
      for (let k = 0; k < PIECES; k++) {
        const i = s * PIECES + k;
        const j = i * 3;
        if (!done) {
          const drag = Math.exp(-DRAG * dt);
          vel[j] *= drag;
          vel[j + 2] *= drag;
          vel[j + 1] = Math.max(vel[j + 1] * drag - GRAVITY * dt, -0.9); // paper falls slowly
          const flutter = Math.sin(slot.age * 7 + phase[i]) * 0.5;
          pos[j] += (vel[j] + flutter) * dt;
          pos[j + 1] += vel[j + 1] * dt;
          pos[j + 2] += (vel[j + 2] + flutter * 0.6) * dt;
          rot[j] += spin[j] * dt;
          rot[j + 1] += spin[j + 1] * dt;
          rot[j + 2] += spin[j + 2] * dt;
        }
        dummy.position.set(pos[j], pos[j + 1], pos[j + 2]);
        dummy.rotation.set(rot[j], rot[j + 1], rot[j + 2]);
        dummy.scale.setScalar(size);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      }
      if (done) slot.key = null;
      else flying++;
    }
    m.instanceMatrix.needsUpdate = true;
    if (!flying) m.visible = false;
  });

  return (
    <>
      <instancedMesh ref={mesh} args={[sim.geometry, sim.material, SLOTS * PIECES]} frustumCulled={false} />
      {sim.glowMaterials.map((mat, i) => (
        <sprite
          key={i}
          ref={(g) => {
            glows.current[i] = g;
          }}
          material={mat}
          visible={false}
          renderOrder={2}
        />
      ))}
    </>
  );
}
