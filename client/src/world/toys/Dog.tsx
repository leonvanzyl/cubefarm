import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CuboidCollider, RigidBody, useBeforePhysicsStep, useRapier, type CollisionEnterPayload, type RapierCollider, type RapierRigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { repoOnFloor, useStore } from '../../store';
import { ding } from '../../ui/sfx';
import type { BodyState } from '../body';
import { SANS } from '../draw';
import { useInteractable } from '../interact';
import { GONG_SPOT, HALF_D, SPAWN } from '../layout';
import { toon } from '../materials';
import { Outlines } from '../Outlines';
import { bodyState, liveBodies } from '../people';
import { walkways } from '../walkways';
import { Zzz } from '../Zzz';
import { BALLS, type ToyFloor } from './balls';
import { dogLeft, dogMayLeave, dogName, dogNow, dogOn, dogRides, dogSeen, dogStats, setDogHooks, setDogLive, setDogThrow, takeArrival, takeParty, takeRelease, troubled } from './dogState';
import { DOG_EVENT, ballReleased, boardDog, callDog, createDog, delightDog, dogAsleep, dogStatus, leaveDogNow, napDogNow, partyDog, petDog, stepDog, type Dog as Brain, type DogBall, type DogEnv, type DogFriend, type DogWalker } from './dogBrain';
import { DOG_R, byDoors, dogPlaces, lapSpot } from './dogPlaces';
import { cadence, headAim, newJoints, rig, type DogJoints, type RigInput } from './dogRig';
import { DogSounds } from './DogSounds';
import { throwHeld } from './hands';
import { ballHolder, npcBalls, npcGrips, npcHolding, npcLetGo, npcLost, npcPickUp, npcPose, npcRoomba, setNpcStance } from './npc';
import { onPoke } from './poke';
import { clear } from './roombaBrain';
import { CHARGE, holdPoint, type View } from './throwing';

// The office dog on the floor you're on (one for the whole building: dogState.ts says which floor it's on). Its brain
// (dogBrain.ts) runs every physics step and steers a kinematic body the balls bounce off; it carries a fetched ball
// through the same hands other people use (npc.ts), so you can take it back. The body is a chunky toon dog with a
// collar and name tag, rigged by dogRig.ts: a tail that wags with its mood, floppy ears, a walk, trot and gallop,
// sitting, lying and hopping. E pets it.

const UP = new THREE.Vector3(0, 1, 0);
const ZERO = { x: 0, y: 0, z: 0 };
const INK = '#1f1d2b';
const COAT = '#d9a066';
const CREAM = '#f6e3c3';
const EARS = '#a8673a';
const DARK = '#2b2d42';

/**
 * The collider round its body: balls bounce off it. It's off while it carries a ball, which would otherwise catch on it
 * as it swings round in front (npcAim.ts 'mouth') when the dog turns.
 */
const BODY = { half: [0.36, 0.17, 0.14] as [number, number, number], y: 0.36 };

// ---------- the look ----------

const heartGeometry = new THREE.PlaneGeometry(0.16, 0.16);
let heartMaterial: THREE.MeshBasicMaterial | null = null;

/** A red toon heart on a canvas, made on first use (in the browser, not at import). */
function heart() {
  if (heartMaterial) return heartMaterial;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = `700 50px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.fillStyle = '#ff4d6d';
  ctx.beginPath();
  ctx.moveTo(32, 54);
  ctx.bezierCurveTo(6, 36, 6, 12, 22, 12);
  ctx.bezierCurveTo(28, 12, 32, 17, 32, 22);
  ctx.bezierCurveTo(32, 17, 36, 12, 42, 12);
  ctx.bezierCurveTo(58, 12, 58, 36, 32, 54);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  heartMaterial = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false });
  return heartMaterial;
}

/** Hearts rising over its head after a pet (`at.current` is performance.now() of the pet). */
function Hearts({ at }: { at: { current: number } }) {
  const g = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  const q = useMemo(() => ({ parent: new THREE.Quaternion(), camera: new THREE.Quaternion() }), []);
  useFrame(() => {
    const grp = g.current;
    if (!grp) return;
    const age = (performance.now() - at.current) / 1000;
    grp.visible = age >= 0 && age < 1.6;
    if (!grp.visible || !grp.parent) return;
    grp.parent.getWorldQuaternion(q.parent);
    grp.quaternion.copy(q.parent.invert().multiply(camera.getWorldQuaternion(q.camera)));
    for (let i = 0; i < grp.children.length; i++) {
      const h = grp.children[i];
      const f = Math.min(1, Math.max(0, (age - i * 0.18) / 1.1));
      const fade = f <= 0 || f >= 1 ? 0 : f < 0.15 ? f / 0.15 : f > 0.7 ? (1 - f) / 0.3 : 1;
      h.position.set((i - 1) * 0.13 + Math.sin(f * 6 + i) * 0.04, f * 0.45, 0);
      h.scale.setScalar(Math.max(0.001, (0.6 + f * 0.6) * fade));
    }
  });
  return (
    <group ref={g} position={[0.3, 0.88, 0]} visible={false}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} geometry={heartGeometry} material={heart()} renderOrder={2} />
      ))}
    </group>
  );
}

const JOINTS: (keyof DogJoints)[] = ['drop', 'pitch', 'sway', 'fl', 'fr', 'rl', 'rr', 'headYaw', 'headPitch', 'reach', 'tailYaw', 'tailLift', 'earOut', 'earBack', 'tongue'];
const LEGS = new Set<keyof DogJoints>(['fl', 'fr', 'rl', 'rr']);

/** One leg, hanging from its hip or shoulder: rotation.z swings the paw forward. */
function Leg({ legRef, at }: { legRef: React.RefObject<THREE.Group | null>; at: [number, number, number] }) {
  return (
    <group ref={legRef} position={at}>
      <mesh position={[0, -0.14, 0]} castShadow material={toon(COAT)}>
        <cylinderGeometry args={[0.058, 0.05, 0.28, 10]} />
      </mesh>
      <mesh position={[0.025, -0.285, 0]} scale={[1.35, 0.65, 1.05]} material={toon(CREAM)}>
        <sphereGeometry args={[0.064, 12, 8]} />
      </mesh>
    </group>
  );
}

/**
 * The dog, facing +x with its paws on the floor at the origin. The rear legs hang from the root (so sitting folds them
 * flat), everything else from the hips, which pitch the body up to sit.
 */
function DogLook({ brain, gait, carrying }: { brain: Brain; gait: { phase: number }; carrying: { current: string | null } }) {
  const root = useRef<THREE.Group>(null);
  const hips = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const earL = useRef<THREE.Group>(null);
  const earR = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  const tongue = useRef<THREE.Mesh>(null);
  const fl = useRef<THREE.Group>(null);
  const fr = useRef<THREE.Group>(null);
  const rl = useRef<THREE.Group>(null);
  const rr = useRef<THREE.Group>(null);
  const j = useMemo(newJoints, []);
  const cur = useMemo(newJoints, []);
  const input = useMemo<RigInput>(() => ({ pose: 'stand', speed: 0, happy: 0.5, wiggle: 0, phase: 0, t: 0, panting: false, carrying: false, lookYaw: 0, lookPitch: 0, looking: false }), []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    gait.phase += dt * cadence(brain.speed) * Math.PI * 2;
    input.pose = brain.pose;
    input.speed = brain.speed;
    input.happy = brain.happy;
    input.wiggle = brain.wiggle;
    input.phase = gait.phase;
    input.t = performance.now() / 1000;
    input.panting = brain.pant > 0;
    input.carrying = carrying.current !== null;
    input.looking = brain.look.on;
    if (brain.look.on) {
      const hx = brain.x + Math.cos(brain.heading) * 0.35;
      const hz = brain.z + Math.sin(brain.heading) * 0.35;
      const a = headAim(brain.heading, brain.look.x - hx, brain.look.y - (brain.y + 0.55), brain.look.z - hz);
      input.lookYaw = a.yaw;
      input.lookPitch = a.pitch;
    }
    rig(input, j);
    const moving = brain.speed > 0.08;
    const k = 1 - Math.exp(-dt * 9);
    for (let i = 0; i < JOINTS.length; i++) {
      const key = JOINTS[i];
      cur[key] += (j[key] - cur[key]) * (moving && LEGS.has(key) ? 1 : k);
    }
    if (root.current) {
      root.current.position.y = -cur.drop;
      root.current.rotation.y = cur.sway;
    }
    if (hips.current) hips.current.rotation.z = cur.pitch;
    if (head.current) {
      head.current.position.x = 0.26 + cur.reach;
      head.current.rotation.set(0, cur.headYaw, cur.headPitch, 'YXZ');
    }
    if (tail.current) tail.current.rotation.set(0, cur.tailYaw, -cur.tailLift, 'YXZ');
    if (earL.current) earL.current.rotation.set(cur.earOut, 0, -cur.earBack);
    if (earR.current) earR.current.rotation.set(-cur.earOut, 0, -cur.earBack);
    if (tongue.current) tongue.current.visible = cur.tongue > 0.5;
    if (fl.current) fl.current.rotation.z = cur.fl;
    if (fr.current) fr.current.rotation.z = cur.fr;
    if (rl.current) rl.current.rotation.z = cur.rl;
    if (rr.current) rr.current.rotation.z = cur.rr;
  });

  return (
    <group ref={root}>
      <Leg legRef={rl} at={[-0.18, 0.3, -0.085]} />
      <Leg legRef={rr} at={[-0.18, 0.3, 0.085]} />
      <group ref={hips} position={[-0.18, 0.3, 0]}>
        <group position={[0.18, -0.3, 0]}>
          {/* body: a chunky capsule with a cream belly and a round rump */}
          <mesh position={[0.01, 0.36, 0]} rotation={[0, 0, Math.PI / 2]} castShadow material={toon(COAT)}>
            <capsuleGeometry args={[0.15, 0.32, 6, 14]} />
            <Outlines thickness={0.012} color={INK} />
          </mesh>
          <mesh position={[0.03, 0.28, 0]} scale={[1.6, 0.65, 0.95]} material={toon(CREAM)}>
            <sphereGeometry args={[0.13, 14, 10]} />
          </mesh>
          <Leg legRef={fl} at={[0.17, 0.3, -0.085]} />
          <Leg legRef={fr} at={[0.17, 0.3, 0.085]} />
          {/* collar and its round name tag */}
          <mesh position={[0.21, 0.45, 0]} rotation={[0, Math.PI / 2, -0.55]} material={toon('#e63946')}>
            <torusGeometry args={[0.105, 0.022, 8, 20]} />
          </mesh>
          <mesh position={[0.29, 0.34, 0]} rotation={[0, 0, Math.PI / 2]} material={toon('#ffd166')}>
            <cylinderGeometry args={[0.032, 0.032, 0.01, 14]} />
          </mesh>
          {/* the tail, wagging from its base */}
          <group ref={tail} position={[-0.3, 0.44, 0]}>
            <mesh position={[-0.05, 0.08, 0]} rotation={[0, 0, 0.6]} castShadow material={toon(COAT)}>
              <capsuleGeometry args={[0.03, 0.16, 4, 8]} />
            </mesh>
          </group>
          {/* head on the neck: turns and nods about here */}
          <group ref={head} position={[0.26, 0.5, 0]}>
            <mesh position={[0.06, 0.06, 0]} scale={[1.05, 0.95, 0.95]} castShadow material={toon(COAT)}>
              <sphereGeometry args={[0.14, 18, 14]} />
              <Outlines thickness={0.012} color={INK} />
            </mesh>
            <mesh position={[0.18, 0, 0]} scale={[1.35, 0.8, 0.95]} material={toon(CREAM)}>
              <sphereGeometry args={[0.075, 14, 10]} />
            </mesh>
            <mesh position={[0.28, 0.025, 0]} material={toon(DARK)}>
              <sphereGeometry args={[0.028, 10, 8]} />
            </mesh>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[0.14, 0.1, s * 0.068]} material={toon(DARK)}>
                <sphereGeometry args={[0.021, 8, 6]} />
              </mesh>
            ))}
            <mesh ref={tongue} position={[0.2, -0.065, 0]} visible={false} material={toon('#ff8fa3')}>
              <boxGeometry args={[0.06, 0.012, 0.04]} />
            </mesh>
            {/* floppy ears, hanging from the top of the head */}
            <group ref={earL} position={[0.02, 0.15, -0.105]}>
              <mesh position={[0, -0.075, -0.012]} scale={[0.55, 1.25, 0.3]} material={toon(EARS)}>
                <sphereGeometry args={[0.07, 12, 8]} />
              </mesh>
            </group>
            <group ref={earR} position={[0.02, 0.15, 0.105]}>
              <mesh position={[0, -0.075, 0.012]} scale={[0.55, 1.25, 0.3]} material={toon(EARS)}>
                <sphereGeometry args={[0.07, 12, 8]} />
              </mesh>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

/** What you aim at to pet it: an invisible box a bit bigger than the dog. */
function Hint({ brain }: { brain: Brain }) {
  const name = useStore((s) => s.settings.dogName);
  const label = () => `Pet ${name?.trim() || dogName()} · ${dogStatus(brain)}`;
  const [text, setText] = useState(label);
  const ref = useInteractable<THREE.Mesh>({ id: 'toy:dog', label: text, action: { kind: 'poke', toyId: 'dog' } }, 3);
  useFrame(() => {
    const next = label();
    if (next !== text) setText(next);
  });
  return (
    <mesh ref={ref} position={[0.05, 0.4, 0]}>
      <boxGeometry args={[0.95, 0.8, 0.45]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

// ---------- the body in the physics world ----------

const SECOND = 60; // physics steps

/** Where it shows up on this floor, and its brain. */
function spawn(floor: ToyFloor): Brain {
  const places = dogPlaces(floor);
  const a = takeArrival();
  const seed = (Math.random() * 2 ** 32) >>> 0;
  let at = { x: SPAWN.x + 0.9, z: SPAWN.z - 0.4, heading: -Math.PI / 2 }; // beside you, out of the elevator together
  if (a.how === 'here') {
    const seen = a.seen && clear(places.rects, a.seen.x, a.seen.z, DOG_R) && !byDoors(a.seen.x, a.seen.z) ? a.seen : null;
    const s = places.sniffs[Math.floor(Math.random() * places.sniffs.length)];
    at = seen ?? { x: s.x, z: s.z, heading: s.heading };
  }
  const brain = createDog(places, a.how, at, seed);
  if (a.called) callDog(brain);
  if (a.follow > 0) brain.followUntil = a.follow;
  if (a.how === 'cabin') ding({ x: 0, y: 2.6, z: HALF_D });
  return brain;
}

function DogBody({ floor, level, groups }: { floor: ToyFloor; level: number; groups: number }) {
  const camera = useThree((s) => s.camera);
  const repoId = useStore((s) => (level === 0 ? null : (repoOnFloor(s.repos, level)?.id ?? null)));
  const brain = useMemo(() => spawn(floor), [floor]);
  const body = useRef<RapierRigidBody>(null);
  const collider = useRef<RapierCollider>(null);
  const gait = useMemo(() => ({ phase: 0 }), []);
  const pending = useMemo(() => ({ bits: 0 }), []);
  const petAt = useRef(-Infinity);
  const asleep = useRef(false);
  const carrying = useRef<string | null>(null);
  const env = useMemo<DogEnv>(
    () => ({
      nav: walkways(floor).nav,
      places: dogPlaces(floor),
      player: { x: 0, z: 0, fx: 0, fz: -1, holding: null },
      walkers: [],
      roomba: null,
      balls: [],
      holding: null,
      friends: [],
      party: null,
      canLeave: dogMayLeave(),
    }),
    [floor],
  );
  // Everything the physics step fills in, made once.
  const s = useMemo(() => {
    const walkers: DogWalker[] = [];
    const balls: DogBall[] = [];
    const st = {
      walkers,
      walking: 0,
      balls,
      roomba: { x: 0, z: 0, moving: false },
      party: { x: 0, z: 0 },
      partyWith: null as string | null,
      stance: { x: 0, z: 0, heading: 0 },
      at: { x: 0, y: 0, z: 0 },
      q: new THREE.Quaternion(),
      tick: 0,
      left: false,
      goneAt: 0,
      // fills `walkers` from everyone up and about, without allocating once they're known
      walker: (b: BodyState) => {
        if (b.stage === 'seated') return;
        const w = (walkers[st.walking] ??= { x: 0, z: 0, fx: 0, fz: 0, speed: 0 });
        w.x = b.x;
        w.z = b.z;
        w.fx = -Math.sin(b.heading);
        w.fz = -Math.cos(b.heading);
        w.speed = b.speed;
        st.walking++;
      },
      holder: (g: { ball: string }, who: string) => {
        for (const b of balls) if (b.id === g.ball) b.holder = who === 'dog' ? 'dog' : 'other';
      },
    };
    return st;
  }, []);

  const pet = () => {
    petDog(brain);
    petAt.current = performance.now();
    dogStats.pets++;
  };

  useEffect(() => {
    setNpcStance('dog', () => s.stance);
    setDogLive(() => ({
      x: brain.x,
      z: brain.z,
      y: brain.y,
      heading: brain.heading,
      state: brain.state,
      pose: brain.pose,
      target: brain.target.kind ? { ...brain.target, kind: brain.target.kind } : null,
      carrying: carrying.current,
      happy: brain.happy,
      asleep: dogAsleep(brain),
      speed: brain.speed,
    }));
    setDogHooks({
      pet,
      come: () => callDog(brain),
      nap: () => napDogNow(brain),
      leave: () => leaveDogNow(brain),
      party: (agentId) => {
        partyDog(brain, agentId);
        s.partyWith = agentId;
      },
    });
    const off = onPoke('dog', pet);
    // Taking the elevator with it close by and playing with you: it rides along.
    const unsub = useStore.subscribe((st, prev) => {
      if (!st.travel || prev.travel || brain.state === 'gone' || brain.state === 'leave') return;
      const keen = brain.clock < brain.followUntil || brain.state === 'eager' || brain.state === 'fetch' || brain.state === 'bring';
      if (!keen || Math.hypot(brain.x, brain.z - HALF_D) > 7) return;
      boardDog(brain);
      dogRides(st.travel.to, Math.max(0, brain.followUntil - brain.clock));
    });
    return () => {
      off();
      unsub();
      setNpcStance('dog', null);
      setDogLive(null);
      setDogHooks(null);
      dogNow.drawn = false;
      // you left it here: it carries on from where it was when you come back (or it's off in the elevator after all)
      if (brain.state === 'gone' && !s.left) dogLeft(level);
      else if (brain.state !== 'gone' && brain.state !== 'board') dogSeen(level, brain.x, brain.z, brain.heading);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pet only touches brain
  }, [brain, s, level]);

  useBeforePhysicsStep((world) => {
    const b = body.current;
    if (!b) return;
    const store = useStore.getState();
    const held = store.held?.kind === 'ball' ? store.held.id : null;

    // ---------- what it sees ----------
    const p = env.player!;
    p.x = camera.position.x;
    p.z = camera.position.z;
    p.fx = -Math.sin(camera.rotation.y);
    p.fz = -Math.cos(camera.rotation.y);
    p.holding = held;
    s.walking = 0;
    liveBodies().forEach(s.walker);
    s.walkers.length = s.walking;
    env.walkers = s.walkers;
    const r = npcRoomba();
    if (r) {
      s.roomba.x = r.x;
      s.roomba.z = r.z;
      s.roomba.moving = r.state !== 'charging' && r.move !== 'idle' && r.move !== 'wait';
    }
    env.roomba = r ? s.roomba : null;
    const list = npcBalls();
    if (s.balls.length !== list.length) {
      s.balls.length = 0;
      for (const nb of list) s.balls.push({ id: nb.id, x: 0, y: 0, z: 0, r: nb.r, vx: 0, vy: 0, vz: 0, holder: null });
    }
    for (let i = 0; i < list.length; i++) {
      const nb = list[i];
      const db = s.balls[i];
      db.x = nb.x;
      db.y = nb.y;
      db.z = nb.z;
      db.vx = nb.vx;
      db.vy = nb.vy;
      db.vz = nb.vz;
      db.holder = nb.id === held ? 'player' : null;
    }
    npcGrips().forEach(s.holder);
    env.balls = s.balls;
    env.holding = npcHolding('dog');
    npcLost('dog'); // the ball leaving its mouth shows in env.holding
    const released = takeRelease();
    if (released) ballReleased(brain, released);

    // now and then: who's having a hard time, a merge, and whether there's another floor to go to
    if (s.tick++ % SECOND === 0) {
      const friends: DogFriend[] = [];
      for (const id of repoId ? troubled(repoId) : []) {
        // at their desk (seated, or up beside the chair for a stretch), or away from it for now
        const st = bodyState(id);
        if (st) friends.push({ ...lapSpot(st.seatX, st.seatZ, st.seatHeading), id, away: st.stage !== 'seated' && Math.hypot(st.x - st.seatX, st.z - st.seatZ) > 1.2 });
      }
      env.friends = friends;
      env.canLeave = dogMayLeave();
    }
    if (repoId && s.tick % 6 === 0) {
      const party = takeParty(repoId);
      if (party) {
        partyDog(brain, party.agentId);
        s.partyWith = party.agentId;
      }
    }
    if (brain.clock < brain.partyUntil) {
      const who = s.partyWith ? bodyState(s.partyWith) : undefined;
      const at = who ?? (floor === 'office' ? GONG_SPOT : null);
      if (at) {
        s.party.x = at.x;
        s.party.z = at.z;
      }
      env.party = at ? s.party : null;
    } else env.party = null;

    // ---------- think, then move ----------
    const had = env.holding;
    stepDog(brain, world.timestep, env);
    // its mouth, through the hands everyone shares
    if (brain.mouth !== env.holding) {
      if (env.holding) npcLetGo('dog');
      else if (brain.mouth && ballHolder(brain.mouth) === null && npcPickUp('dog', brain.mouth)) npcPose('dog', 'mouth');
    }
    const c = collider.current;
    if (c && c.isEnabled() !== (env.holding === null)) c.setEnabled(env.holding === null);
    carrying.current = env.holding;
    s.stance.x = brain.x;
    s.stance.z = brain.z;
    s.stance.heading = Math.atan2(-Math.cos(brain.heading), -Math.sin(brain.heading)); // body.ts's heading
    s.at.x = brain.x;
    s.at.y = brain.y;
    s.at.z = brain.z;
    b.setNextKinematicTranslation(s.at);
    b.setNextKinematicRotation(s.q.setFromAxisAngle(UP, -brain.heading));
    asleep.current = dogAsleep(brain);
    dogNow.drawn = brain.state !== 'gone';
    dogNow.x = brain.x;
    dogNow.z = brain.z;

    // ---------- what happened ----------
    const ev = brain.events;
    brain.events = 0;
    if (ev) {
      pending.bits |= ev;
      if (ev & DOG_EVENT.fetch) dogStats.fetches++;
      if (ev & DOG_EVENT.lost) dogStats.lost++;
      if (ev & DOG_EVENT.visit) dogStats.visits++;
      if (ev & DOG_EVENT.party) dogStats.parties++;
      if (ev & DOG_EVENT.nap) dogStats.naps++;
      if (ev & DOG_EVENT.bark) dogStats.barks++;
      if (ev & DOG_EVENT.returned) {
        dogStats.returned++;
        const ball = s.balls.find((x) => x.id === had);
        if (ball) dogStats.lastDrop = Math.round(Math.hypot(ball.x - p.x, ball.z - p.z) * 100) / 100;
      }
      if (ev & DOG_EVENT.gone) s.goneAt = brain.clock;
    }
    // into the elevator: the doors close on it (dogNow.drawn is off), then it's away
    if (brain.state === 'gone' && !s.left && brain.clock - s.goneAt > 1.5) {
      s.left = true;
      dogLeft(level);
    }
  });

  // A ball bounced off it: no harm done, it's delighted.
  const balls = useMemo(() => new Set(BALLS[floor].map((x) => x.id)), [floor]);
  const onHit = useMemo(
    () => (e: CollisionEnterPayload) => {
      const toy = (e.other.rigidBodyObject?.userData as { toy?: string } | undefined)?.toy;
      const rb = e.other.rigidBody;
      if (!toy || !balls.has(toy) || !rb || toy === carrying.current) return;
      const v = rb.linvel();
      if (Math.hypot(v.x, v.y, v.z) < 2) return;
      delightDog(brain);
      dogStats.delighted++;
    },
    [balls, brain],
  );

  const start = brain;
  return (
    <>
      <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[start.x, start.y, start.z]} rotation={[0, -start.heading, 0]} userData={{ toy: 'dog' }} onCollisionEnter={onHit}>
        <CuboidCollider ref={collider} args={BODY.half} position={[0, BODY.y, 0]} friction={0.4} restitution={0.6} collisionGroups={groups} />
        <DogLook brain={brain} gait={gait} carrying={carrying} />
        <Hint brain={brain} />
        <Hearts at={petAt} />
        <Zzz on={asleep} position={[0.34, 0.5, 0]} />
      </RigidBody>
      <DogSounds brain={brain} pending={pending} gait={gait} floor={floor} />
    </>
  );
}

// ---------- the floor ----------

/**
 * QA's throw (__swarmDog.fetch): a loose ball (nobody's holding it) straight into your hands, then thrown along your
 * view as charged to `power`, exactly as a real throw goes. Works on any floor with toys, dog or no dog.
 */
function useQaThrow() {
  const { world } = useRapier();
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    setDogThrow((id, power) => {
      const st = useStore.getState();
      if (st.travel || st.overlay) return null;
      const loose = npcBalls().filter((b) => (id ? b.id === id : true) && ballHolder(b.id) === null);
      loose.sort((a, b) => Math.hypot(a.x - camera.position.x, a.z - camera.position.z) - Math.hypot(b.x - camera.position.x, b.z - camera.position.z));
      const pick = loose[0];
      if (!pick) return null;
      let found: RapierRigidBody | null = null;
      world.forEachRigidBody((b) => {
        if ((b.userData as { toy?: string } | undefined)?.toy === pick.id) found = b as RapierRigidBody;
      });
      const b = found as RapierRigidBody | null;
      if (!b) return null;
      const view: View = { eye: camera.position, pitch: camera.rotation.x, yaw: camera.rotation.y };
      b.setTranslation(holdPoint(view, pick.r, 0, { x: 0, y: 0, z: 0 }), true);
      b.setLinvel(ZERO, true);
      st.setHeld({ kind: 'ball', id: pick.id });
      const p = Math.min(1, Math.max(0, power));
      setTimeout(() => {
        const now = useStore.getState();
        if (now.held?.kind !== 'ball' || now.held.id !== pick.id) return;
        now.setCharge(performance.now() - (CHARGE.tap + p * (CHARGE.full - CHARGE.tap)));
        throwHeld();
      }, 400);
      return pick.id;
    });
    return () => setDogThrow(null);
  }, [world, camera]);
}

/** The dog, when it's on this floor: checked about once a second (it may come up in the elevator). */
export const Dog = memo(function Dog({ floor, groups }: { floor: ToyFloor; groups: number }) {
  const storeFloor = useStore((s) => s.floor);
  const level = floor === 'lobby' ? 0 : storeFloor;
  const [here, setHere] = useState(() => dogOn(level));
  useEffect(() => {
    const tick = () => setHere(dogOn(level));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [level]);
  useQaThrow();
  return here ? <DogBody floor={floor} level={level} groups={groups} /> : null;
});
