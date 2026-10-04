import { memo, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody, useAfterPhysicsStep, useBeforePhysicsStep, type RapierRigidBody } from '@react-three/rapier';
import type { Collider } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { useStore } from '../../store';
import { bodyState } from '../people';
import { BALLS, type ToyFloor } from './balls';
import { countsAsHit, hitKind, hitTargets, onTargetsChange, reportHit, type HitTarget } from './hits';
import { npcIgnores } from './npc';

// A sensor round every person's upper body, following them in their chair or on their feet. After each physics
// step, a ball or dart that just entered one is checked against the hit rules (hits.ts) using how fast it was going
// before that step, so a bounce off the person doesn't hide a hard throw.
// The sensors are kinematic, not fixed: Blasters only sticks darts to fixed bodies, so a dart that reaches someone
// bounces off them instead of sticking to thin air round them.

// Half-sizes and height of the sensor's centre in the chair's frame: from just above the seat to past the head,
// a little roomier than the solid box the building has for chair and occupant (layout.ts), so toys reach it first.
const SENSOR = { half: [0.43, 0.5, 0.43] as [number, number, number], y: 1.0 };
// Up and about (errands.ts), the sensor stands from the knees to over the head, and walks with them.
const STANDING = { half: { x: 0.36, y: 0.75, z: 0.36 }, at: { x: 0, y: 1.05, z: 0 } };
const SEATED = { half: { x: SENSOR.half[0], y: SENSOR.half[1], z: SENSOR.half[2] }, at: { x: 0, y: SENSOR.y, z: 0 } };

export const HitTargets = memo(function HitTargets({ floor, groups }: { floor: ToyFloor; groups: number }) {
  const list = useSyncExternalStore(onTargetsChange, hitTargets);
  const ballIds = useMemo(() => BALLS[floor].map((b) => b.id), [floor]);
  const bodies = useRef(new Map<HitTarget, RapierRigidBody>());
  const inside = useRef(new Map<HitTarget, Set<number>>());
  const standing = useRef(new Map<HitTarget, boolean>());
  const speeds = useMemo(() => new Map<number, number>(), []);
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), q: new THREE.Quaternion(), found: [] as Collider[] }), []);

  // The sensors still in the world. A RigidBody's ref only hears about its body being created, not removed (someone
  // leaves their desk, the floor changes), and reading a removed body makes Rapier panic, which stops every toy.
  const live = () => {
    for (const [t, b] of bodies.current) {
      if (b.isValid()) continue;
      bodies.current.delete(t);
      inside.current.delete(t);
      standing.current.delete(t);
    }
    return bodies.current;
  };

  // A sensor only moves when its person did (or on its first frame): most of the time they sit still.
  useFrame(() => {
    const { p, q } = tmp;
    for (const [t, b] of live()) {
      t.obj.getWorldPosition(p);
      t.obj.getWorldQuaternion(q);
      const at = b.translation();
      const r = b.rotation();
      const moved = Math.abs(at.x - p.x) + Math.abs(at.y - p.y) + Math.abs(at.z - p.z) > 0.005;
      const turned = Math.abs(r.x * q.x + r.y * q.y + r.z * q.z + r.w * q.w) < 0.99999;
      if (moved || turned) {
        b.setTranslation(p, true);
        b.setRotation(q, true);
      }
      const up = (bodyState(t.id)?.stage ?? 'seated') !== 'seated';
      if (up !== (standing.current.get(t) ?? false) && b.numColliders()) {
        standing.current.set(t, up);
        const box = up ? STANDING : SEATED;
        const c = b.collider(0);
        c.setHalfExtents(box.half);
        c.setTranslationWrtParent(box.at);
      }
    }
  });

  useBeforePhysicsStep((world) => {
    speeds.clear();
    if (!bodies.current.size) return;
    world.forEachActiveRigidBody((b) => {
      if (!b.isDynamic()) return;
      const v = b.linvel();
      speeds.set(b.handle, Math.hypot(v.x, v.y, v.z));
    });
  });

  useAfterPhysicsStep((world) => {
    const held = useStore.getState().held;
    const heldBall = held?.kind === 'ball' ? held.id : null;
    const found = tmp.found;
    for (const [t, b] of live()) {
      if (!b.numColliders()) continue;
      const sensor = b.collider(0);
      found.length = 0;
      world.intersectionPairsWith(sensor, (other) => void found.push(other));
      const was = inside.current.get(t);
      let now: Set<number> | null = null;
      for (const other of found) {
        const body = other.parent();
        if (!body || !world.intersectionPair(sensor, other)) continue;
        (now ??= new Set()).add(body.handle);
        if (was?.has(body.handle)) continue;
        const tag = body.userData as { toy?: unknown } | undefined;
        const kind = hitKind(tag, ballIds);
        // their own ball (held, just thrown, or on its way to their hands) isn't a hit
        const theirs = kind === 'ball' && (tag?.toy === heldBall || npcIgnores(t.id, tag?.toy));
        if (countsAsHit(kind, speeds.get(body.handle) ?? 0, theirs)) reportHit(t.id);
      }
      if (now) inside.current.set(t, now);
      else inside.current.delete(t);
    }
  });

  return list.map((t) => (
    <RigidBody
      key={t.key}
      ref={(b: RapierRigidBody | null) => {
        if (b) bodies.current.set(t, b);
      }}
      type="kinematicPosition"
      colliders={false}
      position={t.obj.getWorldPosition(new THREE.Vector3()).toArray()}
      userData={{ seat: t.id }}
    >
      <CuboidCollider sensor args={SENSOR.half} position={[0, SENSOR.y, 0]} collisionGroups={groups} />
    </RigidBody>
  ));
});
