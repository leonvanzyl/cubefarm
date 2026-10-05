// Photo mode's controls, loaded on first use: the settings the panel and the scene share, going in and coming out
// (everything it touches is put back exactly), the free camera, shots and clips. PhotoScene.tsx does the drawing.
import { create } from 'zustand';
import { useStore } from '../store';
import { soundStream } from '../ui/sfx';
import { holdGongRuns } from '../world/gongRunner';
import { requestLook } from '../world/Player';
import { dayTime, sampleDayTime } from '../world/sky/useDayTime';
import { GRADES, isFilter, type Filter } from './filters';
import { FOV_MAX, FOV_MIN, newFreeCam, ROLL_MAX } from './flight';
import { addToGallery, here, useGallery } from './gallery';
import { canEnterPhoto, markLeft, officeCanvas, photoActive, usePhotoGate } from './gate';
import { clipSupport, copyImage, download } from './media';
import type { OverlayOptions } from './overlay';
import { startClip, type Clip } from './recorder';
import { caption, fileName, SCALES, type ShotScale } from './shots';

/** What a cinematic orbit circles: nothing (the free camera), the gong, the whiteboard or someone (`person:<id>`). */
export type OrbitTarget = 'free' | 'gong' | 'board' | `person:${string}`;

export const CLIP_SECONDS = [10, 30, 60] as const;
/** Golden hour on the sky's clock (sky/time.ts): the warm, low sun just before sunset. */
export const GOLDEN_HOUR = 0.735;

export interface PhotoState {
  filter: Filter;
  stamp: boolean;
  caption: boolean;
  guides: boolean;
  dof: boolean;
  /** Metres to the sharpest point. */
  focus: number;
  /** 0..1 */
  blur: number;
  /** A time of day held for the shot, or null for the sky as it is. */
  daytime: number | null;
  scale: ShotScale;
  fps: 30 | 60;
  /** How long a clip runs before it stops by itself (the panel offers CLIP_SECONDS; QA may ask for less). */
  clipSeconds: number;
  orbit: OrbitTarget;
  /** The panel is showing (H hides it for a clean view). */
  panel: boolean;
  recording: { started: number; limit: number; fps: number } | null;
  /** Something slow is under way ("Developing…", "Saving the clip…"). */
  busy: string | null;
  note: { text: string; level: 'info' | 'error' } | null;
}

export const usePhoto = create<PhotoState>(() => ({
  filter: 'none',
  stamp: true,
  caption: false,
  guides: true,
  dof: false,
  focus: 4,
  blur: 0.5,
  daytime: null,
  scale: 2,
  fps: 30,
  clipSeconds: 10,
  orbit: 'free',
  panel: true,
  recording: null,
  busy: null,
  note: null,
}));

/** The free camera: PhotoScene sets it from the player's view on the way in and moves it every frame. */
export const cam = newFreeCam(0, 1.65, 0, 0, 0, 72);

/** What only the scene can do: draw a shot, find what's in the middle of the view. Set while it's mounted. */
export interface SceneBridge {
  shot(scale: ShotScale): Promise<{ png: Blob; thumb: Blob; width: number; height: number; scale: number }>;
  focusCenter(): number | null;
  /** Frames drawn since photo mode opened (QA: a frozen office draws only when something changes). */
  frames(): number;
}

let bridge: SceneBridge | null = null;
export const setBridge = (b: SceneBridge | null) => void (bridge = b);

let redraw = true;
/** Asks for a new picture (the frozen office only draws when something changes). */
export const requestFrame = () => void (redraw = true);
export function takeRedraw() {
  const r = redraw;
  redraw = false;
  return r;
}

let saved: { locked: boolean; daytime: number | null } | null = null;
let clip: Clip | null = null;
let clipDone: ((r: ClipResult | null) => void)[] = [];

interface ClipResult {
  name: string;
  bytes: number;
  seconds: number;
  type: string;
  width: number;
  height: number;
}

export const activeClip = () => clip;

function note(text: string, level: 'info' | 'error' = 'info') {
  usePhoto.setState({ note: { text, level } });
}

// ---------- in and out ----------

/** Goes into photo mode, frozen, from the player's view. `locked`: whether the mouse was captured (it's given back). */
export function enter(locked = !!document.pointerLockElement): boolean {
  if (photoActive() || !canEnterPhoto()) return false;
  saved = { locked, daytime: dayTime.frozen };
  useStore.getState().setFocus(null);
  usePhoto.setState({ daytime: null, orbit: 'free', panel: true, note: null, busy: null });
  holdGongRuns(true);
  usePhotoGate.setState({ active: true, frozen: true });
  redraw = true;
  return true;
}

/** Back to the office exactly as it was: the player's view and hands, the mouse, the sky's clock and the gong. */
export function leave() {
  if (!photoActive()) return;
  if (clip) void stopRecording();
  const s = saved;
  saved = null;
  dayTime.frozen = s?.daytime ?? null;
  sampleDayTime();
  holdGongRuns(false);
  markLeft();
  usePhotoGate.setState({ active: false, frozen: false });
  if (s?.locked && !document.pointerLockElement) requestLook();
  else if (!s?.locked && document.pointerLockElement) document.exitPointerLock();
}

export function setFrozen(on: boolean) {
  if (!photoActive()) return;
  holdGongRuns(on);
  usePhotoGate.setState({ frozen: on });
  redraw = true;
}

/** Holds the sky at a time of day for the shot (null: the sky as it was). */
export function setDaytime(t: number | null) {
  const held = t === null ? null : ((t % 1) + 1) % 1;
  // the clock first: the scene's listener brings the sky up to it as soon as the setting changes
  dayTime.frozen = held ?? saved?.daytime ?? null;
  sampleDayTime();
  usePhoto.setState({ daytime: held });
  redraw = true;
}

/** Changes settings (the panel and __swarmPhoto.set). */
export function update(patch: Partial<PhotoState>) {
  usePhoto.setState(patch);
  redraw = true;
}

/** The overlay as the settings ask for it. */
export function overlayOptions(guides: boolean): OverlayOptions {
  const s = usePhoto.getState();
  const h = here();
  return {
    frame: GRADES[s.filter].frame,
    stamp: s.stamp ? useStore.getState().settings.companyName || 'cubefarm' : null,
    caption: s.caption ? caption(h.label, h.floor, new Date()) : null,
    guides: guides && s.guides,
  };
}

export function focusCenter() {
  const d = bridge?.focusCenter() ?? null;
  if (d === null) {
    note('Nothing in the middle of the view to focus on.');
    return null;
  }
  update({ dof: true, focus: Math.round(d * 10) / 10 });
  return d;
}

// ---------- shots ----------

export async function takeShot(scale: ShotScale = usePhoto.getState().scale) {
  if (!bridge || usePhoto.getState().busy) return null;
  usePhoto.setState({ busy: 'Developing…' });
  try {
    const r = await bridge.shot(scale);
    const name = fileName(here().label, new Date(), 'png');
    const item = addToGallery(r.png, { kind: 'shot', name, width: r.width, height: r.height, seconds: null }, r.thumb);
    download(item.url, name);
    const copied = await copyImage(r.png);
    const shrunk = r.scale < scale ? ` (${scale}× was too big for the browser, so ${Math.round(r.scale * 10) / 10}×)` : '';
    note(`📸 Saved ${name}, ${r.width}×${r.height}${shrunk}${copied ? ', and copied it' : ''}`);
    return { name, width: r.width, height: r.height, bytes: r.png.size, copied };
  } catch (err) {
    note(`The shot failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    return null;
  } finally {
    usePhoto.setState({ busy: null });
  }
}

// ---------- clips ----------

/** Starts recording what photo mode shows, with the office's sound. Resolves when the clip is saved. */
export function startRecording(): Promise<ClipResult | null> {
  if (clip) return new Promise((resolve) => clipDone.push(resolve));
  const canvas = officeCanvas();
  const support = clipSupport(canvas);
  if (!support.ok || !canvas) {
    note(support.ok ? 'The 3D view is not ready.' : support.why, 'error');
    return Promise.resolve(null);
  }
  const s = usePhoto.getState();
  try {
    clip = startClip({ source: canvas, fps: s.fps, seconds: s.clipSeconds, overlay: overlayOptions(false), audio: soundStream(), type: support.type, onLimit: () => void stopRecording() });
  } catch (err) {
    note(`Recording could not start: ${err instanceof Error ? err.message : String(err)}`, 'error');
    return Promise.resolve(null);
  }
  usePhoto.setState({ recording: { started: performance.now(), limit: s.clipSeconds, fps: s.fps }, note: null });
  redraw = true;
  return new Promise((resolve) => clipDone.push(resolve));
}

export async function stopRecording(): Promise<ClipResult | null> {
  const c = clip;
  if (!c) return null;
  clip = null;
  const seconds = c.elapsed();
  const waiting = clipDone;
  clipDone = [];
  usePhoto.setState({ recording: null, busy: 'Saving the clip…' });
  let result: ClipResult | null = null;
  try {
    const blob = await c.stop();
    const name = fileName(here().label, new Date(), 'webm');
    const item = addToGallery(blob, { kind: 'clip', name, width: c.width, height: c.height, seconds });
    download(item.url, name);
    result = { name, bytes: blob.size, seconds, type: blob.type, width: c.width, height: c.height };
    note(`🎬 Saved ${name}, ${Math.round(seconds)} s at ${c.width}×${c.height}`);
  } catch (err) {
    note(`The clip failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
  } finally {
    usePhoto.setState({ busy: null });
  }
  for (const fn of waiting) fn(result);
  return result;
}

export const toggleRecording = () => (clip ? stopRecording() : startRecording());

// ---------- window.__swarmPhoto (gate.ts forwards here) ----------

const round = (n: number, k = 100) => Math.round(n * k) / k;
const deg = (r: number) => round((r * 180) / Math.PI, 10);

export const probe = {
  state() {
    const s = usePhoto.getState();
    return {
      frozen: usePhotoGate.getState().frozen,
      camera: { x: round(cam.x), y: round(cam.y), z: round(cam.z), yaw: deg(cam.yaw), pitch: deg(cam.pitch), roll: deg(cam.roll), fov: round(cam.fov, 10) },
      filter: s.filter,
      overlays: { stamp: s.stamp, caption: s.caption, guides: s.guides },
      dof: s.dof ? { focus: s.focus, blur: s.blur } : null,
      daytime: s.daytime,
      orbit: s.orbit,
      recording: s.recording ? { seconds: round((performance.now() - s.recording.started) / 1000, 10), limit: s.recording.limit, fps: s.recording.fps } : null,
      busy: s.busy,
      note: s.note?.text ?? null,
      frames: bridge?.frames() ?? 0,
      gallery: useGallery.getState().items.map((i) => ({ kind: i.kind, name: i.name, bytes: i.bytes, width: i.width, height: i.height, seconds: i.seconds && round(i.seconds, 10) })),
    };
  },
  /** Settings by name; `daytime: 'golden'` is golden hour, `frozen` freezes or thaws, `fov` and `roll` (degrees) move the camera. */
  set(patch: Record<string, unknown>) {
    const p: Partial<PhotoState> = {};
    if (isFilter(patch.filter)) p.filter = patch.filter;
    for (const k of ['stamp', 'caption', 'guides', 'dof', 'panel'] as const) if (typeof patch[k] === 'boolean') p[k] = patch[k] as boolean;
    if (typeof patch.focus === 'number') p.focus = Math.max(0.3, patch.focus);
    if (typeof patch.blur === 'number') p.blur = Math.min(1, Math.max(0, patch.blur));
    if (SCALES.includes(patch.scale as ShotScale)) p.scale = patch.scale as ShotScale;
    if (patch.fps === 30 || patch.fps === 60) p.fps = patch.fps;
    if (typeof patch.clipSeconds === 'number') p.clipSeconds = Math.min(60, Math.max(1, patch.clipSeconds));
    if (typeof patch.orbit === 'string') p.orbit = patch.orbit as OrbitTarget;
    update(p);
    if (patch.daytime === 'golden') setDaytime(GOLDEN_HOUR);
    else if (typeof patch.daytime === 'number' || patch.daytime === null) setDaytime(patch.daytime as number | null);
    if (typeof patch.frozen === 'boolean') setFrozen(patch.frozen);
    if (typeof patch.fov === 'number') cam.fov = Math.min(FOV_MAX, Math.max(FOV_MIN, patch.fov));
    if (typeof patch.roll === 'number') cam.roll = Math.min(ROLL_MAX, Math.max(-ROLL_MAX, (patch.roll * Math.PI) / 180));
    return probe.state();
  },
  /** Puts the camera somewhere (pointer lock doesn't work headless): metres, and degrees for the view. */
  fly(x: number, y: number, z: number, yawDeg = 0, pitchDeg = 0) {
    Object.assign(cam, { x, y, z, yaw: (yawDeg * Math.PI) / 180, pitch: (pitchDeg * Math.PI) / 180, vx: 0, vy: 0, vz: 0 });
    update({ orbit: 'free' });
    return probe.state().camera;
  },
  shot: (scale?: number) => takeShot(SCALES.includes(scale as ShotScale) ? (scale as ShotScale) : undefined),
  /** Records a clip of `seconds` (at most 60) and resolves with it once saved. */
  record(seconds?: number, opts?: { fps?: 30 | 60; orbit?: OrbitTarget }) {
    probe.set({ clipSeconds: seconds, fps: opts?.fps, orbit: opts?.orbit });
    return startRecording();
  },
};
