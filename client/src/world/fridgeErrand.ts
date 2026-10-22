// The snack break errand: snackBreak.ts's actor wired to the kitchenette fridge (fridgeState.ts), the people's hands
// and speech bubbles (people.ts) and the snacks' sounds. Imported by ErrandDirector.tsx, which registers it.

import { BREAK } from './coffeeBreak';
import { isFree, registerErrand } from './errands';
import { fridge, fridgeAt } from './fridgeState';
import { bodyState, say, setHandSnack } from './people';
import { SNACK, SNACK_SPOTS, SnackBreak, fanciesSnack, type FridgeWorld } from './snackBreak';
import { snackSoundAt } from './toys/sipping';

/** Where someone's hands are, for their sounds. */
const at = (who: string) => {
  const s = bodyState(who);
  return { x: s?.x ?? 0, y: 1.2, z: s?.z ?? 0 };
};

const world: FridgeWorld = {
  playerBusy: fridge.playerBusy,
  claim: fridge.claim,
  release: fridge.release,
  isOpen: fridge.isOpen,
  open: () => void fridge.open(),
  close: () => void fridge.close(),
  stock: fridge.stock,
  take: (_, snack) => fridge.take(snack),
  hold: (who, s) => setHandSnack(who, s),
  sound: (who, cue) => snackSoundAt(cue, at(who)),
  say: (who, text) => say(who, text, 1.6),
  line: new Map(),
  seats: new Map(),
};

registerErrand({
  name: 'fridge',
  max: SNACK.max,
  // Now and then instead of a coffee, a little before they'd get up to stretch, on a floor with a fridge.
  when: (agent, s) => s.floor === 'office' && fridgeAt.on && isFree(agent.status) && s.seatedFor >= s.restless * BREAK.early && fanciesSnack(s.restless),
  spot: [SNACK_SPOTS.line[0]],
  steps: [],
  act: (id) => new SnackBreak(id, world),
});
