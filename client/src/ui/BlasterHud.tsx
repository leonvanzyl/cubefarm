import { useEffect, useRef } from 'react';
import type { Held } from '../store';
import { ammoLabel, reloadProgress } from '../world/toys/darts';
import { Key } from './Key';

/** With a blaster in hand: the controls, and the darts left ("Darts 9/12") with a bar while reloading. */
export function BlasterHud({ held }: { held: Extract<Held, { kind: 'blaster' }> }) {
  const bar = useRef<HTMLDivElement>(null);
  const reloading = held.reloadAt !== null;
  useEffect(() => {
    if (!reloading) return;
    let raf = 0;
    const tick = () => {
      const p = reloadProgress(held, performance.now());
      if (bar.current) bar.current.style.transform = `scaleX(${p ?? 1})`;
      if (p !== null) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [held, reloading]);
  const empty = held.ammo === 0 && !reloading;
  return (
    <>
      <div className="hud-hint hud-held">
        <kbd>Click</kbd> / <Key action="throw" /> fire · <Key action="reload" /> reload · <Key action="drop" /> drop
      </div>
      <div className={`hud-ammo ${empty ? 'hud-ammo-empty' : ''}`}>
        <span className="hud-ammo-count">🎯 {ammoLabel(held, performance.now())}</span>
        {reloading && (
          <div className="hud-ammo-bar">
            <div ref={bar} className="hud-ammo-fill" />
          </div>
        )}
        {reloading && <span className="hud-ammo-note">Reloading…</span>}
        {empty && <span className="hud-ammo-note">Empty: R to reload</span>}
      </div>
    </>
  );
}
