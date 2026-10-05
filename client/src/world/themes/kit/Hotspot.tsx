import { useEffect, type ReactNode } from 'react';
import type * as THREE from 'three';
import { useInteractable } from '../../interact';
import { useThemeRuntime } from '../active';

// Things a theme lets you press E on (the candy bowl, a present, the cake, an egg): an interactable group whose focus
// action is { kind: 'theme', id }, and the theme's handler for them while it's mounted.

export function Hotspot({ id, label, range = 2.6, position, rotationY = 0, children }: { id: string; label: string; range?: number; position: [number, number, number]; rotationY?: number; children: ReactNode }) {
  const ref = useInteractable<THREE.Group>({ id: `theme:${id}`, label, action: { kind: 'theme', id } }, range);
  return (
    <group ref={ref} position={position} rotation={[0, rotationY, 0]}>
      {children}
    </group>
  );
}

/** Routes E on the theme's hotspots to `act` while the calling component is mounted. */
export function useThemeActions(act: (id: string) => void) {
  useEffect(() => {
    useThemeRuntime.setState({ act });
    return () => {
      if (useThemeRuntime.getState().act === act) useThemeRuntime.setState({ act: null });
    };
  }, [act]);
}
