import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CuboidCollider, CylinderCollider, RigidBody, useBeforePhysicsStep, type CollisionEnterPayload, type RapierRigidBody } from '@react-three/rapier';
import { Outlines } from '../Outlines';
import * as THREE from 'three';
import { roombaChirp } from '../../ui/sfx';
import { useInteractable } from '../interact';
import { toon } from '../materials';
import { BALLS, type ToyFloor } from './balls';
import { setNpcRoomba, setRoombaRound } from './npc';
import { onPoke } from './poke';
import { setRoombaSource } from './probe';
import { DOCK_SIZE, FULL, ROOMBA, ROOMBA_EVENT, createRoomba, dockFor, makeNav, roombaRects, roombaStatus, sendOut, spinRoomba, stepRoomba, type Dock, type Pt, type Roomba as Brain } from './roombaBrain';
import { RoombaSounds } from './RoombaSounds';
import { Vacuum } from './RoombaVacuum';

// The floor's robot vacuum and its charging dock. roombaBrain.ts decides where it goes; this steers a kinematic
// body there every physics step (so balls it bumps get nudged) and animates the brush and status light.

const INK = '#1f1d2b';
const UP = new THREE.Vector3(0, 1, 0);
const LIGHT = { clean: new THREE.Color('#4cc9f0'), home: new THREE.Color('#ffd166'), charge: new THREE.Color('#ff9f1c'), full: new THREE.Color('#06d6a0'), off: new THREE.Color('#3a3f4b') };

const hintFor = (b: Brain) => `Roomba · ${roombaStatus(b)} (battery ${Math.round(b.battery * 100)}%)`;

/** What you aim at: an invisible puck a bit bigger than the roomba, so it's easy to hit. */
function Hint({ brain }: { brain: Brain }) {
  const [label, setLabel] = useState(() => hintFor(brain));
  const ref = useInteractable<THREE.Mesh>({ id: 'toy:roomba', label, action: { kind: 'poke', toyId: 'roomba' } }, 3);
  useFrame(() => {
    const next = hintFor(brain);
    if (next !== label) setLabel(next);
  });
  return (
    <mesh ref={ref} position={[0, 0.08, 0]}>
      <cylinderGeometry args={[0.25, 0.25, 0.16, 12]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

/** The roomba, facing local +x: a white disc with a dark front bumper, a status light and a side brush. */
function Look({ brain, light }: { brain: Brain; light: THREE.MeshBasicMaterial }) {
  const brush = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const b = brush.current;
    if (b && (brain.speed > 0 || brain.move === 'turn' || brain.move === 'follow')) b.rotation.y += Math.min(dt, 0.1) * 14;
  });
  const { r } = ROOMBA;
  return (
    <group>
      <mesh position={[0, 0.045, 0]} castShadow material={toon('#f1f3f5')}>
        <cylinderGeometry args={[r, r, 0.07, 32]} />
        <Outlines thickness={0.01} color={INK} />
      </mesh>
      {/* front bumper: half a ring round the nose */}
      <mesh position={[0, 0.04, 0]} material={toon('#495057')}>
        <cylinderGeometry args={[r + 0.008, r + 0.008, 0.045, 24, 1, false, 0, Math.PI]} />
      </mesh>
      <mesh position={[0, 0.084, 0]} material={toon('#ced4da')}>
        <cylinderGeometry args={[0.12, 0.12, 0.012, 28]} />
      </mesh>
      <mesh position={[-0.02, 0.092, 0]} material={toon('#868e96')}>
        <cylinderGeometry args={[0.035, 0.035, 0.008, 16]} />
      </mesh>
      <mesh position={[0.085, 0.09, 0]} material={light}>
        <sphereGeometry args={[0.016, 10, 8]} />
      </mesh>
      {/* side brush, front right */}
      <group ref={brush} position={[0.115, 0.012, 0.095]}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} rotation={[0, (i * 2 * Math.PI) / 3, 0]} position={[0, 0, 0]} material={toon('#adb5bd')}>
            <boxGeometry args={[0.13, 0.006, 0.008]} />
          </mesh>
        ))}
        <mesh material={toon('#495057')}>
          <cylinderGeometry args={[0.018, 0.018, 0.012, 10]} />
        </mesh>
      </group>
    </group>
  );
}

/** The charging dock against the wall, facing into the room. */
function DockLook({ dock, led, groups }: { dock: Dock; led: THREE.MeshBasicMaterial; groups: number }) {
  const { w, d, h } = DOCK_SIZE;
  const cx = (dock.rect.minX + dock.rect.maxX) / 2;
  const cz = (dock.rect.minZ + dock.rect.maxZ) / 2;
  // which way the dock faces: towards the parked roomba
  const face = Math.atan2(dock.x - cx, dock.z - cz);
  return (
    <group position={[cx, 0, cz]} rotation={[0, face, 0]}>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[w / 2, h / 2, d / 2]} position={[0, h / 2, 0]} collisionGroups={groups} />
      </RigidBody>
      <mesh position={[0, h / 2, 0]} castShadow material={toon('#343a40')}>
        <boxGeometry args={[w, h, d]} />
        <Outlines thickness={0.012} color={INK} />
      </mesh>
      <mesh position={[0, h - 0.02, 0]} material={toon('#495057')}>
        <boxGeometry args={[w + 0.02, 0.04, d + 0.02]} />
      </mesh>
      <mesh position={[0, h * 0.62, d / 2 + 0.004]} material={led}>
        <circleGeometry args={[0.022, 14]} />
      </mesh>
      {/* charging contacts on the floor, under the parked roomba's nose */}
      <mesh position={[0, 0.004, d / 2 + 0.09]} material={toon('#2b2d42')}>
        <boxGeometry args={[0.3, 0.008, 0.18]} />
      </mesh>
      {[-0.07, 0.07].map((x) => (
        <mesh key={x} position={[x, 0.009, d / 2 + 0.06]} material={toon('#ced4da')}>
          <boxGeometry args={[0.05, 0.004, 0.08]} />
        </mesh>
      ))}
    </group>
  );
}

/** One roomba and its dock, inside the floor's physics world. Remounting (a floor change) starts it fresh on its dock. */
export const Roomba = memo(function Roomba({ floor, groups, dockGroups }: { floor: ToyFloor; groups: number; dockGroups: number }) {
  const camera = useThree((s) => s.camera);
  const dock = useMemo(() => dockFor(floor), [floor]);
  const brain = useMemo(() => createRoomba(dock, (Math.random() * 2 ** 32) >>> 0), [dock]);
  const env = useMemo(() => ({ nav: makeNav(roombaRects(floor)), dock, player: { x: 0, z: 0 } as Pt | null }), [floor, dock]);
  const body = useRef<RapierRigidBody>(null);
  const at = useMemo(() => ({ x: 0, y: 0, z: 0 }), []);
  const turn = useMemo(() => new THREE.Quaternion(), []);
  const light = useMemo(() => new THREE.MeshBasicMaterial({ color: LIGHT.clean, toneMapped: false }), []);
  const led = useMemo(() => new THREE.MeshBasicMaterial({ color: LIGHT.off, toneMapped: false }), []);
  useEffect(
    () => () => {
      light.dispose();
      led.dispose();
    },
    [light, led],
  );

  useEffect(() => {
    let spins = 0;
    setRoombaSource(() => ({ x: brain.x, z: brain.z, state: brain.state, battery: Math.round(brain.battery * 100), spinning: brain.move === 'spin', spins }));
    setNpcRoomba(() => brain);
    setRoombaRound(() => sendOut(brain));
    const off = onPoke('roomba', () => {
      if (brain.move !== 'spin') spins++;
      spinRoomba(brain);
      roombaChirp({ x: brain.x, y: 0.1, z: brain.z });
    });
    return () => {
      setRoombaSource(null);
      setNpcRoomba(null);
      setRoombaRound(null);
      off();
    };
  }, [brain]);

  useBeforePhysicsStep((world) => {
    const b = body.current;
    if (!b) return;
    const p = env.player!;
    p.x = camera.position.x;
    p.z = camera.position.z;
    stepRoomba(brain, world.timestep, env);
    at.x = brain.x;
    at.z = brain.z;
    b.setNextKinematicTranslation(at);
    b.setNextKinematicRotation(turn.setFromAxisAngle(UP, -brain.heading));
  });

  // Status light: blue while cleaning, blinking yellow on the way home, a slow amber pulse while charging
  // (green once full), and a rainbow while it spins.
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const charging = brain.state === 'charging';
    if (brain.move === 'spin') light.color.setHSL((t * 2) % 1, 0.9, 0.6);
    else if (charging) light.color.copy(brain.battery >= FULL ? LIGHT.full : LIGHT.charge).multiplyScalar(0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 3)));
    else if (brain.state === 'returning' || brain.state === 'docking') light.color.copy(Math.sin(t * 8) > 0 ? LIGHT.home : LIGHT.off);
    else light.color.copy(LIGHT.clean);
    led.color.copy(charging ? light.color : LIGHT.off);
  });

  // Nudging a ball counts as a bump for the bonk (walls and furniture are the brain's own bumps).
  const balls = useMemo(() => new Set(BALLS[floor].map((b) => b.id)), [floor]);
  const onHit = useMemo(
    () => (e: CollisionEnterPayload) => {
      const toy = (e.other.rigidBodyObject?.userData as { toy?: string } | undefined)?.toy;
      if (toy && balls.has(toy)) brain.events |= ROOMBA_EVENT.bump;
    },
    [balls, brain],
  );

  return (
    <>
      <DockLook dock={dock} led={led} groups={dockGroups} />
      <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[dock.x, 0, dock.z]} rotation={[0, -dock.heading, 0]} userData={{ toy: 'roomba' }} onCollisionEnter={onHit}>
        <CylinderCollider args={[ROOMBA.h / 2, ROOMBA.r]} position={[0, ROOMBA.h / 2 + 0.005, 0]} friction={0.3} restitution={0.3} collisionGroups={groups} />
        <Look brain={brain} light={light} />
        <Hint brain={brain} />
      </RigidBody>
      <Vacuum brain={brain} />
      <RoombaSounds brain={brain} />
    </>
  );
});
