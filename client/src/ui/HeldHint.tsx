import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { CHARGE, chargePower } from '../world/toys/hands';
import { BlasterHud } from './BlasterHud';

/** The throw meter under the crosshair. Animates itself while charging; hidden during the first moments of a tap. */
function ChargeMeter({ at }: { at: number }) {
  const meter = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const ms = performance.now() - at;
      const p = chargePower(ms);
      if (meter.current) meter.current.className = `charge ${ms > CHARGE.tap ? 'charge-on' : ''} ${p >= 1 ? 'charge-full' : ''}`;
      if (fill.current) fill.current.style.transform = `scaleX(${p})`;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [at]);
  return (
    <div ref={meter} className="charge">
      <div ref={fill} className="charge-fill" />
    </div>
  );
}

/** What you can do with what's in your hands. */
export function HeldHint() {
  const held = useStore((s) => s.held);
  const chargeAt = useStore((s) => s.chargeAt);
  if (!held) return null;
  if (held.kind === 'blaster') return <BlasterHud held={held} />;
  return (
    <>
      {chargeAt !== null && <ChargeMeter at={chargeAt} />}
      <div className="hud-hint hud-held">
        <kbd>Click</kbd> / <kbd>F</kbd> throw · hold to charge · <kbd>G</kbd> drop
      </div>
    </>
  );
}
