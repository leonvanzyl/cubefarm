import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CuboidCollider, RigidBody, useAfterPhysicsStep, useBeforePhysicsStep, useRapier, type RapierRigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { useStore } from '../../store';
import { drawSign } from '../draw';
import { useInteractable } from '../interact';
import { BLASTER_RACK, HALF_D, toyOnlyAt } from '../layout';
import { shade, toon } from '../materials';
import { WallSign } from '../OfficeFloor';
import { Box, Cyl } from '../Toon';
import { escaped, type ToyFloor } from './balls';
import { blasterClatter, dartSound } from './blasterSfx';
import { LANDING_SOUNDS, dartImpact, dartSurface, heardSurface, landingSpeed, type DartSurface } from './blasterSounds';
import { BLASTERS, DART_CAP, FLOOR_Y, reloadProgress, setDartSource, sticks, toEvict, type BlasterDef } from './darts';
import { kick, resetBlasters, takeShot } from './gun';
import { walk } from './hands';

// Foam blasters: the wall rack, the blaster in your hands, blasters dropped on the floor, and the darts.
// Rendered inside the toy world's <Physics> (ToyWorld.tsx); the darts are raw Rapier bodies drawn with two
// instanced meshes, so a floor full of them costs two draw calls.

const STEP = 1 / 60;
const INK = '#2b2d42';
const TAKE_RANGE = 2.8;

// ---------- looks ----------

/**
 * A chunky toy blaster, muzzle towards -Z, roughly centred on its middle. `mag` lets the view model
 * animate the magazine during a reload.
 */
function BlasterLook({ def, shadow = true, mag }: { def: BlasterDef; shadow?: boolean; mag?: RefObject<THREE.Group | null> }) {
  const { body, trim } = def;
  return (
    <group>
      <Box size={[0.1, 0.12, 0.3]} position={[0, 0.02, -0.02]} color={body} outline shadow={shadow} />
      <Box size={[0.104, 0.03, 0.2]} position={[0, -0.01, -0.04]} color="#ffffff" shadow={false} />
      <Box size={[0.05, 0.035, 0.22]} position={[0, 0.095, -0.03]} color={trim} outline shadow={shadow} />
      <Cyl r={0.038} h={0.14} position={[0, 0.03, -0.23]} rotation={[Math.PI / 2, 0, 0]} color={trim} outline shadow={shadow} />
      <Cyl r={0.046} h={0.04} position={[0, 0.03, -0.31]} rotation={[Math.PI / 2, 0, 0]} color="#ffd166" outline shadow={shadow} />
      <Box size={[0.11, 0.07, 0.08]} position={[0, 0.03, 0.16]} color={trim} outline shadow={shadow} />
      <Box size={[0.065, 0.15, 0.075]} position={[0, -0.1, 0.09]} rotation={[0.3, 0, 0]} color={INK} outline shadow={shadow} />
      <Box size={[0.02, 0.05, 0.07]} position={[0, -0.065, 0.01]} color={INK} shadow={false} />
      <group ref={mag} position={[0, -0.08, -0.1]}>
        <Box size={[0.055, 0.12, 0.08]} color={shade(body, -0.2)} outline shadow={shadow} />
      </group>
    </group>
  );
}

// Where the held blaster sits in view (camera space, metres) and where its muzzle ends up.
const VIEW = { x: 0.17, y: -0.155, z: -0.3, scale: 0.5 };
const MUZZLE = new THREE.Vector3(VIEW.x, VIEW.y + 0.03 * VIEW.scale, VIEW.z - 0.33 * VIEW.scale);

/** The blaster in your hands: lower right of the view, kicking on each shot and dipping through a reload. */
function ViewModel({ def }: { def: BlasterDef }) {
  const root = useRef<THREE.Group>(null);
  const gun = useRef<THREE.Group>(null);
  const mag = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    const r = root.current;
    const g = gun.current;
    if (!r || !g) return;
    r.position.copy(camera.position);
    r.quaternion.copy(camera.quaternion);
    const now = performance.now();
    const t = (now - kick.at) / 160;
    const k = t < 1 ? Math.min(1, t * 4) * (1 - t) : 0;
    const h = useStore.getState().held;
    const p = h?.kind === 'blaster' ? reloadProgress(h, now) : null;
    const dip = p === null ? 0 : Math.sin(p * Math.PI);
    g.position.set(VIEW.x, VIEW.y - dip * 0.06, VIEW.z + k * 0.05);
    g.rotation.set(k * 0.25 + dip * 0.45, 0, dip * 0.5);
    if (mag.current) mag.current.position.y = -0.08 - dip * 0.14;
  });
  return (
    <group ref={root}>
      <group ref={gun} scale={VIEW.scale}>
        <BlasterLook def={def} shadow={false} mag={mag} />
      </group>
    </group>
  );
}

// ---------- the rack ----------

const SLOT_Y = [1.4, 1.06];

function Rack({ x, onRack }: { x: number; onRack: BlasterDef[] }) {
  const first = onRack[0];
  const ref = useInteractable<THREE.Group>(first ? { id: `toy:rack:${first.id}`, label: 'Take a blaster', action: { kind: 'pickup', toyId: first.id } } : null, TAKE_RANGE);
  const { w, d, h } = BLASTER_RACK;
  // Local +Z faces into the room.
  return (
    <group position={[x, 0, HALF_D]} rotation={[0, Math.PI, 0]}>
      <group ref={ref}>
        <Box size={[w, 0.8, d]} position={[0, 0.4, d / 2]} color="#ffd166" outline />
        <Box size={[w - 0.2, 0.08, 0.01]} position={[0, 0.62, d + 0.005]} color="#ff8c1a" shadow={false} />
        <Box size={[w - 0.1, h - 0.85, 0.04]} position={[0, 0.8 + (h - 0.8) / 2, 0.03]} color="#f4e1c1" outline />
        {SLOT_Y.flatMap((y) =>
          [-0.16, 0.16].map((px) => <Cyl key={`${y}${px}`} r={0.012} h={0.1} position={[px, y - 0.1, 0.09]} rotation={[Math.PI / 2, 0, 0]} color={INK} shadow={false} />),
        )}
        {BLASTERS.map((b, i) =>
          onRack.includes(b) ? (
            <group key={b.id} position={[0, SLOT_Y[i], 0.13]} rotation={[0, Math.PI / 2, 0]}>
              <BlasterLook def={b} />
            </group>
          ) : null,
        )}
        {/* a box of spare darts on top of the cabinet */}
        <Box size={[0.34, 0.1, 0.2]} position={[0.36, 0.85, 0.16]} color="#3a86ff" outline />
        {[0, 1, 2, 3].map((i) => (
          <group key={i} position={[0.26 + i * 0.065, 0.92, 0.16]} rotation={[Math.PI / 2, 0, 0.2 * (i - 1.5)]}>
            <Cyl r={0.02} h={0.13} color={i % 2 ? '#ff8c1a' : '#3a86ff'} shadow={false} />
            <Cyl r={0.026} rTop={0.02} h={0.025} position={[0, -0.075, 0]} color="#ffd166" shadow={false} />
          </group>
        ))}
      </group>
      <WallSign
        position={[0, h - 0.14, 0.055]}
        rotationY={0}
        size={[w - 0.2, 0.22]}
        px={[512, 96]}
        draw={(ctx) => drawSign(ctx, 512, 96, [{ text: '🎯 FOAM ZONE', size: 54 }], '#ef476f')}
        deps={[]}
      />
    </group>
  );
}

// ---------- loose blasters ----------

type Spot = { where: 'rack' } | { where: 'held' } | { where: 'loose'; key: number; at: [number, number, number]; vel: [number, number, number]; yaw: number };

function LooseBlaster({ def, spot, groups, onLost }: { def: BlasterDef; spot: Extract<Spot, { where: 'loose' }>; groups: number; onLost: () => void }) {
  const ref = useInteractable<THREE.Group>({ id: `toy:${def.id}`, label: 'Pick up blaster', action: { kind: 'pickup', toyId: def.id } }, TAKE_RANGE);
  const body = useRef<RapierRigidBody>(null);
  const tick = useRef(0);
  const fall = useRef({ vy: 0, landings: 0 });
  useAfterPhysicsStep(() => {
    const b = body.current;
    // The first bounces after a drop clatter where it lands.
    const f = fall.current;
    if (b && f.landings < LANDING_SOUNDS.blaster && !b.isSleeping()) {
      const vy = b.linvel().y;
      const speed = landingSpeed(f.vy, vy);
      f.vy = vy;
      if (speed !== null) {
        f.landings++;
        blasterClatter(b.translation(), Math.min(1, speed / 3.5));
      }
    }
    // Safety net, like the balls: a blaster that got out of the building goes back on the rack.
    if (++tick.current % 15 || !b || b.isSleeping()) return;
    if (escaped(b.translation())) onLost();
  });
  return (
    <RigidBody
      ref={body}
      colliders={false}
      position={spot.at}
      rotation={[0, spot.yaw, 0]}
      linearVelocity={spot.vel}
      linearDamping={0.3}
      angularDamping={0.6}
      ccd
      userData={{ toy: def.id }}
    >
      <CuboidCollider args={[0.055, 0.15, 0.27]} position={[0, -0.03, -0.07]} density={260} friction={0.8} restitution={0.25} collisionGroups={groups} />
      <group ref={ref}>
        <BlasterLook def={def} />
        {/* an invisible, roomier target, so a blaster lying on its side is easy to aim at */}
        <mesh visible={false} position={[0, -0.03, -0.07]}>
          <boxGeometry args={[0.36, 0.36, 0.6]} />
        </mesh>
      </group>
    </RigidBody>
  );
}

// ---------- darts ----------

// Radius and half-length of the capsule, how far the suction tip reaches from the centre, muzzle speed (m/s),
// gravity while in flight (a slight drop), and how deep a stuck tip sinks in.
const DART = { r: 0.026, half: 0.064, tip: 0.105, speed: 19, flightGravity: 0.35, density: 35, embed: 0.012, slow: 4 };
const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const ZERO = { x: 0, y: 0, z: 0 };

interface Dart {
  id: number;
  born: number;
  body: RapierRigidBody;
  color: THREE.Color;
  state: 'flying' | 'loose' | 'stuck';
  dir: THREE.Vector3;
  /**
   * For its sounds: its speed in flight, what its look-ahead ray last met and how many steps ago it met someone, its
   * vertical speed while loose, and landings heard.
   */
  speed: number;
  ahead: DartSurface | null;
  sincePerson: number;
  vy: number;
  landings: number;
}

/** A dart that hit something falls and rolls like any other toy. */
function tumble(d: Dart) {
  const impact = dartImpact('glance', heardSurface(d.ahead, d.sincePerson, 'furniture'), d.speed);
  if (impact) dartSound(impact.sound, d.body.translation(), impact.gain);
  d.vy = d.body.linvel().y;
  d.state = 'loose';
  d.body.setGravityScale(1, true);
  d.body.setLinearDamping(0.3);
}

/** A tumbling dart's first few landings patter on the floor, or tick on whatever else catches it. */
function listenForLanding(d: Dart) {
  const b = d.body;
  if (d.landings >= LANDING_SOUNDS.dart || b.isSleeping()) return;
  const vy = b.linvel().y;
  const speed = landingSpeed(d.vy, vy);
  d.vy = vy;
  if (speed === null) return;
  d.landings++;
  const at = b.translation();
  const impact = dartImpact('land', at.y < FLOOR_Y ? 'floor' : 'furniture', speed);
  if (impact) dartSound(impact.sound, at, impact.gain);
}

function Darts({ floor, groups }: { floor: ToyFloor; groups: number }) {
  const { world, rapier } = useRapier();
  const camera = useThree((s) => s.camera);
  const darts = useRef<Dart[]>([]);
  const nextId = useRef(1);
  const tick = useRef(0);
  const tmp = useMemo(() => ({ fwd: new THREE.Vector3(), muzzle: new THREE.Vector3(), aim: new THREE.Vector3(), v: new THREE.Vector3(), n: new THREE.Vector3(), q: new THREE.Quaternion(), m: new THREE.Matrix4(), p: new THREE.Vector3() }), []);
  const ray = useMemo(() => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }), [rapier]);

  const meshes = useMemo(() => {
    const foam = new THREE.InstancedMesh(new THREE.CylinderGeometry(DART.r, DART.r, 0.15, 8), toon('#ffffff'), DART_CAP + 8);
    const tip = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, DART.r, 0.03, 10).translate(0, 0.09, 0), toon('#ffd166'), DART_CAP + 8);
    for (const m of [foam, tip]) {
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    foam.setColorAt(0, new THREE.Color('#ffffff')); // allocate instance colours before the first draw
    return { foam, tip };
  }, []);
  useEffect(
    () => () => {
      for (const m of [meshes.foam, meshes.tip]) {
        m.geometry.dispose();
        m.dispose();
      }
    },
    [meshes],
  );

  const remove = useCallback(
    (d: Dart) => {
      const i = darts.current.indexOf(d);
      if (i < 0) return;
      darts.current.splice(i, 1);
      world.removeRigidBody(d.body);
    },
    [world],
  );

  useEffect(() => {
    setDartSource({
      count: () => darts.current.length,
      stuck: () => darts.current.filter((d) => d.state === 'stuck').length,
      loose: () =>
        darts.current
          .filter((d) => d.state === 'loose')
          .map((d) => {
            const p = d.body.translation();
            return { id: d.id, x: p.x, y: p.y, z: p.z, color: `#${d.color.getHexString()}`, q: d.body.rotation() };
          }),
      remove: (id) => {
        const d = darts.current.find((x) => x.id === id);
        if (d) remove(d);
        return !!d;
      },
    });
    return () => {
      setDartSource(null);
      darts.current = []; // the world (and every body in it) goes with <Physics>
    };
  }, [remove]);

  /** Where the crosshair ray first meets something, or null for nothing within reach. */
  const castFrom = useCallback(
    (from: THREE.Vector3, dir: THREE.Vector3, max: number) => {
      ray.origin = from;
      ray.dir = dir;
      return world.castRay(ray, max, true, undefined, groups);
    },
    [ray, world, groups],
  );

  const spawn = useCallback(
    (blasterId: string) => {
      const def = BLASTERS.find((b) => b.id === blasterId) ?? BLASTERS[0];
      const { fwd, muzzle, aim, v, q } = tmp;
      fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
      muzzle.copy(MUZZLE).applyQuaternion(camera.quaternion).add(camera.position);
      // Keep the muzzle on this side of a wall you're standing against.
      v.subVectors(muzzle, camera.position);
      const reach = v.length();
      v.divideScalar(reach);
      const block = castFrom(camera.position, v, reach + DART.tip);
      if (block) muzzle.copy(camera.position).addScaledVector(v, Math.max(0, block.timeOfImpact - DART.tip - 0.02));
      // Aim from the muzzle at whatever the crosshair is on, so darts land where you point.
      const hit = castFrom(camera.position, fwd, 60);
      const dist = hit ? hit.timeOfImpact : 40;
      if (dist > 1.2) aim.copy(camera.position).addScaledVector(fwd, dist);
      else aim.copy(muzzle).add(fwd);
      v.subVectors(aim, muzzle).normalize();
      q.setFromUnitVectors(UP, v);

      for (const old of toEvict(darts.current, DART_CAP)) remove(old);
      const body = world.createRigidBody(
        rapier.RigidBodyDesc.dynamic()
          .setTranslation(muzzle.x, muzzle.y, muzzle.z)
          .setRotation(q)
          .setLinvel(v.x * DART.speed, v.y * DART.speed, v.z * DART.speed)
          .setGravityScale(DART.flightGravity)
          .setLinearDamping(0.05)
          .setAngularDamping(1.5)
          .setCcdEnabled(true)
          .setUserData({ toy: 'dart' }), // how HitTargets tells a dart from other bodies
      );
      world.createCollider(
        rapier.ColliderDesc.capsule(DART.half, DART.r).setDensity(DART.density).setRestitution(0.35).setFriction(0.9).setCollisionGroups(groups),
        body,
      );
      darts.current.push({ id: nextId.current++, born: performance.now(), body, color: new THREE.Color(def.foam), state: 'flying', dir: v.clone(), speed: DART.speed, ahead: null, sincePerson: Infinity, vy: 0, landings: 0 });
    },
    [camera, castFrom, groups, rapier, remove, tmp, world],
  );

  const stick = useCallback(
    (d: Dart, point: THREE.Vector3, n: THREE.Vector3) => {
      const b = d.body;
      b.setBodyType(rapier.RigidBodyType.Fixed, false);
      // A stuck dart is decoration: no collider, so balls roll past it and later darts (and aim rays) never land on it.
      world.removeCollider(b.collider(0), false);
      b.setTranslation(point.addScaledVector(n, DART.tip - DART.embed), false);
      b.setRotation(tmp.q.setFromUnitVectors(UP, n.negate()), false);
      d.state = 'stuck';
      const impact = dartImpact('stick', heardSurface(d.ahead, d.sincePerson, 'wall'), d.speed);
      if (impact) dartSound(impact.sound, point, impact.gain);
    },
    [rapier, tmp, world],
  );

  const step = useCallback(() => {
    for (let id = takeShot(); id; id = takeShot()) spawn(id);
    const { v, n, p, q } = tmp;
    for (const d of [...darts.current]) {
      if (d.state === 'loose') listenForLanding(d);
      if (d.state !== 'flying') continue;
      const b = d.body;
      const lv = b.linvel();
      const speed = Math.hypot(lv.x, lv.y, lv.z);
      v.set(lv.x, lv.y, lv.z).divideScalar(speed || 1);
      // Anything that turned or slowed it this sharply was a hit: from here on it tumbles like any other toy.
      if (speed < DART.slow || v.dot(d.dir) < 0.97) {
        tumble(d);
        continue;
      }
      d.dir.copy(v);
      b.setRotation(q.setFromUnitVectors(UP, v), true);
      b.setAngvel(ZERO, true);
      // Look ahead one step: a square-on hit on the building (a wall, desk, board or screen) sticks.
      const at = b.translation();
      ray.origin = at;
      ray.dir = v;
      const hit = world.castRayAndGetNormal(ray, speed * STEP + DART.tip, true, undefined, groups, undefined, b);
      d.speed = speed;
      if (hit) {
        const c = hit.collider;
        const body = c.parent();
        d.ahead = dartSurface({
          fixed: !!body?.isFixed(),
          tag: body?.userData,
          halfHeight: c.shapeType() === rapier.ShapeType.Cuboid ? c.halfExtents().y : null,
          normalY: hit.normal.y,
          y: at.y + v.y * hit.timeOfImpact,
        });
      } else d.ahead = null;
      d.sincePerson = d.ahead === 'person' ? 0 : d.sincePerson + 1;
      if (!hit || !hit.collider.parent()?.isFixed()) continue;
      p.set(at.x, at.y, at.z).addScaledVector(v, hit.timeOfImpact);
      const inDoorway = toyOnlyAt(floor, p.x, p.y, p.z); // doorways and the screen over a balcony's railing only exist for toys
      n.set(hit.normal.x, hit.normal.y, hit.normal.z);
      if (!inDoorway && sticks(lv, n)) stick(d, p, n);
    }
    // Safety net: a dart that somehow left the building is gone.
    if (++tick.current % 15) return;
    for (const d of [...darts.current]) if (d.state !== 'stuck' && escaped(d.body.translation())) remove(d);
  }, [floor, groups, rapier, ray, remove, spawn, stick, tmp, world]);
  useBeforePhysicsStep(step);

  useFrame(() => {
    const { foam, tip } = meshes;
    const { m, p, q } = tmp;
    const list = darts.current;
    for (let i = 0; i < list.length; i++) {
      const b = list[i].body;
      const t = b.translation();
      const r = b.rotation();
      m.compose(p.set(t.x, t.y, t.z), q.set(r.x, r.y, r.z, r.w), ONE);
      foam.setMatrixAt(i, m);
      tip.setMatrixAt(i, m);
      foam.setColorAt(i, list[i].color);
    }
    if (foam.count !== list.length || list.length) {
      foam.count = tip.count = list.length;
      foam.instanceMatrix.needsUpdate = true;
      tip.instanceMatrix.needsUpdate = true;
      if (foam.instanceColor) foam.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      <primitive object={meshes.foam} />
      <primitive object={meshes.tip} />
    </>
  );
}

// ---------- all together ----------

const onRackAll = (): Record<string, Spot> => Object.fromEntries(BLASTERS.map((b) => [b.id, { where: 'rack' } as Spot]));

/** The rack, both blasters wherever they are, and the darts. A new floor (a remount) puts both back on the rack. */
export function Blasters({ floor, groups }: { floor: ToyFloor; groups: number }) {
  const heldId = useStore((s) => (s.held?.kind === 'blaster' ? s.held.id : null));
  const camera = useThree((s) => s.camera);
  const { world, rapier } = useRapier();
  const [spots, setSpots] = useState(onRackAll);
  const prevHeld = useRef<string | null>(null);
  const drops = useRef(0);

  useEffect(() => resetBlasters(), []);

  // A blaster that leaves your hands (G, a swap, a panel opening) falls just in front of you.
  const dropSpot = useCallback((): Spot => {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const from = { x: camera.position.x, y: 1.1, z: camera.position.z };
    const hit = world.castRay(new rapier.Ray(from, fwd), 1, true, undefined, groups);
    const ahead = hit ? Math.max(0, Math.min(0.45, hit.timeOfImpact - 0.3)) : 0.45;
    return {
      where: 'loose',
      key: ++drops.current,
      at: [from.x + fwd.x * ahead, from.y, from.z + fwd.z * ahead],
      vel: [walk.x * 0.5, 0, walk.z * 0.5],
      yaw: camera.rotation.y,
    };
  }, [camera, groups, rapier, world]);

  useEffect(() => {
    const was = prevHeld.current;
    prevHeld.current = heldId;
    if (was === heldId) return;
    const dropped = was ? dropSpot() : null;
    setSpots((cur) => {
      const next = { ...cur };
      if (was && dropped) next[was] = dropped;
      if (heldId) next[heldId] = { where: 'held' };
      return next;
    });
  }, [heldId, dropSpot]);

  const backOnRack = useCallback((id: string) => setSpots((cur) => ({ ...cur, [id]: { where: 'rack' } })), []);
  const held = BLASTERS.find((b) => b.id === heldId);
  const x = floor === 'office' ? BLASTER_RACK.officeX : BLASTER_RACK.lobbyX;

  return (
    <>
      <Rack x={x} onRack={BLASTERS.filter((b) => spots[b.id]?.where === 'rack')} />
      {BLASTERS.map((b) => {
        const s = spots[b.id];
        return s?.where === 'loose' ? <LooseBlaster key={`${b.id}:${s.key}`} def={b} spot={s} groups={groups} onLost={() => backOnRack(b.id)} /> : null;
      })}
      {held && <ViewModel def={held} />}
      <Darts floor={floor} groups={groups} />
    </>
  );
}
