import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { loadView, pendingRequests, saveView, unreadMessages, useStore, type Focus } from '../store';
import { api } from '../api';
import { EYE_HEIGHT, SPAWN, collide, surfaceAt, type Rect } from './layout';
import { interactables } from './interact';
import { LOOK_RADIANS_PER_PX, createLookFilter, filterLookDelta, resetLookFilter, useLookPrefs } from './look';
import { confirmDialog, isConfirmOpen } from '../ui/Confirm';
import { getAudioPrefs, toggleMute } from '../ui/sfx';
import { footstepsFollow } from '../ui/footsteps';
import { dropHeld, startCharge, throwHeld, walk } from './toys/hands';
import { watchLookLock } from './lookLock';
import { pokeToy } from './toys/poke';
import { isBlasterId } from './toys/darts';
import { reloadHeld, takeBlaster } from './toys/gun';
import { isMugId, takeMug } from './toys/mugs';

let canvasEl: HTMLCanvasElement | null = null;

// After an action, mouse presses are swallowed for a moment, so the second half of a double click
// (or a click right after E) can't land on the panel's backdrop and close it, or confirm a hire.
const QUIET_MS = 400;
let quietUntil = 0;
const QUIET_EVENTS = ['mousedown', 'mouseup', 'click', 'dblclick'] as const;
const hushMouse = () => {
  quietUntil = performance.now() + QUIET_MS;
};

/** Grab the mouse for looking around. Must be called from a click handler. */
export function requestLook() {
  const s = useStore.getState();
  if (!canvasEl || s.overlay || !s.started || isConfirmOpen()) return;
  const el = canvasEl;
  // Raw (unadjusted) input skips the OS mouse path that produces bogus spikes on Windows.
  // Browsers that can't do it reject with NotSupportedError (Firefox ignores the option).
  lockPointer(el, { unadjustedMovement: true })?.catch?.((err: unknown) => {
    if (err instanceof DOMException && err.name === 'NotSupportedError') lockPointer(el)?.catch?.(() => undefined);
  });
}

function lockPointer(el: HTMLCanvasElement, options?: PointerLockOptions): Promise<void> | undefined {
  try {
    return el.requestPointerLock?.(options);
  } catch {
    return undefined; // older browsers throw instead of rejecting
  }
}

/** Spike counters, readable from the console as __swarmLook. */
const lookDiag = { dropped: 0, skipped: 0 };
(window as unknown as Record<string, unknown>).__swarmLook = lookDiag;

export function runFocusAction(focus: Focus, via: 'key' | 'click' = 'key') {
  const s = useStore.getState();
  quietUntil = performance.now() + QUIET_MS;
  if (focus.action.kind === 'pickup' && isBlasterId(focus.action.toyId)) {
    takeBlaster(focus.action.toyId);
    return;
  }
  if (focus.action.kind === 'pickup' && isMugId(focus.action.toyId)) {
    takeMug(focus.action.toyId);
    return;
  }
  if (focus.action.kind === 'pickup') {
    s.setHeld({ kind: 'ball', id: focus.action.toyId }); // already holding one? the toy world swaps them
    return;
  }
  if (focus.action.kind === 'poke') {
    pokeToy(focus.action.toyId);
    return;
  }
  if (focus.action.kind === 'hire') {
    const { repoId, role } = focus.action;
    const hire = () =>
      api
        .hireAgent(repoId, { role })
        .then(() => s.pushToast('success', role === 'qa' ? 'New QA tester hired! They will take the next free station in the QA lab.' : 'New teammate hired! They will sit at the next free desk.'))
        .catch(() => undefined);
    if (via === 'key') {
      void hire();
      return;
    }
    // A click is easier to make by accident than E, so hiring by click asks first.
    if (document.pointerLockElement) document.exitPointerLock();
    void confirmDialog({
      icon: role === 'qa' ? '🔍' : '🪑',
      title: role === 'qa' ? 'Hire a QA tester for this station?' : 'Hire an agent for this desk?',
      confirm: 'Hire',
    }).then((ok) => {
      if (ok) void hire();
    });
    return;
  }
  s.openOverlay(focus.action);
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
  const lookFilter = useMemo(createLookFilter, []);

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
  }, [camera]);

  useEffect(() => {
    canvasEl = gl.domElement;
    // Left button only. If the mouse is already captured, use what you're holding (winding up a throw until
    // the button comes up) or, empty-handed, act on the crosshair's target (like E). Otherwise this press
    // just captures the mouse, so the click that locks never also acts.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (document.pointerLockElement !== gl.domElement) return requestLook();
      const s = useStore.getState();
      if (!s.started || s.overlay || s.travel || isConfirmOpen()) return;
      if (s.held) startCharge();
      else if (s.focus) runFocusAction(s.focus, 'click');
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) throwHeld();
    };
    const onQuietMouse = (e: MouseEvent) => {
      if (performance.now() >= quietUntil) return;
      e.stopPropagation();
      e.preventDefault();
    };
    const onLockChange = () => {
      resetLookFilter(lookFilter);
      const locked = document.pointerLockElement === gl.domElement;
      if (!locked) dropHeld(); // Esc: you've stepped away, so let go rather than leave it hanging in the air
      useStore.getState().setLocked(locked);
    };
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== gl.domElement || !document.hasFocus()) return;
      const d = filterLookDelta(lookFilter, e.movementX, e.movementY, e.timeStamp);
      lookDiag.dropped = lookFilter.dropped;
      lookDiag.skipped = lookFilter.skipped;
      if (!d) return;
      const { sensitivity, invertY } = useLookPrefs.getState();
      const k = LOOK_RADIANS_PER_PX * sensitivity;
      look.current.yaw -= d[0] * k;
      look.current.pitch = Math.max(-1.35, Math.min(1.35, look.current.pitch - d[1] * k * (invertY ? -1 : 1)));
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const s = useStore.getState();
      if (e.code === 'KeyM' && !e.repeat && !isConfirmOpen()) {
        toggleMute();
        s.pushToast('info', getAudioPrefs().muted ? '🔇 Sound off (M to turn it back on)' : '🔊 Sound on');
      }
      if (s.overlay || !s.started || isConfirmOpen()) return;
      keys.current.add(e.code);
      // E always acts on the crosshair's target, even with your hands full (a panel opening drops the ball).
      if (e.code === 'KeyE' && !e.repeat && s.focus) runFocusAction(s.focus);
      if (e.code === 'KeyF' && !e.repeat && !s.travel) startCharge();
      if (e.code === 'KeyG' && !e.repeat) dropHeld();
      if (e.code === 'KeyR' && !e.repeat && !s.travel) reloadHeld();
      if (e.code === 'KeyH') s.openOverlay({ kind: 'help' });
      if (e.code === 'KeyP') {
        e.preventDefault(); // don't type the "p" into the phone's message box
        s.openOverlay({ kind: 'phone', tab: pendingRequests(s.requests).length && !unreadMessages(s.messages, s.phoneReadAt) ? 'hires' : 'chat' });
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.current.delete(e.code);
      if (e.code === 'KeyF') throwHeld();
    };
    const onBlur = () => {
      keys.current.clear();
      useStore.getState().setCharge(null); // the button's release would be missed
    };
    gl.domElement.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    for (const type of QUIET_EVENTS) window.addEventListener(type, onQuietMouse, true);
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('mousemove', onMove);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    const stopLookLock = watchLookLock(requestLook, hushMouse);
    return () => {
      stopLookLock();
      gl.domElement.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      for (const type of QUIET_EVENTS) window.removeEventListener(type, onQuietMouse, true);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('mousemove', onMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [gl, lookFilter]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = useStore.getState();
    if (s.overlay || isConfirmOpen()) keys.current.clear();

    // movement
    const k = keys.current;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? 6.5 : 3.6;
    const { yaw, pitch } = look.current;
    let moving = false;
    walk.x = 0;
    walk.z = 0;
    if ((fwd || strafe) && !s.travel) {
      const len = Math.hypot(fwd, strafe);
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      const dx = ((-sin * fwd + cos * strafe) / len) * speed * dt;
      const dz = ((-cos * fwd - sin * strafe) / len) * speed * dt;
      const p = collide(camera.position.x + dx, camera.position.z + dz, colliders);
      if (dt > 0) {
        walk.x = (p.x - camera.position.x) / dt;
        walk.z = (p.z - camera.position.z) / dt;
      }
      camera.position.x = p.x;
      camera.position.z = p.z;
      moving = true;
    }
    bob.current += moving ? dt * speed * 2.2 : 0;
    camera.position.y = EYE_HEIGHT + (moving ? Math.sin(bob.current) * 0.035 : 0);
    footstepsFollow(bob.current, moving, speed > 5, surfaceAt(floor === 0 ? 'lobby' : 'office', camera.position.x, camera.position.z));
    camera.rotation.set(pitch, yaw, 0, 'YXZ');

    const now = performance.now();
    if (s.started && !s.travel && now - lastSave.current > 1000) {
      lastSave.current = now;
      saveView({ floor: s.floor, x: camera.position.x, z: camera.position.z, yaw, pitch });
    }

    // what are we looking at?
    if (++frame.current % 3 !== 0) return;
    if (s.overlay || s.travel || isConfirmOpen()) {
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
