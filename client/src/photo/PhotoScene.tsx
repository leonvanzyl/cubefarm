// Photo mode inside the Canvas (lazy, mounted only while it's on): a camera of its own that flies or orbits, and the
// drawing. Frozen, the frame loop is stopped (Game.tsx), so nothing in the office moves and this draws from its own
// requestAnimationFrame, only when something changed; live, it draws last in each frame (useFrame priority 1 takes
// over the render). On Medium and High it draws through its own copy of the graphics effects (bloom, AO, grading),
// built for its camera. Either way the player's camera, hands and look are never touched. No allocations per frame.
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { bindings } from '../ui/controls';
import { anyHeld, isBound, type ActionId } from '../ui/keymap';
import type { Pipeline } from '../world/gfx/pipeline';
import { effectiveTier, useGfx } from '../world/gfx/useGraphics';
import { BOARD, GONG } from '../world/layout';
import { createLookFilter, filterLookDelta, LOOK_RADIANS_PER_PX, resetLookFilter, useLookPrefs } from '../world/look';
import { bodyState } from '../world/people';
import { runSkyFrames } from '../world/sky/useDayTime';
import { GRADES, needsGrade } from './filters';
import { flyStep, look, newFreeCam, orbitFrom, orbitStep, rollStep, zoom, type FlyInput, type Orbit } from './flight';
import { usePhotoGate } from './gate';
import { canvasBlob, thumbnail } from './media';
import { drawOverlay } from './overlay';
import {
  activeClip,
  cam,
  focusCenter,
  leave,
  overlayOptions,
  requestFrame,
  setBridge,
  setFrozen,
  takeRedraw,
  takeShot,
  toggleRecording,
  update,
  usePhoto,
  type OrbitTarget,
} from './photoMode';
import { PhotoPost, type PostOptions } from './post';
import { shotSize, tiles, type ShotScale } from './shots';

/** The player's own movement keys fly the camera (Help → Controls), the overview's turn keys roll it; Space and C rise and sink. */
const FLY_ACTIONS: readonly ActionId[] = ['forward', 'back', 'left', 'right', 'run', 'rotateLeft', 'rotateRight'];
const UP = 'Space';
const DOWN = 'KeyC';

/** Text fields keep their keys; on a slider, button or checkbox the arrows, Space and Enter stay theirs too. */
function keyTarget(e: KeyboardEvent): 'text' | 'control' | 'view' {
  const el = e.target as HTMLElement | null;
  if (!el || el === document.body) return 'view';
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return 'text';
  if (el.tagName === 'INPUT') return ['range', 'checkbox', 'radio', 'button'].includes((el as HTMLInputElement).type) ? 'control' : 'text';
  return el.tagName === 'BUTTON' ? 'control' : 'view';
}

/** Where an orbit's target is now (people move while the office runs), or false when it's gone. */
function targetPoint(t: OrbitTarget, out: THREE.Vector3): boolean {
  if (t === 'gong') out.set(GONG.x, GONG.y, GONG.z);
  else if (t === 'board') out.set(0, BOARD.y + BOARD.h / 2, BOARD.z);
  else if (t.startsWith('person:')) {
    const s = bodyState(t.slice(7));
    if (!s) return false;
    if (s.stage === 'seated') out.set(s.seatX, 1.1, s.seatZ);
    else out.set(s.x, 1.35, s.z);
  } else return false;
  return true;
}

function shown(o: THREE.Object3D | null): boolean {
  // a batched part's stand-in (world/Batched.tsx) is never drawn itself: its batch draws it where it stands
  for (; o; o = o.parent) if (!o.visible && !o.userData.standIn) return false;
  return true;
}

/** Part of a name tag or sign (a billboard): it keeps its owner's depth, so it's as sharp as they are. */
function onSign(o: THREE.Object3D | null): boolean {
  for (let n = 0; o && n < 6; o = o.parent, n++) {
    const u = o.userData as { billboard?: boolean; facesCamera?: boolean };
    if (u.billboard || u.facesCamera) return true;
  }
  return false;
}

function isFirstPerson(o: THREE.Object3D | null): boolean {
  for (; o; o = o.parent) if ((o.userData as { firstPerson?: boolean }).firstPerson) return true;
  return false;
}

export default function PhotoScene() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const get = useThree((s) => s.get);
  const frozen = usePhotoGate((s) => s.frozen);

  const view = useMemo(() => new THREE.PerspectiveCamera(camera.fov, 1, camera.near, camera.far), [camera]);
  const post = useMemo(() => new PhotoPost(gl), [gl]);
  useEffect(() => () => post.dispose(), [post]);
  const tier = useGfx(effectiveTier);
  const [pipe, setPipe] = useState<Pipeline | null>(null);

  // Everything the frame loop reuses, made once.
  const rt = useMemo(() => {
    const r = {
      keys: new Set<string>(),
      input: { forward: 0, right: 0, up: 0, roll: 0, fast: false } as FlyInput,
      orbit: null as Orbit | null,
      orbitKey: 'free' as OrbitTarget,
      target: new THREE.Vector3(),
      facing: [] as THREE.Object3D[],
      firstPerson: [] as THREE.Object3D[],
      seeThrough: [] as THREE.Object3D[],
      hidden: [] as boolean[],
      /** How much further out the fog starts while this camera draws (prepare to putBack). */
      fogBack: 0,
      scanAt: -Infinity,
      frames: 0,
      seed: 0,
      q: new THREE.Quaternion(),
      buf: new THREE.Vector2(),
      ray: new THREE.Raycaster(),
      center: new THREE.Vector2(),
      unlockedAt: -Infinity,
      lookFilter: createLookFilter(),
      /** The canvas's CSS size (kept here so the loop's functions never go stale). */
      width: 1,
      height: 1,
      /** The graphics effects for this camera, on Medium and High. */
      pipe: null as Pipeline | null,
      delta: 0,
      post: { grade: GRADES.none, dof: null, seed: 0, origin: [0, 0], full: [1, 1], px: 1, seeThrough: [] } as PostOptions,
      dof: { focus: 4, blur: 0.5 },
      visit: (o: THREE.Object3D) => {
        const u = o.userData as { billboard?: boolean; facesCamera?: boolean; firstPerson?: boolean };
        if (u.billboard && o.children[0]) r.facing.push(o.children[0]); // drei's Billboard turns its inner group
        if (u.facesCamera) r.facing.push(o);
        if (u.firstPerson) r.firstPerson.push(o);
        const m = o as THREE.Mesh;
        if (m.isMesh && !Array.isArray(m.material) && m.material.transparent && !onSign(o)) r.seeThrough.push(o);
      },
    };
    r.post.seeThrough = r.seeThrough;
    return r;
  }, []);

  useLayoutEffect(() => {
    rt.width = Math.max(1, size.width);
    rt.height = Math.max(1, size.height);
    pipe?.setSize(rt.width, rt.height);
    requestFrame();
  }, [rt, size, pipe]);

  // The tier's effects, from the chunk Effects.tsx already loaded (it stands down while photo mode draws).
  useEffect(() => {
    if (tier === 'low') return;
    let alive = true;
    let made: Pipeline | null = null;
    void import('../world/gfx/pipeline').then(({ createPipeline }) => {
      if (!alive) return;
      try {
        made = createPipeline(gl, scene, view, tier);
        made.setSize(rt.width, rt.height);
        rt.pipe = made;
        setPipe(made);
        requestFrame();
      } catch {
        // the effects can't run here: photos are drawn as on Low
      }
    });
    return () => {
      alive = false;
      rt.pipe = null;
      made?.dispose();
      setPipe(null);
    };
  }, [gl, scene, view, rt, tier]);

  // Start exactly where the player is looking.
  useLayoutEffect(() => {
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    Object.assign(cam, newFreeCam(camera.position.x, camera.position.y, camera.position.z, e.y, e.x, camera.fov));
    requestFrame();
  }, [camera]);

  // The frame loop's work, made once (it reads the size and settings from rt and the stores, so it never goes stale).
  const engine = useMemo(() => {
    /** Finds the tagged and see-through objects again (people come and go; balls are picked up). */
    const scan = () => {
      rt.facing.length = 0;
      rt.firstPerson.length = 0;
      rt.seeThrough.length = 0;
      scene.traverse(rt.visit);
      rt.scanAt = rt.frames;
    };

    /** The free camera into the view camera, billboards turned to face it, the player's hands put away. */
    const prepare = () => {
      view.position.set(cam.x, cam.y, cam.z);
      view.rotation.set(cam.pitch, cam.yaw, cam.roll, 'YXZ');
      const aspect = rt.width / rt.height;
      if (view.fov !== cam.fov || view.aspect !== aspect) {
        view.fov = cam.fov;
        view.aspect = aspect;
        view.updateProjectionMatrix();
      }
      view.updateMatrixWorld();
      if (rt.frames - rt.scanAt > 30) scan();
      for (let n = 0; n < rt.facing.length; n++) {
        const o = rt.facing[n];
        if (!o.parent) continue;
        o.parent.getWorldQuaternion(rt.q);
        o.quaternion.copy(view.quaternion).premultiply(rt.q.invert());
      }
      rt.hidden.length = 0;
      for (let n = 0; n < rt.firstPerson.length; n++) {
        rt.hidden.push(rt.firstPerson[n].visible);
        rt.firstPerson[n].visible = false;
      }
      // three.js measures fog from the camera: flown away from the player's, it starts that much further out, as for
      // the overview (camera/rig.ts viewStandoff), so a shot from afar doesn't sink the office in it
      const fog = scene.fog as THREE.Fog | null;
      rt.fogBack = fog?.isFog ? view.position.distanceTo(camera.position) : 0;
      if (fog && rt.fogBack) {
        fog.near += rt.fogBack;
        fog.far += rt.fogBack;
      }
      const s = usePhoto.getState();
      const p = rt.post;
      p.grade = GRADES[s.filter];
      rt.dof.focus = s.focus;
      rt.dof.blur = s.blur;
      p.dof = s.dof && s.blur > 0 ? rt.dof : null;
    };

    const putBack = () => {
      for (let i = 0; i < rt.firstPerson.length; i++) rt.firstPerson[i].visible = rt.hidden[i];
      const fog = scene.fog as THREE.Fog | null;
      if (fog && rt.fogBack) {
        fog.near -= rt.fogBack;
        fog.far -= rt.fogBack;
      }
      rt.fogBack = 0;
    };

    /** One picture of the whole view, as on screen. */
    const draw = () => {
      prepare();
      gl.getDrawingBufferSize(rt.buf);
      const p = rt.post;
      p.origin[0] = 0;
      p.origin[1] = 0;
      p.full[0] = rt.buf.x;
      p.full[1] = rt.buf.y;
      p.px = gl.getPixelRatio();
      p.seed = rt.seed;
      post.render(scene, view, rt.pipe, rt.delta, p);
      putBack();
      activeClip()?.draw();
      rt.frames++;
    };

    /** Moves the camera on `dt` seconds; draws when something changed (always while live or recording). */
    const frame = (dt: number, live: boolean) => {
      rt.delta = dt;
      const k = rt.keys;
      const i = rt.input;
      const b = bindings();
      i.forward = (anyHeld(b, 'forward', k) ? 1 : 0) - (anyHeld(b, 'back', k) ? 1 : 0);
      i.right = (anyHeld(b, 'right', k) ? 1 : 0) - (anyHeld(b, 'left', k) ? 1 : 0);
      i.up = (k.has(UP) ? 1 : 0) - (k.has(DOWN) ? 1 : 0);
      i.roll = (anyHeld(b, 'rotateRight', k) ? 1 : 0) - (anyHeld(b, 'rotateLeft', k) ? 1 : 0);
      i.fast = anyHeld(b, 'run', k);
      const orbit = usePhoto.getState().orbit;
      let moved = false;
      if (orbit !== 'free' && targetPoint(orbit, rt.target)) {
        const t = rt.target;
        if (rt.orbitKey !== orbit || !rt.orbit) rt.orbit = orbitFrom(cam, t.x, t.y, t.z);
        rt.orbitKey = orbit;
        rt.orbit.cx = t.x;
        rt.orbit.cy = t.y;
        rt.orbit.cz = t.z;
        orbitStep(rt.orbit, cam, dt);
        rollStep(cam, i.roll, dt);
        moved = true;
      } else {
        if (orbit !== 'free') update({ orbit: 'free' }); // they left, or there's no such thing on this floor
        rt.orbitKey = 'free';
        flyStep(cam, i, dt);
        moved = i.forward !== 0 || i.right !== 0 || i.up !== 0 || i.roll !== 0 || Math.abs(cam.vx) + Math.abs(cam.vy) + Math.abs(cam.vz) > 1e-4;
      }
      const recording = activeClip() !== null;
      if (recording) rt.seed = (rt.seed + 0.618) % 64;
      if (takeRedraw() || moved || live || recording) draw();
    };

    return { prepare, putBack, frame };
  }, [gl, scene, view, camera, post, rt]);
  const { prepare, putBack, frame } = engine;

  // Frozen: the frame loop is stopped, so photo mode keeps its own.
  useEffect(() => {
    if (!frozen) return;
    let id = 0;
    let last = performance.now();
    const loop = (now: number) => {
      frame(Math.min(0.1, Math.max(0, (now - last) / 1000)), false);
      last = now;
      id = requestAnimationFrame(loop);
    };
    requestFrame();
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [frozen, frame]);

  // Live: drawn after everything else has moved; a priority above 0 also stops R3F drawing the player's view.
  useFrame((_, delta) => {
    if (!usePhotoGate.getState().frozen) frame(Math.min(delta, 0.1), true);
  }, 1);

  // A new time of day (the sky follows it even while frozen) or new settings: draw again.
  useEffect(
    () =>
      usePhoto.subscribe((s, prev) => {
        if (s.daytime !== prev.daytime && usePhotoGate.getState().frozen) runSkyFrames(get());
        requestFrame();
      }),
    [get],
  );

  // The keys and the mouse, while photo mode is on (the player's own controls stand down: Player.tsx).
  useEffect(() => {
    const canvas = gl.domElement;
    const keys = rt.keys;
    const onKeyDown = (e: KeyboardEvent) => {
      const on = keyTarget(e);
      if (on === 'text' || e.ctrlKey || e.metaKey || e.altKey) return;
      const c = e.code;
      if (c === 'Escape') {
        // the Esc that frees the mouse isn't also a request to leave
        if (!document.pointerLockElement && performance.now() - rt.unlockedAt > 400) leave();
        return;
      }
      const b = bindings();
      if (c === UP || c === DOWN || FLY_ACTIONS.some((a) => isBound(b, a, c))) {
        if (on === 'control' && (c.startsWith('Arrow') || c === UP)) return;
        e.preventDefault();
        keys.add(c);
        return;
      }
      if (e.repeat) return;
      if (c === 'Enter' && on === 'view') void takeShot();
      else if (c === 'KeyF') setFrozen(!usePhotoGate.getState().frozen);
      else if (c === 'KeyH') update({ panel: !usePhoto.getState().panel });
      else if (c === 'KeyT') focusCenter();
      else if (c === 'KeyV') void toggleRecording();
      else if (c === 'KeyR') {
        cam.roll = 0;
        cam.fov = camera.fov;
        requestFrame();
      } else return;
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => void keys.delete(e.code);
    const onBlur = () => keys.clear();
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || document.pointerLockElement === canvas) return;
      try {
        canvas.requestPointerLock?.()?.catch?.(() => undefined);
      } catch {
        // older browsers throw instead of rejecting
      }
    };
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas || usePhoto.getState().orbit !== 'free') return;
      const d = filterLookDelta(rt.lookFilter, e.movementX, e.movementY, e.timeStamp);
      if (!d) return;
      const { sensitivity, invertY } = useLookPrefs.getState();
      // zoomed in, the same hand movement turns the view less
      const k = LOOK_RADIANS_PER_PX * sensitivity * Math.min(1, cam.fov / 72);
      look(cam, d[0] * k, d[1] * k * (invertY ? -1 : 1));
      requestFrame();
    };
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('.photo-panel')) return;
      cam.fov = zoom(cam.fov, e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY);
      requestFrame();
    };
    const onLock = () => {
      resetLookFilter(rt.lookFilter);
      if (!document.pointerLockElement) rt.unlockedAt = performance.now();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    canvas.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMove);
    window.addEventListener('wheel', onWheel, { passive: true });
    document.addEventListener('pointerlockchange', onLock);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      canvas.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMove);
      window.removeEventListener('wheel', onWheel);
      document.removeEventListener('pointerlockchange', onLock);
    };
  }, [gl, rt, camera]);

  // What the controls (photoMode.ts) ask of the scene.
  useEffect(() => {
    setBridge({
      frames: () => rt.frames,
      focusCenter() {
        prepare();
        putBack();
        rt.ray.setFromCamera(rt.center, view);
        for (const h of rt.ray.intersectObjects(scene.children, true)) {
          const o = h.object as THREE.Mesh;
          if (!o.isMesh || !o.frustumCulled || !shown(o) || isFirstPerson(o)) continue;
          if (!Array.isArray(o.material) && o.material.transparent) continue; // glass: focus through it
          return h.distance;
        }
        return null;
      },
      async shot(want: ShotScale) {
        const { width, height, scale } = shotSize(rt.width, rt.height, window.devicePixelRatio || 1, want);
        const out = document.createElement('canvas');
        out.width = width;
        out.height = height;
        const ctx = out.getContext('2d');
        if (!ctx) throw new Error('the browser could not make a canvas that big');
        prepare();
        gl.getDrawingBufferSize(rt.buf);
        const bw = rt.buf.x;
        const bh = rt.buf.y;
        const p = rt.post;
        p.full[0] = width;
        p.full[1] = height;
        p.px = width / rt.width;
        const effects = p.dof !== null || needsGrade(p.grade);
        // Bloom spreads far: give it room round each tile so glows crossing a seam don't stop at it.
        const margin = Math.max(effects ? post.margin(p) : 0, rt.pipe ? Math.round(Math.min(bw, bh) * 0.08) : 0);
        // Each tile is drawn to the screen and copied out at once: the screen only shows the last, for one frame at most.
        for (const t of tiles(width, height, bw, bh, margin)) {
          view.setViewOffset(width, height, t.viewX, t.viewY, bw, bh);
          p.origin[0] = t.viewX;
          p.origin[1] = height - (t.viewY + bh);
          post.render(scene, view, rt.pipe, 0, p);
          ctx.drawImage(gl.domElement, t.x - t.viewX, t.y - t.viewY, t.w, t.h, t.x, t.y, t.w, t.h);
        }
        view.clearViewOffset();
        view.aspect = rt.width / rt.height;
        view.updateProjectionMatrix();
        putBack();
        requestFrame();
        drawOverlay(ctx, width, height, overlayOptions(false));
        const png = await canvasBlob(out, 'image/png');
        const thumb = await thumbnail(out, width, height);
        out.width = 0; // let the big canvas go now rather than when it's collected
        return { png, thumb, width, height, scale };
      },
    });
    return () => setBridge(null);
  }, [gl, scene, view, post, rt, prepare, putBack]);

  return null;
}
