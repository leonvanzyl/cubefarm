import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Outlines } from '@react-three/drei';
import { BallCollider, CuboidCollider, RigidBody, useAfterPhysicsStep } from '@react-three/rapier';
import type { World } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { repoOnFloor, useStore } from '../../store';
import { swish } from '../../ui/sfx';
import { roundRect, SANS } from '../draw';
import { useCanvasTexture } from '../interact';
import { HALF_D } from '../layout';
import { toon } from '../materials';
import type { ToyFloor } from './balls';
import { HOOP, HOOP_X, RIM_OUT, hoopColliders, hoopRim, newTrack, stepHoop, type HoopTrack } from './hoopScore';
import { setHoopSource, type HoopScore } from './probe';

// The basketball hoop on the south wall of every floor: backboard, rim and net, physics colliders for the board
// and rim, basket detection, and the scoreboard above it. Part of the lazily loaded toy world (ToyWorld.tsx).
// Local coordinates start at the foot of the wall, with -z pointing out into the room (north).

const INK = '#1f1d2b';
const RIM_COLOR = '#ff7b00';
const SQUARE_COLOR = '#e63946';

// ---------- scores ----------

const BEST_KEY = 'cubefarm:hoop-best';

/** Baskets this session, per floor, so a trip in the elevator doesn't wipe the scoreboard. */
const sessionScores = new Map<string, number>();

function readBests(): Record<string, unknown> {
  try {
    const all: unknown = JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}');
    return all && typeof all === 'object' ? (all as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function loadBest(floorKey: string) {
  const n = Number(readBests()[floorKey]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function saveBest(floorKey: string, best: number) {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify({ ...readBests(), [floorKey]: best }));
  } catch {
    // storage may be unavailable (private mode); the best just won't be remembered
  }
}

function drawScoreboard(ctx: CanvasRenderingContext2D, w: number, h: number, { score, best }: HoopScore) {
  roundRect(ctx, 0, 0, w, h, 22);
  ctx.fillStyle = '#15151f';
  ctx.fill();
  const text = `Score ${score} · Best ${best}`;
  let size = 88;
  ctx.font = `700 ${size}px ${SANS}`;
  while (size > 30 && ctx.measureText(text).width > w - 48) {
    size -= 4;
    ctx.font = `700 ${size}px ${SANS}`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffd166';
  ctx.fillText(text, w / 2, h / 2 + 4);
  ctx.textAlign = 'left';
}

// ---------- looks ----------

/** The basketball: orange with black seams. Used by balls.tsx for the pick-up-able ball. */
export function BasketballLook({ r }: { r: number }) {
  const seam = toon(INK);
  const tube = r * 0.05;
  return (
    <group>
      <mesh castShadow material={toon('#f3722c')}>
        <sphereGeometry args={[r, 24, 16]} />
        <Outlines thickness={0.012} color={INK} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} material={seam}>
        <torusGeometry args={[r * 1.004, tube, 6, 40]} />
      </mesh>
      <mesh material={seam}>
        <torusGeometry args={[r * 1.004, tube, 6, 40]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * r * 0.6, 0, 0]} rotation={[0, Math.PI / 2, 0]} material={seam}>
          <torusGeometry args={[r * 0.8 * 1.006, tube, 6, 32]} />
        </mesh>
      ))}
    </group>
  );
}

let netMat: THREE.MeshBasicMaterial | null = null;
/** A white diamond mesh on a transparent canvas, wrapped round an open cone. */
function netMaterial() {
  if (netMat) return netMat;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(64, 64);
  ctx.moveTo(64, 0);
  ctx.lineTo(0, 64);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 3);
  netMat = new THREE.MeshBasicMaterial({ map: tex, color: '#f1f3f5', alphaTest: 0.5, side: THREE.DoubleSide });
  return netMat;
}

/** Seconds since the last basket (from performance.now()), or Infinity before the first. */
const since = (burst: RefObject<number>) => (burst.current < 0 ? Infinity : (performance.now() - burst.current) / 1000);

/** The net hangs from the rim and stretches and sways after a basket. */
function Net({ burst }: { burst: RefObject<number> }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => {
    const grp = g.current;
    if (!grp) return;
    const t = since(burst);
    if (t > 2.5) {
      if (grp.scale.y !== 1) {
        grp.scale.set(1, 1, 1);
        grp.rotation.set(0, 0, 0);
      }
      return;
    }
    const s = Math.exp(-3 * t);
    const pull = Math.sin(t * 12) * s;
    grp.scale.set(1 - 0.16 * pull, 1 + 0.4 * pull, 1 - 0.16 * pull);
    grp.rotation.set(0.2 * s * Math.sin(t * 9), 0, 0.12 * s * Math.sin(t * 7));
  });
  const { h, bottomR } = HOOP.net;
  return (
    <group ref={g} position={[0, HOOP.rim.y, -RIM_OUT]}>
      <mesh position={[0, -h / 2, 0]} material={netMaterial()}>
        <cylinderGeometry args={[HOOP.rim.r, bottomR, h, 24, 1, true]} />
      </mesh>
    </group>
  );
}

const CONFETTI = 42;
const CONFETTI_S = 1.8;
const CONFETTI_COLORS = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#ff9f1c', '#9b5de5'];

/** A small burst of paper bits from the rim after a basket. */
function Confetti({ burst }: { burst: RefObject<number> }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const bits = useMemo(() => Array.from({ length: CONFETTI }, () => ({ v: new THREE.Vector3(), spin: new THREE.Vector3() })), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const started = useRef(-1);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const c = new THREE.Color();
    for (let i = 0; i < CONFETTI; i++) m.setColorAt(i, c.set(CONFETTI_COLORS[i % CONFETTI_COLORS.length]));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, []);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const t = since(burst);
    if (t > CONFETTI_S) {
      if (m.visible) m.visible = false;
      return;
    }
    if (started.current !== burst.current) {
      started.current = burst.current;
      for (const b of bits) {
        const a = Math.random() * Math.PI * 2;
        const out = 0.6 + Math.random() * 1.6;
        b.v.set(Math.cos(a) * out, 1.2 + Math.random() * 2, Math.sin(a) * out - 0.8);
        b.spin.set(Math.random() * 12, Math.random() * 12, Math.random() * 12);
      }
    }
    m.visible = true;
    const fade = Math.min(1, (CONFETTI_S - t) / 0.4);
    for (let i = 0; i < CONFETTI; i++) {
      const b = bits[i];
      // paper drifts, so a light gravity and no bounce; stop at the floor
      dummy.position.set(b.v.x * t, Math.max(0.02 - HOOP.rim.y, b.v.y * t - 2.2 * t * t), b.v.z * t);
      dummy.rotation.set(b.spin.x * t, b.spin.y * t, b.spin.z * t);
      dummy.scale.setScalar(fade);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, CONFETTI]} position={[0, HOOP.rim.y - 0.05, -RIM_OUT]} visible={false} frustumCulled={false}>
      <planeGeometry args={[0.06, 0.035]} />
      <meshBasicMaterial side={THREE.DoubleSide} toneMapped={false} />
    </instancedMesh>
  );
}

function Scoreboard({ tally }: { tally: HoopScore }) {
  const { w, h, bottom } = HOOP.score;
  const tex = useCanvasTexture(640, 186, (ctx) => drawScoreboard(ctx, 640, 186, tally), [tally.score, tally.best]);
  return (
    <group position={[0, bottom + h / 2, -(HOOP.standoff + HOOP.board.t / 2)]}>
      <mesh material={toon('#2b2d42')}>
        <boxGeometry args={[w, h, 0.06]} />
        <Outlines thickness={0.015} color={INK} />
      </mesh>
      <mesh position={[0, 0, -0.031]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[w - 0.05, h - 0.05]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

const Board = memo(function Board() {
  const { standoff, board, square, rim } = HOOP;
  const face = -(standoff + board.t) - 0.003;
  const bar = 0.035;
  const sq = { cy: rim.y + square.h / 2, w: square.w, h: square.h };
  return (
    <group>
      {/* wall brackets */}
      {[-0.4, 0.4].flatMap((x) =>
        [2.72, 3.05].map((y) => (
          <mesh key={`${x}${y}`} position={[x, y, -standoff / 2]} material={toon('#8d99ae')}>
            <boxGeometry args={[0.05, 0.05, standoff]} />
          </mesh>
        )),
      )}
      <mesh position={[0, board.bottom + board.h / 2, -(standoff + board.t / 2)]} material={toon('#fdfdfd')} castShadow>
        <boxGeometry args={[board.w, board.h, board.t]} />
        <Outlines thickness={0.015} color={INK} />
      </mesh>
      {/* painted border and target square */}
      {[
        [0, board.bottom + board.h - bar / 2, board.w - 0.04, bar],
        [0, board.bottom + bar / 2, board.w - 0.04, bar],
        [-(board.w / 2 - 0.02 - bar / 2), board.bottom + board.h / 2, bar, board.h - 0.04],
        [board.w / 2 - 0.02 - bar / 2, board.bottom + board.h / 2, bar, board.h - 0.04],
        [0, sq.cy + sq.h / 2 - bar / 2, sq.w, bar],
        [0, sq.cy - sq.h / 2 + bar / 2, sq.w, bar],
        [-(sq.w / 2 - bar / 2), sq.cy, bar, sq.h],
        [sq.w / 2 - bar / 2, sq.cy, bar, sq.h],
      ].map(([x, y, w, h], i) => (
        <mesh key={i} position={[x, y, face]} material={toon(SQUARE_COLOR)}>
          <boxGeometry args={[w, h, 0.004]} />
        </mesh>
      ))}
      {/* the rim and the plate holding it to the board */}
      <mesh position={[0, rim.y, -(standoff + board.t + rim.gap / 2)]} material={toon(RIM_COLOR)}>
        <boxGeometry args={[0.14, 0.025, rim.gap + 0.02]} />
      </mesh>
      <mesh position={[0, rim.y, -RIM_OUT]} rotation={[Math.PI / 2, 0, 0]} material={toon(RIM_COLOR)} castShadow>
        <torusGeometry args={[rim.r, rim.tube, 8, 40]} />
        <Outlines thickness={0.008} color={INK} />
      </mesh>
    </group>
  );
});

// ---------- physics ----------

/** The hoop's fixed colliders (hoopColliders), so balls bounce off the board and rim. */
const HoopColliders = memo(function HoopColliders({ groups }: { groups: number }) {
  const parts = useMemo(hoopColliders, []);
  return parts.map((c, i) =>
    c.box ? (
      <CuboidCollider key={i} args={c.box} position={c.at} restitution={c.restitution} friction={c.friction} collisionGroups={groups} />
    ) : (
      <BallCollider key={i} args={[c.ball ?? 0]} position={c.at} restitution={c.restitution} friction={c.friction} collisionGroups={groups} />
    ),
  );
});

/** The hoop for one floor. `groups` are the building's collision groups, so balls (held or loose) bounce off it. */
export const Hoop = memo(function Hoop({ floor, groups }: { floor: ToyFloor; groups: number }) {
  const rim = useMemo(() => hoopRim(floor), [floor]);
  // Office floors keep their best per repo, so it stays with the team even if the floors get renumbered.
  const floorKey = useMemo(() => {
    const s = useStore.getState();
    return floor === 'lobby' ? 'lobby' : (repoOnFloor(s.repos, s.floor)?.id ?? `floor-${s.floor}`);
  }, [floor]);
  const [tally, setTally] = useState<HoopScore>(() => ({ score: sessionScores.get(floorKey) ?? 0, best: loadBest(floorKey) }));
  const live = useRef(tally);
  const burst = useRef(-1);

  useEffect(() => {
    setHoopSource(() => ({ ...live.current }));
    return () => setHoopSource(null);
  }, []);

  const basket = useCallback(() => {
    const prev = live.current;
    const next = { score: prev.score + 1, best: Math.max(prev.best, prev.score + 1) };
    live.current = next;
    sessionScores.set(floorKey, next.score);
    if (next.best > prev.best) saveBest(floorKey, next.best);
    setTally(next);
    burst.current = performance.now();
    swish();
  }, [floorKey]);

  // Basket detection: follow each awake basketball's centre from step to step.
  const tracks = useRef(new Map<number, HoopTrack>());
  const watch = useCallback(
    (world: World) => {
      world.bodies.forEach((b) => {
        if ((b.userData as { toy?: string } | undefined)?.toy !== 'basketball' || b.isSleeping()) return;
        let t = tracks.current.get(b.handle);
        if (!t) tracks.current.set(b.handle, (t = newTrack()));
        if (stepHoop(t, b.translation(), rim)) basket();
      });
    },
    [basket, rim],
  );
  useAfterPhysicsStep(watch);

  const at: [number, number, number] = [HOOP_X[floor], 0, HALF_D];
  return (
    <>
      <RigidBody type="fixed" colliders={false} position={at}>
        <HoopColliders groups={groups} />
      </RigidBody>
      <group position={at}>
        <Board />
        <Net burst={burst} />
        <Confetti burst={burst} />
        <Scoreboard tally={tally} />
      </group>
    </>
  );
});
