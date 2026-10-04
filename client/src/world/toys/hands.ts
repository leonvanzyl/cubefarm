import { useStore } from '../../store';
import { noise } from '../../ui/sfx';
import { pullTrigger } from './gun';

// The player's hands. store.held says what is being carried; input (Player.tsx) charges and throws here,
// and the toy world picks the throw up on its next physics step.

/** Holding the throw button this long (ms) is still a tap, a gentle lob; by `full` the throw is at full power. */
export const CHARGE = { tap: 150, full: 1000 };

/** 0 for a tap up to 1 for a full charge. */
export const chargePower = (ms: number) => Math.min(1, Math.max(0, (ms - CHARGE.tap) / (CHARGE.full - CHARGE.tap)));

/** The player's walking velocity in m/s, written by Player every frame, so a throw carries it. */
export const walk = { x: 0, z: 0 };

let pending: { id: string; power: number; at: number } | null = null;

/** Start winding up a throw (left mouse or F went down). */
export function startCharge() {
  const s = useStore.getState();
  if (s.held?.kind === 'blaster') return pullTrigger(); // a blaster fires on the press; there's nothing to charge
  if (s.held?.kind === 'mug') return; // a mug can't be thrown
  if (s.held && s.chargeAt === null) s.setCharge(performance.now());
}

/** The throw button came up: let go of the held item with the power charged so far. */
export function throwHeld() {
  const s = useStore.getState();
  if (!s.held || s.chargeAt === null) return;
  const power = chargePower(performance.now() - s.chargeAt);
  pending = { id: s.held.id, power, at: performance.now() };
  noise({ dur: 0.14 + power * 0.08, peak: 0.03 + power * 0.05, filter: 'bandpass', freq: 500, to: 1500 + power * 900, q: 0.9, group: 'toys' });
  s.setHeld(null);
}

/** Let go gently (G, a panel opening, the mouse being freed). */
export function dropHeld() {
  const s = useStore.getState();
  if (s.held) s.setHeld(null);
}

/** For the toy world: the power `id` was just thrown with, or null if it was dropped. */
export function takeThrow(id: string): number | null {
  const p = pending;
  if (!p || p.id !== id || performance.now() - p.at > 500) return null;
  pending = null;
  return p.power;
}
