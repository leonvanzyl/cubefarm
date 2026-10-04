// Office rituals (ritualSchedule.ts decides when, ritualRunner.ts carries them out): the stand-up at the whiteboard
// when the CEO files a burst of issues, the CEO walking the floor, lunch, Friday pizza and the evening wind-down. This
// mounts the runner for the floor you're on and draws what the rituals add: the visiting CEO (E on them texts them),
// the pizza courier, the desk lamps, lunch at busy desks and the pizza on the coffee table. It runs in the render
// loop, so it pauses with the render. QA: `?ritual=standup|lunch|pizza|winddown|ceo-walk` forces one a moment after
// you arrive, and window.__swarmRituals shows what's scheduled or running (state()), forces one (force(name)) or pins
// the clock (clock({ hour, weekday }), null to let go).

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CEO_ID, type RepoView } from '../../../shared/types';
import { useRenderPaused } from '../perf';
import { useStore, type Agent } from '../store';
import { Character } from './Character';
import { NameTag } from './Desk';
import { FoodLook, OpenPizza, PIZZA_STACK, PizzaBox } from './food';
import { useInteractable } from './interact';
import { QA_ROTATION, deskPosition, qaDeskPosition } from './layout';
import { meals, mealsVersion, subscribeMeals } from './meals';
import { isHidden } from './people';
import { COURIER_ID, LobbyRitualRunner, OfficeRitualRunner } from './ritualRunner';
import { ritualLook } from './ritualLook';
import { COFFEE_TABLE, lunchOf, parseRitualParam, RITUALS, type Ritual } from './ritualSchedule';
import { CABIN } from './socials';
import { merged } from './shapes';
import { toon } from './materials';

let active: OfficeRitualRunner | LobbyRitualRunner | null = null;

/** `?ritual=…`, read once. */
const forcedByUrl = typeof window !== 'undefined' ? parseRitualParam(window.location.search) : null;

/** Steps a runner every frame on the ritual clock: nothing moves while the render is paused, and no catch-up after. */
function useRunner(run: OfficeRitualRunner | LobbyRitualRunner) {
  const paused = useRenderPaused();
  const fresh = useRef(true);
  useEffect(() => {
    if (!paused) fresh.current = true;
  }, [paused]);
  useEffect(() => {
    active = run;
    if (forcedByUrl) run.after(2.5, () => run.force(forcedByUrl));
    return () => {
      if (active === run) active = null;
      run.dispose();
    };
  }, [run]);
  useFrame((_, delta) => {
    const dt = fresh.current ? 0 : Math.min(delta, 0.1);
    fresh.current = false;
    run.tick(dt);
  });
}

/** The rituals on an office floor. */
export function OfficeRituals({ repo, agents }: { repo: RepoView; agents: Agent[] }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one runner per floor (OfficeFloor is keyed by repo)
  const run = useMemo(() => new OfficeRitualRunner(repo, agents), [repo.id]);
  run.repo = repo;
  run.agents = agents;
  const [cast, setCast] = useState({ ...run.cast });
  run.onCast = () => setCast({ ...run.cast });
  useRunner(run);
  const ceo = useStore((s) => s.agents[CEO_ID]);
  return (
    <>
      {cast.ceo && ceo && <Visitor agent={ceo} ceo />}
      {cast.courier && <Visitor agent={COURIER} carrying={PIZZA_STACK} scale={0.8} />}
      <DeskLamps agents={agents} />
      <DeskLunch agents={agents} />
      <TablePizza />
    </>
  );
}

/** The lobby's part: the CEO leaving their desk for a walk round the floors, and coming back. */
export function LobbyRituals() {
  const run = useMemo(() => new LobbyRitualRunner(), []);
  useRunner(run);
  return null;
}

// ---------- visitors ----------

/** The pizza courier, a person for the day (Character.tsx draws anyone with an Agent's looks). */
const COURIER: Agent = {
  id: COURIER_ID,
  name: 'Pizza delivery',
  repoId: '',
  role: 'dev',
  title: '',
  specialty: '',
  brief: '',
  hiredBy: 'manager',
  look: 'masculine',
  task: null,
  desk: 0,
  color: '#e63946',
  hair: '#3d2b1f',
  skin: '#d9a066',
  style: null,
  model: '',
  effort: '',
  cli: '',
  terminal: false,
  status: 'idle',
  issueNumber: null,
  issueTitle: null,
  branch: null,
  prNumber: null,
  prUrl: null,
  currentTool: null,
  startedAt: null,
  endedAt: null,
  costUsd: 0,
  turns: 0,
  browserUrl: null,
  hasScreenshot: false,
  screenshotAt: null,
  lastError: null,
};

/** Someone visiting the floor, drawn from inside the elevator cabin (their "chair") while ritualRunner.ts walks them. */
function Visitor({ agent, ceo = false, carrying, scale }: { agent: Agent; ceo?: boolean; carrying?: ReactNode; scale?: number }) {
  const ref = useInteractable<THREE.Group>(ceo ? { id: 'ceo-visit', label: `Text ${agent.name} (CEO) on your phone`, action: { kind: 'phone', tab: 'chat' } } : null, 3.2);
  return (
    <group ref={ref} position={[CABIN.x, 0, CABIN.z]}>
      <Character agent={agent} carrying={carrying} scale={scale}>
        {ceo && <NameTag agent={agent} />}
      </Character>
    </group>
  );
}

// ---------- the desks ----------

/** Where something on a desk is in the world: the desk's place and turn, then the spot on it (desk space). */
function onDesk(a: Agent, x: number, y: number, z: number) {
  const qa = a.role === 'qa';
  const d = qa ? qaDeskPosition(a.desk) : deskPosition(a.desk);
  const turn = qa ? QA_ROTATION : 0;
  return { x: d.x + x * Math.cos(turn) + z * Math.sin(turn), y, z: d.z - x * Math.sin(turn) + z * Math.cos(turn), turn };
}

const LAMP_MAX = 16;
/** The lamp's foot on the desk (desk space): the back corner on the mug's side, its shade over towards the keyboard. */
const LAMP_AT = { x: 0.72, y: 0.77, z: -0.3 };
// lamp space: its foot on the desk, the shade leaning towards -x
const lampGeometry = merged([
  new THREE.CylinderGeometry(0.065, 0.08, 0.025, 16).translate(0, 0.0125, 0),
  new THREE.CylinderGeometry(0.012, 0.012, 0.36, 8).translate(0, 0.2, 0),
  new THREE.CylinderGeometry(0.01, 0.01, 0.17, 8).rotateZ(Math.PI / 2).translate(-0.085, 0.375, 0),
  new THREE.CylinderGeometry(0.04, 0.09, 0.11, 16).translate(-0.17, 0.33, 0),
]);
const bulbGeometry = new THREE.SphereGeometry(0.035, 12, 8).translate(-0.17, 0.27, 0);
// the warm pool of light on the desk under the shade
const poolGeometry = new THREE.PlaneGeometry(0.85, 0.75).rotateX(-Math.PI / 2).translate(-0.4, 0.006, 0.14);
const BULB_OFF = new THREE.Color('#d6d0c2');
const BULB_ON = new THREE.Color('#fff1c1');
const bulbMaterial = new THREE.MeshBasicMaterial({ color: BULB_OFF.clone(), toneMapped: false });
const poolMaterial = new THREE.MeshBasicMaterial({ map: poolTexture(), color: '#ffd89a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });

function poolTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A lamp on every occupied desk, lit while the floor winds down for the evening (off at the desks of anyone gone home). */
function DeskLamps({ agents }: { agents: Agent[] }) {
  const lamps = useRef<THREE.InstancedMesh>(null);
  const bulbs = useRef<THREE.InstancedMesh>(null);
  const pools = useRef<THREE.InstancedMesh>(null);
  const desks = useMemo(() => agents.filter((a) => a.role === 'dev' || a.role === 'qa').slice(0, LAMP_MAX), [agents]);
  const seen = useMemo(() => ({ key: '', level: -1, m: new THREE.Matrix4(), off: new THREE.Matrix4().makeScale(0, 0, 0), q: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0) }), []);
  const place = (a: Agent) => {
    const p = onDesk(a, LAMP_AT.x, LAMP_AT.y, LAMP_AT.z);
    return seen.m.compose(new THREE.Vector3(p.x, p.y, p.z), seen.q.setFromAxisAngle(seen.up, p.turn), new THREE.Vector3(1, 1, 1));
  };
  useLayoutEffect(() => {
    const [m, b, p] = [lamps.current, bulbs.current, pools.current];
    if (!m || !b || !p) return;
    desks.forEach((a, i) => {
      m.setMatrixAt(i, place(a));
      b.setMatrixAt(i, seen.off);
      p.setMatrixAt(i, seen.off);
    });
    m.count = b.count = p.count = desks.length;
    m.instanceMatrix.needsUpdate = b.instanceMatrix.needsUpdate = p.instanceMatrix.needsUpdate = true;
    seen.key = '';
    // eslint-disable-next-line react-hooks/exhaustive-deps -- place only uses `seen`
  }, [desks, seen]);
  useFrame(() => {
    const b = bulbs.current;
    const p = pools.current;
    if (!b || !p) return;
    const level = ritualLook.lamps;
    if (level !== seen.level) {
      seen.level = level;
      bulbMaterial.color.lerpColors(BULB_OFF, BULB_ON, level);
      poolMaterial.opacity = level * 0.5;
      p.visible = level > 0.01;
    }
    const key = desks.map((a) => (isHidden(a.id) ? 0 : 1)).join('');
    if (key === seen.key) return;
    seen.key = key;
    desks.forEach((a, i) => {
      const m = isHidden(a.id) ? seen.off : place(a);
      b.setMatrixAt(i, m);
      p.setMatrixAt(i, m);
    });
    b.instanceMatrix.needsUpdate = p.instanceMatrix.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh ref={lamps} args={[lampGeometry, toon('#3d5a80'), LAMP_MAX]} castShadow frustumCulled={false} />
      <instancedMesh ref={bulbs} args={[bulbGeometry, bulbMaterial, LAMP_MAX]} frustumCulled={false} />
      <instancedMesh ref={pools} args={[poolGeometry, poolMaterial, LAMP_MAX]} visible={false} frustumCulled={false} renderOrder={1} />
    </>
  );
}

/** Lunchtime: the ones too busy to get up eat at their desk, beside the keyboard. */
function DeskLunch({ agents }: { agents: Agent[] }) {
  const lunch = useSyncExternalStore(subscribeMeals, () => meals.lunch);
  if (!lunch) return null;
  return (
    <>
      {agents
        .filter((a) => (a.role === 'dev' || a.role === 'qa') && (a.status === 'working' || a.status === 'preparing'))
        .map((a) => {
          const p = onDesk(a, -0.56, 0.81, 0.2);
          return (
            <group key={a.id} position={[p.x, p.y, p.z]} rotation={[0, p.turn + 0.4, 0]}>
              <FoodLook kind={lunchOf(a.id)} />
            </group>
          );
        })}
    </>
  );
}

/** Friday pizza on the coffee table: shut boxes under the open one, its slices going as people take them. */
function TablePizza() {
  useSyncExternalStore(subscribeMeals, mealsVersion);
  if (!meals.pizza) return null;
  const boxes = Math.max(1, Math.ceil(meals.slices / 8));
  const top = meals.slices - (boxes - 1) * 8;
  return (
    // the lid stands up on the couch's side; it opens towards the room
    <group position={[COFFEE_TABLE.x, 0.5, COFFEE_TABLE.z + 0.2]} rotation={[0, Math.PI / 2, 0]}>
      {Array.from({ length: boxes - 1 }, (_, i) => (
        <group key={i} position={[0, i * 0.052, 0]}>
          <PizzaBox />
        </group>
      ))}
      <group position={[0, (boxes - 1) * 0.052, 0]}>
        <OpenPizza slices={top} />
      </group>
    </group>
  );
}

// ---------- the probe ----------

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__swarmRituals = {
    /** What's scheduled or running on the floor you're on; null between floors. */
    state: () => active?.state() ?? null,
    /** Starts a ritual now ('standup', 'lunch', 'pizza', 'winddown' or 'ceo-walk'); false when it can't. */
    force: (kind: Ritual) => (RITUALS.includes(kind) && active ? active.force(kind) : false),
    /** Pins the rituals' clock (`{ hour: 12.5, weekday: 5 }`); null lets the sky's clock drive it again. */
    clock: (o: { hour?: number; weekday?: number } | null) => {
      if (active) active.pin = o;
      return active?.state().clock ?? null;
    },
  };
}
