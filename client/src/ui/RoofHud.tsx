import { useRoof } from '../world/roof/roofState';
import { nightFactor } from '../world/sky/time';
import { useDayTime } from '../world/sky/useDayTime';

/** Up on the roof: the telescope's round eyepiece and what you can do there, or how to get up from a deck chair. */
export function RoofHud() {
  const here = useRoof((s) => s.here);
  const sitting = useRoof((s) => s.sitting);
  const telescope = useRoof((s) => s.telescope);
  const zoom = useRoof((s) => s.zoom);
  const { t } = useDayTime();
  if (!here) return null;
  if (telescope) {
    const night = nightFactor(t) > 0.5;
    return (
      <>
        <div className="roof-scope" aria-hidden="true">
          <div className="roof-scope-reticle" />
        </div>
        <div className="hud-hint roof-scope-hint">
          🔭 {zoom}× · {night ? 'the moon and the constellations' : 'read the billboards on the rooftops'} · <kbd>Scroll</kbd> zoom · <kbd>E</kbd> / <kbd>WASD</kbd> step back
        </div>
      </>
    );
  }
  if (sitting !== null) {
    return (
      <div className="hud-hint">
        🪑 Sitting back · <kbd>E</kbd> / <kbd>WASD</kbd> get up
      </div>
    );
  }
  return null;
}
