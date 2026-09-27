import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { BallCollider, CapsuleCollider, CuboidCollider, Physics, RigidBody, useAfterPhysicsStep, useBeforePhysicsStep, useRapier, type RapierRigidBody } from '@react-three/rapier';
import { useStore } from '../../store';
import { HALF_D, HALF_W, PLAYER_RADIUS, WALL_H, elevatorDoorway, lobbyColliders, officeColliders, type Rect } from '../layout';
import { BALLS, BallLook, escaped, type BallDef, type ToyFloor } from './balls';
import { setToySource } from './probe';

// Loaded lazily by ./index.tsx, so Rapier stays out of the main bundle.

const STEP = 1 / 60;

/** Fixed colliders generated from layout.ts: floor, ceiling, walls, cabin and furniture, each at its own height. */
function Building({ floor }: { floor: ToyFloor }) {
  const rects = useMemo<Rect[]>(() => [...(floor === 'office' ? officeColliders() : lobbyColliders()), { ...elevatorDoorway(), h: WALL_H }], [floor]);
  return (
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider args={[HALF_W + 1, 0.5, HALF_D + 4]} position={[0, -0.5, 2]} friction={0.8} restitution={0.5} />
      <CuboidCollider args={[HALF_W + 1, 0.5, HALF_D + 4]} position={[0, WALL_H + 0.5, 2]} />
      {rects.map((r, i) => {
        const h = r.h ?? WALL_H;
        return (
          <CuboidCollider
            key={i}
            args={[(r.maxX - r.minX) / 2, h / 2, (r.maxZ - r.minZ) / 2]}
            position={[(r.minX + r.maxX) / 2, h / 2, (r.minZ + r.maxZ) / 2]}
            friction={0.6}
            restitution={0.5}
          />
        );
      })}
    </RigidBody>
  );
}

// The player as the physics world sees them: a kinematic capsule from the floor to head height that follows the
// camera. It shoves balls (harder when running, because it moves faster) but nothing ever pushes back: the
// player keeps moving with collide() exactly as before.
const PUSHER = { half: 0.6, y: 0.9 };

function Pusher() {
  const camera = useThree((s) => s.camera);
  const body = useRef<RapierRigidBody>(null);
  const next = useMemo(() => ({ x: 0, y: PUSHER.y, z: 0 }), []);
  const last = useRef({ x: NaN, z: NaN });
  useBeforePhysicsStep(() => {
    const b = body.current;
    if (!b) return;
    const { x, z } = camera.position;
    const l = last.current;
    if (x === l.x && z === l.z) return; // standing still: let the capsule sleep
    next.x = x;
    next.z = z;
    // A spawn or floor change is a teleport, not a very fast step that would launch every ball.
    if (Math.abs(x - l.x) < 1 && Math.abs(z - l.z) < 1) b.setNextKinematicTranslation(next);
    else b.setTranslation(next, true);
    l.x = x;
    l.z = z;
  });
  return (
    <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[camera.position.x, PUSHER.y, camera.position.z]}>
      <CapsuleCollider args={[PUSHER.half, PLAYER_RADIUS]} restitution={0} friction={0.4} />
    </RigidBody>
  );
}

const ZERO = { x: 0, y: 0, z: 0 };
const UPRIGHT = { x: 0, y: 0, z: 0, w: 1 };

function respawn(b: RapierRigidBody, def: BallDef) {
  b.setTranslation(def.start, true);
  b.setRotation(UPRIGHT, true);
  b.setLinvel(ZERO, true);
  b.setAngvel(ZERO, true);
}

function Balls({ floor }: { floor: ToyFloor }) {
  const defs = BALLS[floor];
  const { world } = useRapier();
  const bodies = useRef<(RapierRigidBody | null)[]>([]);
  const refs = useMemo(() => defs.map((_, i) => (b: RapierRigidBody | null) => void (bodies.current[i] = b)), [defs]);

  useEffect(() => {
    setToySource(() => ({
      bodies: world.bodies.len(),
      balls: defs.map((d, i) => {
        const b = bodies.current[i];
        const p = b ? b.translation() : d.start;
        return { id: d.id, x: p.x, y: p.y, z: p.z, sleeping: b ? b.isSleeping() : true };
      }),
    }));
    return () => setToySource(null);
  }, [world, defs]);

  // Safety net: a ball that somehow got out of the building comes back to where it started. Asleep means it
  // hasn't moved, so only awake balls are checked, a few times a second.
  const tick = useRef(0);
  const check = useCallback(() => {
    if (++tick.current % 15) return;
    for (let i = 0; i < defs.length; i++) {
      const b = bodies.current[i];
      if (b && !b.isSleeping() && escaped(b.translation())) respawn(b, defs[i]);
    }
  }, [defs]);
  useAfterPhysicsStep(check);

  return defs.map((d, i) => (
    <RigidBody
      key={d.id}
      ref={refs[i]}
      colliders={false}
      position={[d.start.x, d.start.y, d.start.z]}
      linearDamping={d.damping}
      angularDamping={d.damping}
      ccd
      userData={{ toy: d.id }}
    >
      <BallCollider args={[d.r]} restitution={d.restitution} friction={0.7} density={d.density} />
      <BallLook def={d} />
    </RigidBody>
  ));
}

function ToyWorld({ floor }: { floor: ToyFloor }) {
  const paused = useStore((s) => s.travel !== null);
  return (
    <Physics timeStep={STEP} paused={paused}>
      <Building floor={floor} />
      <Pusher />
      <Balls floor={floor} />
    </Physics>
  );
}

export default memo(ToyWorld);
