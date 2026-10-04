// Toy errands: idle people shoot hoops, or throw the beach ball to each other (the roomba poke happens on any walk,
// in ErrandDirector.tsx). They're scripted errands (errands.ts) using the toys' hands for people (toys/npc.ts), with
// manners: never take a ball from the player, give up (with a shrug) when the player takes theirs, never throw while
// the player is in the way, and leave the balls in the play area. At most one errand per toy at a time.

import type { Gesture } from './body';
import { isFree, registerErrand, type Act, type ErrandScript, type Me } from './errands';
import { bodyState } from './people';
import { hoopRim } from './toys/hoopScore';
import { ballHolder, npcBall, npcExpect, npcHolding, npcLetGo, npcLost, npcPickUp, npcPose, npcScoredSince, npcThrow, type NpcBall } from './toys/npc';
import { aimHoop, aimToss, facingHoop, npcHoldPoint } from './toys/npcAim';
import type { Pt } from './toys/roombaBrain';
import { spot, standable, walkways, type FloorKind } from './walkways';

const BASKETBALL = 'basketball';
const BEACH = 'beach-ball';

/** Restless people share out what they do by their roll (ErrandState.roll): these go to the toys, the rest stretch. */
export const SHARE = { hoops: [0, 0.3], toss: [0.3, 0.5] } as const;
/** Hoop shots per visit, and throws per game of catch. */
export const SHOTS = { min: 3, max: 5 };
export const TOSSES = { min: 4, max: 7 };
/** How close (m) the player may be to a throw's line before they wait. */
export const PLAYER_GAP = 1.2;
/** How long (s) to wait for the player to get out of the way, or for a partner to turn up. */
const PATIENCE = { player: 8, partner: 20, fetch: 25 };

// ---------- pure helpers ----------

/** Whether the player is clear of a throw from `a` to `b` (on the floor plan): at least `gap` m from the line. */
export function clearOfPlayer(a: Pt, b: Pt, player: Pt, gap = PLAYER_GAP): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((player.x - a.x) * dx + (player.z - a.z) * dz) / len2)) : 0;
  return Math.hypot(player.x - (a.x + dx * t), player.z - (a.z + dz * t)) >= gap;
}

/** The body.ts heading that faces from `a` towards `b`. */
export const headingTo = (a: Pt, b: Pt) => Math.atan2(-(b.x - a.x), -(b.z - a.z));

/** A ball lying (or rolling slowly) on the floor, where someone can pick it up. */
export const onFloor = (b: Pick<NpcBall, 'y' | 'r' | 'vx' | 'vy' | 'vz'>) => b.y < b.r + 0.25 && Math.hypot(b.vx, b.vy, b.vz) < 1.2;

/** Is the roll in [from, to)? */
const rolled = (roll: number | undefined, [from, to]: readonly [number, number]) => roll !== undefined && roll >= from && roll < to;

const between = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

// ---------- the parts every toy errand shares ----------

/** Who is playing with each toy (at most one errand per toy). */
const plays: { hoops: string | null; toss: Toss | null } = { hoops: null, toss: null };

interface Toss {
  a: string;
  b: string | null;
  /** Whose turn it is to have the ball: who it was last thrown to (or who fetches it first). */
  to: string;
  throws: number;
  want: number;
  /** Who is at their spot, ready to play. */
  ready: Record<string, boolean>;
  over: false | 'done' | 'taken' | 'quit';
}

/** A script's moment-to-moment state: its act (one object, reused every frame), a stage and how long it's been in it. */
class Hands<S extends string> {
  act: Act = { do: 'stand', x: 0, z: 0, heading: 0, gesture: 'none' };
  stage: S;
  t = 0;
  heading = 0;
  private stoop = 0;
  private fetching = 0;

  constructor(
    readonly id: string,
    readonly floor: FloorKind,
    first: S,
  ) {
    this.stage = first;
  }

  go(stage: S) {
    this.stage = stage;
    this.t = 0;
  }

  stand(heading: number, gesture: Gesture): Act {
    const a = this.act;
    a.do = 'stand';
    a.heading = this.heading = heading;
    a.gesture = gesture;
    return a;
  }

  walk(x: number, z: number, heading: number, gesture: Gesture): Act {
    const a = this.act;
    a.do = 'walk';
    a.x = x;
    a.z = z;
    a.heading = this.heading = heading;
    a.gesture = gesture;
    return a;
  }

  done(): Act {
    this.act.do = 'done';
    return this.act;
  }

  /** Walks up to ball `id` and picks it up: 'got' once it's in hand, 'player' if the player has it, 'gone' if it can't. */
  fetch(me: Me, id: string): 'busy' | 'got' | 'player' | 'gone' {
    if (npcHolding(this.id) === id) return 'got';
    const b = npcBall(id);
    const holder = ballHolder(id);
    if (holder === 'player') return 'player';
    if (!b || holder || (this.fetching += me.dt) > PATIENCE.fetch) return 'gone';
    const face = headingTo(me, b);
    if (!onFloor(b)) {
      // still flying or bouncing: watch it; up on the furniture: leave it be
      if (b.sleeping) return 'gone';
      this.stand(face, 'none');
      return 'busy';
    }
    const reach = 0.42 + b.r;
    const d = Math.hypot(me.x - b.x, me.z - b.z);
    if (d < reach + 0.3) {
      this.stand(face, 'stoop');
      if ((this.stoop += me.dt) < 0.35) return 'busy';
      this.stoop = 0;
      if (!npcPickUp(this.id, id)) return 'gone';
      this.fetching = 0;
      return 'got';
    }
    this.stoop = 0;
    // stand on this side of it, or round it if that's in the furniture
    const w = walkways(this.floor);
    const a0 = Math.atan2(me.z - b.z, me.x - b.x);
    for (const turn of [0, 1, -1, 2]) {
      const a = a0 + (turn * Math.PI) / 2;
      const x = b.x + Math.cos(a) * reach;
      const z = b.z + Math.sin(a) * reach;
      if (standable(w, x, z)) return (this.walk(x, z, headingTo({ x, z }, b), 'none'), 'busy');
    }
    return 'gone';
  }
}

// ---------- shooting hoops ----------

type HoopStage = 'fetch' | 'court' | 'aim' | 'watch' | 'react' | 'tidy' | 'place' | 'shrug';

/** Fetch the basketball, take a few shots from the free-throw spot, cheer or shrug, then put it back under the hoop. */
function hoops(id: string, floor: FloorKind): ErrandScript | null {
  if (plays.hoops || ballHolder(BASKETBALL) !== null) return null;
  const court = spot(walkways(floor), 'hoop');
  if (!court) return null;
  plays.hoops = id;
  const h = new Hands<HoopStage>(id, floor, 'fetch');
  const facing = facingHoop(court, floor);
  const rim = hoopRim(floor);
  const want = between(SHOTS.min, SHOTS.max);
  let shots = 0;
  let thrownAt = 0;
  let cheer = false;
  let waited = 0;

  return {
    tick(me) {
      h.t += me.dt;
      if (npcLost(id) === 'taken' && h.stage !== 'shrug') h.go('shrug');
      switch (h.stage) {
        case 'fetch': {
          const got = h.fetch(me, BASKETBALL);
          if (got === 'player') h.go('shrug');
          else if (got === 'gone') return h.done();
          else if (got === 'got') h.go(shots < want ? 'court' : 'tidy');
          return h.act;
        }
        case 'court':
          if (!npcHolding(id)) return (h.go('fetch'), h.act);
          npcPose(id, 'carry');
          if (me.arrived && Math.hypot(me.x - court.x, me.z - court.z) < 0.3) h.go('aim');
          return h.walk(court.x, court.z, facing.heading, 'hold');
        case 'aim': {
          if (!npcHolding(id)) return (h.go('fetch'), h.act);
          // ball up, a moment to line it up and a little dip, but only with the player out of the way
          const clear = clearOfPlayer(me, rim, me.player);
          if (!clear) {
            if ((waited += me.dt) > PATIENCE.player) h.go('tidy');
            h.t = Math.min(h.t, 0.5);
          }
          const dip = h.t > 0.75 ? Math.sin(Math.min(1, (h.t - 0.75) / 0.3) * Math.PI) * 0.12 : 0;
          npcPose(id, 'shoot', dip);
          if (h.t >= 1.05) {
            npcThrow(id, aimHoop({ x: me.x, z: me.z, heading: me.heading }, floor, Math.random));
            thrownAt = performance.now();
            shots++;
            h.go('watch');
          }
          return h.stand(facing.heading, 'shoot');
        }
        case 'watch':
          if (npcScoredSince(id, thrownAt)) cheer = true;
          else if (h.t < 2.2) return h.stand(facing.heading, h.t < 0.3 ? 'shoot' : 'none');
          else cheer = false;
          h.go('react');
          return h.act;
        case 'react':
          if (h.t > 1.4) h.go('fetch');
          return h.stand(facing.heading, cheer ? 'cheer' : 'shrug');
        case 'tidy': {
          // back where it lives, just in front of the hoop
          const b = npcBall(BASKETBALL);
          if (!npcHolding(id) || !b) return (h.go('fetch'), h.act);
          npcPose(id, 'carry');
          const x = b.home.x;
          const z = b.home.z - (0.42 + b.r);
          if (me.arrived && Math.hypot(me.x - x, me.z - z) < 0.3) h.go('place');
          return h.walk(x, z, headingTo({ x, z }, b.home), 'hold');
        }
        case 'place':
          npcPose(id, 'low');
          if (h.t > 0.6) npcLetGo(id);
          if (h.t > 1.1) return h.done();
          return h.stand(h.heading, 'stoop');
        case 'shrug':
          if (h.t > 1.5) return h.done();
          return h.stand(headingTo(me, me.player), 'shrug');
      }
      return h.act;
    },
    end() {
      if (npcHolding(id)) npcLetGo(id);
      if (plays.hoops === id) plays.hoops = null;
    },
  };
}

// ---------- catch with the beach ball ----------

type TossStage = 'fetch' | 'home' | 'play' | 'wind' | 'follow' | 'place' | 'shrug' | 'leave';

/** One of the two people throwing the beach ball to each other: the one who started it (`starter`), or who joined. */
function toss(id: string, floor: FloorKind, starter: boolean): ErrandScript | null {
  let game = plays.toss;
  if (starter) {
    if (game || ballHolder(BEACH) !== null || !npcBall(BEACH)) return null;
    game = plays.toss = { a: id, b: null, to: id, throws: 0, want: between(TOSSES.min, TOSSES.max), ready: {}, over: false };
  } else {
    if (!game || game.b || game.over || game.a === id) return null;
    game.b = id;
  }
  const g = game;
  const h = new Hands<TossStage>(id, floor, starter ? 'fetch' : 'play');
  let home: Pt | null = null;
  let waited = 0;
  let flying = 0;
  const partner = () => (g.a === id ? g.b : g.a);
  const finish = (how: Toss['over']) => {
    if (!g.over) g.over = how;
    if (plays.toss === g) plays.toss = null;
  };
  const hands = { x: 0, y: 0, z: 0 };

  return {
    tick(me) {
      h.t += me.dt;
      home ??= { x: me.x, z: me.z }; // their spot: the director walked them there
      if (npcLost(id) === 'taken' || (ballHolder(BEACH) === 'player' && g.over !== 'done')) finish('taken');
      if (g.over === 'taken' && h.stage !== 'shrug' && h.stage !== 'leave') h.go('shrug');
      else if (g.over && g.over !== 'taken' && (h.stage === 'play' || h.stage === 'wind' || h.stage === 'follow')) h.go(npcHolding(id) ? 'place' : 'leave');
      g.ready[id] = h.stage === 'play' || h.stage === 'wind' || h.stage === 'follow';
      const other = partner();
      const them = other ? bodyState(other) : undefined;
      const toThem = them ? headingTo(me, them) : h.heading;
      switch (h.stage) {
        case 'fetch': {
          const got = h.fetch(me, BEACH);
          if (got === 'player') finish('taken');
          else if (got === 'gone') {
            finish('quit');
            return h.done();
          } else if (got === 'got') h.go('home');
          return h.act;
        }
        case 'home':
          if (!npcHolding(id)) return (h.go('fetch'), h.act);
          npcPose(id, 'carry');
          if (me.arrived && Math.hypot(me.x - home.x, me.z - home.z) < 0.3) h.go('play');
          return h.walk(home.x, home.z, toThem, 'hold');
        case 'play': {
          // waiting for a partner to turn up
          if (!other || !them || !g.ready[other]) {
            if ((waited += me.dt) > PATIENCE.partner) {
              finish('quit');
              h.go(npcHolding(id) ? 'place' : 'leave');
            }
            if (npcHolding(id)) npcPose(id, 'carry');
            return h.stand(toThem, npcHolding(id) ? 'hold' : 'none');
          }
          waited = 0;
          if (npcHolding(id)) {
            npcPose(id, 'toss');
            if (g.throws >= g.want) {
              finish('done');
              h.go('place');
            } else if (h.t > 0.8) h.go('wind');
            return h.stand(toThem, 'hold');
          }
          if (g.to !== id) return h.stand(toThem, 'none');
          // their throw is coming: hands out, and catch it when it reaches them
          const b = npcBall(BEACH);
          if (!b) return h.stand(toThem, 'none');
          npcHoldPoint({ x: me.x, z: me.z, heading: toThem }, 'carry', b.r, 0, hands);
          if (ballHolder(BEACH) === null && Math.hypot(b.x - hands.x, b.y - hands.y, b.z - hands.z) < b.r + 0.45 && npcPickUp(id, BEACH)) {
            flying = 0;
            h.go('play');
            return h.stand(toThem, 'hold');
          }
          if (ballHolder(BEACH) === null && ((flying += me.dt) > 3 || (onFloor(b) && flying > 0.5))) {
            // dropped it: go and get it
            flying = 0;
            npcExpect(id, null);
            h.go('fetch');
          }
          return h.stand(toThem, ballHolder(BEACH) === null ? 'catch' : 'none');
        }
        case 'wind': {
          if (!npcHolding(id) || !other || !them) return (h.go('play'), h.act);
          const at = npcHoldPoint({ x: them.x, z: them.z, heading: headingTo(them, me) }, 'carry', npcBall(BEACH)?.r ?? 0.4, 0, hands);
          if (!clearOfPlayer(me, them, me.player)) {
            if ((waited += me.dt) > PATIENCE.player) {
              finish('quit');
              h.go('place');
            }
            h.t = 0;
          }
          npcPose(id, 'toss', Math.min(1, h.t / 0.4) * 0.2);
          if (h.t >= 0.45) {
            const aim = aimToss(me.x, me.z, at, npcBall(BEACH)?.r ?? 0.4);
            if (!aim) {
              finish('quit');
              h.go('place');
              return h.act;
            }
            npcExpect(other, BEACH);
            npcThrow(id, aim);
            g.to = other;
            g.throws++;
            waited = 0;
            h.go('follow');
          }
          return h.stand(toThem, 'hold');
        }
        case 'follow':
          if (h.t > 0.6) h.go('play');
          return h.stand(toThem, 'toss');
        case 'place':
          // put it down at their feet, in the play area
          if (!npcHolding(id)) return (h.go('leave'), h.act);
          npcPose(id, 'low');
          if (h.t > 0.6) npcLetGo(id);
          return h.stand(h.heading, 'stoop');
        case 'shrug':
          if (npcHolding(id)) npcLetGo(id);
          if (h.t > 1.5) return h.done();
          return h.stand(headingTo(me, me.player), 'shrug');
        case 'leave':
          if (h.t > 0.4) return h.done();
          return h.stand(toThem, 'none');
      }
      return h.act;
    },
    end() {
      if (npcHolding(id)) npcLetGo(id);
      npcExpect(id, null);
      g.ready[id] = false;
      finish(g.over || 'quit');
    },
  };
}

// ---------- the registry ----------

registerErrand({
  name: 'hoops',
  when: (agent, s) => isFree(agent.status) && s.seatedFor >= s.restless && rolled(s.roll, SHARE.hoops) && !plays.hoops && ballHolder(BASKETBALL) === null && !!npcBall(BASKETBALL),
  spot: ['hoop'],
  steps: [],
  script: (agent, floor) => hoops(agent.id, floor),
});

registerErrand({
  name: 'toss',
  when: (agent, s) =>
    s.floor === 'office' && isFree(agent.status) && s.seatedFor >= s.restless && rolled(s.roll, SHARE.toss) && !plays.toss && ballHolder(BEACH) === null && !!npcBall(BEACH),
  spot: ['toss-*'],
  steps: [],
  script: (agent, floor) => toss(agent.id, floor, true),
});

// Someone else free, and sitting a few seconds already, joins a game that's waiting for a partner.
registerErrand({
  name: 'catch',
  when: (agent, s) => isFree(agent.status) && s.seatedFor >= 3 && !!plays.toss && !plays.toss.b && !plays.toss.over && plays.toss.a !== agent.id,
  spot: ['toss-*'],
  steps: [],
  script: (agent, floor) => toss(agent.id, floor, false),
});

/** For the probe and tests: who is playing with what. */
export const toyPlays = () => ({ hoops: plays.hoops, toss: plays.toss && { ...plays.toss } });
