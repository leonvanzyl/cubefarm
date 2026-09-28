import { useStore } from '../store';
import { isConfirmOpen, subscribeConfirm } from '../ui/Confirm';
import { useLookPrefs } from './look';
import { shouldGrabLook, viewUncovered, type Covering } from './lookLockRules';

// Grabs the mouse again when a panel or question closes, so looking around needs no extra click.
// The store listeners run synchronously inside set(), which happens inside the closing click or
// keydown handler, so the browser still counts requestPointerLock as part of that user gesture.

/**
 * Watches the store and the confirm dialog. On every close that uncovers the view it calls hush (so a
 * double click's second half can't act through the freshly locked canvas) and, if the setting is on,
 * grab. Returns the unsubscribe function.
 */
export function watchLookLock(grab: () => void, hush: () => void): () => void {
  const onChange = (prev: Covering, next: Covering) => {
    if (!viewUncovered(prev, next)) return;
    hush();
    if (shouldGrabLook(prev, next, { started: useStore.getState().started, enabled: useLookPrefs.getState().grabOnClose })) grab();
  };
  const offStore = useStore.subscribe((s, p) => {
    if (s.overlay === p.overlay) return;
    const confirm = isConfirmOpen();
    onChange({ overlay: !!p.overlay, confirm }, { overlay: !!s.overlay, confirm });
  });
  const offConfirm = subscribeConfirm((open, was) => {
    const overlay = !!useStore.getState().overlay;
    if (open !== was) onChange({ overlay, confirm: was }, { overlay, confirm: open });
  });
  return () => {
    offStore();
    offConfirm();
  };
}
