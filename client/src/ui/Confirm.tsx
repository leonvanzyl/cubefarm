import { useEffect, type ReactNode } from 'react';
import { create } from 'zustand';

// The office's own confirmation box, instead of the browser's confirm():
//   if (await confirmDialog({ title: 'Merge PR #12?', confirm: 'Merge' })) …

interface Ask {
  title: string;
  body?: ReactNode;
  icon?: string;
  confirm?: string; // label of the confirm button
  cancel?: string;
  tone?: 'good' | 'danger' | 'warn';
}

const useConfirm = create<{ ask: (Ask & { resolve: (ok: boolean) => void }) | null }>(() => ({ ask: null }));

export function confirmDialog(ask: Ask): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirm.getState().ask?.resolve(false); // a newer question replaces an unanswered one
    useConfirm.setState({ ask: { ...ask, resolve } });
  });
}

/** True while a question is on screen; the player shouldn't walk or interact behind it. */
export const isConfirmOpen = () => useConfirm.getState().ask !== null;

/** Calls fn synchronously whenever a question appears or is answered. Returns the unsubscribe function. */
export const subscribeConfirm = (fn: (open: boolean, was: boolean) => void) => useConfirm.subscribe((s, p) => fn(s.ask !== null, p.ask !== null));

function answer(ok: boolean) {
  const ask = useConfirm.getState().ask;
  if (!ask) return;
  useConfirm.setState({ ask: null });
  ask.resolve(ok);
}

export function ConfirmDialog() {
  const ask = useConfirm((s) => s.ask);
  useEffect(() => {
    if (!ask) return;
    // Capture phase, so Esc answers the question instead of also closing the panel underneath.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        answer(e.key === 'Enter');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ask]);
  if (!ask) return null;
  const tone = ask.tone ?? 'good';
  return (
    <div className="confirm-overlay" onMouseDown={(e) => e.target === e.currentTarget && answer(false)}>
      <div className={`confirm confirm-${tone}`} role="alertdialog" aria-modal="true" aria-label={ask.title}>
        <div className="confirm-icon">{ask.icon ?? (tone === 'danger' ? '⚠️' : tone === 'warn' ? '🤔' : '✨')}</div>
        <h3>{ask.title}</h3>
        {ask.body && <div className="confirm-body">{ask.body}</div>}
        <div className="confirm-actions">
          <button className="btn btn-ghost" onClick={() => answer(false)}>
            {ask.cancel ?? 'Cancel'}
          </button>
          <button className={`btn ${tone === 'danger' ? 'btn-bad' : tone === 'warn' ? 'btn-warn' : 'btn-good'}`} onClick={() => answer(true)} autoFocus>
            {ask.confirm ?? 'OK'}
          </button>
        </div>
        <div className="confirm-keys muted small">
          <kbd>Enter</kbd> {ask.confirm ?? 'OK'} · <kbd>Esc</kbd> {ask.cancel ?? 'Cancel'}
        </div>
      </div>
    </div>
  );
}
