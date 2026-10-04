import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Focus } from '../store';

// Objects the player can aim at and press E (or left click) on. The player raycasts against these roots.

/** A finer target inside an interactable, from where the crosshair hits it (a sticky on the whiteboard); null: the whole. */
export type Pick = (point: THREE.Vector3, root: THREE.Object3D) => Focus | null;

export const interactables = new Map<THREE.Object3D, Focus & { range: number; pick?: Pick }>();

export function useInteractable<T extends THREE.Object3D>(focus: Focus | null, range = 3.2, pick?: Pick) {
  const ref = useRef<T>(null);
  const key = focus ? `${focus.id}|${focus.label}` : '';
  useEffect(() => {
    const obj = ref.current;
    if (!obj || !focus) return;
    interactables.set(obj, { ...focus, range, pick });
    return () => {
      interactables.delete(obj);
    };
    // focus is recreated every render; key captures what matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, range, pick]);
  return ref;
}

/** A canvas-backed texture. `draw` runs whenever deps change. */
export function useCanvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, deps: unknown[]) {
  const tex = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [w, h]);
  useEffect(() => {
    const ctx = (tex.image as HTMLCanvasElement).getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    draw(ctx);
    tex.needsUpdate = true;
    // web fonts may arrive after the first paint
    let alive = true;
    document.fonts?.ready.then(() => {
      if (!alive) return;
      ctx.clearRect(0, 0, w, h);
      draw(ctx);
      tex.needsUpdate = true;
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tex, ...deps]);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}
