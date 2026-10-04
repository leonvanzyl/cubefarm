import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BallCollider, CapsuleCollider, CuboidCollider, interactionGroups, Physics, RigidBody, useAfterPhysicsStep, useBeforePhysicsStep, useRapier, type RapierRigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { useStore } from '../../store';
import { useInteractable } from '../interact';
import { HALF_D, HALF_W, PLAYER_RADIUS, WALL_H, elevatorDoorway, lobbyColliders, officeColliders, type Rect } from '../layout';
import { BALLS, BallLook, escaped, type BallDef, type ToyFloor } from './balls';
import { boardThud, bounce, grabSound, rimClank } from './ballSounds';
import { Blasters } from './Blasters';
import { chargePower, dropHeld, takeThrow, walk } from './hands';
import { HitTargets } from './HitTargets';
import { Hoop } from './Hoop';
import { hoopRim, hoopSquare } from './hoopScore';
import { hoopPart, impactLevel, offCooldown } from './impacts';
import { Mugs } from './MugToys';
import { setToySource } from './probe';
import { Roomba } from './Roomba';
import { HOLD, THROW, holdPoint, hoopShot, throwVelocity, type HoopAim, type View } from './throwing';

// Loaded lazily by ./index.tsx, so Rapier stays out of the main bundle.

const STEP = 1 / 60;

// Collision groups: the elevator doorway only stops toys, so the player's pusher can follow the player into the cabin.
const G = { building: 0, doorway: 1, pusher: 2, toys: 3 };
const DOORWAY_GROUPS = interactionGroups(G.doorway, [G.toys]);
const PUSHER_GROUPS = interactionGroups(G.pusher, [G.building, G.toys]);
const TOY_GROUPS = interactionGroups(G.toys, [G.building, G.doorway, G.pusher, G.toys]);
// A ball in (or just out of) your hands: everything but you.
const HELD_GROUPS = interactionGroups(G.toys, [G.building, G.doorway, G.toys]);
const BUILDING_GROUPS = interactionGroups(G.building, [G.pusher, G.toys]);
// The roomba steers itself round the building (roombaBrain.ts) and never shoves the player's pusher: it only touches toys.
const ROOMBA_GROUPS = interactionGroups(G.toys, [G.toys]);
// Sensors round seated people (HitTargets.tsx) only notice toys.
const SEATED_GROUPS = interactionGroups(G.toys, [G.toys]);
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

// Carrying: the held ball stays a dynamic body (so walls and desks still stop it) with gravity off, steered
// towards its hold point (throwing.ts).
// A ball you've let go of passes through you until it's clear of you (or this long, in ms), so it can't be kicked on release.
const GRACE_MS = 1500;
const PICKUP_RANGE = 2.5;

const tmp = new THREE.Vector3();

/** A ball's looks, and the handle you aim at to pick it up. Only this re-renders when the ball is picked up. */
function Grip({ def }: { def: BallDef }) {
  const held = useStore((s) => s.held?.kind === 'ball' && s.held.id === def.id);
  const ref = useInteractable<THREE.Group>(held ? null : { id: `toy:${def.id}`, label: 'Pick up ball', action: { kind: 'pickup', toyId: def.id } }, PICKUP_RANGE);
  // Pinned between you and a wall, a carried ball can end up round the camera: hide it rather than show its inside.
  useFrame(({ camera }) => {
    const g = ref.current;
    if (!g) return;
    const near = held && g.getWorldPosition(tmp).distanceTo(camera.position) < def.r + 0.12;
    if (g.visible === near) g.visible = !near;
  });
  return (
    <group ref={ref}>
      <BallLook def={def} />
    </group>
  );
}

function Balls({ floor }: { floor: ToyFloor }) {
  const defs = BALLS[floor];
  const { world } = useRapier();
  const camera = useThree((s) => s.camera);
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
    return () => {
      setToySource(null);
      dropHeld(); // leaving the floor: whatever you carried stays behind
    };
  }, [world, defs]);

  // Safety net: a ball that somehow got out of the building comes back to where it started. Asleep means it
  // hasn't moved, so only awake balls are checked, a few times a second.
  const tick = useRef(0);
  const respawned = useRef<boolean[]>([]); // its sudden stop isn't a bounce: listen() skips it once
  const check = useCallback(() => {
    if (++tick.current % 15) return;
    for (let i = 0; i < defs.length; i++) {
      const b = bodies.current[i];
      if (b && !b.isSleeping() && escaped(b.translation())) {
        respawn(b, defs[i]);
        respawned.current[i] = true;
      }
    }
  }, [defs]);
  useAfterPhysicsStep(check);

  // ---------- picking up, carrying, throwing ----------
  const holding = useRef(-1); // index of the ball in hand, -1 for none
  const lostFor = useRef(0);
  const grace = useRef<number[]>([]); // performance.now() until which a released ball ignores the player; 0 when it doesn't
  const flying = useRef<boolean[]>([]); // thrown and not yet touched anything: fly with almost no drag
  const v = useMemo(() => ({ x: 0, y: 0, z: 0 }), []);
  const at = useMemo(() => ({ x: 0, y: 0, z: 0 }), []);
  const view = useMemo<View>(() => ({ eye: camera.position, pitch: 0, yaw: 0 }), [camera]);
  const hoop = useMemo<HoopAim>(() => ({ rim: hoopRim(floor), square: hoopSquare(floor) }), [floor]);

  const grab = useCallback((b: RapierRigidBody) => {
    b.setGravityScale(0, true);
    b.setLinearDamping(0);
    b.setAngularDamping(3);
    b.collider(0).setCollisionGroups(HELD_GROUPS);
  }, []);

  const letGo = useCallback(
    (i: number, power: number | null) => {
      const b = bodies.current[i];
      if (!b) return;
      const d = defs[i];
      b.setGravityScale(1, true);
      b.setAngularDamping(d.damping);
      grace.current[i] = performance.now() + GRACE_MS;
      if (power === null) {
        // a gentle drop: just carry on at walking pace and fall
        b.setLinearDamping(d.damping);
        v.x = walk.x * 0.5;
        v.y = 0;
        v.z = walk.z * 0.5;
        b.setLinvel(v, true);
        return;
      }
      view.pitch = camera.rotation.x;
      view.yaw = camera.rotation.y;
      const top = d.throwSpeed ?? THROW.hard;
      const from = b.translation();
      // the basketball thrown at its hoop is an arcade shot; anything else flies along the crosshair
      if (d.kind !== 'basketball' || !hoopShot(view, from, power, top, hoop, v)) throwVelocity(view, from, power, top, walk, v);
      b.setLinearDamping(THROW.flightDamping);
      b.setLinvel(v, true);
      flying.current[i] = true;
    },
    [camera, defs, hoop, v, view],
  );

  const landed = useMemo(
    () =>
      defs.map((d, i) => () => {
        if (!flying.current[i]) return;
        flying.current[i] = false;
        bodies.current[i]?.setLinearDamping(d.damping);
      }),
    [defs],
  );

  const steer = useCallback(
    (b: RapierRigidBody, r: number, chargeAt: number | null) => {
      view.pitch = camera.rotation.x;
      view.yaw = camera.rotation.y;
      // winding up a throw pulls the ball back towards you
      const pull = chargeAt === null ? 0 : chargePower(performance.now() - chargeAt) * HOLD.windUp;
      holdPoint(view, r, pull, at);
      const p = b.translation();
      const dx = at.x - p.x;
      const dy = at.y - p.y;
      const dz = at.z - p.z;
      const d = Math.hypot(dx, dy, dz);
      const k = d > 0 ? Math.min(HOLD.follow, HOLD.maxSpeed / d) : 0;
      v.x = dx * k;
      v.y = dy * k;
      v.z = dz * k;
      b.setLinvel(v, true);
      return d;
    },
    [at, camera, v, view],
  );

  const hands = useCallback(() => {
    const s = useStore.getState();
    let want = -1;
    if (s.held?.kind === 'ball') for (let i = 0; i < defs.length; i++) if (defs[i].id === s.held.id) want = i;
    const cur = holding.current;
    if (want !== cur) {
      if (cur >= 0) letGo(cur, takeThrow(defs[cur].id));
      const b = want >= 0 ? bodies.current[want] : null;
      if (b) {
        grab(b);
        grabSound(defs[want].kind, b.translation());
        flying.current[want] = false;
        grace.current[want] = 0;
      }
      holding.current = b ? want : -1;
      lostFor.current = 0;
    }
    const i = holding.current;
    if (i >= 0) {
      const b = bodies.current[i];
      // Stuck behind something while you walked off: let go rather than drag it along from across the room.
      if (b && steer(b, defs[i].r, s.chargeAt) > HOLD.lost) {
        lostFor.current += STEP;
        if (lostFor.current > HOLD.lostFor) dropHeld();
      } else lostFor.current = 0;
    }
    // Released balls start bumping into you again once they're clear of you.
    const now = performance.now();
    for (let j = 0; j < defs.length; j++) {
      const until = grace.current[j];
      if (!until) continue;
      const b = bodies.current[j];
      if (!b) continue;
      const p = b.translation();
      if (now > until || Math.hypot(p.x - camera.position.x, p.z - camera.position.z) > defs[j].r + PLAYER_RADIUS + 0.15) {
        grace.current[j] = 0;
        b.collider(0).setCollisionGroups(TOY_GROUPS);
      }
    }
  }, [camera, defs, grab, letGo, steer]);
  useBeforePhysicsStep(hands);

  // ---------- bounce sounds ----------
  // A hit shows as a sudden change in a ball's velocity over one step (less gravity's share): whatever it hit, a
  // wall, a desk, another ball, the roomba or someone. Velocities are read after hands() has steered or thrown, so
  // only the physics' own changes count, and the ball in your hands is left out.
  const before = useMemo(() => defs.map(() => ({ x: 0, y: 0, z: 0 })), [defs]);
  const lastSound = useRef<number[]>([]);
  // Balls start just above the floor and drop onto it: a floor arriving shouldn't clatter.
  const settling = useRef(30);
  useEffect(() => void (settling.current = 30), [defs]);
  const rim = useMemo(() => hoopRim(floor), [floor]);
  const snapVelocities = useCallback(() => {
    for (let i = 0; i < defs.length; i++) {
      const b = bodies.current[i];
      if (!b) continue;
      const lv = b.linvel();
      before[i].x = lv.x;
      before[i].y = lv.y;
      before[i].z = lv.z;
    }
  }, [before, defs]);
  useBeforePhysicsStep(snapVelocities);
  const listen = useCallback(
    (w: typeof world) => {
      if (settling.current > 0 && settling.current--) return;
      const now = performance.now();
      const g = w.gravity.y * STEP;
      for (let i = 0; i < defs.length; i++) {
        const b = bodies.current[i];
        if (respawned.current[i]) {
          respawned.current[i] = false;
          continue;
        }
        if (!b || i === holding.current || b.isSleeping()) continue;
        const lv = b.linvel();
        const p0 = before[i];
        const level = impactLevel(Math.hypot(lv.x - p0.x, lv.y - p0.y - g * b.gravityScale(), lv.z - p0.z));
        if (!level || !offCooldown(lastSound.current[i] ?? -Infinity, now)) continue;
        lastSound.current[i] = now;
        const p = b.translation();
        const part = hoopPart(p, defs[i].r, rim, Math.hypot(lv.x, lv.y, lv.z) * STEP);
        if (part === 'rim') rimClank({ x: rim.x, y: rim.y, z: rim.z }, level);
        else if (part === 'board') boardThud(p, level);
        else bounce(defs[i].kind, p, level);
      }
    },
    [before, defs, rim],
  );
  useAfterPhysicsStep(listen);

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
      onCollisionEnter={landed[i]}
    >
      <BallCollider args={[d.r]} restitution={d.restitution} friction={0.7} density={d.density} collisionGroups={TOY_GROUPS} />
      <Grip def={d} />
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
      <Hoop floor={floor} groups={BUILDING_GROUPS} />
      <Roomba floor={floor} groups={ROOMBA_GROUPS} dockGroups={BUILDING_GROUPS} />
      <Blasters floor={floor} groups={HELD_GROUPS} />
      <Mugs groups={HELD_GROUPS} />
      <HitTargets floor={floor} groups={SEATED_GROUPS} />
    </Physics>
  );
}

export default memo(ToyWorld);
