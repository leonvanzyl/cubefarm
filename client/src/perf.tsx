import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerformanceMonitor, type PerformanceMonitorApi } from '@react-three/drei';
import { coversView, useStore } from './store';

// Keeping the office cheap to leave open all day: the 3D view stops drawing while a panel hides it or
// the tab is in the background, the resolution steps down when frames get slow, and `?stats` shows
// what the canvas costs.

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

// The probe inside the Canvas writes straight into this element, so the readout never re-renders React.
let readoutEl: HTMLSpanElement | null = null;

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

/** Lives inside the Canvas (only with `?stats`). Samples the frame rate and the renderer's counters twice a second. */
export function StatsProbe({ paused }: { paused: boolean }) {
  const gl = useThree((s) => s.gl);
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
    readoutEl.textContent = `${Math.round(fps)} fps · ${(elapsed / a.frames).toFixed(1)} ms · ${calls} calls · ${fmt(triangles)} tris · dpr ${gl.getPixelRatio().toFixed(2)}`;
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
