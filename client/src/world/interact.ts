import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Focus } from '../store';
import { PaintedTexture } from './paint/painter';

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

/**
 * A canvas-painted texture. `draw` runs whenever deps change, in the paint worker where it can (paint/painter.ts).
 * With `near` (a mesh showing it and a distance), a change waits to be painted until the camera is that close.
 */
export function useCanvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, deps: unknown[], near?: { anchor: React.RefObject<THREE.Object3D | null>; range: number }) {
  const painted = useMemo(() => new PaintedTexture(w, h), [w, h]);
  const later = useRef<((ctx: CanvasRenderingContext2D) => void) | null>(null);
  const spot = useMemo(() => new THREE.Vector3(), []);
  const far = () => {
    const a = near?.anchor.current;
    return !!a && a.getWorldPosition(spot).distanceTo(cameraAt) > near!.range;
  };
  useEffect(() => {
    // the first picture is always painted; later ones wait while it's out of sight range
    if (painted.texture.version > 0 && far()) later.current = draw;
    else {
      later.current = null;
      painted.paint(draw);
    }
    // web fonts may arrive after the first paint
    let alive = true;
    if (document.fonts && document.fonts.status !== 'loaded') {
      void document.fonts.ready.then(() => {
        if (alive) painted.paint(draw);
      });
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [painted, ...deps]);
  useFrame(({ camera }) => {
    cameraAt.copy(camera.position);
    if (!later.current || far()) return;
    painted.paint(later.current);
    later.current = null;
  });
  useEffect(() => () => painted.dispose(), [painted]);
  return painted.texture;
}

// Where the camera was at the last frame, for the near checks above.
const cameraAt = new THREE.Vector3();
