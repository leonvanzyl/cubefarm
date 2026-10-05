import { lazy, Suspense, useEffect, type ComponentType, type LazyExoticComponent } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRenderPaused } from '../../perf';
import { useStore } from '../../store';
import { eventSoundsOff, eventSoundsOn, setEventsQuiet } from '../../ui/eventSfx';
import { viewElevation } from '../layout';
import type { EventId } from './director';
import { stepEvents, useEventRuns } from './eventsState';
import type { SceneProps } from './kit';

// World events outside (director.ts picks them, eventsState.ts runs them): each running event's scene, loaded lazily
// the first time it's needed and torn down when it ends, in a group at street level. Nothing is drawn while no event
// runs. Stepped in the frame loop, so the events stop with the render (a hidden tab or a panel over the office).

type FloorKind = 'office' | 'lobby' | 'roof';

const SCENES: Record<EventId, LazyExoticComponent<ComponentType<SceneProps>>> = {
  plane: lazy(() => import('./scenes/Plane')),
  helicopter: lazy(() => import('./scenes/Helicopter')),
  birds: lazy(() => import('./scenes/Birds')),
  balloon: lazy(() => import('./scenes/Balloon')),
  blimp: lazy(() => import('./scenes/Blimp')),
  skywriting: lazy(() => import('./scenes/Skywriting')),
  fireworks: lazy(() => import('./scenes/Fireworks')),
  ufo: lazy(() => import('./scenes/Ufo')),
  meteors: lazy(() => import('./scenes/Meteors')),
  rainbow: lazy(() => import('./scenes/Rainbow')),
  kaiju: lazy(() => import('./scenes/Kaiju')),
  duck: lazy(() => import('./scenes/Duck')),
  whale: lazy(() => import('./scenes/Whale')),
  hurricane: lazy(() => import('./scenes/Hurricane')),
};

export function WorldEvents({ kind }: { kind: FloorKind }) {
  const runs = useEventRuns();
  const floor = useStore((s) => s.floor);
  const top = useStore((s) => s.repos.reduce((m, r) => Math.max(m, r.floor), 0));
  const elevation = viewElevation(kind === 'lobby' ? 0 : floor, top);
  const paused = useRenderPaused();
  const away = useStore((s) => s.travel !== null || s.overlay !== null);
  useFrame((_, delta) => stepEvents(Math.min(delta, 0.1)));
  useEffect(() => setEventsQuiet(paused || away), [paused, away]);
  const any = runs.length > 0;
  useEffect(() => {
    if (!any) return;
    eventSoundsOn(kind);
    return eventSoundsOff;
  }, [any, kind]);
  if (!any) return null;
  return (
    <group position={[0, -elevation, 0]}>
      {runs.map((r) => {
        const Scene = SCENES[r.id];
        return (
          <Suspense key={r.key} fallback={null}>
            <Scene run={r} elevation={elevation} />
          </Suspense>
        );
      })}
    </group>
  );
}
