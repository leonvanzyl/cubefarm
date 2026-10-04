import { useStore, type Held } from '../../store';
import { noise, thwip, tone } from '../../ui/sfx';
import { BLASTER, fire, reload, settle } from './darts';

// The blaster in your hands: taking one, the trigger, reloading. Input (Player.tsx, hands.ts) calls in here;
// the toy world (Blasters.tsx) turns each shot into a dart on its next physics step.

type HeldBlaster = Extract<Held, { kind: 'blaster' }>;

const heldBlaster = (): HeldBlaster | null => {
  const h = useStore.getState().held;
  return h?.kind === 'blaster' ? h : null;
};

/** performance.now() of the last shot, for the fire rate and the view model's recoil. */
export const kick = { at: -Infinity };

// Darts left in blasters lying around, so picking one back up keeps its count. A blaster on the rack is full.
const spare = new Map<string, number>();
// Shots fired since the toy world's last physics step (you can only hold a blaster while one is mounted).
let shots: string[] = [];

/** A fresh floor: every blaster is back on the rack, full. */
export function resetBlasters() {
  spare.clear();
  shots = [];
}

/** Take a blaster (from the rack or the floor) into your hands. */
export function takeBlaster(id: string) {
  useStore.getState().setHeld({ kind: 'blaster', id, ammo: spare.get(id) ?? BLASTER.mag, reloadAt: null });
}

// Remember what was left in a blaster when it leaves your hands (dropped, swapped, or a panel opening).
useStore.subscribe((s, prev) => {
  const was = prev.held;
  if (was?.kind !== 'blaster' || (s.held?.kind === 'blaster' && s.held.id === was.id)) return;
  spare.set(was.id, settle(was, performance.now()).ammo);
});

/** Left click or F with a blaster in hand. */
export function pullTrigger() {
  const s = useStore.getState();
  const h = heldBlaster();
  if (!h || s.travel) return;
  const now = performance.now();
  const next = fire(h, kick.at, now);
  if (!next) {
    const m = settle(h, now);
    if (m.reloadAt === null && m.ammo === 0) tone({ freq: 1400, to: 900, type: 'square', dur: 0.03, peak: 0.03, attack: 0.002, group: 'toys' }); // dry click
    return;
  }
  kick.at = now;
  if (shots.length < BLASTER.mag) shots.push(h.id);
  s.setHeld({ ...h, ...next });
  thwip();
}

/** R: reload the blaster in hand, if it isn't full. */
export function reloadHeld() {
  const h = heldBlaster();
  if (!h) return;
  const next = reload(h, performance.now());
  if (!next) return;
  useStore.getState().setHeld({ ...h, ...next });
  noise({ dur: 0.08, peak: 0.06, filter: 'bandpass', freq: 900, q: 2, group: 'toys' });
  noise({ at: 0.75, dur: 0.07, peak: 0.08, filter: 'bandpass', freq: 1500, q: 2, group: 'toys' });
  // Settle the store when the reload is done, so the HUD and __swarmToys show the full magazine.
  setTimeout(() => {
    const cur = heldBlaster();
    if (cur && cur.id === h.id && cur.reloadAt === next.reloadAt) useStore.getState().setHeld({ ...cur, ...settle(cur, performance.now()) });
  }, BLASTER.reloadMs + 20);
}

/** For the toy world: the blaster that fired the next shot still to turn into a dart, or null. */
export function takeShot(): string | null {
  return shots.shift() ?? null;
}
