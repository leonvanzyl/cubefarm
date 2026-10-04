// The 3D office and everything drawn over it. Loaded on its own (App.tsx), so pocket mode never downloads the 3D world.
import { StatsReadout, statsEnabled } from './perf';
import { Game } from './world/Game';
import { HUD } from './ui/HUD';
import { ReplayBar } from './ui/TimeLapse';
import { Overlays } from './ui/Overlays';
import { StartScreen } from './ui/StartScreen';
import { Tutorial } from './ui/Tutorial';

export default function Office() {
  return (
    <>
      <Game />
      <HUD />
      <ReplayBar />
      <Overlays />
      <Tutorial />
      <StartScreen />
      {statsEnabled && <StatsReadout />}
    </>
  );
}
