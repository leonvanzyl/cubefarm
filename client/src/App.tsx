import { StatsReadout, statsEnabled } from './perf';
import { Game } from './world/Game';
import { ConfirmDialog } from './ui/Confirm';
import { HUD } from './ui/HUD';
import { Overlays } from './ui/Overlays';
import { StartScreen } from './ui/StartScreen';
import { Tutorial } from './ui/Tutorial';

export function App() {
  return (
    <>
      <Game />
      <HUD />
      <Overlays />
      <Tutorial />
      <StartScreen />
      <ConfirmDialog />
      {statsEnabled && <StatsReadout />}
    </>
  );
}
