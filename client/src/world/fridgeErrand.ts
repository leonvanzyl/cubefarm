// The snack break errand: fridgeBreak.ts's actor wired to the kitchenette fridge (fridgeState.ts), the people's hands
// (people.ts) and the snacks' sounds. Imported by ErrandDirector.tsx, which registers it.

import { bare } from './fridge';
import { FridgeBreak, SNACK, SNACK_SPOTS, fanciesSnack, type SnackWorld } from './fridgeBreak';
import { claimDoor, closeDoor, doorFree, fridge, openDoor, releaseDoor, stockNow, takeFor } from './fridgeState';
import { isFree, registerErrand } from './errands';
import { bodyState, setHandSnack } from './people';
import { snackAt } from './toys/sipping';

const seats = new Map<string, string>();

const world: SnackWorld = {
  doorFree,
  claim: claimDoor,
  release: releaseDoor,
  open: () => openDoor(),
  close: () => closeDoor(),
  take: takeFor,
  seats,
  hold(who, snack) {
    setHandSnack(who, snack);
    if (snack) fridge.eating.add(who);
    else fridge.eating.delete(who);
  },
  bite(who, snack) {
    const s = bodyState(who);
    snackAt({ x: s?.x ?? 0, y: 1.5, z: s?.z ?? 0 }, snack);
  },
};

registerErrand({
  name: 'fridge',
  max: SNACK.max,
  // Now and then instead of a coffee, while there's something in the fridge.
  when: (agent, s) => s.floor === 'office' && isFree(agent.status) && s.seatedFor >= s.restless * SNACK.early && fanciesSnack(s.restless) && !bare(stockNow()),
  spot: [...SNACK_SPOTS.eat],
  steps: [],
  act: (id) => new FridgeBreak(id, world),
});
