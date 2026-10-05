import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerformanceMonitor, type PerformanceMonitorApi } from '@react-three/drei';
import type * as THREE from 'three';
import { coversView, useStore } from './store';
import { gfxLabel } from './world/gfx/useGraphics';

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

// Low/high fps bounds relative to the display's refresh rate, so a 60 Hz screen holding ~55 fps still
// counts as healthy. The monitor reports the highest rate it has ever measured, and a burst of catch-up
// frames can overshoot it (and then nothing ever counts as recovered), so snap it to a common display rate.
function fpsBounds(measured: number): [number, number] {
  const hz = measured > 130 ? 144 : measured > 100 ? 120 : 60;
  return [Math.round(hz * 0.6), Math.round(hz * 0.9)];
}

/**
 * Lives inside the Canvas. Steps the pixel ratio down toward 1 while the frame rate stays low, and
 * back up toward MAX_DPR once it recovers. No flip-flop limit: drei's fallback would stop monitoring and
 * leave the view at its lowest resolution for the rest of the day after one busy spell (a build, a test
 * run). The gap between the low and high bounds keeps it from bouncing between steps.
 *
 * Driven from onIncline/onDecline rather than onChange: drei compares against a `lastFactor` that is
 * reset to 0 on every render, and each step re-renders the Canvas, so the last step down to factor 0
 * looked unchanged and the view got stuck one step above DPR 1.
 */
export function AdaptiveResolution({ onChange }: { onChange: (maxDpr: number) => void }) {
  const apply = ({ factor }: PerformanceMonitorApi) => onChange(Math.round((1 + (MAX_DPR - 1) * factor) * 100) / 100);
  return <PerformanceMonitor factor={1} step={0.25} bounds={fpsBounds} onIncline={apply} onDecline={apply} />;
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
    readoutEl.textContent = `${Math.round(fps)} fps · ${(elapsed / a.frames).toFixed(1)} ms · ${calls} calls · ${fmt(triangles)} tris · dpr ${gl.getPixelRatio().toFixed(2)} · gfx ${gfxLabel()}`;
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
