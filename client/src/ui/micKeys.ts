// The keys around the 🎙 (mic.ts). Holding V talks in a message box with a 🎙, or anywhere on a panel or phone that
// has one, but never in other fields; a quick tap still types its "v". While the mic is on, Esc closes it, and so does
// M on the hands-free phone or outside a text field. Pure, so it's tested without a keyboard.

/** A V held this long talks; a shorter press is typing. */
export const HOLD_MS = 300;
/** A press of the 🎙 button shorter than this is a tap: it keeps listening until you stop talking. */
export const TAP_MS = 300;

export interface KeyLike {
  code: string;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}

/** Where a key landed: the 🎙's own message box, another text field, or no field at all. */
export type KeyPlace = 'mic-box' | 'field' | 'none';

const plain = (e: KeyLike) => !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !e.isComposing;

/** A plain V (Ctrl+V pastes, Shift+V types a capital) where it may talk: the 🎙's box, or outside any field. */
export const isTalkKey = (e: KeyLike, place: KeyPlace) => e.code === 'KeyV' && plain(e) && place !== 'field';

/** Whether a key closes the listening mic (and goes no further): Esc always, M hands-free or outside a field. */
export function closesMic(e: KeyLike, handsFree: boolean, place: KeyPlace): boolean {
  if (e.key === 'Escape') return true;
  return e.code === 'KeyM' && plain(e) && (handsFree || place === 'none');
}
