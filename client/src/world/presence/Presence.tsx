import { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { VisitorHeld, VisitorPose } from '../../../../shared/types';
import { useStore, type Held } from '../../store';
import { isConfirmOpen } from '../../ui/Confirm';
import { installFollowCam } from './follow';
import { Pings, pingHere } from './Pings';
import { setFloorHere, syncSelf, tickPresence } from './presenceState';
import { Visitors } from './Visitors';

// Shared presence in the 3D view (#223): the other visitors on this floor, their pings, the follow cam, and this tab's
// own pose going out (presence.ts sends it only when it changed, at most ten times a second).

/** What's in your hands, as the others draw it (a sticky stays yours). */
export function heldForOthers(h: Held | null): VisitorHeld | null {
  if (!h) return null;
  if (h.kind === 'mug') return { k: 'mug', id: h.id, s: h.sips };
  if (h.kind === 'ball' || h.kind === 'blaster') return { k: h.kind, id: h.id };
  return null;
}

const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Middle-click (or Q) pings: at the crosshair while looking around, at the mouse when it's free. */
function usePingInput(canvas: HTMLCanvasElement) {
  useEffect(() => {
    const ready = () => {
      const s = useStore.getState();
      return s.started && !s.overlay && !s.travel && !isConfirmOpen();
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 1 || !ready()) return;
      e.preventDefault(); // no autoscroll
      if (document.pointerLockElement === canvas) pingHere();
      else {
        const r = canvas.getBoundingClientRect();
        pingHere(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1));
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyQ' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || !ready()) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      pingHere();
    };
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [canvas]);
}

export function Presence() {
  const floor = useStore((s) => s.floor);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  useEffect(() => setFloorHere(floor), [floor]);
  useEffect(() => installFollowCam(scene, camera), [scene, camera]);
  usePingInput(gl.domElement);

  useFrame(() => {
    const s = useStore.getState();
    const now = performance.now();
    tickPresence(now);
    let pose: VisitorPose | null = null;
    if (s.started && !s.travel) {
      euler.setFromQuaternion(camera.quaternion, 'YXZ');
      pose = { ts: Math.round(now), f: s.floor, x: r2(camera.position.x), z: r2(camera.position.z), h: r3(euler.y), p: r3(euler.x), held: heldForOthers(s.held) };
    }
    syncSelf({ started: s.started, floor: s.floor, pose }, now);
  });

  return (
    <>
      <Visitors />
      <Pings />
    </>
  );
}
