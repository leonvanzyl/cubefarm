import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { AdaptiveResolution, FrameWhilePaused, MAX_DPR, StatsProbe, statsEnabled, useRenderPaused } from '../perf';
import { repoOnFloor, useStore } from '../store';
import { ding, whoosh } from '../ui/sfx';
import { CameraRig } from './camera/CameraRig';
import { Chatter } from './Chatter';
import { CUT_PLANES } from './camera/rig';
import { lobbyColliders, officeColliders, ROOF, roofColliders } from './layout';
import { decorRects } from './decor/decor';
import { Graphics } from './gfx/Graphics';
import { Lobby } from './Lobby';
import { OfficeFloor } from './OfficeFloor';
import { Outside } from './Outside';
import { City } from './outside/City';
import { Player } from './Player';
import { DayLights } from './sky/DayLights';
import { Sky } from './sky/Sky';
import { DayClock } from './sky/useDayTime';
import { SoundListener } from './SoundListener';
import { Soundscape } from './Soundscape';
import { useTheme } from './themes/active';
import { ThemeLayer } from './themes/ThemeLayer';
import { decorColliders } from './themes/themes';
import { TypingSounds } from './TypingSounds';
import { Weather } from './weather/Weather';
import { WorldEvents } from './events/WorldEvents';

// The roof is its own chunk: fetched as the elevator heads up there, never by a floor that doesn't go.
const loadRoof = () => import('./roof/Roof');
const Roof = lazy(loadRoof);

function Travel() {
  const travel = useStore((s) => s.travel);
  const finish = useStore((s) => s.finishTravel);
  useEffect(() => {
    if (!travel) return;
    if (travel.phase === 'closing') whoosh(0.75);
    const t = setTimeout(
      () => {
        if (travel.phase === 'closing') {
          finish('arrived');
          ding();
        } else finish('done');
      },
      travel.phase === 'closing' ? 750 : 650,
    );
    return () => clearTimeout(t);
  }, [travel, finish]);
  return null;
}

export function Game() {
  const floor = useStore((s) => s.floor);
  const repos = useStore((s) => s.repos);
  const onRoof = floor === ROOF;
  const repo = floor === 0 || onRoof ? null : repoOnFloor(repos, floor);
  const isOffice = !!repo;
  const top = useStore((s) => s.repos.reduce((m, r) => Math.max(m, r.floor), 0));
  const placed = useStore((s) => (repo ? s.progress.floors[repo.id]?.placed : undefined));
  const theme = useTheme((s) => s.id);
  const colliders = useMemo(
    () =>
      onRoof
        ? roofColliders()
        : [...(isOffice ? [...officeColliders(), ...decorRects(placed ?? {})] : lobbyColliders()), ...decorColliders(theme, isOffice ? 'office' : 'lobby')],
    [onRoof, isOffice, placed, theme],
  );
  const toRoof = useStore((s) => s.travel?.to === ROOF);
  useEffect(() => {
    if (toRoof) void loadRoof();
  }, [toRoof]);
  // Stop drawing while nobody can see the office; switching back to 'always' draws a fresh frame at once.
  const paused = useRenderPaused();
  const [maxDpr, setMaxDpr] = useState(MAX_DPR);

  return (
    <Canvas
      shadows
      frameloop={paused ? 'never' : 'always'}
      dpr={[1, maxDpr]}
      camera={{ fov: 72, near: 0.05, far: 560, position: [0, 1.65, 10] }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.0;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
        gl.clippingPlanes = CUT_PLANES; // the overview's cutaway, out of the way until it's used (camera/rig.ts)
      }}
    >
      <DayClock />
      <Weather kind={onRoof ? 'roof' : isOffice ? 'office' : 'lobby'} />
      <Sky />
      <DayLights />
      <City />
      <WorldEvents kind={onRoof ? 'roof' : isOffice ? 'office' : 'lobby'} />
      <Suspense fallback={null}>{onRoof ? <Roof top={top} /> : repo ? <OfficeFloor key={repo.id} repo={repo} /> : <Lobby />}</Suspense>
      {!onRoof && <Outside key={isOffice ? floor : 0} kind={isOffice ? 'office' : 'lobby'} floor={isOffice ? floor : 0} top={top} />}
      <ThemeLayer key={onRoof ? ROOF : isOffice ? floor : 0} kind={onRoof ? 'roof' : isOffice ? 'office' : 'lobby'} floor={onRoof ? ROOF : isOffice ? floor : 0} top={top} repoId={repo?.id ?? null} />
      <Player colliders={colliders} floor={floor} />
      <CameraRig />
      <Travel />
      <SoundListener />
      <Soundscape kind={onRoof ? 'roof' : isOffice ? 'office' : 'lobby'} repoId={repo?.id ?? null} />
      <TypingSounds />
      <Chatter />
      <FrameWhilePaused paused={paused} />
      <AdaptiveResolution onChange={setMaxDpr} />
      <Graphics paused={paused} />
      {statsEnabled && <StatsProbe paused={paused} />}
    </Canvas>
  );
}
