// Keyboard focus for the office's dialogs (panels, the phone, confirmations): focus moves into a dialog when it opens,
// Tab and Shift+Tab cycle inside the top one, and focus goes back where it was when it closes. A terminal keeps its
// own Tab (the coding agent's completion), so focus is never pulled out of xterm.

import { useEffect, useState, type RefObject } from 'react';

const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

/** Where Tab (or Shift+Tab, `back`) goes from item `index` of `count`; -1 is from outside the dialog. Wraps at the ends. */
export function wrapIndex(index: number, count: number, back: boolean): number {
  if (count <= 0) return -1;
  if (index < 0) return back ? count - 1 : 0;
  return (index + (back ? -1 : 1) + count) % count;
}

/** The dialog's controls in Tab order, leaving out hidden ones. */
function tabbables(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>(TABBABLE)].filter((x) => x.tabIndex >= 0 && (x.offsetWidth > 0 || x.offsetHeight > 0 || x.getClientRects().length > 0));
}

const open: HTMLElement[] = [];

/** True while a dialog that traps focus is open. */
export const dialogOpen = () => open.length > 0;

/** Makes the element in `ref` a modal dialog for the keyboard (give it tabIndex={-1} so it can hold focus itself). */
export function useDialogFocus(ref: RefObject<HTMLElement | null>) {
  // Who had focus before the dialog, noted while rendering: by the time effects run, an autofocused field inside has it.
  const [before] = useState(() => (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null));
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    open.push(el);
    // Something inside may have taken focus already (an autofocused message box); otherwise the dialog takes it.
    if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey || open[open.length - 1] !== el) return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest('.xterm')) return;
      const items = tabbables(el);
      if (!items.length) {
        e.preventDefault();
        el.focus();
        return;
      }
      const i = active ? items.indexOf(active) : -1;
      // Only at the ends (or from outside) does focus need steering; in between the browser moves it as usual.
      if (i === -1 || (e.shiftKey ? i === 0 : i === items.length - 1)) {
        e.preventDefault();
        items[wrapIndex(i, items.length, e.shiftKey)].focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      open.splice(open.indexOf(el), 1);
      if (before && before !== document.body && before.isConnected && !el.contains(before)) before.focus({ preventScroll: true });
    };
  }, [ref, before]);
}
