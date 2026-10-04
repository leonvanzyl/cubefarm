import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CuboidCollider, CylinderCollider, RigidBody, useAfterPhysicsStep, useBeforePhysicsStep, useRapier, type RapierRigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { useStore } from '../../store';
import { useInteractable } from '../interact';
import { escaped } from './balls';
import { walk } from './hands';
import { MUG_SIZE, MugLook, mugColor } from './mugLook';
import { mugsToEvict, resetMugs, setMugSource, takeDrop, type HeldMug } from './mugs';

// Coffee mugs in the toy world: the one in your hands (drawn in view, like the blaster) and mugs lying loose,
// which are small Rapier bodies that fall, tip over and come to rest. Rendered inside <Physics> (ToyWorld.tsx).

const TAKE_RANGE = 2.5;
// A dropped mug leaves your hands tipped and turning, so it lands on its side rather than neatly upright.
// Both are relative to your facing (turned by your yaw at the drop), so it tips forward, into view, whichever way you face.
const TUMBLE: [number, number, number] = [4, 1, 3];
const TILT: [number, number] = [0.5, 0.3];
const UP = new THREE.Vector3(0, 1, 0);
// A bare cylinder on its side rolls forever (Rapier has no rolling friction). The handle's collider stops a full
// roll, so the mug rocks onto rim and handle, and the damping stands in for rolling resistance so it settles quickly.
const ROLL_DAMPING = 3;
const HANDLE = {
  half: [0.02, 0.038, 0.01] as [number, number, number],
  at: [MUG_SIZE.r + 0.02, 0.004, 0] as [number, number, number],
};

// Where the held mug sits in view (camera space, metres), tipped a little towards you so the coffee shows.
const VIEW = { x: 0.16, y: -0.13, z: -0.42, tilt: 0.55, turn: -0.6, scale: 0.75 };

/** The mug in your hands: lower right of the view, bobbing gently. */
function ViewModel({ mug }: { mug: HeldMug }) {
  const root = useRef<THREE.Group>(null);
  const cup = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    const r = root.current;
    const c = cup.current;
    if (!r || !c) return;
    r.position.copy(camera.position);
    r.quaternion.copy(camera.quaternion);
    const t = performance.now() / 1000;
    c.position.set(VIEW.x, VIEW.y + Math.sin(t * 1.6) * 0.003, VIEW.z);
  });
  return (
    <group ref={root}>
      <group ref={cup} rotation={[VIEW.tilt, VIEW.turn, 0]} scale={VIEW.scale}>
        <MugLook color={mugColor(mug.id)} sips={mug.sips} shadow={false} />
      </group>
    </group>
  );
}

interface Loose {
  id: string;
  sips: number;
  born: number;
  key: number;
  at: [number, number, number];
  vel: [number, number, number];
  /** Starting rotation (XYZ Euler) and spin, both already turned by the drop yaw. */
  rot: [number, number, number];
  spin: [number, number, number];
}

function LooseMug({ mug, groups, bodies, onLost }: { mug: Loose; groups: number; bodies: Map<string, RapierRigidBody>; onLost: (id: string) => void }) {
  const ref = useInteractable<THREE.Group>({ id: `toy:${mug.id}`, label: 'Pick up mug', action: { kind: 'pickup', toyId: mug.id } }, TAKE_RANGE);
  const body = useRef<RapierRigidBody>(null);
  const tick = useRef(0);
  useEffect(() => {
    const b = body.current;
    if (!b) return;
    bodies.set(mug.id, b);
    return () => {
      if (bodies.get(mug.id) === b) bodies.delete(mug.id);
    };
  }, [bodies, mug.id]);
  // Safety net, like the balls: a mug that got out of the building is gone.
  useAfterPhysicsStep(() => {
    const b = body.current;
    if (++tick.current % 15 || !b || b.isSleeping()) return;
    if (escaped(b.translation())) onLost(mug.id);
  });
  const { r, rBase, h } = MUG_SIZE;
  return (
    <RigidBody
      ref={body}
      colliders={false}
      position={mug.at}
      rotation={mug.rot}
      linearVelocity={mug.vel}
      angularVelocity={mug.spin}
      linearDamping={0.3}
      angularDamping={ROLL_DAMPING}
      ccd
      userData={{ toy: mug.id }}
    >
      <CylinderCollider args={[h / 2, (r + rBase) / 2]} density={300} friction={0.7} restitution={0.2} collisionGroups={groups} />
      <CuboidCollider args={HANDLE.half} position={HANDLE.at} density={300} friction={0.7} restitution={0.2} collisionGroups={groups} />
      <group ref={ref}>
        <MugLook color={mugColor(mug.id)} sips={mug.sips} />
        {/* an invisible, roomier target, so a small mug on the floor is easy to aim at */}
        <mesh visible={false}>
          <boxGeometry args={[0.26, 0.26, 0.26]} />
        </mesh>
      </group>
    </RigidBody>
  );
}

/** The mug in your hands and the loose mugs on this floor. A new floor (a remount) starts with none. */
export function Mugs({ groups }: { groups: number }) {
  const held = useStore((s) => (s.held?.kind === 'mug' ? s.held : null));
  const camera = useThree((s) => s.camera);
  const { world, rapier } = useRapier();
  const mugs = useRef<Loose[]>([]);
  const bodies = useMemo(() => new Map<string, RapierRigidBody>(), []);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const keys = useRef(0);
  const tmp = useMemo(() => ({ fwd: new THREE.Vector3(), ray: new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }) }), [rapier]);

  const remove = useCallback((id: string) => {
    const i = mugs.current.findIndex((m) => m.id === id);
    if (i < 0) return null;
    const [m] = mugs.current.splice(i, 1);
    redraw();
    return m;
  }, []);

  useEffect(() => {
    resetMugs();
    setMugSource({
      loose: () =>
        mugs.current.map((m) => {
          const b = bodies.get(m.id);
          const p = b ? b.translation() : { x: m.at[0], y: m.at[1], z: m.at[2] };
          return { id: m.id, x: p.x, y: p.y, z: p.z, sips: m.sips, sleeping: b ? b.isSleeping() : false };
        }),
      take: (id) => remove(id)?.sips ?? null,
    });
    return () => {
      setMugSource(null);
      mugs.current = []; // the bodies go with <Physics>
    };
  }, [bodies, remove]);

  // A mug that leaves your hands falls just in front of you, short of any wall you're facing.
  const drop = useCallback(
    (id: string, sips: number) => {
      const { fwd, ray } = tmp;
      fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      ray.origin = { x: camera.position.x, y: 1.1, z: camera.position.z };
      ray.dir = fwd;
      const hit = world.castRay(ray, 1, true, undefined, groups);
      const ahead = hit ? Math.max(0, Math.min(0.45, hit.timeOfImpact - 0.2)) : 0.45;
      for (const old of mugsToEvict(mugs.current)) remove(old.id);
      // Tilt in your own frame (yaw first), then express it in the XYZ order <RigidBody rotation> expects.
      const yaw = camera.rotation.y;
      const rot = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(TILT[0], yaw, TILT[1], 'YXZ')), 'XYZ');
      const spin = new THREE.Vector3(...TUMBLE).applyAxisAngle(UP, yaw);
      mugs.current.push({
        id,
        sips,
        born: performance.now(),
        key: ++keys.current,
        at: [camera.position.x + fwd.x * ahead, 1.1, camera.position.z + fwd.z * ahead],
        vel: [walk.x * 0.5, 0, walk.z * 0.5],
        rot: [rot.x, rot.y, rot.z],
        spin: [spin.x, spin.y, spin.z],
      });
      redraw();
    },
    [camera, groups, remove, tmp, world],
  );

  const step = useCallback(() => {
    for (let d = takeDrop(); d; d = takeDrop()) drop(d.id, d.sips);
  }, [drop]);
  useBeforePhysicsStep(step);

  return (
    <>
      {mugs.current.map((m) => (
        <LooseMug key={m.key} mug={m} groups={groups} bodies={bodies} onLost={remove} />
      ))}
      {held && <ViewModel mug={held} />}
    </>
  );
}
