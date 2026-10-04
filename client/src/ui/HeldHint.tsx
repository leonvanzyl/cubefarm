import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { CHARGE, chargePower } from '../world/toys/hands';
import { BlasterHud } from './BlasterHud';
import { decorName } from '../world/decor/actions';
import { Key } from './Key';

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
  if (held.kind === 'sausage') {
    return (
      <div className="hud-hint hud-held">
        🌭 {held.bites} {held.bites === 1 ? 'bite' : 'bites'} left{held.charred ? ' (a bit charred)' : ''} · <Key action="interact" /> eat · <Key action="drop" /> drop
      </div>
    );
  }
  if (held.kind === 'decor') {
    return (
      <div className="hud-hint hud-held">
        📦 Carrying the {decorName(held.item).toLowerCase()} · <Key action="interact" /> on a glowing spot places it · <Key action="drop" /> puts it back
      </div>
    );
  }
  if (held.kind === 'sticky') {
    return (
      <div className="hud-hint hud-held">
        📌 {held.pr ? `PR #${held.number}` : `#${held.number}`} · {held.pr ? 'take it to the QA lab' : "take it to a free developer's desk"} and press <Key action="interact" /> · <Key action="drop" /> elsewhere puts it back
      </div>
    );
  }
  if (held.kind === 'mug') {
    return (
      <div className="hud-hint hud-held">
        ☕ {held.sips > 0 ? `${held.sips} ${held.sips === 1 ? 'sip' : 'sips'} left` : 'Empty mug'} · <Key action="drop" /> drop
      </div>
    );
  }
  return (
    <>
      {chargeAt !== null && <ChargeMeter at={chargeAt} />}
      <div className="hud-hint hud-held">
        <kbd>Click</kbd> / <Key action="throw" /> throw · hold to charge · <Key action="drop" /> drop
      </div>
    </>
  );
}
