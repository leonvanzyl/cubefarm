import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BallCollider, CapsuleCollider, CuboidCollider, interactionGroups, Physics, RigidBody, useAfterPhysicsStep, useBeforePhysicsStep, useRapier, type RapierCollider, type RapierRigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { useStore } from '../../store';
import { useInteractable } from '../interact';
import { DOOR_PASSABLE, doorOpen } from '../doors';
import { BALCONY_OUT, BALCONY_TOP, HALF_D, HALF_W, PLAYER_RADIUS, SIDES, WALL_H, elevatorDoorway, lobbyColliders, officeColliders, pongTableRect, sideDoorway, type Rect } from '../layout';
import { playerAt } from '../camera/rig';
import { bodyState } from '../people';
import { FIRST_PERSON } from '../viewTags';
import { BALLS, BallLook, escaped, type BallDef, type ToyFloor } from './balls';
import { boardThud, bounce, grabSound, rimClank } from './ballSounds';
import { Blasters } from './Blasters';
import { DecorColliders } from '../decor/DecorColliders';
import { Dog } from './Dog';
import { chargePower, dropHeld, takeThrow, walk } from './hands';
import { HitTargets } from './HitTargets';
import { Hoop } from './Hoop';
import { hoopRim, hoopSquare } from './hoopScore';
import { hoopPart, impactLevel, offCooldown } from './impacts';
import { Mugs } from './MugToys';
import { npcGrips, npcStance, playerTook, released, setNpcBalls, takeRelease, type NpcBall } from './npc';
import { PingPong } from './PingPong';
import { npcHoldPoint, npcView, type NpcAim } from './npcAim';
import { setToySource } from './probe';
import { Roomba } from './Roomba';
import { HOLD, THROW, holdPoint, hoopShot, throwVelocity, type HoopAim, type View } from './throwing';

// Loaded lazily by ./index.tsx, so Rapier stays out of the main bundle.

const STEP = 1 / 60;

// Collision groups: the elevator doorway (and a shut side door) only stops toys, so the player's pusher can follow the
// player into the cabin (or through a side door that's still sliding open). The ping-pong ball is a group of its own:
// it meets the building and the other toys, but not you, the roomba or the dog (a rally goes on round them), nor the
// ping-pong table's top, which the match bounces it off itself.
const G = { building: 0, doorway: 1, pusher: 2, toys: 3, pong: 4 };
const DOORWAY_GROUPS = interactionGroups(G.doorway, [G.toys, G.pong]);
const PUSHER_GROUPS = interactionGroups(G.pusher, [G.building, G.toys]);
const TOY_GROUPS = interactionGroups(G.toys, [G.building, G.doorway, G.pusher, G.toys, G.pong]);
// A ball in (or just out of) your hands: everything but you.
const HELD_GROUPS = interactionGroups(G.toys, [G.building, G.doorway, G.toys, G.pong]);
const BUILDING_GROUPS = interactionGroups(G.building, [G.pusher, G.toys, G.pong]);
const PONG_TABLE_GROUPS = interactionGroups(G.building, [G.pusher, G.toys]);
const PONG_BALL_GROUPS = interactionGroups(G.pong, [G.building, G.doorway, G.toys]);
const PONG_GROUPS = { table: PONG_TABLE_GROUPS, net: BUILDING_GROUPS, ball: PONG_BALL_GROUPS };
// The roomba and the dog steer themselves round the building (roombaBrain.ts, dogBrain.ts) and never shove the player's
// pusher: they only touch toys.
const ROOMBA_GROUPS = interactionGroups(G.toys, [G.toys]);
// Sensors round seated people (HitTargets.tsx) only notice toys.
const SEATED_GROUPS = interactionGroups(G.toys, [G.toys]);
const DOOR = elevatorDoorway();

const sameRect = (a: Rect, b: Rect) => a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ;

/**
 * Fixed colliders generated from layout.ts: floor, ceiling, walls, cabin and furniture, each at its own height, and the
 * balconies under the balcony above. A side door stops toys while it's shut; open, they can roll out onto the balcony.
 * The ping-pong table is PingPong.tsx's, with collision groups of its own.
 */
function Building({ floor }: { floor: ToyFloor }) {
  const rects = useMemo<Rect[]>(() => (floor === 'office' ? officeColliders().filter((r) => !sameRect(r, pongTableRect())) : lobbyColliders()), [floor]);
  const doors = useMemo(() => SIDES.map((side) => sideDoorway(floor, side)), [floor]);
  const doorColliders = useRef<(RapierCollider | null)[]>([]);
  const shut = useRef([true, true]);
  const swing = useCallback(() => {
    for (let i = 0; i < SIDES.length; i++) {
      const c = doorColliders.current[i];
      const isShut = doorOpen(SIDES[i]) < DOOR_PASSABLE;
      if (!c || shut.current[i] === isShut) continue;
      shut.current[i] = isShut;
      c.setEnabled(isShut);
    }
  }, []);
  useBeforePhysicsStep(swing);
  return (
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider args={[BALCONY_OUT + 0.5, 0.5, HALF_D + 4]} position={[0, -0.5, 2]} friction={0.8} restitution={0.5} collisionGroups={BUILDING_GROUPS} />
      <CuboidCollider args={[HALF_W + 0.4, 0.5, HALF_D + 4]} position={[0, WALL_H + 0.5, 2]} collisionGroups={BUILDING_GROUPS} />
      <CuboidCollider args={[BALCONY_OUT + 0.5, 0.5, HALF_D]} position={[0, BALCONY_TOP + 0.5, 0]} collisionGroups={BUILDING_GROUPS} />
      {doors.map((d, i) => (
        <CuboidCollider
          key={i}
          ref={(c) => void (doorColliders.current[i] = c)}
          args={[(d.maxX - d.minX) / 2, WALL_H / 2, (d.maxZ - d.minZ) / 2]}
          position={[(d.minX + d.maxX) / 2, WALL_H / 2, (d.minZ + d.maxZ) / 2]}
          collisionGroups={DOORWAY_GROUPS}
        />
      ))}
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
const STILL = { x: 0, z: 0 };

// The player as the physics world sees them: a capsule from just above the floor to head height that chases where
// they stand (the camera, unless another view has it). It shoves balls (harder when running, because it moves faster) but nothing ever pushes back on the
// player, who keeps moving with collide() exactly as before.
// It's a dynamic body steered with force-limited impulses rather than a kinematic one: a kinematic body always
// wins, so pinning a ball against a wall would squeeze the ball into the wall. This one gives way instead.
const PUSHER = { half: 0.62, y: 0.95, mass: 4, maxSpeed: 12, maxImpulse: 600 * STEP, teleport: 1.5 };

function Pusher() {
  const body = useRef<RapierRigidBody>(null);
  const at = useMemo(() => ({ x: 0, y: PUSHER.y, z: 0 }), []);
  const push = useMemo(() => ({ x: 0, y: 0, z: 0 }), []);
  const last = useRef({ x: NaN, z: NaN });
  useBeforePhysicsStep(() => {
    const b = body.current;
    if (!b) return;
    const { x, z } = playerAt;
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
      position={[playerAt.x, PUSHER.y, playerAt.z]}
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
const LOOSE = {}; // a ball nobody holds: no tags (a held one is hidden from photo mode's camera)

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
    <group ref={ref} userData={held ? FIRST_PERSON : LOOSE}>
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

  // Other people's hands (npc.ts) see every ball through these, updated after each step.
  const seen = useMemo<NpcBall[]>(
    () => defs.map((d) => ({ id: d.id, kind: d.kind, r: d.r, home: { ...d.start }, x: d.start.x, y: d.start.y, z: d.start.z, vx: 0, vy: 0, vz: 0, sleeping: true })),
    [defs],
  );

  useEffect(() => {
    setNpcBalls(seen);
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
      setNpcBalls(null);
      dropHeld(); // leaving the floor: whatever you carried stays behind
    };
  }, [world, defs, seen]);

  // Safety net: a ball that somehow got out of the building comes back to where it started. Asleep means it
  // hasn't moved, so only awake balls are checked, a few times a second.
  const tick = useRef(0);
  const respawned = useRef<boolean[]>([]); // its sudden stop isn't a bounce: listen() skips it once
  const check = useCallback(() => {
    for (let i = 0; i < defs.length; i++) {
      const b = bodies.current[i];
      if (!b) continue;
      const p = b.translation();
      const v = b.linvel();
      const o = seen[i];
      o.x = p.x;
      o.y = p.y;
      o.z = p.z;
      o.vx = v.x;
      o.vy = v.y;
      o.vz = v.z;
      o.sleeping = b.isSleeping();
    }
    if (++tick.current % 15) return;
    for (let i = 0; i < defs.length; i++) {
      const b = bodies.current[i];
      if (b && !b.isSleeping() && escaped(b.translation())) {
        respawn(b, defs[i]);
        respawned.current[i] = true;
      }
    }
  }, [defs, seen]);
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

  /** Steers a carried ball towards `at`; returns how far off it is. */
  const chase = useCallback(
    (b: RapierRigidBody, at: { x: number; y: number; z: number }) => {
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
    [v],
  );

  const steer = useCallback(
    (b: RapierRigidBody, r: number, chargeAt: number | null) => {
      view.pitch = camera.rotation.x;
      view.yaw = camera.rotation.y;
      // winding up a throw pulls the ball back towards you
      const pull = chargeAt === null ? 0 : chargePower(performance.now() - chargeAt) * HOLD.windUp;
      holdPoint(view, r, pull, at);
      return chase(b, at);
    },
    [at, camera, chase, view],
  );

  // ---------- other people's hands (npc.ts) ----------
  const npcHeld = useRef<(string | null)[]>([]); // who holds each ball, as this world last carried it out
  const npcLostFor = useRef<number[]>([]);
  const hand = useMemo(() => ({ x: 0, y: 0, z: 0 }), []);
  const npcEye = useMemo(() => ({ x: 0, y: 0, z: 0 }), []);

  const npcRelease = useCallback(
    (i: number, who: string, aim: NpcAim | null, how: 'dropped' | 'stuck' = 'dropped') => {
      const b = bodies.current[i];
      const d = defs[i];
      npcHeld.current[i] = null;
      if (!b) return released(who, how);
      b.setGravityScale(1, true);
      b.setAngularDamping(d.damping);
      b.collider(0).setCollisionGroups(TOY_GROUPS);
      const st = bodyState(who);
      const g = npcGrips().get(who);
      if (!aim || !st || !g) {
        b.setLinearDamping(d.damping);
        b.setLinvel(ZERO, true);
        return released(who, how);
      }
      // from exactly where their hands are, with the player's throw maths
      npcHoldPoint(st, g.pose, d.r, g.pull, hand);
      b.setTranslation(hand, true);
      b.setAngvel(ZERO, true); // no spin from being carried about, as in the throw simulation
      const look = npcView(st, aim, npcEye);
      const top = d.throwSpeed ?? THROW.hard;
      if (d.kind !== 'basketball' || !hoopShot(look, hand, aim.power, top, hoop, v)) throwVelocity(look, hand, aim.power, top, STILL, v);
      b.setLinearDamping(THROW.flightDamping);
      b.setLinvel(v, true);
      flying.current[i] = true;
      released(who, 'thrown');
    },
    [defs, hand, hoop, npcEye, v],
  );

  const others = useCallback(() => {
    const grips = npcGrips();
    // let go of balls whose grip went away without a release (the errand ended)
    for (let i = 0; i < defs.length; i++) {
      const who = npcHeld.current[i];
      if (who && !grips.has(who)) npcRelease(i, who, null);
    }
    for (const [who, g] of grips) {
      let i = -1;
      for (let j = 0; j < defs.length; j++) if (defs[j].id === g.ball) i = j;
      const b = i >= 0 ? bodies.current[i] : null;
      const st = bodyState(who) ?? npcStance(who);
      if (!b || !st || i === holding.current) {
        released(who, i === holding.current ? 'taken' : 'stuck');
        continue;
      }
      if (npcHeld.current[i] !== who) {
        grab(b);
        grabSound(defs[i].kind, b.translation());
        flying.current[i] = false;
        grace.current[i] = 0;
        npcHeld.current[i] = who;
        npcLostFor.current[i] = 0;
      }
      const rel = takeRelease(who);
      if (rel) {
        npcRelease(i, who, rel.kind === 'throw' ? rel.aim : null);
        continue;
      }
      // stuck behind something they walked past: it stays there
      if (chase(b, npcHoldPoint(st, g.pose, defs[i].r, g.pull, hand)) > HOLD.lost) {
        npcLostFor.current[i] = (npcLostFor.current[i] ?? 0) + STEP;
        if (npcLostFor.current[i] > HOLD.lostFor) npcRelease(i, who, null, 'stuck');
      } else npcLostFor.current[i] = 0;
    }
  }, [chase, defs, grab, hand, npcRelease]);

  const hands = useCallback(() => {
    const s = useStore.getState();
    let want = -1;
    if (s.held?.kind === 'ball') for (let i = 0; i < defs.length; i++) if (defs[i].id === s.held.id) want = i;
    const cur = holding.current;
    if (want !== cur) {
      if (cur >= 0) letGo(cur, takeThrow(defs[cur].id));
      const b = want >= 0 ? bodies.current[want] : null;
      if (b) {
        // taken out of someone's hands: it's yours now
        const from = npcHeld.current[want];
        if (from) released(from, 'taken');
        npcHeld.current[want] = null;
        playerTook(defs[want].id);
        if (!from) grab(b);
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
    others();
    // Released balls start bumping into you again once they're clear of you.
    const now = performance.now();
    for (let j = 0; j < defs.length; j++) {
      const until = grace.current[j];
      if (!until) continue;
      const b = bodies.current[j];
      if (!b) continue;
      const p = b.translation();
      if (now > until || Math.hypot(p.x - playerAt.x, p.z - playerAt.z) > defs[j].r + PLAYER_RADIUS + 0.15) {
        grace.current[j] = 0;
        b.collider(0).setCollisionGroups(TOY_GROUPS);
      }
    }
  }, [camera, defs, grab, letGo, steer, others]);
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
      {floor === 'office' && <DecorColliders groups={BUILDING_GROUPS} />}
      <Pusher />
      <Balls floor={floor} />
      <Hoop floor={floor} groups={BUILDING_GROUPS} />
      <Roomba floor={floor} groups={ROOMBA_GROUPS} dockGroups={BUILDING_GROUPS} />
      <Blasters floor={floor} groups={HELD_GROUPS} />
      <Mugs groups={HELD_GROUPS} />
      <HitTargets floor={floor} groups={SEATED_GROUPS} />
      <Dog floor={floor} groups={ROOMBA_GROUPS} />
      {floor === 'office' && <PingPong groups={PONG_GROUPS} />}
    </Physics>
  );
}

export default memo(ToyWorld);
