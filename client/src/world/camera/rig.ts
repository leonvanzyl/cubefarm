// The camera rig: the views besides first person (the overview "dollhouse", the building view and the follow cam) and
// the flights between them. Player.tsx hands the camera over while the rig owns it and calls stepRig once a frame;
// CameraRig.tsx (inside the Canvas) binds the camera and feeds in the mouse. Module state, so a frame re-renders
// nothing; useCameraView is the React side for the HUD. The pose maths is in cameraMath.ts. window.__swarmCamera is
// the probe.

import * as THREE from 'three';
import { create } from 'zustand';
import { CEO_ID } from '../../../../shared/types';
import { repoOnFloor, useStore } from '../../store';
import { EYE_HEIGHT, HALF_D, HALF_W, WALL_H } from '../layout';
import { bodyState } from '../people';
import {
  BUILDING,
  FACE_Z,
  FOLLOW,
  OVERVIEW,
  aimAt,
  blendPose,
  buildingOrbit,
  clampFocus,
  clampFollowCamera,
  clampTowerFocus,
  copyOrbit,
  copyPose,
  dampOrbit,
  ease,
  fitDistance,
  metresPerPixel,
  nearSides,
  nearestQuad,
  newOrbit,
  newPose,
  orbitPose,
  overviewOrbit,
  panOrbit,
  quadYaw,
  tabTarget,
  type Pose,
  type ViewMode,
} from './cameraMath';

export type { ViewMode } from './cameraMath';

// ---------- follow targets ----------

/** Where something the follow cam trails is now: on the floor you're on (y 0 is its floor), facing `heading`. */
export interface TargetPose {
  x: number;
  y: number;
  z: number;
  /** A yaw like Object3D.rotation.y: 0 faces north (-Z). The camera sits behind it. */
  heading: number;
}

/** Anything the follow cam can trail: an agent's body, a visitor, any position source. */
export interface FollowTarget {
  /** Stable id, shown by the probe (an agent's id, `visitor:…`). */
  id: string;
  /** Who it is, for the HUD ("Following Ada"). */
  label: string;
  /** Writes where it is now into `out`; false while it isn't on this floor (the follow ends if it stays gone). */
  read(out: TargetPose): boolean;
}

/** Follows any body the people controller draws on this floor (people.ts), by its id. */
export function followBody(id: string, label: string): FollowTarget {
  return {
    id,
    label,
    read(out) {
      const s = bodyState(id);
      if (!s) return false;
      out.x = s.x;
      out.y = 0;
      out.z = s.z;
      out.heading = s.heading;
      return true;
    },
  };
}

// ---------- state ----------

/** Where the player is standing and facing: the camera in first person, and where they left themselves in any other view. */
export const playerAt = { x: 0, z: 0, yaw: 0 };

interface Home {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}

const FIRST_FOV = 72;
const FIRST_NEAR = 0.05;
/** Seconds: out to a view, between views, and back to first person. */
const FLY_OUT = 0.9;
const FLY_BACK = 0.65;
/** How long a followed body may be missing (a floor change, someone leaving) before the follow ends. */
const LOST_S = 1.5;

const rig = {
  mode: 'first' as ViewMode,
  /** The rig drives the camera: any view but first person, and the flight back to it. */
  owns: false,
  flight: 1,
  flightTime: FLY_OUT,
  from: newPose(),
  pose: newPose(),
  goalPose: newPose(),
  /** The orbit the camera is on (eased) and the one it's easing to. */
  orbit: newOrbit(),
  goal: newOrbit(),
  /** The overview's corner (quadYaw) and the zoom that fits the floor. */
  quad: 0,
  fit: 40,
  home: { x: 0, z: 0, yaw: 0, pitch: 0 } as Home,
  target: null as FollowTarget | null,
  seen: { x: 0, y: 0, z: 0, heading: 0 } as TargetPose,
  lost: 0,
  /** After arriving on someone's floor: wait for them this long (performance.now()), then jump straight to them. */
  waitUntil: 0,
  snap: false,
  /** Set while travelling to another floor: what to show on arrival. */
  arrival: null as { mode: 'overview' } | { mode: 'follow'; target: FollowTarget; until: number } | null,
  lastTap: -Infinity,
  lastWent: null as ViewMode | null,
  aspect: 16 / 9,
  height: 900,
  /** The near walls cut away (cameraMath nearSides) and whether the cutaway is on. */
  sides: { x: 0, z: 0 },
  cut: 'none' as 'none' | 'dollhouse' | 'face',
};

let camera: THREE.PerspectiveCamera | null = null;
let homeLook: () => { yaw: number; pitch: number } = () => rig.home;

/** CameraRig.tsx hands over the camera (and how big the view is, every frame). */
export function bindCamera(c: THREE.PerspectiveCamera | null) {
  camera = c;
}

export function setViewport(width: number, height: number) {
  const aspect = width / Math.max(1, height);
  rig.height = height;
  if (Math.abs(aspect - rig.aspect) < 1e-3) return;
  rig.aspect = aspect;
  if (rig.mode === 'overview') refit();
  if (rig.mode === 'building') buildingOrbit(useStore.getState().floor, topFloor(), aspect, rig.goal);
}

/** Player.tsx: where the player looks while the rig flies them back (the mouse may move meanwhile). */
export function setHomeLook(fn: () => { yaw: number; pitch: number }) {
  homeLook = fn;
}

export const cameraMode = () => rig.mode;
/** Which cutaway is on: the dollhouse's, the building's south face, or none. */
export const cutKind = () => rig.cut;
const NO_SIDES = { x: 0, z: 0 };
/** The walls the dollhouse has cut away (cameraMath nearSides; 0 and 0 when it's off). */
export const wallCut = (): Readonly<{ x: number; z: number }> => (rig.cut === 'dollhouse' ? rig.sides : NO_SIDES);
/** Where you stand while the rig has the camera. */
export const homeSpot = (): Readonly<Home> => rig.home;
/** Where to hear the office from instead of the camera: where you stand, in the overview and the building view. */
export const earAtHome = (): Readonly<Home> | null => (rig.owns && rig.mode !== 'follow' ? rig.home : null);
/** Whether first person may grab the mouse: not in a view, nor on the way to one on another floor. */
export const lookAllowed = () => rig.mode === 'first' && !rig.arrival;
export const rigOwnsCamera = () => rig.owns;
/** Whether the rig's flight is under way (the HUD waits for it before offering clicks). */
export const rigFlying = () => rig.flight < 1;

// ---------- the React side ----------

interface CameraView {
  mode: ViewMode;
  /** Who the follow cam trails. */
  following: string | null;
  /** What a click in the overview or the building view would open, under the mouse now. */
  hover: string | null;
}

export const useCameraView = create<CameraView>(() => ({ mode: 'first', following: null, hover: null }));

function notify() {
  useCameraView.setState({ mode: rig.mode, following: rig.mode === 'follow' ? (rig.target?.label ?? null) : null });
}

export function setHover(label: string | null) {
  if (useCameraView.getState().hover !== label) useCameraView.setState({ hover: label });
}

// ---------- the cutaway ----------

const OPEN = 1e6;
/**
 * Global clipping planes, installed on the renderer once (Game.tsx) and opened out of the way in first person, so
 * switching views never recompiles a shader. The dollhouse cuts the ceiling, the walls on the camera's side and
 * everything under the floor; the building view cuts what sticks out of the south face in front of the floors' slices.
 */
export const CUT_PLANES = [
  new THREE.Plane(new THREE.Vector3(0, -1, 0), OPEN),
  new THREE.Plane(new THREE.Vector3(-1, 0, 0), OPEN),
  new THREE.Plane(new THREE.Vector3(0, 0, -1), OPEN),
  new THREE.Plane(new THREE.Vector3(0, 1, 0), OPEN),
];
const [CEILING, SIDE_X, SIDE_Z, BELOW] = CUT_PLANES;
const WALL_CUT = 0.05;

/** Whether world point (x, y, z) is cut away right now (so the overview's clicks go through it). */
export const isCut = (x: number, y: number, z: number) => {
  for (const p of CUT_PLANES) if (p.normal.x * x + p.normal.y * y + p.normal.z * z + p.constant < 0) return true;
  return false;
};

function setCut(kind: typeof rig.cut) {
  rig.cut = kind;
  CEILING.constant = OPEN;
  SIDE_X.constant = OPEN;
  SIDE_Z.constant = OPEN;
  BELOW.constant = OPEN;
  if (kind === 'dollhouse') {
    nearSides(rig.orbit.yaw, rig.sides);
    CEILING.constant = WALL_H - 0.08;
    BELOW.constant = 0.35;
    if (rig.sides.x) {
      SIDE_X.normal.set(-rig.sides.x, 0, 0);
      SIDE_X.constant = HALF_W - WALL_CUT;
    }
    if (rig.sides.z) {
      SIDE_Z.normal.set(0, 0, -rig.sides.z);
      SIDE_Z.constant = HALF_D - WALL_CUT;
    }
  } else if (kind === 'face') {
    SIDE_Z.normal.set(0, 0, -1);
    SIDE_Z.constant = FACE_Z + 0.02;
  }
}

/** The cutaway this frame's view wants: the dollhouse until the flight back is nearly home. */
function cutFor(): typeof rig.cut {
  if (rig.mode === 'overview') return 'dollhouse';
  if (rig.mode === 'building') return 'face';
  if (rig.mode === 'first' && rig.owns && rig.flight < 0.8) return rig.cut;
  return 'none';
}

// ---------- switching views ----------

const topFloor = () => useStore.getState().repos.reduce((m, r) => Math.max(m, r.floor), 0);

function refit() {
  const ratio = rig.goal.dist / rig.fit;
  rig.fit = fitDistance(rig.goal, rig.aspect);
  rig.goal.dist = Math.max(OVERVIEW.minDist, Math.min(rig.fit * OVERVIEW.maxZoom, rig.fit * ratio));
}

/** Where the camera is now, as a pose (from the camera itself when the player was driving it). */
function capture(out: Pose) {
  if (rig.owns || !camera) return copyPose(rig.pose, out);
  out.x = camera.position.x;
  out.y = camera.position.y;
  out.z = camera.position.z;
  out.yaw = camera.rotation.y;
  out.pitch = camera.rotation.x;
  out.fov = camera.fov;
  out.near = camera.near;
  return out;
}

/** Leaving first person: remember where you stand, put down what you hold and let go of the mouse. */
function leaveFirst() {
  if (rig.owns || !camera) return;
  const look = homeLook();
  rig.home = { x: camera.position.x, z: camera.position.z, yaw: look.yaw, pitch: look.pitch };
  playerAt.x = rig.home.x;
  playerAt.z = rig.home.z;
  playerAt.yaw = rig.home.yaw;
  const s = useStore.getState();
  if (s.held) s.setHeld(null);
  if (s.focus) s.setFocus(null);
  if (document.pointerLockElement) document.exitPointerLock();
}

function startFlight(time: number) {
  capture(rig.from);
  copyPose(rig.from, rig.pose);
  rig.flight = 0;
  rig.flightTime = time;
}

/** Flies out to the overview of the floor you're on. */
export function enterOverview() {
  if (rig.mode === 'overview' || !camera) return;
  const from = rig.mode;
  leaveFirst();
  startFlight(FLY_OUT);
  const facing = from === 'first' ? rig.home.yaw : rig.pose.yaw;
  overviewOrbit(facing, rig.aspect, rig.goal);
  rig.quad = nearestQuad(facing);
  rig.fit = rig.goal.dist;
  copyOrbit(rig.goal, rig.orbit);
  rig.mode = 'overview';
  rig.owns = true;
  rig.target = null;
  notify();
}

/** Flies out to the building: every floor's slice of the tower, from the plaza in front. */
export function enterBuilding() {
  if (rig.mode === 'building' || !camera) return;
  leaveFirst();
  startFlight(FLY_OUT);
  buildingOrbit(useStore.getState().floor, topFloor(), rig.aspect, rig.goal);
  copyOrbit(rig.goal, rig.orbit);
  rig.mode = 'building';
  rig.owns = true;
  rig.target = null;
  notify();
}

/** Trails `target` in third person until a movement key, Esc or Tab. */
export function follow(target: FollowTarget) {
  if (!camera) return;
  if (!target.read(rig.seen)) return void useStore.getState().pushToast('info', `${target.label} isn't on this floor right now`);
  leaveFirst();
  startFlight(FLY_OUT);
  rig.target = target;
  rig.lost = 0;
  rig.waitUntil = 0;
  rig.snap = false;
  followGoal(rig.goal);
  rig.goal.dist = FOLLOW.dist;
  copyOrbit(rig.goal, rig.orbit);
  rig.mode = 'follow';
  rig.owns = true;
  notify();
}

/** The floor an agent works on (the CEO's office is in the lobby); null when they're gone. */
function agentFloor(id: string) {
  const s = useStore.getState();
  const a = s.agents[id];
  if (!a) return null;
  if (a.role === 'ceo' || id === CEO_ID) return 0;
  return s.repos.find((r) => r.id === a.repoId)?.floor ?? null;
}

/** "Follow" in an agent's panel: trails them, taking the elevator to their floor first if they're elsewhere. */
export function followAgent(id: string) {
  const s = useStore.getState();
  const a = s.agents[id];
  const floor = agentFloor(id);
  if (!a || floor === null) return;
  const target = followBody(id, a.name);
  if (floor === s.floor) {
    follow(target);
    if (s.overlay) s.openOverlay(null);
    return;
  }
  rig.arrival = { mode: 'follow', target, until: performance.now() + 8000 };
  s.goToFloor(floor);
}

/** Flies back to where you were standing and gives you the controls again. */
export function exitView() {
  if (rig.mode === 'first') return;
  startFlight(FLY_BACK);
  rig.mode = 'first';
  rig.target = null;
  rig.arrival = null;
  notify();
}

/** Tab (or the pad's Select): the overview and back; twice quickly, the building. */
export function tapView(now = performance.now()) {
  if (useStore.getState().travel) return;
  const to = tabTarget(rig.mode, now, rig.lastTap, rig.lastWent);
  rig.lastTap = now;
  rig.lastWent = to;
  if (to === 'overview') enterOverview();
  else if (to === 'building') enterBuilding();
  else exitView();
}

/** Q / E (or the pad's shoulder buttons): the overview turns a quarter round the floor. */
export function rotateView(dir: number) {
  if (rig.mode !== 'overview') return;
  rig.quad += dir;
  rig.goal.yaw = quadYaw(rig.quad);
}

/** The mouse wheel: closer or further (the building view widens or narrows instead). */
export function zoomView(deltaY: number) {
  const g = rig.goal;
  const k = Math.exp(deltaY * 0.0012);
  if (rig.mode === 'overview') g.dist = Math.max(OVERVIEW.minDist, Math.min(rig.fit * OVERVIEW.maxZoom, g.dist * k));
  else if (rig.mode === 'follow') g.dist = Math.max(FOLLOW.minDist, Math.min(FOLLOW.maxDist, g.dist * k));
  else if (rig.mode === 'building') g.fov = Math.max(BUILDING.minFov, Math.min(BUILDING.maxFov, g.fov * k));
}

/** Dragging with the mouse: the floor (or the tower) follows the pointer. Pixels. */
export function dragView(dx: number, dy: number) {
  const g = rig.goal;
  const mpp = metresPerPixel(g, rig.height);
  if (rig.mode === 'overview') panOrbit(g, -dx * mpp, (dy * mpp) / Math.max(0.3, Math.sin(g.el)));
  else if (rig.mode === 'building') {
    g.fy += dy * mpp;
    clampTowerFocus(g, useStore.getState().floor, topFloor());
  }
}

/** A floor change finished (Player.tsx): you're standing at `spawn`; the view carries on there or comes home. */
export function arriveOnFloor(spawn: Home) {
  rig.home = { ...spawn };
  playerAt.x = spawn.x;
  playerAt.z = spawn.z;
  playerAt.yaw = spawn.yaw;
  const want = rig.arrival;
  rig.arrival = null;
  if (want?.mode === 'follow') {
    // look over the floor until they're drawn, then jump to them (the elevator's fade hides it)
    overviewOrbit(spawn.yaw, rig.aspect, rig.orbit);
    orbitPose(rig.orbit, rig.pose);
    rig.target = want.target;
    rig.lost = 0;
    rig.waitUntil = want.until;
    rig.snap = true;
    rig.mode = 'follow';
    rig.owns = true;
    rig.flight = 1;
    rig.goal.dist = FOLLOW.dist;
    notify();
    return;
  }
  if (want?.mode === 'overview' || rig.mode === 'overview' || rig.mode === 'building') {
    overviewOrbit(spawn.yaw, rig.aspect, rig.goal);
    rig.quad = nearestQuad(spawn.yaw);
    rig.fit = rig.goal.dist;
    copyOrbit(rig.goal, rig.orbit);
    orbitPose(rig.orbit, rig.pose);
    rig.mode = 'overview';
    rig.owns = true;
    rig.flight = 1;
    notify();
    return;
  }
  if (rig.mode === 'follow' || rig.owns) {
    // the one you followed stayed behind: you arrive on foot
    rig.mode = 'first';
    rig.target = null;
    rig.owns = false;
    rig.flight = 1;
    setCut('none');
    if (camera) restoreLens(camera);
    notify();
  }
}

/** After a click on a floor's slice in the building view: the overview of that floor (travelling there first). */
export function visitFloor(floor: number) {
  const s = useStore.getState();
  if (floor === s.floor) return enterOverview();
  if (floor !== 0 && !repoOnFloor(s.repos, floor)) return;
  rig.arrival = { mode: 'overview' };
  s.goToFloor(floor);
}

// ---------- every frame ----------

/** What the keys and the pad say this frame (Player.tsx fills it in): -1 to 1 each. */
export const rigInput = { right: 0, forward: 0, fast: false, zoom: 0 };

function followGoal(out: typeof rig.goal) {
  const t = rig.seen;
  out.fx = t.x;
  out.fy = t.y + FOLLOW.height;
  out.fz = t.z;
  out.yaw = t.heading;
  out.el = FOLLOW.el;
  out.fov = FOLLOW.fov;
  return out;
}

function restoreLens(c: THREE.PerspectiveCamera) {
  if (c.fov === FIRST_FOV && c.near === FIRST_NEAR) return;
  c.fov = FIRST_FOV;
  c.near = FIRST_NEAR;
  c.updateProjectionMatrix();
}

function applyPose(c: THREE.PerspectiveCamera, p: Pose) {
  c.position.set(p.x, p.y, p.z);
  c.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
  if (Math.abs(c.fov - p.fov) > 1e-4 || Math.abs(c.near - p.near) > 1e-5) {
    c.fov = p.fov;
    c.near = p.near;
    c.updateProjectionMatrix();
  }
}

/** One frame of the rig (Player.tsx calls it while the rig owns the camera). */
export function stepRig(dt: number) {
  const c = camera;
  if (!rig.owns || !c) return;
  const g = rig.goal;
  const inp = rigInput;
  if (rig.mode === 'overview') {
    const speed = g.dist * (inp.fast ? 1.6 : 0.8) * dt;
    if (inp.right || inp.forward) panOrbit(g, inp.right * speed, inp.forward * speed);
    if (inp.zoom) zoomView(inp.zoom * dt * 900);
    clampFocus(g);
    dampOrbit(rig.orbit, g, dt, 7);
    orbitPose(rig.orbit, rig.goalPose);
  } else if (rig.mode === 'building') {
    if (inp.forward) {
      g.fy += inp.forward * dt * 10;
      clampTowerFocus(g, useStore.getState().floor, topFloor());
    }
    if (inp.zoom) zoomView(inp.zoom * dt * 900);
    dampOrbit(rig.orbit, g, dt, 6);
    orbitPose(rig.orbit, rig.goalPose);
  } else if (rig.mode === 'follow') {
    const t = rig.target;
    if (t && t.read(rig.seen)) {
      rig.lost = 0;
      const dist = g.dist;
      followGoal(g);
      g.dist = dist;
      if (rig.snap) copyOrbit(g, rig.orbit);
      rig.snap = false;
      if (inp.zoom) zoomView(inp.zoom * dt * 900);
    } else if ((rig.lost += dt) > LOST_S && performance.now() > rig.waitUntil) {
      useStore.getState().pushToast('info', `🎥 Lost sight of ${t?.label ?? 'them'}: back to you`);
      exitView();
      return stepRig(dt);
    }
    dampOrbit(rig.orbit, g, dt, 6, 2.4);
    orbitPose(rig.orbit, rig.goalPose);
    clampFollowCamera(rig.goalPose, rig.orbit.fx);
    aimAt(rig.goalPose, rig.orbit.fx, rig.orbit.fy, rig.orbit.fz);
  } else {
    const look = homeLook();
    const p = rig.goalPose;
    p.x = rig.home.x;
    p.y = EYE_HEIGHT;
    p.z = rig.home.z;
    p.yaw = look.yaw;
    p.pitch = look.pitch;
    p.fov = FIRST_FOV;
    p.near = FIRST_NEAR;
  }

  if (rig.flight < 1) {
    rig.flight = Math.min(1, rig.flight + dt / rig.flightTime);
    blendPose(rig.from, rig.goalPose, ease(rig.flight), rig.pose);
  } else copyPose(rig.goalPose, rig.pose);
  applyPose(c, rig.pose);

  const cut = cutFor();
  if (cut !== rig.cut || cut === 'dollhouse') setCut(cut);
  if (rig.mode === 'first' && rig.flight >= 1) {
    rig.owns = false;
    setCut('none');
    restoreLens(c);
    notify();
  }
}

// ---------- the probe ----------

const round = (n: number) => Math.round(n * 100) / 100;
const v = new THREE.Vector3();
let canvas: HTMLCanvasElement | null = null;

export function bindCanvas(el: HTMLCanvasElement | null) {
  canvas = el;
}

/** Where world point (x, y, z) is in the page, in CSS pixels; null when it's behind the camera or off screen. */
export function screenOf(x: number, y: number, z: number) {
  if (!camera || !canvas) return null;
  camera.updateMatrixWorld();
  v.set(x, y, z).project(camera);
  if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return null;
  const r = canvas.getBoundingClientRect();
  return { x: Math.round(r.left + ((v.x + 1) / 2) * r.width), y: Math.round(r.top + ((1 - v.y) / 2) * r.height) };
}

const probe = {
  state: () => ({
    mode: rig.mode,
    owns: rig.owns,
    flying: rig.flight < 1,
    target: rig.target ? { id: rig.target.id, label: rig.target.label } : null,
    home: { x: round(rig.home.x), z: round(rig.home.z), yaw: round(rig.home.yaw), pitch: round(rig.home.pitch) },
    pose: { x: round(rig.pose.x), y: round(rig.pose.y), z: round(rig.pose.z), yaw: round(rig.pose.yaw), pitch: round(rig.pose.pitch), fov: round(rig.pose.fov) },
    orbit: { fx: round(rig.goal.fx), fy: round(rig.goal.fy), fz: round(rig.goal.fz), yaw: round(rig.goal.yaw), dist: round(rig.goal.dist), fov: round(rig.goal.fov) },
    quad: rig.quad,
    cut: rig.cut,
    sides: { ...rig.sides },
  }),
  overview: enterOverview,
  building: enterBuilding,
  first: exitView,
  tab: () => tapView(),
  follow: (id: string) => {
    const a = useStore.getState().agents[id];
    follow(followBody(id, a?.name ?? id));
  },
  followAgent,
  rotate: rotateView,
  zoom: zoomView,
  drag: dragView,
  /** Where a world point shows on the page (CSS pixels), for clicking it. */
  screenOf,
  /** Someone on this floor and where they show on the page (their middle, a metre up). */
  person(id: string) {
    const s = bodyState(id);
    return s ? screenOf(s.x, 1, s.z) : null;
  },
};

if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__swarmCamera = probe;
