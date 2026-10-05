// Ping-pong errands: someone free walks over to play whoever is waiting at the table (you, after you pick up a
// paddle, or a teammate who fancied a game), and now and then an idle person starts a game themselves. Once they're
// at their end, the toy world (toys/PingPong.tsx) plays the match and moves them (toys/pongState.ts); the script here
// just carries that out, and walks them back when the game is over, they're replaced, or work calls.
// Manners: only free people come (errands never pull anyone busy away), within the floor's walker cap.

import type { Gesture } from './body';
import { isFree, registerErrand, type Act, type ErrandPeer, type ErrandScript } from './errands';
import { say } from './people';
import { claimSeat, leaveSeat, npcPong, readySeat, seatOf, startNpcMatch, tableFree, wantsOpponent } from './toys/pongState';
import { otherEnd, type End } from './toys/pongPhysics';

/** Restless people share out what they do by their roll (ErrandState.roll): this slice starts a game (toyErrands.ts has 0-0.5). */
export const PONG_SHARE = [0.5, 0.62] as const;
/** Seconds someone sits after getting back before they'd come and play again. */
const REST = 2;
/** How long a game may keep someone at the table, playing the player (s), and two agents playing each other. */
const PATIENCE = { player: 1800, npc: 900 };

const rolled = (roll: number | undefined) => roll !== undefined && roll >= PONG_SHARE[0] && roll < PONG_SHARE[1];
const WAITING = 30; // s a starter waits at the table for someone to come and play

/** Faces down the table from `end`: body.ts heading 0 faces -Z, so west (looking +x) is -π/2. */
const facing = (end: End) => (end === 'west' ? -Math.PI / 2 : Math.PI / 2);

/** One person at the table, from when they get to their end until they leave it (the script starts as they set off). */
function atTable(id: string): ErrandScript {
  const act: Act = { do: 'stand', x: 0, z: 0, heading: 0, gesture: 'none' };
  let bye = 0;
  let waited = 0;
  const stand = (h: number, gesture: Gesture) => Object.assign(act, { do: 'stand', heading: h, gesture } as const);
  return {
    tick(me) {
      const end = seatOf(id);
      if (!end) {
        // the game's over, the player took this end, or the other one left: a shrug, and back to the desk
        if (bye === 0) say(id, null);
        if ((bye += me.dt) > 1.2) return Object.assign(act, { do: 'done' } as const);
        return stand(act.heading, 'shrug');
      }
      readySeat(id);
      const cmd = npcPong(id);
      if (!cmd) {
        // nobody at the other end yet (a starter waiting): stand ready, but not for ever
        if (wantsOpponent() === otherEnd(end) && (waited += me.dt) > WAITING) leaveSeat(id);
        return stand(facing(end), 'paddle');
      }
      waited = 0;
      return Object.assign(act, { do: 'step', x: cmd.x, z: cmd.z, heading: cmd.heading, gesture: cmd.gesture, speed: cmd.speed } as const);
    },
    end() {
      say(id, null);
      leaveSeat(id);
    },
  };
}

/** Two people asked (by the probe) to play each other, as soon as they're free and back at their desks. */
let invite: { a: string; b: string; until: number } | null = null;
const invited = () => (invite && performance.now() < invite.until ? invite : null);

/** Asks `a` to start a game and `b` to come and play them, within the next half minute (window.__swarmPong.npcMatch). */
export function invitePong(a: string, b: string) {
  invite = { a, b, until: performance.now() + 30_000 };
}

/** Whether anyone else on the floor is free to come and play. */
const someoneElseFree = (id: string, others: readonly ErrandPeer[] | undefined) => !!others?.some((o) => o.id !== id && o.role !== 'ceo' && isFree(o.status));

// Answering a game: the player (or a teammate) is at the table waiting for someone.
registerErrand({
  name: 'pong',
  weight: 40,
  speed: 1.6,
  patience: PATIENCE.player,
  when: (agent, s) => s.floor === 'office' && isFree(agent.status) && s.seatedFor >= REST && wantsOpponent() !== null && (!invited() || invited()?.b === agent.id),
  spot: ['pong-west', 'pong-east'],
  where: () => {
    const end = wantsOpponent();
    return end ? [`pong-${end}`] : [];
  },
  claim: (id) => {
    if (claimSeat(id) === null) return false;
    if (invited()?.b === id) invite = null;
    return true;
  },
  steps: [],
  script: (agent) => (seatOf(agent.id) ? atTable(agent.id) : null),
});

// Fancying a game: an idle, restless person goes to the free table, and someone else free comes to play them.
let startAt: End = 'west';
registerErrand({
  name: 'pong-start',
  when: (agent, s) =>
    s.floor === 'office' &&
    isFree(agent.status) &&
    tableFree() &&
    (invited()?.a === agent.id || (s.seatedFor >= s.restless && rolled(s.roll) && someoneElseFree(agent.id, s.others) && !invited())),
  spot: ['pong-west', 'pong-east'],
  where: () => {
    startAt = Math.random() < 0.5 ? 'west' : 'east';
    return [`pong-${startAt}`];
  },
  claim: (id) => startNpcMatch(id, startAt) !== null,
  patience: PATIENCE.npc,
  steps: [],
  script: (agent) => (seatOf(agent.id) ? atTable(agent.id) : null),
});
