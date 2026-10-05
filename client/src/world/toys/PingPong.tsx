import { memo, useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { BallCollider, CuboidCollider, RigidBody, useAfterPhysicsStep, useBeforePhysicsStep, type RapierRigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { api } from '../../api';
import { repoOnFloor, useStore } from '../../store';
import { pongTableRect } from '../layout';
import { PaddleLook } from '../PongTable';
import { toon } from '../materials';
import { bodyState, say } from '../people';
import { useInteractable } from '../interact';
import { dirOf, netBox, PONG, TABLE, type End } from './pongPhysics';
import { PongRunner } from './pongRunner';
import { paddle, paddleAt, playerEnd, resetPong, setPongLive } from './pongState';

// The ping-pong table's physics and play, in the lazily loaded toy world (ToyWorld.tsx): the table top and net
// colliders, the ball (a Rapier body the match runner, pongRunner.ts, steps), the player's paddle, the two ends you
// press E at, and the live half of window.__swarmPong. The table itself is drawn with the floor (PongTable.tsx), so
// it stands there even before the toys load. The ball passes through the table top in Rapier (its collision groups):
// the runner bounces it there itself, exactly as its forecasts do.

const R = PONG.ball.r;
const TRAIL = 14;

/** The table top and the net: the table stops everything but the ping-pong ball, the net stops that too. */
const Colliders = memo(function Colliders({ table, net }: { table: number; net: number }) {
  const t = pongTableRect();
  const h = t.h ?? TABLE.top;
  const n = netBox();
  return (
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider args={[(t.maxX - t.minX) / 2, h / 2, (t.maxZ - t.minZ) / 2]} position={[(t.minX + t.maxX) / 2, h / 2, (t.minZ + t.maxZ) / 2]} friction={0.6} restitution={0.5} collisionGroups={table} />
      <CuboidCollider args={n.half} position={n.at} friction={PONG.netBody.friction} restitution={PONG.netBody.restitution} collisionGroups={net} />
    </RigidBody>
  );
});

/** One end of the table, to press E at: a roomy invisible box over the end, while you aren't playing. */
function TableEnd({ end }: { end: End }) {
  const playing = useStore((s) => s.held?.kind === 'paddle');
  const ref = useInteractable<THREE.Mesh>(playing ? null : { id: `pong:${end}`, label: 'Play ping-pong', action: { kind: 'pong', end } }, 3.2);
  const x = TABLE.x - dirOf(end) * (TABLE.len / 2 - 0.35);
  return (
    <mesh ref={ref} position={[x, TABLE.top + 0.1, TABLE.z]}>
      <boxGeometry args={[0.8, 0.3, TABLE.wid + 0.2]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

/** The player's paddle, where the mouse puts it: red rubber facing the net, tipped by how it's swinging. */
function PlayerPaddle() {
  const g = useRef<THREE.Group>(null);
  useFrame(() => {
    const grp = g.current;
    const end = playerEnd();
    if (!grp) return;
    grp.visible = end !== null;
    if (!end) return;
    const p = paddleAt(end);
    grp.position.set(p.x, p.y, p.z);
    // red side to you, the other down the table; forward swings close the face (topspin), backward ones open it
    grp.rotation.set(Math.max(-0.6, Math.min(0.6, paddle.vBack * 0.12)), end === 'west' ? Math.PI / 2 : -Math.PI / 2, Math.max(-0.4, Math.min(0.4, paddle.vLat * 0.06)), 'YXZ');
  });
  return (
    <group ref={g} visible={false}>
      <PaddleLook />
    </group>
  );
}

/** The ball: orange with a white band, so its spin shows. Hidden while it's out of play. */
function BallLook({ live }: { live: () => boolean }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => {
    if (g.current) g.current.visible = live();
  });
  return (
    <group ref={g} visible={false}>
      <mesh material={toon('#ff9f1c')} castShadow>
        <sphereGeometry args={[R, 16, 12]} />
      </mesh>
      <mesh material={toon('#fff8e7')} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[R * 1.01, R * 0.18, 6, 20]} />
      </mesh>
    </group>
  );
}

/** A faint trail behind the ball in play, so a curving shot shows its curve. */
function Trail({ body, live }: { body: RefObject<RapierRigidBody | null>; live: () => boolean }) {
  const line = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.5 }));
    l.frustumCulled = false;
    l.visible = false;
    return l;
  }, []);
  const filled = useRef(false);
  useEffect(() => () => line.geometry.dispose(), [line]);
  useFrame(() => {
    const b = body.current;
    if (!b || !live() || b.linvel().y === 0) {
      line.visible = false;
      filled.current = false;
      return;
    }
    const p = b.translation();
    const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    if (!filled.current) for (let i = 0; i < TRAIL; i++) a.set([p.x, p.y, p.z], i * 3);
    a.copyWithin(3, 0, (TRAIL - 1) * 3);
    a[0] = p.x;
    a[1] = p.y;
    a[2] = p.z;
    filled.current = true;
    pos.needsUpdate = true;
    line.visible = true;
  });
  return <primitive object={line} />;
}

/** Ping-pong on this floor: the table's colliders, the ball and the match. `groups`: the collision groups (ToyWorld.tsx). */
export const PingPong = memo(function PingPong({ groups }: { groups: { table: number; net: number; ball: number } }) {
  const body = useRef<RapierRigidBody>(null);
  const runner = useRef<PongRunner | null>(null);
  const live = useMemo(() => () => !!runner.current && !runner.current.hidden, []);

  useEffect(() => {
    const b = body.current;
    if (!b) return;
    const r = new PongRunner(b, {
      bodyAt: (id) => {
        const s = bodyState(id);
        return s ? { x: s.x, z: s.z } : null;
      },
      report: (result) => {
        // a game two agents played is everyone's to watch, but only one tab should record it
        if (document.hidden) return;
        const s = useStore.getState();
        const repo = repoOnFloor(s.repos, s.floor);
        if (repo) void api.pongResult(repo.id, result).catch(() => undefined);
      },
      say,
      sounds: true,
    });
    runner.current = r;
    setPongLive(r);
    return () => {
      setPongLive(null);
      r.stop();
      runner.current = null;
      resetPong(); // leaving the floor: nobody plays here any more
    };
  }, []);

  useBeforePhysicsStep(() => runner.current?.before());
  useAfterPhysicsStep(() => runner.current?.after());

  return (
    <>
      <Colliders table={groups.table} net={groups.net} />
      <TableEnd end="west" />
      <TableEnd end="east" />
      <RigidBody ref={body} colliders={false} position={[TABLE.x, -1, TABLE.z]} gravityScale={0} linearDamping={0} angularDamping={0} ccd userData={{ toy: 'pong-ball' }}>
        <BallCollider args={[R]} restitution={PONG.body.restitution} friction={PONG.body.friction} density={PONG.body.density} collisionGroups={groups.ball} />
        <BallLook live={live} />
      </RigidBody>
      <Trail body={body} live={live} />
      <PlayerPaddle />
    </>
  );
});
