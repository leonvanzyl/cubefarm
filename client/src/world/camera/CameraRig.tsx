import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../../store';
import { wasPressed } from '../gamepad';
import { HALF_D, HALF_W } from '../layout';
import { toon } from '../materials';
import { runFocusAction } from '../Player';
import { BuildingView } from './BuildingView';
import { OverviewChips } from './OverviewChips';
import { hovered, pickAt, type Pick } from './picking';
import { bindCamera, bindCanvas, cameraMode, cutKind, dragView, rigFlying, setHover, setViewport, useCameraView, visitFloor, zoomView } from './rig';

// Inside the Canvas: hands the camera to the rig (rig.ts), and in the overview, the building view and the follow cam
// turns the mouse into the views' controls: drag to pan, the wheel to zoom, a click (or the pad's A, at the middle of
// the screen) to open whatever is under it. Draws the chips, the building's slices and the dollhouse's base.

/** Opens what a view's click (or the pad's A, like E) landed on, as in first person: hiring by click asks first. */
function act(p: Pick, via: 'key' | 'click') {
  if (p.kind === 'floor') return visitFloor(p.floor);
  if (p.kind === 'agent') return runFocusAction({ id: `agent-${p.agentId}`, label: p.label, action: { kind: 'terminal', agentId: p.agentId } }, via);
  runFocusAction(p.focus, via);
}

const viewing = () => cameraMode() !== 'first';
const DRAG_PX = 5;

export function CameraRig() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const mode = useCameraView((s) => s.mode);
  const base = useRef<THREE.Mesh>(null);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const mouse = useMemo(() => ({ x: 0, y: 0, dirty: false, inside: false, shown: false }), []);
  const frame = useRef(0);

  useEffect(() => {
    bindCamera(camera as THREE.PerspectiveCamera);
    bindCanvas(gl.domElement);
    return () => {
      bindCamera(null);
      bindCanvas(null);
    };
  }, [camera, gl]);

  useEffect(() => {
    const el = gl.domElement;
    let drag: { x: number; y: number; lx: number; ly: number; moved: boolean } | null = null;
    const toNdc = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      mouse.inside = e.target === el;
      mouse.dirty = true;
    };
    const pick = () => {
      ndc.set(mouse.x, mouse.y);
      ray.setFromCamera(ndc, camera);
      return pickAt(ray, cameraMode() === 'building' ? 'building' : 'overview');
    };
    // Mouse events, not pointer events: the quiet-click guard (Player.tsx) swallows these after a panel closes.
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || !viewing() || useStore.getState().overlay) return;
      toNdc(e);
      drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
    };
    const onMove = (e: MouseEvent) => {
      toNdc(e);
      if (!drag || !viewing()) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_PX) return;
      drag.moved = true;
      dragView(e.clientX - drag.lx, e.clientY - drag.ly);
      drag.lx = e.clientX;
      drag.ly = e.clientY;
    };
    const onUp = (e: MouseEvent) => {
      const was = drag;
      drag = null;
      if (e.button !== 0 || !was || was.moved || !viewing() || rigFlying() || useStore.getState().overlay) return;
      toNdc(e);
      const p = pick();
      if (p) act(p, 'click');
    };
    const onWheel = (e: WheelEvent) => {
      if (!viewing() || useStore.getState().overlay) return;
      e.preventDefault();
      zoomView(e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY);
    };
    const onLeave = () => {
      mouse.inside = false;
      mouse.dirty = true;
    };
    el.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('mouseleave', onLeave);
    };
  }, [gl, camera, mouse, ndc, ray]);

  useFrame(({ size }) => {
    setViewport(size.width, size.height);
    if (base.current) base.current.visible = cutKind() === 'dollhouse';
    const s = useStore.getState();
    const live = viewing() && !s.overlay && !s.travel && !rigFlying();
    // the pad's A clicks whatever is in the middle of the screen
    if (live && wasPressed('A')) {
      ndc.set(0, 0);
      ray.setFromCamera(ndc, camera);
      const p = pickAt(ray, cameraMode() === 'building' ? 'building' : 'overview');
      if (p) act(p, 'key');
    }
    // what a click would open, under the mouse (every other frame, and only once it has moved)
    if (++frame.current % 2 !== 0) return;
    if (!live || !mouse.inside) {
      if (mouse.shown) {
        mouse.shown = false;
        hovered.floor = -1;
        setHover(null);
        gl.domElement.style.cursor = '';
      }
      return;
    }
    if (!mouse.dirty) return;
    mouse.dirty = false;
    ndc.set(mouse.x, mouse.y);
    ray.setFromCamera(ndc, camera);
    const p = pickAt(ray, cameraMode() === 'building' ? 'building' : 'overview');
    mouse.shown = true;
    hovered.floor = p?.kind === 'floor' ? p.floor : -1;
    setHover(p?.label ?? null);
    gl.domElement.style.cursor = p ? 'pointer' : 'grab';
  });

  return (
    <>
      {/* the dollhouse's base: the slab under the floor, seen where the walls are cut away */}
      <mesh ref={base} visible={false} position={[0, -0.17, 0]} material={toon('#c9bfae')}>
        <boxGeometry args={[HALF_W * 2 - 0.12, 0.32, HALF_D * 2 - 0.12]} />
      </mesh>
      {mode === 'overview' && <OverviewChips />}
      {mode === 'building' && <BuildingView />}
    </>
  );
}
