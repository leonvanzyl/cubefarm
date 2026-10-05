// The 3D office and everything drawn over it. Loaded on its own (App.tsx), so pocket mode never downloads the 3D world.
import { lazy, Suspense, useEffect } from 'react';
import { StatsReadout, statsEnabled } from './perf';
import { installPhoto, usePhotoGate } from './photo/gate';
import { Game } from './world/Game';
import { HUD } from './ui/HUD';
import { ReplayBar } from './ui/TimeLapse';
import { Overlays } from './ui/Overlays';
import { StartScreen } from './ui/StartScreen';
import { Tutorial } from './ui/Tutorial';

// Photo mode's panel loads the first time it's opened; the HUD and the tutorial hide while it's on.
const PhotoPanel = lazy(() => import('./photo/PhotoPanel'));

export default function Office() {
  const photo = usePhotoGate((s) => s.active);
  useEffect(installPhoto, []);
  return (
    <>
      <Game />
      {photo ? (
        <Suspense fallback={null}>
          <PhotoPanel />
        </Suspense>
      ) : (
        <HUD />
      )}
      <ReplayBar />
      <Overlays />
      {!photo && <Tutorial />}
      <StartScreen />
      {statsEnabled && <StatsReadout />}
    </>
  );
}
