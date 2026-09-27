import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { loadView, pendingRequests, saveView, unreadMessages, useStore, type Focus } from '../store';
import { api } from '../api';
import { EYE_HEIGHT, SPAWN, collide, type Rect } from './layout';
import { interactables } from './interact';

let canvasEl: HTMLCanvasElement | null = null;

/** Grab the mouse for looking around. Must be called from a click handler. */
export function requestLook() {
  const s = useStore.getState();
  if (!canvasEl || s.overlay || !s.started) return;
  canvasEl.requestPointerLock?.()?.catch?.(() => undefined);
}

export function runFocusAction(focus: Focus) {
  const s = useStore.getState();
  if (focus.action.kind === 'hire') {
    const role = focus.action.role;
    api
      .hireAgent(focus.action.repoId, { role })
      .then(() => s.pushToast('success', role === 'qa' ? 'New QA tester hired! They will take the next free station in the QA lab.' : 'New teammate hired! They will sit at the next free desk.'))
      .catch(() => undefined);
    return;
  }
  s.openOverlay(focus.action);
}

/** The shared E / left-click interaction: act on whatever the crosshair is on, unless something blocks it. */
function interact() {
  const s = useStore.getState();
  if (s.overlay || !s.started || s.travel || !s.focus) return;
  runFocusAction(s.focus);
}

const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

export function Player({ colliders, floor }: { colliders: Rect[]; floor: number }) {
  const { camera, gl } = useThree();
  const keys = useRef(new Set<string>());
  const look = useRef({ yaw: SPAWN.yaw, pitch: -0.05 });
  const bob = useRef(0);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const center = useMemo(() => new THREE.Vector2(0, 0), []);
  const frame = useRef(0);

  // Arrive at the elevator whenever the floor changes; after a page reload, return to the remembered spot.
  const restored = useRef(false);
  useEffect(() => {
    const saved = restored.current ? null : loadView();
    restored.current = true;
    if (saved && saved.floor === floor) {
      camera.position.set(saved.x, EYE_HEIGHT, saved.z);
      look.current = { yaw: saved.yaw, pitch: saved.pitch };
      return;
    }
    camera.position.set(SPAWN.x, EYE_HEIGHT, SPAWN.z);
    look.current = { yaw: SPAWN.yaw, pitch: -0.05 };
  }, [floor, camera]);
  const lastSave = useRef(0);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // Dev helper for inspecting views without pointer lock: __swarmCam(x, z, yawDeg, pitchDeg)
    (window as unknown as Record<string, unknown>).__swarmCam = (x: number, z: number, yawDeg = 0, pitchDeg = 0) => {
      camera.position.set(x, EYE_HEIGHT, z);
      look.current = { yaw: (yawDeg * Math.PI) / 180, pitch: (pitchDeg * Math.PI) / 180 };
    };
    // Dev helper for the captured left-click path, which headless browsers can't reach: __swarmClick()
    // Behaves like a left click while the mouse is captured. Aim with __swarmCam first; returns the focus it acted on.
    (window as unknown as Record<string, unknown>).__swarmClick = () => {
      const focus = useStore.getState().focus;
      interact();
      return focus?.label ?? null;
    };
  }, [camera]);

  useEffect(() => {
    canvasEl = gl.domElement;
    const isLocked = () => document.pointerLockElement === gl.domElement;
    // Captured: a left press acts like E. Uncaptured: the click only grabs the mouse, so the click that
    // brings you back after closing a panel can never reopen it. mousedown never repeats while held.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0 && isLocked()) interact();
    };
    const onClick = (e: MouseEvent) => {
      if (e.button === 0 && !isLocked()) requestLook();
    };
    const onLockChange = () => useStore.getState().setLocked(document.pointerLockElement === gl.domElement);
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== gl.domElement) return;
      look.current.yaw -= e.movementX * 0.0022;
      look.current.pitch = Math.max(-1.35, Math.min(1.35, look.current.pitch - e.movementY * 0.0022));
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const s = useStore.getState();
      if (s.overlay || !s.started) return;
      keys.current.add(e.code);
      if (e.code === 'KeyE') interact();
      if (e.code === 'KeyH') s.openOverlay({ kind: 'help' });
      if (e.code === 'KeyP') {
        e.preventDefault(); // don't type the "p" into the phone's message box
        s.openOverlay({ kind: 'phone', tab: pendingRequests(s.requests).length && !unreadMessages(s.messages, s.phoneReadAt) ? 'hires' : 'chat' });
      }
    };
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.code);
    const onBlur = () => keys.current.clear();
    gl.domElement.addEventListener('mousedown', onMouseDown);
    gl.domElement.addEventListener('click', onClick);
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('mousemove', onMove);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      gl.domElement.removeEventListener('mousedown', onMouseDown);
      gl.domElement.removeEventListener('click', onClick);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('mousemove', onMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [gl]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = useStore.getState();
    if (s.overlay) keys.current.clear();

    // movement
    const k = keys.current;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? 6.5 : 3.6;
    const { yaw, pitch } = look.current;
    let moving = false;
    if ((fwd || strafe) && !s.travel) {
      const len = Math.hypot(fwd, strafe);
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      const dx = ((-sin * fwd + cos * strafe) / len) * speed * dt;
      const dz = ((-cos * fwd - sin * strafe) / len) * speed * dt;
      const p = collide(camera.position.x + dx, camera.position.z + dz, colliders);
      camera.position.x = p.x;
      camera.position.z = p.z;
      moving = true;
    }
    bob.current += moving ? dt * speed * 2.2 : 0;
    camera.position.y = EYE_HEIGHT + (moving ? Math.sin(bob.current) * 0.035 : 0);
    camera.rotation.set(pitch, yaw, 0, 'YXZ');

    const now = performance.now();
    if (s.started && !s.travel && now - lastSave.current > 1000) {
      lastSave.current = now;
      saveView({ floor: s.floor, x: camera.position.x, z: camera.position.z, yaw, pitch });
    }

    // what are we looking at?
    if (++frame.current % 3 !== 0) return;
    if (s.overlay || s.travel) {
      if (s.focus) s.setFocus(null);
      return;
    }
    ray.setFromCamera(center, camera);
    ray.far = 8;
    const roots = [...interactables.keys()];
    const hits = ray.intersectObjects(roots, true);
    let found: Focus | null = null;
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !interactables.has(o)) o = o.parent;
      if (!o) continue;
      const info = interactables.get(o)!;
      if (h.distance <= info.range) found = { id: info.id, label: info.label, action: info.action };
      break;
    }
    s.setFocus(found);
  });

  return null;
}
