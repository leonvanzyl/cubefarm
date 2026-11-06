import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useStore } from '../store';
import { freeName, HAIR_COLORS, lookFor, SHIRT_COLORS, SKIN_TONES, type AgentStyle } from '../../../shared/looks';
import type { AgentLook } from '../../../shared/types';
import { LookPreview, type PreviewWho } from '../world/LookPreview';
import { LookEditor, type LookValue } from './AgentSettings';
import { useDialogFocus } from './dialogFocus';
import { HireSetupFields, cliLabel, hireCli, type HireSetup } from './Phone';

// The agent designer (#315): a new agent's look and setup, with a big live preview, before they exist. The lobby's
// candidates (Interview.tsx), the console's "+ Agent" and E on an empty desk all open it; nothing is created until
// Hire, and Cancel or Esc creates nobody. Not for pocket mode: it draws in 3D.

/** Everything about a new agent the designer decides. */
export type Design = HireSetup & LookValue;

const PREVIEW = { width: 250, height: 330 };
const SMALL_PREVIEW = { width: 190, height: 250 }; // phones

/** A random id for someone being designed (their look is seeded from it), also outside secure contexts. */
function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const any = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

/**
 * The designer as a dialog over everything. `seed` is who they'll be underneath (their id, base hair and skin);
 * `onHire` resolves true once they're hired (the dialog closes), false to stay open (the error was toasted).
 */
export function AgentDesigner({
  seed,
  repoId,
  initial,
  title,
  focusHire,
  onHire,
  onClose,
  children,
}: {
  seed: { id: string; hair: string; skin: string };
  repoId: string;
  initial: Design;
  title: string;
  focusHire?: boolean;
  onHire: (d: Design) => Promise<boolean>;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [design, setDesign] = useState(initial);
  // "Drawn as" follows the name until the manager picks it
  const [lookPicked, setLookPicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [size] = useState(() => (window.innerWidth < 520 ? SMALL_PREVIEW : PREVIEW));
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const floor = useStore((s) => s.repos.find((r) => r.id === repoId)?.floor);
  useDialogFocus(box);

  useEffect(() => {
    // Capture phase: Esc closes the designer, not also the panel or card under it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const name = design.name.trim() || initial.name;
  const who: PreviewWho = useMemo(() => ({ id: seed.id, role: 'agent', hair: seed.hair, skin: seed.skin, look: design.look, color: design.color, style: design.style }), [seed, design.look, design.color, design.style]);
  const summary = [name, floor != null ? `floor ${floor}` : null, cliLabel(clis, hireCli(design.cli, settings)), `${design.effort || settings.defaultEffort} effort`].filter(Boolean).join(' · ');

  const setSetup = (s: HireSetup) => setDesign((d) => ({ ...d, ...s, look: lookPicked || !s.name.trim() ? d.look : lookFor(s.name) }));
  const setLook = (patch: Partial<LookValue>) => {
    if (patch.look) setLookPicked(true);
    setDesign((d) => ({ ...d, ...patch }));
  };
  const hire = async () => {
    setBusy(true);
    const done = await onHire({ ...design, name });
    if (!done) setBusy(false);
  };

  return createPortal(
    <div className="overlay designer-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div ref={box} className="panel designer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={{ ['--accent' as string]: '#06d6a0' }}>
        <div className="panel-head">
          <h2 className="panel-title" id={titleId}>
            🎨 {title}
          </h2>
          <button className="panel-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="panel-body designer-body">
          <div className="designer-preview">
            <LookPreview who={who} label={`${name} as they'll look`} size={size} />
            <p className="designer-summary" aria-live="polite">
              {summary}
            </p>
          </div>
          <div className="designer-fields">
            <HireSetupFields value={design} onChange={setSetup} disabled={busy} />
            <LookEditor who={{ id: seed.id, name, role: 'agent', hair: seed.hair, skin: seed.skin }} value={design} onChange={setLook} preview={false} seededLabel="↺ Back to their own look" />
            {children}
          </div>
        </div>
        <div className="designer-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <span className="spacer" />
          <button type="button" className="btn btn-good" disabled={busy} autoFocus={focusHire} onClick={() => void hire()}>
            Hire {name}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The design to send with a hire: the base hair and skin the preview showed stay theirs even with no picks. */
export function designedLook(d: Design, seed: { hair: string; skin: string }): { look: AgentLook; color: string; style: AgentStyle } {
  return { look: d.look, color: d.color, style: { hairColor: seed.hair, skin: seed.skin, ...d.style } };
}

/** The designer for a floor (the console's "+ Agent", E on an empty desk): a free name and a random look to start. */
export function NewAgentDesigner({ repoId, onClose, focusHire }: { repoId: string; onClose: () => void; focusHire?: boolean }) {
  const [start] = useState(() => {
    const s = useStore.getState();
    const name = freeName([...Object.values(s.agents).map((a) => a.name), ...s.requests.filter((r) => r.status === 'pending').map((r) => r.name)], Object.keys(s.agents).length);
    const seed = { id: newId(), hair: any(HAIR_COLORS), skin: any(SKIN_TONES) };
    const initial: Design = { name, cli: '', model: '', effort: '', host: '', look: lookFor(name), color: any(SHIRT_COLORS), style: null };
    return { seed, initial };
  });
  const onHire = async (d: Design) => {
    try {
      const a = await api.hireAgent(repoId, { name: d.name, cli: d.cli, model: d.model.trim(), effort: d.effort, host: d.host, id: start.seed.id, ...designedLook(d, start.seed) });
      const floor = useStore.getState().repos.find((r) => r.id === repoId)?.floor;
      useStore.getState().pushToast('success', floor != null ? `${a.name} joined floor ${floor}` : `${a.name} joined the team`);
      onClose();
      return true;
    } catch {
      return false; // api() already toasted why
    }
  };
  return <AgentDesigner seed={start.seed} repoId={repoId} initial={start.initial} title="Design a new agent" focusHire={focusHire} onHire={onHire} onClose={onClose} />;
}
