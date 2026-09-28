import { memo, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody, useAfterPhysicsStep, useBeforePhysicsStep, type RapierRigidBody } from '@react-three/rapier';
import type { Collider } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { useStore } from '../../store';
import { BALLS, type ToyFloor } from './balls';
import { countsAsHit, hitKind, hitTargets, onTargetsChange, reportHit, type HitTarget } from './hits';

// A sensor round every seated person's upper body, following their chair. After each physics step, a ball or dart
// that just entered one is checked against the hit rules (hits.ts) using how fast it was going before that step,
// so a bounce off the person doesn't hide a hard throw.
// The sensors are kinematic, not fixed: Blasters only sticks darts to fixed bodies, so a dart that reaches someone
// bounces off them instead of sticking to thin air round them.

// Half-sizes and height of the sensor's centre in the chair's frame: from just above the seat to past the head,
// a little roomier than the solid box the building has for chair and occupant (layout.ts), so toys reach it first.
const SENSOR = { half: [0.43, 0.5, 0.43] as [number, number, number], y: 1.0 };

export const HitTargets = memo(function HitTargets({ floor, groups }: { floor: ToyFloor; groups: number }) {
  const list = useSyncExternalStore(onTargetsChange, hitTargets);
  const ballIds = useMemo(() => BALLS[floor].map((b) => b.id), [floor]);
  const bodies = useRef(new Map<HitTarget, RapierRigidBody>());
  const inside = useRef(new Map<HitTarget, Set<number>>());
  const speeds = useMemo(() => new Map<number, number>(), []);
  const tmp = useMemo(() => ({ p: new THREE.Vector3(), q: new THREE.Quaternion(), found: [] as Collider[] }), []);

  // People sit still, so a sensor only moves when its chair did (or on its first frame).
  useFrame(() => {
    const { p, q } = tmp;
    for (const [t, b] of bodies.current) {
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
    for (const [t, b] of bodies.current) {
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
        if (countsAsHit(kind, speeds.get(body.handle) ?? 0, kind === 'ball' && tag?.toy === heldBall)) reportHit(t.id);
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
        else {
          bodies.current.delete(t);
          inside.current.delete(t);
        }
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
