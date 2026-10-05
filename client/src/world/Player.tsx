import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { loadView, pendingRequests, saveView, unreadMessages, useStore, type Focus } from '../store';
import { api } from '../api';
import { EYE_HEIGHT, ROOF, SPAWN, collide, surfaceAt, type Rect } from './layout';
import { interactables } from './interact';
import { shutDoorways } from './doors';
import { LOOK_RADIANS_PER_PX, createLookFilter, filterLookDelta, resetLookFilter, useLookPrefs } from './look';
import { confirmDialog, isConfirmOpen } from '../ui/Confirm';
import { confirmResume } from '../ui/MissionConsole';
import { getAudioPrefs, toggleMute } from '../ui/sfx';
import { footstepsFollow } from '../ui/footsteps';
import { dropHeld, startCharge, throwHeld, walk } from './toys/hands';
import { watchLookLock } from './lookLock';
import { pokeToy } from './toys/poke';
import { isBlasterId } from './toys/darts';
import { reloadHeld, takeBlaster } from './toys/gun';
import { isMugId, takeMug } from './toys/mugs';
import { coffeeAction } from './CoffeeMachine';
import { jukeboxAction } from './Jukebox';
import { themeAction } from './themes/active';
import { tuneChannel } from '../ui/theatre';
import { decorationAction } from './decor/actions';
import { eAction } from './toys/sip';
import { sipCoffee, sipPose, tickSip } from './toys/sipping';
import { peelAimed, placeSticky, pressBoard, releaseBoard } from './boardHands';
import { bindings, keyName, useControls } from '../ui/controls';
import { actionsForKey, anyHeld, isBound, type ActionId, type Scope } from '../ui/keymap';
import { lookCurve, pad, padName, pollPad, wasPressed, wasReleased, watchPads } from './gamepad';
import { arriveOnFloor, cameraMode, exitView, homeSpot, lookAllowed, playerAt, rigInput, rigOwnsCamera, rotateView, setHomeLook, stepRig, tapView } from './camera/rig';
import { leavePerch, perch, takePerchTurn, type Perch } from './perch';
import { roofAction } from './roof/roofState';
import { greet } from './Chatter';

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
  if (!canvasEl || s.overlay || !s.started || isConfirmOpen() || !lookAllowed()) return;
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
  if (placeSticky(focus, false)) return; // a sticky in hand goes onto a desk or back on the board
  if (focus.action.kind === 'pickup' && isBlasterId(focus.action.toyId)) {
    takeBlaster(focus.action.toyId, focus.id.startsWith('toy:rack:'));
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
  if (focus.action.kind === 'coffee') {
    coffeeAction(focus.action.op);
    return;
  }
  if (focus.action.kind === 'jukebox') {
    jukeboxAction(focus.action.op);
    return;
  }
  if (focus.action.kind === 'decoration' || focus.action.kind === 'trophy') {
    decorationAction(focus.action);
    return;
  }
  if (focus.action.kind === 'poke') {
    pokeToy(focus.action.toyId);
    return;
  }
  if (focus.action.kind === 'theme') {
    themeAction(focus.action.id);
    return;
  }
  if (focus.action.kind === 'roof') {
    roofAction(focus.action.op);
    return;
  }
  if (focus.action.kind === 'channel') {
    tuneChannel(focus.action.repoId, focus.action.pr);
    return;
  }
  if (focus.action.kind === 'resume') {
    void confirmResume();
    return;
  }
  if (focus.action.kind === 'greet') {
    greet(focus.action.agentId);
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

/** E (or the pad's A): act on the crosshair's target, even with your hands full (a panel opening drops the ball).
 * With coffee in hand it takes a sip instead, except at the coffee machine. */
function interact() {
  const s = useStore.getState();
  const act = eAction(s.held, s.focus?.action.kind ?? null);
  if (act === 'sip') sipCoffee();
  else if (act === 'empty') s.pushToast('info', "☕ It's empty: refill it at the machine");
  else if (s.focus) runFocusAction(s.focus);
}

function openPhone() {
  const s = useStore.getState();
  s.openOverlay({ kind: 'phone', tab: pendingRequests(s.requests).length && !unreadMessages(s.messages, s.phoneReadAt) ? 'hires' : 'chat' });
}

/** Which keys are live: on foot everything, the overview its own (Q and E turn it), other views only the basics. */
const SCOPES: Record<ReturnType<typeof cameraMode>, readonly Scope[]> = {
  first: ['global', 'move', 'walk'],
  overview: ['global', 'move', 'overview'],
  building: ['global', 'move'],
  follow: ['global', 'move'],
};
const MOVES = new Set<ActionId>(['forward', 'back', 'left', 'right']);

/** Back to first person from a view, grabbing the mouse again (a key press may take it) if that setting is on. */
function leaveView() {
  exitView();
  if (useLookPrefs.getState().grabOnClose) requestLook();
}

/** The pad's B and A while a panel or question is up: Esc and Enter, so each panel closes its own way. */
const pressKey = (key: 'Escape' | 'Enter') => window.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }));

/** Right stick at full tilt turns this many radians a second (times the pad sensitivity). */
const PAD_TURN = 2.6;

/** Whether `code` gets you up from a perch (a deck chair, the telescope): a walking key, or Space. */
const gotUp = (b: ReturnType<typeof bindings>, code: string) => code === 'Space' || [...MOVES].some((a) => isBound(b, a, code));

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
  const padRun = useRef(false);
  useEffect(() => setHomeLook(() => look.current), []);
  const perched = useRef<Perch | null>(null);

  // Arrive at the elevator whenever the floor changes; after a page reload, return to the remembered spot.
  const restored = useRef(false);
  useEffect(() => {
    const saved = restored.current ? null : loadView();
    restored.current = true;
    perched.current = null; // a perch left behind on the old floor doesn't stand you at its exit here
    if (saved && saved.floor === floor) {
      camera.position.set(saved.x, EYE_HEIGHT, saved.z);
      look.current = { yaw: saved.yaw, pitch: saved.pitch };
    } else {
      camera.position.set(SPAWN.x, EYE_HEIGHT, SPAWN.z);
      look.current = { yaw: SPAWN.yaw, pitch: -0.05 };
    }
    arriveOnFloor({ x: camera.position.x, z: camera.position.z, ...look.current }); // a view carries on from here
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
      // The coffee machine takes a click with your hands full (that's how the mug goes in), and a decoration goes where you click.
      if (s.held && s.focus?.action.kind !== 'coffee' && s.held.kind !== 'decor') startCharge();
      else if (s.focus && !pressBoard(s.focus)) runFocusAction(s.focus, 'click'); // on a sticky, holding peels it off
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      throwHeld();
      releaseBoard((f) => runFocusAction(f, 'click'));
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
      const p = perch();
      const k = LOOK_RADIANS_PER_PX * sensitivity * (p?.look ?? 1);
      look.current.yaw -= d[0] * k;
      look.current.pitch = Math.max(p?.minPitch ?? -1.35, Math.min(p?.maxPitch ?? 1.35, look.current.pitch - d[1] * k * (invertY ? -1 : 1)));
    };
    // Every key goes through the player's bindings (Help → Controls; ui/keymap.ts), the defaults being the office's keys.
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const s = useStore.getState();
      const b = bindings();
      if (isBound(b, 'mute', e.code) && !e.repeat && !isConfirmOpen()) {
        toggleMute();
        s.pushToast('info', getAudioPrefs().muted ? `🔇 Sound off (${keyName('mute')} to turn it back on)` : '🔊 Sound on');
      }
      if (s.overlay || !s.started || isConfirmOpen()) return;
      keys.current.add(e.code);
      const mode = cameraMode();
      if (e.code === 'Escape' && mode !== 'first') return exitView();
      // Perched (a deck chair, the telescope): walking, Space or the use key gets you up, though with food in hand it still eats.
      if (mode === 'first' && perch() && !e.repeat && (gotUp(b, e.code) || (isBound(b, 'interact', e.code) && eAction(s.held, s.focus?.action.kind ?? null) !== 'sip'))) {
        leavePerch();
        return;
      }
      for (const action of actionsForKey(b, e.code, SCOPES[mode])) {
        if (MOVES.has(action) && mode === 'follow' && !e.repeat) leaveView(); // any movement key takes over again
        if (action === 'interact' && !e.repeat) {
          if (s.focus?.action.kind === 'phone') e.preventDefault(); // don't type the key into the phone's message box
          interact();
        }
        // − and + turn the jukebox down and up while you look at it.
        if (action === 'volumeDown' && s.focus?.action.kind === 'jukebox') jukeboxAction('vol-');
        if (action === 'volumeUp' && s.focus?.action.kind === 'jukebox') jukeboxAction('vol+');
        if (action === 'throw' && !e.repeat && !s.travel) startCharge();
        // G puts a sticky down where you aim (or back on the board), peels the one you aim at off, or drops what you hold
        if (action === 'drop' && !e.repeat && !placeSticky(s.focus, true) && !peelAimed(s.focus)) dropHeld();
        if (action === 'reload' && !e.repeat && !s.travel) reloadHeld();
        if (action === 'help') s.openOverlay({ kind: 'help' });
        if (action === 'phone') {
          e.preventDefault(); // don't type the "p" into the phone's message box
          openPhone();
        }
        if (action === 'overview') {
          e.preventDefault(); // Tab: not on to the next button
          if (e.repeat) continue;
          tapView(e.timeStamp); // when it was pressed, not when a slow frame let us see it: two quick taps stay quick
          if (cameraMode() === 'first' && useLookPrefs.getState().grabOnClose) requestLook();
        }
        if (action === 'rotateLeft' && !e.repeat) rotateView(-1);
        if (action === 'rotateRight' && !e.repeat) rotateView(1);
      }
    };
    // The mouse wheel turns the jukebox up and down while you look at it: one step a notch (or a trackpad's worth).
    let wheel = 0;
    const onWheel = (e: WheelEvent) => {
      const s = useStore.getState();
      if (document.pointerLockElement !== gl.domElement || s.overlay || s.focus?.action.kind !== 'jukebox') {
        wheel = 0;
        return;
      }
      wheel -= e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      if (Math.abs(wheel) < 80) return;
      jukeboxAction(wheel > 0 ? 'vol+' : 'vol-');
      wheel = 0;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.current.delete(e.code);
      if (isBound(bindings(), 'throw', e.code)) throwHeld();
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
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('blur', onBlur);
    const stopLookLock = watchLookLock(requestLook, hushMouse);
    const stopPads = watchPads((on, id) =>
      useStore.getState().pushToast('info', on ? `🎮 ${padName(id)} connected: left stick walks, right stick looks, A uses, Start for the phone` : `🎮 ${padName(id)} disconnected`),
    );
    return () => {
      stopLookLock();
      stopPads();
      gl.domElement.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      for (const type of QUIET_EVENTS) window.removeEventListener(type, onQuietMouse, true);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('mousemove', onMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('blur', onBlur);
    };
  }, [gl, lookFilter]);

  // The pad's buttons, once a frame after polling: the same actions as the keys (B is Esc, A is E, X picks up or drops).
  const padButtons = () => {
    if (!pad.pressed && !pad.released) return;
    const s = useStore.getState();
    if (!s.started) return;
    if (isConfirmOpen()) {
      if (wasPressed('A')) pressKey('Enter');
      if (wasPressed('B')) pressKey('Escape');
      return;
    }
    if (wasPressed('B') && (s.overlay || cameraMode() !== 'first')) pressKey('Escape');
    if (wasPressed('START')) {
      if (s.overlay?.kind === 'phone') s.openOverlay(null);
      else if (!s.overlay) openPhone();
    }
    if (s.overlay) return;
    const mode = cameraMode();
    if (wasPressed('SELECT')) tapView();
    if (wasPressed('LB')) rotateView(-1);
    if (wasPressed('RB')) rotateView(1);
    if (mode !== 'first' || rigOwnsCamera()) return; // in a view, A clicks the middle of the screen (CameraRig.tsx)
    if (wasPressed('A')) interact();
    if (wasPressed('X') && !placeSticky(s.focus, true) && !peelAimed(s.focus)) {
      if (s.held) dropHeld();
      else if (s.focus?.action.kind === 'pickup') runFocusAction(s.focus);
    }
    if (wasPressed('Y') && !s.travel) reloadHeld();
    if ((wasPressed('RT') || wasPressed('LT')) && !s.travel) startCharge();
    if (wasReleased('RT') || wasReleased('LT')) throwHeld();
    if (wasPressed('L3')) padRun.current = !padRun.current;
  };

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = useStore.getState();
    if (s.overlay || isConfirmOpen()) keys.current.clear();
    pollPad(performance.now());
    padButtons();

    // movement: the keys, plus the left stick (which walks slower when pushed less far); L3 runs until you stop
    const k = keys.current;
    const b = bindings();
    const padOn = !s.overlay && !isConfirmOpen() && s.started;
    const px = padOn ? pad.lx : 0;
    const py = padOn ? pad.ly : 0;
    if (!px && !py) padRun.current = false;
    const fwd = Math.max(-1, Math.min(1, (anyHeld(b, 'forward', k) ? 1 : 0) - (anyHeld(b, 'back', k) ? 1 : 0) - py));
    const strafe = Math.max(-1, Math.min(1, (anyHeld(b, 'right', k) ? 1 : 0) - (anyHeld(b, 'left', k) ? 1 : 0) + px));
    const running = anyHeld(b, 'run', k) || padRun.current;
    const speed = running ? 6.5 : 3.6;
    tickSip();

    // another view has the camera (camera/rig.ts): you stay where you were standing
    if (rigOwnsCamera()) {
      if (cameraMode() === 'follow' && (px || py)) exitView();
      rigInput.right = strafe;
      rigInput.forward = fwd;
      rigInput.fast = running;
      rigInput.zoom = padOn ? pad.ry : 0;
      walk.x = 0;
      walk.z = 0;
      if (s.focus) s.setFocus(null);
      footstepsFollow(bob.current, false, false, 'wood');
      stepRig(dt);
      const home = homeSpot();
      const now = performance.now();
      if (s.started && !s.travel && now - lastSave.current > 1000) {
        lastSave.current = now;
        saveView({ floor: s.floor, x: home.x, z: home.z, yaw: home.yaw, pitch: home.pitch });
      }
      return;
    }

    // Perched, the eye stays put and the view starts the perch's way; got up, you stand at its exit. The stick gets you up too.
    const p = perch();
    if (p && (px || py)) leavePerch();
    if (p !== perched.current) {
      if (!p && perched.current) camera.position.set(perched.current.exit.x, camera.position.y, perched.current.exit.z);
      perched.current = p;
    }
    if (p && takePerchTurn()) look.current = { yaw: p.yaw, pitch: p.pitch };

    // the right stick looks around, no mouse grab needed
    if (padOn && (pad.rx || pad.ry)) {
      const turn = PAD_TURN * useControls.getState().padSensitivity * (p?.look ?? 1) * dt;
      const flip = useLookPrefs.getState().invertY ? -1 : 1;
      look.current.yaw -= lookCurve(pad.rx) * turn;
      look.current.pitch = Math.max(p?.minPitch ?? -1.35, Math.min(p?.maxPitch ?? 1.35, look.current.pitch - lookCurve(pad.ry) * turn * 0.75 * flip));
    }
    const { yaw, pitch } = look.current;
    let moving = false;
    walk.x = 0;
    walk.z = 0;
    const tilt = Math.min(1, Math.hypot(fwd, strafe));
    if (tilt > 0 && !s.travel && !p) {
      const len = Math.hypot(fwd, strafe);
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      const dx = ((-sin * fwd + cos * strafe) / len) * speed * tilt * dt;
      const dz = ((-cos * fwd - sin * strafe) / len) * speed * tilt * dt;
      let p = collide(camera.position.x + dx, camera.position.z + dz, colliders);
      const shut = shutDoorways(); // a side door still sliding open
      if (shut.length) p = collide(p.x, p.z, shut);
      if (dt > 0) {
        walk.x = (p.x - camera.position.x) / dt;
        walk.z = (p.z - camera.position.z) / dt;
      }
      camera.position.x = p.x;
      camera.position.z = p.z;
      moving = true;
    }
    bob.current += moving ? dt * speed * tilt * 2.2 : 0;
    if (p) {
      camera.position.set(p.x, p.y, p.z);
      p.yaw = yaw;
      p.pitch = pitch;
    } else camera.position.y = EYE_HEIGHT + (moving ? Math.sin(bob.current) * 0.035 : 0);
    footstepsFollow(bob.current, moving, speed > 5, surfaceAt(floor === ROOF ? 'roof' : floor === 0 ? 'lobby' : 'office', camera.position.x, camera.position.z));
    camera.rotation.set(pitch + (p?.tilt ?? 0) + sipPose.head, yaw, 0, 'YXZ');
    playerAt.x = camera.position.x;
    playerAt.z = camera.position.z;
    playerAt.yaw = yaw;

    const now = performance.now();
    if (s.started && !s.travel && now - lastSave.current > 1000) {
      lastSave.current = now;
      const at = p ? p.exit : camera.position; // a reload stands you up beside your deck chair
      saveView({ floor: s.floor, x: at.x, z: at.z, yaw, pitch });
    }

    // what are we looking at? (nothing while perched: E gets you up)
    if (++frame.current % 3 !== 0) return;
    if (s.overlay || s.travel || p || isConfirmOpen()) {
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
      if (h.distance <= info.range) found = info.pick?.(h.point, o) ?? { id: info.id, label: info.label, action: info.action };
      break;
    }
    s.setFocus(found);
  });

  return null;
}
