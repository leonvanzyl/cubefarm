// Which state changes should grab the mouse again (see lookLock.ts). Pure, so it can be unit-tested.

export interface Covering {
  /** A panel (terminal, Kanban, phone, console, elevator, help…) is open. */
  overlay: boolean;
  /** A confirm dialog (like "Hire an agent for this desk?") is on screen. */
  confirm: boolean;
}

/** True when going from prev to next closed the last thing covering the office view. */
export function viewUncovered(prev: Covering, next: Covering): boolean {
  const closed = (prev.overlay && !next.overlay) || (prev.confirm && !next.confirm);
  return closed && !next.overlay && !next.confirm;
}

/** Whether that transition should grab the mouse for looking around. */
export function shouldGrabLook(prev: Covering, next: Covering, opts: { started: boolean; enabled: boolean }): boolean {
  return opts.enabled && opts.started && viewUncovered(prev, next);
}
