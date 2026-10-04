import { lazy, Suspense } from 'react';
import { useMode } from './pocket/mode';
import { ConfirmDialog } from './ui/Confirm';

// Each loads only when it's shown: a phone in pocket mode never fetches three.js.
const Office = lazy(() => import('./Office'));
const Pocket = lazy(() => import('./pocket/Pocket'));

export function App() {
  const mode = useMode((s) => s.mode);
  return (
    <>
      <Suspense fallback={<div className="app-loading">Loading the office…</div>}>{mode === 'pocket' ? <Pocket /> : <Office />}</Suspense>
      <ConfirmDialog />
    </>
  );
}
