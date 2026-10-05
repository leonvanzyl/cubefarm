import { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { VisitorHeld, VisitorPose } from '../../../../shared/types';
import { useStore, type Held } from '../../store';
import { photoActive } from '../../photo/gate';
import { isConfirmOpen } from '../../ui/Confirm';
import { isKey } from '../../ui/controls';
import { cameraMode, exitView, followBody, followingId, followOnFloor, playerAt, rigOwnsCamera } from '../camera/rig';
import { Pings, pingHere } from './Pings';
import { drawnVisitors, remoteOf, setFloorHere, setFollower, syncSelf, tickPresence } from './presenceState';
import { Visitors, visitorBodyId } from './Visitors';

// Shared presence in the 3D view (#223): the other visitors on this floor and their pings, following one with the
// camera (rig.ts's follow cam, riding the elevator after them), and this tab's own pose going out (presenceState.ts
// sends it only when it changed, at most ten times a second).

/** What's in your hands, as the others draw it (a sticky stays yours). */
export function heldForOthers(h: Held | null): VisitorHeld | null {
  if (!h) return null;
  if (h.kind === 'mug') return { k: 'mug', id: h.id, s: h.sips };
  if (h.kind === 'ball' || h.kind === 'blaster') return { k: h.kind, id: h.id };
  return null;
}

// ---------- following a visitor ----------

const VISITOR = 'visitor:';
/** The visitor the follow cam trails (or is on its way to), by presence id; null for nobody or someone else. */
const followedVisitor = () => {
  const id = followingId();
  return id?.startsWith(VISITOR) ? id.slice(VISITOR.length) : null;
};

function followVisitor(id: string) {
  const r = remoteOf(id);
  if (!r) return false;
  followOnFloor(r.floor, followBody(visitorBodyId(id), r.name));
  return true;
}

setFollower({ start: followVisitor, stop: () => void (followedVisitor() && exitView()), current: followedVisitor });

/** They walked into the elevator and are gone from this floor: ride after them, and carry on following up there. */
function rideAlong(floor: number, travelling: boolean) {
  const id = followedVisitor();
  if (!id || travelling || cameraMode() !== 'follow') return;
  const r = remoteOf(id);
  if (r && r.floor !== floor && !drawnVisitors().includes(id)) followVisitor(id);
}

// ---------- input ----------

/** Middle-click pings where the mouse is (the crosshair while looking around); the ping key, the crosshair on foot. */
function usePingInput(canvas: HTMLCanvasElement) {
  useEffect(() => {
    const ready = () => {
      const s = useStore.getState();
      return s.started && !s.overlay && !s.travel && !s.replaying && !photoActive() && !isConfirmOpen();
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
      if (!isKey('ping', e.code) || e.repeat || e.ctrlKey || e.metaKey || e.altKey || cameraMode() !== 'first' || !ready()) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
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

// ---------- the scene ----------

const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function Presence() {
  const floor = useStore((s) => s.floor);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  useEffect(() => setFloorHere(floor), [floor]);
  usePingInput(gl.domElement);

  useFrame(() => {
    const s = useStore.getState();
    const now = performance.now();
    tickPresence(now);
    rideAlong(s.floor, !!s.travel);
    let pose: VisitorPose | null = null;
    if (s.started && !s.travel) {
      // In the overview, following someone or in photo mode, you're still where you stood (rig.ts playerAt), not
      // where the camera is.
      const away = rigOwnsCamera() || photoActive();
      euler.setFromQuaternion(camera.quaternion, 'YXZ');
      pose = {
        ts: Math.round(now),
        f: s.floor,
        x: r2(away ? playerAt.x : camera.position.x),
        z: r2(away ? playerAt.z : camera.position.z),
        h: r3(away ? playerAt.yaw : euler.y),
        p: away ? 0 : r3(euler.x),
        held: heldForOthers(s.held),
      };
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
