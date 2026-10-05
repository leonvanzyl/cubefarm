// The 'watch' errand: while a big world event is on (eventsState.ts), idle people hurry to a window or the glass door on
// its side of the building, look, point, gasp or cheer (with a little bubble), then go back to their desks. It goes
// through the errand director (errands.ts): its rules for who may go (busy people keep working) and its walker cap
// apply. Each person watches each event once; nobody shares a spot (watchPlan.ts has the spots and the reactions).

import { useStore } from '../../store';
import { isFree, registerErrand, type ActStep, type ErrandActor } from '../errands';
import { onErrand, say } from '../people';
import { standable, walkways } from '../walkways';
import { bigEvent } from './eventsState';
import { watchBeats, watchSpots } from './watchPlan';

/** Start watching a couple of seconds in, and stop sending people out this long before the end. */
const LOOK = { from: 2, last: 14 };

// ---------- the errand ----------

/** Who stands where (agent → spot id), and which run each person has watched already. */
const holders = new Map<string, string>();
const watched = new Map<string, number>();

/** The big event that's on and still worth running to the window for, or null. */
function watchable() {
  const run = bigEvent();
  return run && run.t >= LOOK.from && run.t < run.seconds - LOOK.last ? run : null;
}

function actor(id: string): ErrandActor {
  const run = bigEvent();
  const key = run?.key ?? -1;
  if (run) watched.set(id, key);
  const beats = run ? watchBeats(run.id, Math.random()) : [];
  let i = -1;
  let until = 0;
  return {
    carry: 'none',
    step(now: number): ActStep {
      if (bigEvent()?.key !== key) return 'done'; // it's over (or another took its place): back to work
      if (now >= until) {
        i++;
        if (i >= beats.length) return 'done';
        const b = beats[i];
        until = now + b.seconds * (0.85 + Math.random() * 0.3);
        say(id, b.say ?? null);
      }
      return { stand: beats[i].gesture };
    },
    abort() {
      say(id, null);
    },
    end() {
      say(id, null);
      holders.delete(id);
    },
  };
}

registerErrand({
  name: 'watch',
  when: (agent) => {
    if (!isFree(agent.status)) return false;
    const run = watchable();
    return !!run && watched.get(agent.id) !== run.key;
  },
  spot: [],
  place(agent, state) {
    const run = watchable();
    if (!run) return null;
    const w = walkways(state.floor);
    // spots taken by others still out watching
    const taken = new Set<string>();
    for (const [who, spot] of holders) if (who !== agent.id && onErrand(who)) taken.add(spot);
    const from = state.home ?? { x: 0, z: 0 };
    const free = watchSpots(state.floor, run.side)
      .filter((s) => !taken.has(s.id) && standable(w, s.x, s.z))
      .sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z));
    const spot = free[0] ?? null;
    if (spot) holders.set(agent.id, spot.id);
    return spot;
  },
  steps: [],
  act: actor,
  // they hurry over: you don't stroll to see a kaiju
  speed: 1.9,
  weight: 40,
  end(id) {
    holders.delete(id);
    say(id, null);
  },
});

// For QA: __swarmEvents.watchers() lists who is out watching, where, and their status (always a free one).
if (typeof window !== 'undefined') {
  const probe = (window as unknown as Record<string, Record<string, unknown> | undefined>).__swarmEvents;
  if (probe)
    probe.watchers = () =>
      [...holders].filter(([id]) => onErrand(id)).map(([id, spot]) => ({ id, name: useStore.getState().agents[id]?.name ?? null, status: useStore.getState().agents[id]?.status ?? null, spot }));
}
