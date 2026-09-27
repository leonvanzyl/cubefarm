import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { BallCollider, CapsuleCollider, CuboidCollider, interactionGroups, Physics, RigidBody, useAfterPhysicsStep, useBeforePhysicsStep, useRapier, type RapierRigidBody } from '@react-three/rapier';
import { useStore } from '../../store';
import { HALF_D, HALF_W, PLAYER_RADIUS, WALL_H, elevatorDoorway, lobbyColliders, officeColliders, type Rect } from '../layout';
import { BALLS, BallLook, escaped, type BallDef, type ToyFloor } from './balls';
import { setToySource } from './probe';

// Loaded lazily by ./index.tsx, so Rapier stays out of the main bundle.

const STEP = 1 / 60;

// Collision groups: the elevator doorway only stops toys, so the player's pusher can follow the player into the cabin.
const G = { building: 0, doorway: 1, pusher: 2, toys: 3 };
const DOORWAY_GROUPS = interactionGroups(G.doorway, [G.toys]);
const PUSHER_GROUPS = interactionGroups(G.pusher, [G.building, G.toys]);
const TOY_GROUPS = interactionGroups(G.toys, [G.building, G.doorway, G.pusher, G.toys]);
const BUILDING_GROUPS = interactionGroups(G.building, [G.pusher, G.toys]);
const DOOR = elevatorDoorway();

/** Fixed colliders generated from layout.ts: floor, ceiling, walls, cabin and furniture, each at its own height. */
function Building({ floor }: { floor: ToyFloor }) {
  const rects = useMemo<Rect[]>(() => (floor === 'office' ? officeColliders() : lobbyColliders()), [floor]);
  return (
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider args={[HALF_W + 1, 0.5, HALF_D + 4]} position={[0, -0.5, 2]} friction={0.8} restitution={0.5} collisionGroups={BUILDING_GROUPS} />
      <CuboidCollider args={[HALF_W + 1, 0.5, HALF_D + 4]} position={[0, WALL_H + 0.5, 2]} collisionGroups={BUILDING_GROUPS} />
      <CuboidCollider
        args={[(DOOR.maxX - DOOR.minX) / 2, WALL_H / 2, (DOOR.maxZ - DOOR.minZ) / 2]}
        position={[(DOOR.minX + DOOR.maxX) / 2, WALL_H / 2, (DOOR.minZ + DOOR.maxZ) / 2]}
        collisionGroups={DOORWAY_GROUPS}
      />
      {rects.map((r, i) => {
        const h = r.h ?? WALL_H;
        return (
          <CuboidCollider
            key={i}
            args={[(r.maxX - r.minX) / 2, h / 2, (r.maxZ - r.minZ) / 2]}
            position={[(r.minX + r.maxX) / 2, h / 2, (r.minZ + r.maxZ) / 2]}
            friction={0.6}
            restitution={0.5}
            collisionGroups={BUILDING_GROUPS}
          />
        );
      })}
    </RigidBody>
  );
}

const ZERO = { x: 0, y: 0, z: 0 };

// The player as the physics world sees them: a capsule from just above the floor to head height that chases the
// camera. It shoves balls (harder when running, because it moves faster) but nothing ever pushes back on the
// player, who keeps moving with collide() exactly as before.
// It's a dynamic body steered with force-limited impulses rather than a kinematic one: a kinematic body always
// wins, so pinning a ball against a wall would squeeze the ball into the wall. This one gives way instead.
const PUSHER = { half: 0.62, y: 0.95, mass: 4, maxSpeed: 12, maxImpulse: 600 * STEP, teleport: 1.5 };

function Pusher() {
  const camera = useThree((s) => s.camera);
  const body = useRef<RapierRigidBody>(null);
  const at = useMemo(() => ({ x: 0, y: PUSHER.y, z: 0 }), []);
  const push = useMemo(() => ({ x: 0, y: 0, z: 0 }), []);
  const last = useRef({ x: NaN, z: NaN });
  useBeforePhysicsStep(() => {
    const b = body.current;
    if (!b) return;
    const { x, z } = camera.position;
    const l = last.current;
    const still = x === l.x && z === l.z;
    l.x = x;
    l.z = z;
    if (still && b.isSleeping()) return;
    const p = b.translation();
    const dx = x - p.x;
    const dz = z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > PUSHER.teleport) {
      // a spawn or floor change: jump there instead of charging across the room
      at.x = x;
      at.z = z;
      b.setTranslation(at, true);
      b.setLinvel(ZERO, true);
      return;
    }
    if (still && d < 0.002) {
      b.setLinvel(ZERO, false); // arrived: let it fall asleep
      return;
    }
    // Aim to close the gap this step (capped at maxSpeed), with a capped impulse to get there. Falling far
    // behind the camera means something is in the way (a ball pinned against a wall), so ease off rather than crush it.
    const limit = PUSHER.maxImpulse * Math.min(1, Math.max(0.1, (0.7 - d) / 0.4));
    const k = d > 0 ? Math.min(1 / STEP, PUSHER.maxSpeed / d) : 0;
    const v = b.linvel();
    push.x = PUSHER.mass * (dx * k - v.x);
    push.z = PUSHER.mass * (dz * k - v.z);
    const j = Math.hypot(push.x, push.z);
    if (j > limit) {
      push.x *= limit / j;
      push.z *= limit / j;
    }
    b.applyImpulse(push, true);
  });
  return (
    <RigidBody
      ref={body}
      colliders={false}
      position={[camera.position.x, PUSHER.y, camera.position.z]}
      gravityScale={0}
      enabledTranslations={[true, false, true]}
      lockRotations
    >
      <CapsuleCollider args={[PUSHER.half, PLAYER_RADIUS]} mass={PUSHER.mass} restitution={0} friction={0.2} collisionGroups={PUSHER_GROUPS} />
    </RigidBody>
  );
}

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
      <BallCollider args={[d.r]} restitution={d.restitution} friction={0.7} density={d.density} collisionGroups={TOY_GROUPS} />
      <BallLook def={d} />
    </RigidBody>
  ));
}

function ToyWorld({ floor }: { floor: ToyFloor }) {
  const paused = useStore((s) => s.travel !== null);
  return (
    <Physics timeStep={STEP} paused={paused} numSolverIterations={8}>
      <Building floor={floor} />
      <Pusher />
      <Balls floor={floor} />
    </Physics>
  );
}

export default memo(ToyWorld);
