import * as THREE from 'three';
import { create } from 'zustand';
import { useStore } from '../../store';
import { HALF_D, HALF_W } from '../layout';
import { poseNow, remoteOf, setFollower, type DrawnPose } from './presenceState';

// "Follow" in the HUD's people list: the view trails a visitor in third person, taking the elevator when they change
// floors, until you move (WASD or the arrows), press Esc or they leave the office. A small stand-in for a shared
// follow cam: it borrows the camera only while the frame is drawn (the scene's onBeforeRender, given back in
// onAfterRender), so Player.tsx, the sounds and everything else still see you where you stand, and so do the others.

/** How far behind and above them the camera sits, and how quickly it catches up (per second). */
const BACK = 3.4;
const UP = 2.3;
const LOOK_Y = 1.35;
const EASE = 5;
/** How long they may be out of sight (between floors, say) before the follow gives up. */
const LOST_MS = 12_000;
/** The camera stays indoors: the floor, and back as far as the elevator cabin's wall. */
const ROOM = { x: HALF_W - 0.3, zMin: -HALF_D + 0.3, zMax: HALF_D + 2.3 };

interface FollowView {
  /** Who the view trails (their name, for the HUD), or null. */
  following: string | null;
  id: string | null;
}

export const useFollow = create<FollowView>(() => ({ following: null, id: null }));

const f = {
  id: null as string | null,
  lostAt: 0,
  fresh: true,
  cam: new THREE.Vector3(),
  look: new THREE.Vector3(),
  savedPos: new THREE.Vector3(),
  savedQuat: new THREE.Quaternion(),
  borrowed: false,
  last: 0,
  at: { x: 0, z: 0, h: 0, p: 0 } as DrawnPose,
};

export function startFollow(id: string): boolean {
  const r = remoteOf(id);
  if (!r) return false;
  const s = useStore.getState();
  f.id = id;
  f.fresh = true;
  f.lostAt = 0;
  useFollow.setState({ following: r.name, id });
  if (s.overlay) s.openOverlay(null);
  if (r.floor !== s.floor && !s.travel) s.goToFloor(r.floor);
  return true;
}

export function stopFollow() {
  f.id = null;
  useFollow.setState({ following: null, id: null });
}

setFollower({ start: startFollow, stop: stopFollow, current: () => f.id });

// Moving or Esc hands the view back.
const STOP_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape']);
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (f.id && STOP_KEYS.has(e.code)) stopFollow();
  });
}

/**
 * Hooks the follow cam into `scene`'s rendering. Before each frame is drawn the camera moves behind the one followed
 * (eased); after it, it's put back where you stand. Returns the undo.
 */
export function installFollowCam(scene: THREE.Scene, camera: THREE.Camera) {
  scene.onBeforeRender = () => {
    if (!f.id) return;
    const r = remoteOf(f.id);
    const s = useStore.getState();
    const now = performance.now();
    if (!r) return stopFollow(); // they left the office
    // they took the elevator: so do you
    if (r.floor !== s.floor && !s.travel) {
      s.goToFloor(r.floor);
      f.fresh = true;
    }
    const at = r.floor === s.floor && !s.travel ? poseNow(r, now, f.at) : null;
    if (!at) {
      f.lostAt ||= now;
      if (now - f.lostAt > LOST_MS) stopFollow();
      return;
    }
    f.lostAt = 0;
    const dt = f.last ? Math.min(0.1, (now - f.last) / 1000) : 0;
    f.last = now;
    // behind them (heading 0 faces -Z, so behind is +Z), a little above, looking at their shoulders
    const want = new THREE.Vector3(
      THREE.MathUtils.clamp(at.x + Math.sin(at.h) * BACK, -ROOM.x, ROOM.x),
      UP,
      THREE.MathUtils.clamp(at.z + Math.cos(at.h) * BACK, ROOM.zMin, ROOM.zMax),
    );
    const look = new THREE.Vector3(at.x, LOOK_Y, at.z);
    if (f.fresh) {
      f.cam.copy(want);
      f.look.copy(look);
      f.fresh = false;
    } else {
      const k = 1 - Math.exp(-dt * EASE);
      f.cam.lerp(want, k);
      f.look.lerp(look, Math.min(1, k * 2));
    }
    f.savedPos.copy(camera.position);
    f.savedQuat.copy(camera.quaternion);
    f.borrowed = true;
    camera.position.copy(f.cam);
    camera.lookAt(f.look);
    camera.updateMatrixWorld();
  };
  scene.onAfterRender = () => {
    if (!f.borrowed) return;
    f.borrowed = false;
    camera.position.copy(f.savedPos);
    camera.quaternion.copy(f.savedQuat);
    camera.updateMatrixWorld();
  };
  return () => {
    scene.onBeforeRender = () => undefined;
    scene.onAfterRender = () => undefined;
    stopFollow();
  };
}
