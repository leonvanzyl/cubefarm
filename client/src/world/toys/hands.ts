import { useStore } from '../../store';
import { noise } from '../../ui/sfx';
import { pullTrigger } from './gun';
import { chargePower } from './throwing';

// The player's hands. store.held says what is being carried; input (Player.tsx) charges and throws here,
// and the toy world picks the throw up on its next physics step.

export { CHARGE, chargePower } from './throwing';

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
  // the whoosh rises higher and sharper the harder the throw, with a little spread so no two sound alike
  const spread = 0.94 + Math.random() * 0.12;
  noise({ name: 'throw', group: 'toys', dur: 0.14 + power * 0.08, peak: 0.03 + power * 0.05, filter: 'bandpass', freq: 500 * spread, to: (1500 + power * 900) * spread, q: 0.9 + power * 0.5 });
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
