import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react';
import { isConfirmOpen } from '../Confirm';
import { isKey } from '../controls';

// Shared plumbing for the phone games: a canvas that fits the phone and redraws every frame, keyboard input that
// doesn't leak into the office, and touch buttons that repeat while held.

export type Frame = (ctx: CanvasRenderingContext2D, dt: number, now: number) => void;
export type PointerKind = 'down' | 'move' | 'up';

/**
 * A canvas drawn in fixed logical units (width x height) and scaled to fit its box, sharp on high-DPI screens.
 * `frame` runs on every animation frame with the time since the last one (seconds, capped so a stall can't
 * teleport anything).
 */
export function GameCanvas({ width, height, frame, onPointer, label }: { width: number; height: number; frame: Frame; onPointer?: (kind: PointerKind, x: number, y: number) => void; label: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(frame);
  const pointerRef = useRef(onPointer);
  useEffect(() => {
    frameRef.current = frame;
    pointerRef.current = onPointer;
  });
  useEffect(() => {
    const box = wrap.current;
    const cv = canvas.current;
    if (!box || !cv) return;
    let k = 1;
    const fit = () => {
      const pad = getComputedStyle(box);
      const bw = box.clientWidth - parseFloat(pad.paddingLeft) - parseFloat(pad.paddingRight);
      const bh = box.clientHeight - parseFloat(pad.paddingTop) - parseFloat(pad.paddingBottom);
      const s = Math.max(0.4, Math.min(bw / width, bh / height, 1.5));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.style.width = `${Math.floor(width * s)}px`;
      cv.style.height = `${Math.floor(height * s)}px`;
      cv.width = Math.round(width * s * dpr);
      cv.height = Math.round(height * s * dpr);
      k = cv.width / width;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const ctx = cv.getContext('2d');
      if (ctx) {
        ctx.setTransform(k, 0, 0, k, 0, 0);
        ctx.clearRect(0, 0, width, height);
        frameRef.current(ctx, dt, now);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [width, height]);

  const at = (e: PointerEvent<HTMLCanvasElement>, kind: PointerKind) => {
    const r = e.currentTarget.getBoundingClientRect();
    pointerRef.current?.(kind, ((e.clientX - r.left) / r.width) * width, ((e.clientY - r.top) / r.height) * height);
  };
  return (
    <div ref={wrap} className="game-canvas-wrap">
      <canvas
        ref={canvas}
        className="game-canvas"
        role="img"
        aria-label={label}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          at(e, 'down');
        }}
        onPointerMove={(e) => e.buttons && at(e, 'move')}
        onPointerUp={(e) => at(e, 'up')}
      />
    </div>
  );
}

/**
 * Keyboard for a game while it's on screen. Listens in the capture phase and swallows the keys the game uses, so
 * they never reach the office (walking, E, Tab, M) or scroll the page; Esc and the phone's key still put it away.
 * `handle` returns true for keys it used.
 */
export function useGameKeys(handle: (e: KeyboardEvent) => boolean) {
  const ref = useRef(handle);
  useEffect(() => {
    ref.current = handle;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isConfirmOpen() || e.code === 'Escape' || isKey('phone', e.code)) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (ref.current(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

/** The strip above a game: back to the game list, the game's name, and whatever the game puts on the right. */
export function GameHeader({ title, color, onBack, children }: { title: string; color: string; onBack: () => void; children?: ReactNode }) {
  return (
    <div className="game-head" style={{ ['--game' as string]: color }}>
      <button type="button" className="game-back" onClick={onBack} title="Back to the games (Backspace)">
        ‹ Games
      </button>
      <b className="game-title">{title}</b>
      <span className="game-head-right">{children}</span>
    </div>
  );
}

export type Arrow = 'up' | 'down' | 'left' | 'right';

/** Arrow keys and WASD as directions. */
export function arrowOf(code: string): Arrow | null {
  switch (code) {
    case 'ArrowUp':
    case 'KeyW':
      return 'up';
    case 'ArrowDown':
    case 'KeyS':
      return 'down';
    case 'ArrowLeft':
    case 'KeyA':
      return 'left';
    case 'ArrowRight':
    case 'KeyD':
      return 'right';
  }
  return null;
}

export const isStartKey = (code: string) => code === 'Space' || code === 'Enter' || code === 'NumpadEnter';

/** Runs fn when the window loses focus or the tab is hidden: games pause themselves. */
export function useOnAway(fn: () => void) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    const away = () => ref.current();
    const vis = () => document.hidden && away();
    window.addEventListener('blur', away);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('blur', away);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);
}

/**
 * An on-screen game button. Acts on press, not click (snappier on touch, and it never takes keyboard focus, so
 * Space can't "click" it again); with `repeat`, it keeps firing while held, like a held key.
 */
export function PadButton({ onPress, repeat, label, className, children }: { onPress: () => void; repeat?: boolean; label: string; className?: string; children: ReactNode }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const press = useRef(onPress);
  useEffect(() => {
    press.current = onPress;
  });
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  return (
    <button
      type="button"
      tabIndex={-1}
      className={`game-pad ${className ?? ''}`}
      aria-label={label}
      title={label}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        press.current();
        if (!repeat) return;
        stop();
        const again = (delay: number) => {
          timer.current = setTimeout(() => {
            press.current();
            again(70);
          }, delay);
        };
        again(190);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
    >
      {children}
    </button>
  );
}
