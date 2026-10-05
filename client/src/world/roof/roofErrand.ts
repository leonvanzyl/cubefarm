// A roof break, seen from downstairs (roofBreaks.ts): an idle developer or tester (or the CEO, off to take a call) walks
// to the elevator, steps in and rides up out of sight; once their time up there is over they step back out and go back
// to their desk. A scripted errand (errands.ts) that the errand director runs on the floor you're on; RoofPeople.tsx
// plays the same visit up top.

import { useStore } from '../../store';
import { ding } from '../../ui/sfx';
import { isFree, registerErrand, type Act, type Errand, type ErrandAgent, type ErrandScript, type ErrandState } from '../errands';
import { DECK_CHAIRS, HALF_D, ROOF } from '../layout';
import { setHidden } from '../people';
import { CABIN, DOORS_SECONDS } from '../socials';
import { endVisit, planVisit, ROOF_BREAK, roofVisit, roofVisits, roomFor, startVisit, type VisitKind } from './roofBreaks';

const NORTH = 0; // a body heading facing -z: out through the cabin's doors
const DOORS_SHUT = 0.9; // seconds stood in the cabin before the doors close on them

const kindFor = (role: string): VisitKind => (role === 'ceo' ? 'call' : 'break');

/** Into the cabin and up; a while later back out of it, and then the director walks them home. */
export function rideUp(id: string, kind: VisitKind): ErrandScript {
  let stage: 'in' | 'doors' | 'away' | 'out' = 'in';
  let t = 0;
  const act: Act = { do: 'walk', x: CABIN.x, z: CABIN.z, heading: NORTH, gesture: 'none' };
  const doing = (d: Act['do']) => ((act.do = d), act);
  return {
    tick(me) {
      switch (stage) {
        case 'in':
          if (!me.arrived) return doing('walk');
          stage = 'doors';
          t = 0;
          return doing('stand');
        case 'doors': {
          t += me.dt;
          if (t < DOORS_SHUT) return doing('stand');
          const now = Date.now();
          const v = roofVisit(id) ?? planVisit(roofVisits(now), id, kind, now, Math.random(), { chairs: DECK_CHAIRS.xs.length, playerChair: null });
          if (!v) return doing('done'); // someone took the last chair meanwhile: back out
          startVisit(v);
          setHidden(id, true);
          stage = 'away';
          return doing('stand');
        }
        case 'away': {
          const v = roofVisit(id);
          if (v && Date.now() < v.leave + ROOF_BREAK.ride * 1000) return doing('stand');
          endVisit(id);
          setHidden(id, false);
          ding({ x: 0, y: 2.6, z: HALF_D });
          stage = 'out';
          t = 0;
          return doing('stand');
        }
        case 'out':
          t += me.dt;
          return doing(t < DOORS_SECONDS ? 'stand' : 'done');
      }
    },
    // However it ends (back down, called back to work, the floor left behind), they're in sight again. The visit itself
    // carries on up top until its time is up: follow them up and they're there.
    end() {
      setHidden(id, false);
    },
  };
}

const goesUp = (a: ErrandAgent, s: ErrandState, ceo: boolean) =>
  (ceo ? a.role === 'ceo' && s.floor === 'lobby' : (a.role === 'dev' || a.role === 'qa') && s.floor === 'office') &&
  isFree(a.status) &&
  s.seatedFor >= s.restless &&
  roomFor(roofVisits(), a.id, ceo ? 'call' : 'break', Date.now());

const roofErrand = (name: string, ceo: boolean): Errand => ({
  name,
  when: (a, s) => goesUp(a, s, ceo),
  spot: ['elevator'],
  steps: [],
  weight: ceo ? ROOF_BREAK.callWeight : ROOF_BREAK.weight,
  max: 1,
  // no room up there by the time they'd go: they sit a while longer
  script: (a) => (roomFor(roofVisits(), a.id, kindFor(a.role), Date.now()) ? rideUp(a.id, kindFor(a.role)) : null),
});

registerErrand(roofErrand('roof', false));
registerErrand(roofErrand('roof-call', true));

// Arriving on a floor starts it fresh, everyone at their desk (ErrandDirector.tsx): nobody from there is still up top.
useStore.subscribe((s, prev) => {
  if (s.floor === prev.floor || s.floor === ROOF) return;
  const repo = s.repos.find((r) => r.floor === s.floor);
  for (const v of roofVisits()) {
    const a = s.agents[v.id];
    if (!a || (s.floor === 0 ? a.role === 'ceo' : !!repo && a.repoId === repo.id)) endVisit(v.id);
  }
});
