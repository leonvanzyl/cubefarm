// Settings → Accessibility: captions, colour-blind-safe status, motion comfort, UI scale and readability, and how to
// use the office by keyboard. Everything is saved in this browser (a11y.ts) and applies at once. In pocket mode the
// 3D-only parts (motion, the field of view) are left out.
import { useId, type ReactNode } from 'react';
import { useStore } from '../store';
import { Key } from './Key';
import { resetA11y, setA11y, useA11y } from './a11y';
import { DEFAULT_A11Y, LIMITS, reducesMotion, showsShapes, type A11yPrefs, type ReduceMotion } from './a11yPrefs';
import { KIND_ICON, KIND_WORD, kindStrong, PALETTE_LABELS, PALETTES, STATUS_KINDS, type Palette } from './statusLook';

function Toggle({ k, children, hint, disabled }: { k: 'captions' | 'statusShapes' | 'headBob' | 'cameraShake' | 'centerDot' | 'readableFont' | 'highContrast'; children: ReactNode; hint?: string; disabled?: boolean }) {
  const on = useA11y((s) => s.prefs[k]);
  const hintId = useId();
  return (
    <label className="toggle block">
      <input type="checkbox" checked={on || !!disabled} disabled={disabled} onChange={(e) => setA11y({ [k]: e.target.checked })} aria-describedby={hint ? hintId : undefined} />
      <span>
        <b>{children}</b>
        {hint && (
          <span className="muted small a11y-hint" id={hintId}>
            {' '}
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

function Slider({ k, label, unit, describe }: { k: 'captionSize' | 'captionBg' | 'fov' | 'uiScale'; label: string; unit: string; describe?: (v: number) => string }) {
  const v = useA11y((s) => s.prefs[k]);
  const { min, max, step } = LIMITS[k];
  return (
    <label className="a11y-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} aria-valuetext={`${v}${unit}${describe ? `, ${describe(v)}` : ''}`} onChange={(e) => setA11y({ [k]: Number(e.target.value) })} />
      <b>
        {v}
        {unit}
      </b>
      {v !== DEFAULT_A11Y[k] && (
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setA11y({ [k]: DEFAULT_A11Y[k] })} aria-label={`Reset ${label.toLowerCase()}`}>
          Reset
        </button>
      )}
    </label>
  );
}

/** Each kind of status as it looks now: its colour and shape, and its name. */
function Swatches({ palette, shapes }: { palette: Palette; shapes: boolean }) {
  return (
    <ul className="status-swatches" aria-label="How statuses look">
      {STATUS_KINDS.map((k) => (
        <li key={k} className={`status-kind status-kind-${k}`} style={{ ['--kind' as string]: kindStrong(k, palette) }}>
          {shapes && <span aria-hidden>{KIND_ICON[k]}</span>} {KIND_WORD[k]}
        </li>
      ))}
    </ul>
  );
}

const MOTION_LABELS: Record<ReduceMotion, string> = { system: 'Follow my system setting', on: 'Always reduce motion', off: 'Full motion' };

export function AccessibilitySettings({ pocket = false }: { pocket?: boolean }) {
  const prefs = useA11y((s) => s.prefs);
  const systemReduced = useA11y((s) => s.systemReduced);
  const openOverlay = useStore((s) => s.openOverlay);
  const name = useId();
  const shapes = showsShapes(prefs);
  const set = (p: Partial<A11yPrefs>) => setA11y(p);
  return (
    <>
      <section className="card a11y-card" aria-labelledby={`${name}-cap`}>
        <h3 id={`${name}-cap`}>💬 Captions</h3>
        <Toggle k="captions" hint="The CEO's messages written out as they're read aloud, and short captions for important sounds (the gong, a merge cheer, alarms, the jukebox) with an arrow towards where they came from.">
          Show captions
        </Toggle>
        <Slider k="captionSize" label="Caption size" unit="%" />
        <Slider k="captionBg" label="Caption background" unit="%" />
        <div className="captions captions-preview" aria-hidden style={{ ['--caption-scale' as string]: prefs.captionSize / 100, ['--caption-bg' as string]: prefs.captionBg / 100 }}>
          <div className="caption">[gong] ↗</div>
          <div className="caption caption-speech">
            <b>CEO:</b> PR number 12 is ready to merge.
          </div>
        </div>
      </section>

      <section className="card a11y-card" aria-labelledby={`${name}-col`}>
        <h3 id={`${name}-col`}>🎨 Colour and status</h3>
        <fieldset className="a11y-fieldset">
          <legend>Status colours</legend>
          {PALETTES.map((p) => (
            <label key={p} className="toggle block">
              <input type="radio" name={`${name}-palette`} checked={prefs.palette === p} onChange={() => set({ palette: p })} /> {PALETTE_LABELS[p]}
            </label>
          ))}
        </fieldset>
        <Toggle k="statusShapes" disabled={prefs.palette !== 'standard'} hint={prefs.palette !== 'standard' ? 'Always on with a colour-blind palette.' : 'On name tags, the whiteboard, Kanban cards, status pills and toasts.'}>
          Shapes beside status colours (✓ ✕ ! ⏳)
        </Toggle>
        <Swatches palette={prefs.palette} shapes={shapes} />
      </section>

      {!pocket && (
        <section className="card a11y-card" aria-labelledby={`${name}-mot`}>
          <h3 id={`${name}-mot`}>🌀 Motion</h3>
          <Slider k="fov" label="Field of view" unit="°" describe={(v) => (v < 72 ? 'narrower' : v > 72 ? 'wider' : 'normal')} />
          <Toggle k="headBob">Head bob while walking</Toggle>
          <Toggle k="cameraShake" hint="The view tipping back when you sip a coffee, and any screen shake.">
            Camera sway and shake
          </Toggle>
          <fieldset className="a11y-fieldset">
            <legend>Reduce motion</legend>
            {(Object.keys(MOTION_LABELS) as ReduceMotion[]).map((m) => (
              <label key={m} className="toggle block">
                <input type="radio" name={`${name}-motion`} checked={prefs.reduceMotion === m} onChange={() => set({ reduceMotion: m })} /> {MOTION_LABELS[m]}
                {m === 'system' && <span className="muted small">(your system {systemReduced ? 'asks for less motion' : "doesn't ask for less motion"})</span>}
              </label>
            ))}
            <p className="muted small">
              Reduced motion: confetti bursts become a glow, the elevator doors cut to a fade, and panels, toasts and badges appear without moving.{' '}
              {reducesMotion(prefs.reduceMotion, systemReduced) ? 'On now.' : 'Off now.'}
            </p>
          </fieldset>
          <Toggle k="centerDot" hint="A dot fixed in the middle of the view, which helps some people with motion sickness.">
            Centre dot
          </Toggle>
        </section>
      )}

      <section className="card a11y-card" aria-labelledby={`${name}-read`}>
        <h3 id={`${name}-read`}>🔎 Size and readability</h3>
        <Slider k="uiScale" label="UI scale" unit="%" />
        <p className="muted small">The HUD, the phone, the console and every panel, from 80% to 150%.</p>
        <Toggle k="readableFont" hint="Verdana, with wider letter, word and line spacing, as dyslexia style guides recommend.">
          Dyslexia-friendly font
        </Toggle>
        <Toggle k="highContrast" hint="Plain white panels, darker grey text, heavier borders and focus rings.">
          High-contrast panels
        </Toggle>
      </section>

      {!pocket && (
        <section className="card a11y-card" aria-labelledby={`${name}-kb`}>
          <h3 id={`${name}-kb`}>⌨️ Keyboard and screen readers</h3>
          <p className="small">
            <Key action="phone" /> opens your phone from anywhere: its <b>Company</b> tab opens the console, this floor's Kanban, the floor list, help and these settings. <Key action="help" /> opens help. In any panel,{' '}
            <kbd>Tab</kbd> and <kbd>Shift</kbd>+<kbd>Tab</kbd> move between controls, <kbd>Enter</kbd> or <kbd>Space</kbd> uses one and <kbd>Esc</kbd> closes it; focus goes back where it was.
            Screen readers hear the CEO's messages and alarms as they happen.
          </p>
          <div className="row wrap">
            <button className="btn btn-small" onClick={() => openOverlay({ kind: 'floorList' })}>
              👥 List view of this floor
            </button>
          </div>
        </section>
      )}

      <div className="row">
        <button className="btn btn-ghost btn-small" onClick={resetA11y}>
          Reset accessibility settings
        </button>
      </div>
    </>
  );
}
