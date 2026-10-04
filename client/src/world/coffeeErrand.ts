// The coffee break errand: coffeeBreak.ts's actor wired to the kitchenette's machine (CoffeeMachine.tsx), the
// people's hands and desks (people.ts) and the mugs' looks and sounds. Imported by ErrandDirector.tsx, which registers it.

import { useStore } from '../store';
import { BREAK, CoffeeBreak, SPOTS, fanciesCoffee, type BreakWorld } from './coffeeBreak';
import { line, machine } from './CoffeeMachine';
import { isFree, registerErrand } from './errands';
import { shade } from './materials';
import { bodyState, setDeskMug, setHandMug } from './people';
import { tintMug } from './toys/mugLook';
import { slurpAt } from './toys/sipping';

const seats = new Map<string, string>();
let seq = 1;

/** Where someone's hands are, for their sounds. */
const at = (who: string) => {
  const s = bodyState(who);
  return { x: s?.x ?? 0, y: 1.2, z: s?.z ?? 0 };
};

const world: BreakWorld = {
  slot: machine.slot,
  playerFirst: machine.playerFirst,
  line,
  seats,
  place: machine.place,
  press: machine.press,
  take: machine.take,
  abandon: machine.abandon,
  newMug(who) {
    const id = `mug-${who}-${seq++}`;
    const color = useStore.getState().agents[who]?.color;
    if (color) tintMug(id, shade(color, 0.1)); // the same colour as the mug on their desk
    machine.clink(at(who));
    return { id, sips: 0 };
  },
  putBack: (who) => machine.clink(at(who)),
  hold: (who, mug) => setHandMug(who, mug),
  sip: (who) => slurpAt(at(who)),
  toDesk: (who, mug) => setDeskMug(who, mug, BREAK.desk / 1000),
};

registerErrand({
  name: 'coffee',
  max: BREAK.max,
  // Now and then, a little before they'd get up to stretch; not while the player's mug sits in the machine.
  when: (agent, s) =>
    s.floor === 'office' && isFree(agent.status) && s.seatedFor >= s.restless * BREAK.early && fanciesCoffee(s.restless) && !machine.playerOwns(),
  spot: [SPOTS.mugs],
  steps: [],
  act: (id) => new CoffeeBreak(id, world),
});
