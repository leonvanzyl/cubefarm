import { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { AdaptiveResolution, FrameWhilePaused, MAX_DPR, StatsProbe, statsEnabled, useRenderPaused } from '../perf';
import { repoOnFloor, useStore } from '../store';
import { ding, whoosh } from '../ui/sfx';
import { lobbyColliders, officeColliders } from './layout';
import { Lobby } from './Lobby';
import { OfficeFloor } from './OfficeFloor';
import { Outside } from './Outside';
import { Player } from './Player';
import { Lights } from './Shell';
import { Sky } from './sky/Sky';
import { DayClock } from './sky/useDayTime';
import { SoundListener } from './SoundListener';
import { TypingSounds } from './TypingSounds';

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
  const repo = floor === 0 ? null : repoOnFloor(repos, floor);
  const isOffice = !!repo;
  const top = useStore((s) => s.repos.reduce((m, r) => Math.max(m, r.floor), 0));
  const colliders = useMemo(() => (isOffice ? officeColliders() : lobbyColliders()), [isOffice]);
  // Stop drawing while nobody can see the office; switching back to 'always' draws a fresh frame at once.
  const paused = useRenderPaused();
  const [maxDpr, setMaxDpr] = useState(MAX_DPR);

  return (
    <Canvas
      shadows
      frameloop={paused ? 'never' : 'always'}
      dpr={[1, maxDpr]}
      camera={{ fov: 72, near: 0.05, far: 90, position: [0, 1.65, 10] }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.0;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
      }}
    >
      <DayClock />
      <Sky />
      <Lights />
      <Suspense fallback={null}>{repo ? <OfficeFloor key={repo.id} repo={repo} /> : <Lobby />}</Suspense>
      <Outside key={isOffice ? floor : 0} kind={isOffice ? 'office' : 'lobby'} floor={isOffice ? floor : 0} top={top} />
      <Player colliders={colliders} floor={floor} />
      <Travel />
      <SoundListener />
      <TypingSounds />
      <FrameWhilePaused paused={paused} />
      <AdaptiveResolution onChange={setMaxDpr} />
      {statsEnabled && <StatsProbe paused={paused} />}
    </Canvas>
  );
}
