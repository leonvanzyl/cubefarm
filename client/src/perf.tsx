import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { coversView, useStore } from './store';
import { effectiveTier, gfxLabel, gfxPaused, useGfx } from './world/gfx/useGraphics';
import { DPR, dprSample, dprSettle, newDpr } from './dprControl';
import { glCounts, hitchFrame, hitchNote, hitchResume, hitchSummary, setHitchContext, startHitchRecorder, watchGl } from './hitches';
import { statsLine } from './hitchLog';

// Keeping the office cheap to leave open all day: the 3D view stops drawing while a panel hides it or
// the tab is in the background, the resolution steps down when frames get slow (and Auto graphics, world/gfx,
// drops its effects first, from the same frame-rate samples), and `?stats` shows what the canvas costs.

/** Highest device pixel ratio the canvas renders at (the adaptive resolution never goes below 1). */
export const MAX_DPR = 1.75;

/** `?stats` in the URL shows the FPS readout. Without it nothing is mounted or measured. */
export const statsEnabled = new URLSearchParams(window.location.search).has('stats');

function subscribeVisibility(cb: () => void) {
  document.addEventListener('visibilitychange', cb);
  return () => document.removeEventListener('visibilitychange', cb);
}

export function usePageHidden() {
  return useSyncExternalStore(subscribeVisibility, () => document.hidden);
}

/** True while nobody can see the office: a full-screen panel covers it or the tab is hidden. */
export function useRenderPaused() {
  const covered = useStore((s) => coversView(s.overlay));
  const hidden = usePageHidden();
  return covered || hidden;
}

/**
 * Lives inside the Canvas. With the loop stopped nothing redraws, so if the window is resized (which
 * clears the canvas) while paused, draw one frame so the edges around the panel aren't left blank.
 */
export function FrameWhilePaused({ paused }: { paused: boolean }) {
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const advance = useThree((s) => s.advance);
  const clock = useThree((s) => s.clock);
  const last = useRef({ size, dpr });
  useEffect(() => {
    const changed = last.current.size !== size || last.current.dpr !== dpr;
    last.current = { size, dpr };
    // Passing the clock's own time gives every useFrame a delta of 0, so nothing moves in this frame.
    if (paused && changed) advance(clock.elapsedTime);
  }, [paused, size, dpr, advance, clock]);
  return null;
}

// The adaptive resolution's state (its decisions are in dprControl.ts), outside React: a step changes the Canvas's
// pixel ratio through R3F's own setDpr, so it never re-renders Game and the whole scene under it.
const dprCap = () => Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));
const dprState = newDpr(dprCap());

/** The pixel ratio the view draws at now. Game passes it to the Canvas, so a re-render never resets a step. */
export const currentDpr = () => Math.min(dprState.dpr, dprCap());

/**
 * Lives inside the Canvas. Steps the pixel ratio down toward 1 after sustained slow frames and back up toward
 * MAX_DPR after sustained headroom, waiting longer after every step up that didn't hold (dprControl.ts): walking
 * between busy and quiet parts of a floor never bounces it, and it never gives up and stays low all day. It holds
 * still while the graphics tier changes, and on Auto it only steps down once the effects are off (Low); the tier's
 * governor ignores the frames right after a step.
 */
export function AdaptiveResolution({ paused }: { paused: boolean }) {
  const setDpr = useThree((s) => s.setDpr);
  useEffect(() => useGfx.subscribe((s, prev) => void ((s.tier !== prev.tier || s.shown !== prev.shown) && dprSettle(dprState))), []);
  const onSample = useCallback(
    (fps: number, ms: number) => {
      const from = dprState.dpr;
      const g = useGfx.getState();
      const next = dprSample(dprState, fps, ms, { ...DPR, max: dprCap() }, g.preset !== 'auto' || effectiveTier(g) === 'low');
      if (next === null || next === from) return;
      hitchNote('dpr', `${from} → ${next} at ${Math.round(fps)} fps`);
      gfxPaused();
      setDpr(next);
    },
    [setDpr],
  );
  const onPause = useCallback(() => dprSettle(dprState), []);
  return <FrameRateSampler paused={paused} onSample={onSample} onPause={onPause} />;
}

/**
 * Lives inside the Canvas while something needs the frame rate (Auto graphics, world/gfx): every half second of
 * drawing, `onSample` gets the average fps over it. A pause (panel open, tab hidden) calls `onPause` and starts a fresh
 * window, so time the view wasn't drawing never counts as slow frames; a genuinely slow frame (software WebGL) does.
 */
export function FrameRateSampler({ paused, onSample, onPause }: { paused: boolean; onSample: (fps: number, ms: number) => void; onPause?: () => void }) {
  const acc = useRef({ start: 0, frames: 0 });
  useEffect(() => {
    acc.current.start = 0;
    if (paused) onPause?.();
  }, [paused, onPause]);
  useFrame(() => {
    if (paused) return; // FrameWhilePaused's one-off frames
    const now = performance.now();
    const a = acc.current;
    if (!a.start) {
      a.start = now;
      a.frames = 0;
      return;
    }
    a.frames++;
    const elapsed = now - a.start;
    if (elapsed < 500) return;
    onSample((a.frames * 1000) / elapsed, elapsed);
    a.start = now;
    a.frames = 0;
  });
  return null;
}

/**
 * Lives inside the Canvas, always: the hitch recorder's frame clock (hitches.ts). Per frame it compares two numbers;
 * a slow frame is written down with what was going on. `camera` and `events` come from the world, which this module
 * doesn't import.
 */
export function HitchProbe({ paused, camera, events }: { paused: boolean; camera: () => string; events: () => string[] }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    watchGl(gl.getContext());
    startHitchRecorder();
    setHitchContext({ camera, events, dpr: () => gl.getPixelRatio(), gfx: gfxLabel, textures: () => gl.info.memory.textures });
    return () => setHitchContext(null);
  }, [gl, camera, events]);
  useEffect(() => {
    if (paused) hitchResume();
  }, [paused]);
  useFrame(() => {
    if (!paused) hitchFrame(); // FrameWhilePaused's one-off frames aren't the loop
  });
  return null;
}

const PRECOMPILE_GAP_MS = 8000;

/**
 * Lives inside the Canvas. Compiles the shaders of everything in the scene, not just what's in view, soon after it
 * appears: entering a floor, a world event, a theme, a graphics tier's extras. Otherwise each compiles the first time
 * it comes into view (turning round to the kitchenette, looking out of a window), stalling that frame. With
 * KHR_parallel_shader_compile the browser compiles them off the main thread. Checks about once a second whether the
 * scene holds more meshes than it ever has since the last floor change (speech bubbles coming and going don't count
 * twice), never per frame.
 */
export function ScenePrecompile({ paused, watch }: { paused: boolean; watch: string }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const last = useRef(-1);
  const lastAt = useRef(0);
  const busy = useRef(false);
  useEffect(() => {
    last.current = -1;
    lastAt.current = 0;
  }, [watch]);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => {
      if (busy.current) return;
      let n = 0;
      scene.traverseVisible((o) => void ((o as THREE.Mesh).isMesh && n++));
      // Compiling walks every material in the scene: at most every PRECOMPILE_GAP_MS, except on a new floor.
      if (n <= last.current || performance.now() - lastAt.current < PRECOMPILE_GAP_MS) return;
      last.current = n;
      lastAt.current = performance.now();
      busy.current = true;
      const from = glCounts.compiles;
      const t0 = performance.now();
      gl.compileAsync(scene, camera)
        .then(() => {
          const k = glCounts.compiles - from;
          if (k) hitchNote('precompile', `${k} programs for ${n} meshes in ${Math.round(performance.now() - t0)} ms`);
        })
        .catch(() => undefined)
        .finally(() => void (busy.current = false));
    }, 1200);
    return () => clearInterval(t);
  }, [paused, gl, scene, camera]);
  return null;
}

// The probe inside the Canvas writes straight into this element, so the readout never re-renders React.
let readoutEl: HTMLSpanElement | null = null;

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

/** With `?stats`, window.__swarmStats: the same numbers for scripts (scripts/bench.mjs), and census() of what's drawn. */
const probe = { fps: 0, ms: 0, calls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0 };
let probeScene: THREE.Scene | null = null;

/** The visible meshes by geometry (and whether instanced), most draws first: where the draw calls and triangles go. */
function census(top = 25) {
  const counts = new Map<string, { draws: number; triangles: number }>();
  probeScene?.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry as THREE.BufferGeometry & { parameters?: Record<string, number> };
    const params = g.parameters ? Object.values(g.parameters).map((v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)).join(',') : g.uuid.slice(0, 6);
    const instances = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
    const key = `${instances > 1 || (m as THREE.InstancedMesh).isInstancedMesh ? 'instanced ' : ''}${g.type}(${params})${m.castShadow ? ' shadow' : ''}`;
    const c = counts.get(key) ?? { draws: 0, triangles: 0 };
    c.draws++;
    c.triangles += (((g.index?.count ?? g.attributes.position?.count) || 0) / 3) * instances;
    counts.set(key, c);
  });
  return [...counts.entries()].sort((a, b) => b[1].draws - a[1].draws || b[1].triangles - a[1].triangles).slice(0, top);
}

if (statsEnabled) Object.assign(window as unknown as Record<string, unknown>, { __swarmStats: Object.assign(probe, { census }) });

/** Lives inside the Canvas (only with `?stats`). Samples the frame rate and the renderer's counters twice a second. */
export function StatsProbe({ paused }: { paused: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  probeScene = scene;
  const acc = useRef({ start: 0, prev: 0, frames: 0 });
  // After a pause (panel open, tab hidden) start a fresh window instead of averaging over the gap.
  useEffect(() => {
    acc.current.start = 0;
  }, [paused]);
  useFrame(() => {
    const now = performance.now();
    const a = acc.current;
    if (!a.start || now - a.prev > 1000) {
      a.start = now;
      a.frames = 0;
    }
    a.prev = now;
    a.frames++;
    const elapsed = now - a.start;
    if (elapsed < 500 || !readoutEl) return;
    // gl.info holds the previous frame's totals (shadow passes included) until this frame renders.
    const { calls, triangles } = gl.info.render;
    const fps = (a.frames * 1000) / elapsed;
    Object.assign(probe, { fps: Math.round(fps * 10) / 10, ms: Math.round((elapsed / a.frames) * 10) / 10, calls, triangles, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, programs: gl.info.programs?.length ?? 0 });
    readoutEl.textContent = `${Math.round(fps)} fps · ${(elapsed / a.frames).toFixed(1)} ms · ${calls} calls · ${fmt(triangles)} tris · dpr ${gl.getPixelRatio().toFixed(2)} · gfx ${gfxLabel()} · ${statsLine(hitchSummary())}`;
    a.start = now;
    a.frames = 0;
  });
  return null;
}

/** The corner readout for `?stats`. Shows when the 3D view is paused, since the numbers stop updating then. */
export function StatsReadout() {
  const paused = useRenderPaused();
  return (
    <div className="stats" aria-hidden="true">
      <span
        ref={(el) => {
          readoutEl = el;
        }}
        hidden={paused}
      >
        measuring…
      </span>
      {paused && <span>⏸ 3D view paused</span>}
    </div>
  );
}
