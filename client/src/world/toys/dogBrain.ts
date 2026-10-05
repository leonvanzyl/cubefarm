import { ELEVATOR, HALF_D, PLAYER_RADIUS } from '../layout';
import { DOG_R, byDoors, randomSpot, standNear, type DogPlaces, type NapSpot } from './dogPlaces';
import { clear, planPath, segmentClear, type Nav, type Pt } from './roombaBrain';

// The office dog's brain: a pure state machine stepped once per physics step by Dog.tsx, in the style of the roomba's
// (roombaBrain.ts) and walking the people's walkways (walkways.ts). It wanders and sniffs about, naps when the floor is
// quiet, sits with someone having a hard time, runs to a merged PR's author, follows the player after a pet, watches a
// ball in their hands and fetches it when thrown, keeps clear of the roomba, people and the elevator doors, and now and
// then takes the elevator to another floor. Headings follow the roomba's: facing h looks along (cos h, sin h).
// Allocation-free while it walks: only a new path (now and then) or a new friend to cool down from allocates.

export const DOG = {
  walk: 1.1, // m/s
  trot: 1.9,
  run: 3.8,
  accel: 7, // m/s²
  turnRate: 7, // rad/s
  /** Following: it closes in when further than `far` and stops `near` from the player. */
  near: 1.4,
  far: 2.6,
  follow: 50, // seconds of following after a pet
  /** The player with a ball in hand this close (m) has its full attention. */
  eagerRange: 7,
  /** In front of the player, where it waits for the throw. */
  beg: 1.7,
  /** A ball let go of that gets this far from the player within `watchFor` s was thrown: fetch it. */
  fetchMin: 2.4,
  watchFor: 4,
  fetchGiveUp: 25,
  /** How far its mouth reaches past the ball's hold point when grabbing (m), and the ball's top speed it can catch. */
  reach: 0.3,
  catchSpeed: 3,
  /** Where it drops a fetched ball: the ball's middle this far from the player's. */
  feet: 0.9,
  /** Where a carried ball is held, ahead of its middle (npcAim.ts's 'mouth' pose: 0.42 m plus the ball's radius). */
  mouth: 0.42,
  visitFor: 120,
  visitAgain: 300,
  /** Seconds it waits by the chair for someone who got up (a stretch, a coffee) before giving up on the visit. */
  visitWait: 6,
  partyFor: 14,
  napMin: 45,
  napMax: 90,
  sleepyMin: 90,
  sleepyMax: 180,
  /** Seconds of a quiet floor before it'll nap. */
  quietAfter: 12,
  /** Seconds on a floor before it may take the elevator somewhere else. */
  stayMin: 150,
  stayMax: 360,
  wiggle: 1.4,
  arriveHold: 1.2,
  /** How close the player and people may come before it moves away, and how close the roomba. */
  keepPlayer: PLAYER_RADIUS + DOG_R + 0.15,
  keepPerson: 0.65,
  roombaKeep: 1.1,
  roombaGone: 2.5,
};

export type DogState =
  | 'wander' // walking to something to sniff, or anywhere
  | 'sniff' // nose down at it
  | 'rest' // sitting a while
  | 'nap' // to the couch or a rug, then asleep
  | 'visit' // head on the lap of someone having a hard time
  | 'party' // a merge: run to its author and hop about
  | 'follow' // after a pet
  | 'eager' // the player has a ball: watch it
  | 'fetch' // after a thrown ball
  | 'bring' // carrying it back
  | 'leave' // to the elevator and into the cabin
  | 'arrive' // out of the elevator
  | 'board' // into the elevator with the player
  | 'gone'; // in the cabin, off to another floor

/** What the body is doing when it isn't walking (Dog.tsx turns this into a pose; walking and running come from speed). */
export type DogPose = 'stand' | 'sit' | 'lie' | 'sleep' | 'lap' | 'sniff' | 'hop' | 'beg';

/** Things that happened, ORed into Dog.events for the sounds and the probe to pick up (and clear). */
export const DOG_EVENT = {
  woof: 1, // a happy woof
  bark: 2, // the roomba went past
  yip: 4, // a ball bounced off it: delighted
  hop: 8, // landed a hop
  fetch: 16, // off after a thrown ball
  returned: 32, // dropped it at the player's feet
  lost: 64, // gave up on a ball
  visit: 128, // sat down with someone having a hard time
  party: 256, // started celebrating a merge
  nap: 512, // lay down for a nap
  gone: 1024, // in the elevator cabin: off to another floor
  pet: 2048,
  sniff: 4096,
} as const;

export interface DogTarget extends Pt {
  /** What it's heading for: 'spot', 'sniff', 'nap', 'friend', 'author', 'player', 'ball', 'door' (null x/z: nothing). */
  kind: string | null;
  id: string | null;
}

interface Hop {
  active: boolean;
  t: number;
  dur: number;
  fx: number;
  fz: number;
  fy: number;
  tx: number;
  tz: number;
  ty: number;
}

export interface Dog {
  x: number;
  z: number;
  heading: number;
  /** Height off the floor: up on the couch, or mid-hop. */
  y: number;
  /** Ground speed this step (m/s). */
  speed: number;
  state: DogState;
  stateTime: number;
  pose: DogPose;
  /** 0-1, eased: how hard the tail wags. */
  happy: number;
  /** Seconds of brain time. */
  clock: number;
  target: DogTarget;
  /** Where the head looks (a ball, the player), when `on`. */
  look: { x: number; y: number; z: number; on: boolean };

  goal: Pt;
  /** Where `path` was planned to: a moving goal drifts from it a little at a time, and gets a new plan once it's far. */
  planned: Pt;
  hasGoal: boolean;
  path: Pt[];
  straight: Pt[];
  wp: number;
  noWay: boolean;
  mark: Pt;
  stuck: number;
  stuckCount: number;
  still: number;
  hop: Hop;
  /** The couch spot it's up on, if any. */
  perch: NapSpot | null;
  dodge: number;
  dodgeX: number;
  dodgeZ: number;

  awake: number;
  sleepy: number;
  quietFor: number;
  napNow: boolean;
  nap: NapSpot | null;
  napUntil: number;
  napPhase: 0 | 1 | 2; // walking there, hopping up, lying down
  lieAt: number;
  leaveAt: number;
  leavePhase: 0 | 1;
  followUntil: number;
  partyUntil: number;
  partyWith: string | null;
  wiggle: number;
  /** Seconds left of panting (after a run). */
  pant: number;
  hopClock: number;
  /** Sniff or rest time left, which way to face meanwhile, and the wander goal it's on (hasSpot). */
  dwell: number;
  face: number;
  hasSpot: boolean;
  spot: Pt;
  lastSniff: number;

  /** A ball the player let go of, and when; the ball it's after; what it wants in its mouth; when it bit. */
  watch: string | null;
  watchAt: number;
  ball: string | null;
  ballSince: number;
  mouth: string | null;
  grabAt: number;
  tries: number;
  eagerUntil: number;
  begAt: Pt;
  hasBeg: boolean;

  friend: string | null;
  visitSince: number;
  atFriend: boolean;
  /** Where it sits for the visit, kept while they're up from their chair, and for how long they've been up. */
  lap: DogFriend;
  missing: number;
  cooldown: Map<string, number>;

  barked: boolean;
  seed: number;
  /** DOG_EVENT bits since the reader (Dog.tsx) last cleared them. Never read here. */
  events: number;
}

/** The player as the dog sees them: where, which way they face (unit vector) and the ball in their hands. */
export interface DogPlayer extends Pt {
  fx: number;
  fz: number;
  holding: string | null;
}

/** Someone up and about: where, which way they're going (unit vector) and how fast. */
export interface DogWalker extends Pt {
  fx: number;
  fz: number;
  speed: number;
}

export interface DogBall extends Pt {
  id: string;
  y: number;
  r: number;
  vx: number;
  vy: number;
  vz: number;
  /** In the player's hands, the dog's mouth, someone else's hands, or loose. */
  holder: 'player' | 'dog' | 'other' | null;
}

/**
 * Someone having a hard time: where the dog sits beside their chair for a visit (dogPlaces.ts lapSpot) and its heading,
 * and whether they're `away` from their desk for now (a visit waits a little for them; none starts).
 */
export interface DogFriend extends Pt {
  id: string;
  heading: number;
  away?: boolean;
}

export interface DogEnv {
  nav: Nav;
  places: DogPlaces;
  player: DogPlayer | null;
  walkers: readonly DogWalker[];
  roomba: (Pt & { moving: boolean }) | null;
  balls: readonly DogBall[];
  /** The ball in its mouth, as the toy world carries it out (npc.ts). */
  holding: string | null;
  friends: readonly DogFriend[];
  /** Where the merged PR's author is now (or the gong), while there's a party. */
  party: Pt | null;
  /** There's another floor to take the elevator to. */
  canLeave: boolean;
}

export type DogArrival = 'cabin' | 'here' | 'player';

/** A dog stepping out of the elevator (`cabin`), already on the floor at `at` (`here`), or arriving with the player. */
export function createDog(places: DogPlaces, how: DogArrival, at: Pt & { heading: number }, seed = 1): Dog {
  const goal = { x: at.x, z: at.z };
  const d: Dog = {
    x: how === 'cabin' ? places.cabin.x : at.x,
    z: how === 'cabin' ? places.cabin.z : at.z,
    heading: how === 'cabin' ? -Math.PI / 2 : at.heading,
    y: 0,
    speed: 0,
    state: how === 'cabin' ? 'arrive' : how === 'player' ? 'follow' : 'wander',
    stateTime: 0,
    pose: 'stand',
    happy: 0.5,
    clock: 0,
    target: { kind: null, id: null, x: 0, z: 0 },
    look: { x: 0, y: 0, z: 0, on: false },
    goal,
    planned: { x: at.x, z: at.z },
    hasGoal: false,
    path: [],
    straight: [goal],
    wp: 0,
    noWay: false,
    mark: { x: at.x, z: at.z },
    stuck: 0,
    stuckCount: 0,
    still: 0,
    hop: { active: false, t: 0, dur: 0.45, fx: 0, fz: 0, fy: 0, tx: 0, tz: 0, ty: 0 },
    perch: null,
    dodge: 0,
    dodgeX: 0,
    dodgeZ: 0,
    awake: 0,
    sleepy: 0,
    quietFor: 0,
    napNow: false,
    nap: null,
    napUntil: 0,
    napPhase: 0,
    lieAt: 0,
    leaveAt: 0,
    leavePhase: 0,
    followUntil: how === 'player' ? DOG.follow : 0,
    partyUntil: 0,
    partyWith: null,
    wiggle: 0,
    pant: 0,
    hopClock: 0,
    dwell: 0,
    face: 0,
    hasSpot: false,
    spot: { x: 0, z: 0 },
    lastSniff: -1,
    watch: null,
    watchAt: 0,
    ball: null,
    ballSince: 0,
    mouth: null,
    grabAt: 0,
    tries: 0,
    eagerUntil: 0,
    begAt: { x: 0, z: 0 },
    hasBeg: false,
    friend: null,
    visitSince: 0,
    atFriend: false,
    lap: { id: '', x: 0, z: 0, heading: 0 },
    missing: 0,
    cooldown: new Map(),
    barked: false,
    seed: seed >>> 0 || 1,
    events: 0,
  };
  d.sleepy = between(d, DOG.sleepyMin, DOG.sleepyMax);
  d.leaveAt = between(d, DOG.stayMin, DOG.stayMax);
  return d;
}

/** mulberry32, kept in the state so runs (and tests) repeat. */
function rand(d: Dog) {
  d.seed = (d.seed + 0x6d2b79f5) >>> 0;
  let t = d.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (d: Dog, a: number, b: number) => a + (b - a) * rand(d);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (t: number) => t * t * (3 - 2 * t);

// ---------- from outside ----------

/** E: a happy wiggle and a woof, and it follows you for a while (even off its way to the elevator, or out of a nap). */
export function petDog(d: Dog) {
  if (d.state === 'gone' || d.state === 'board' || d.state === 'arrive') return;
  d.wiggle = DOG.wiggle;
  d.followUntil = d.clock + DOG.follow;
  d.leaveAt = Math.max(d.leaveAt, d.clock + DOG.follow + 60);
  d.events |= DOG_EVENT.pet | DOG_EVENT.woof;
  if (d.state === 'leave' && d.leavePhase === 0) {
    d.leaveAt = d.clock + DOG.stayMin;
    setState(d, 'follow');
  }
}

/** Come here: follow the player for a while (QA's __swarmDog.come, and arriving when called). */
export function callDog(d: Dog) {
  d.followUntil = d.clock + DOG.follow;
  if (d.state === 'leave' && d.leavePhase === 0) setState(d, 'follow');
}

/** The player let go of ball `id`: watch it, and fetch it if it was thrown. */
export function ballReleased(d: Dog, id: string) {
  d.watch = id;
  d.watchAt = d.clock;
}

/** A PR on this floor merged: celebrate with its author (null: at the gong) for a while. */
export function partyDog(d: Dog, agentId: string | null) {
  if (d.state === 'gone' || d.state === 'board' || d.state === 'arrive') return;
  d.partyUntil = d.clock + DOG.partyFor;
  d.partyWith = agentId;
  d.events |= DOG_EVENT.party;
}

/** A ball bounced off it: no harm done, it's delighted. */
export function delightDog(d: Dog) {
  if (d.state === 'gone') return;
  d.wiggle = Math.max(d.wiggle, 0.8);
  d.events |= DOG_EVENT.yip;
  if (d.state === 'nap' && d.napPhase === 2 && !d.perch) setState(d, 'wander');
}

/** The player is taking the elevator with it close by: it hops in with them. */
export function boardDog(d: Dog) {
  if (d.state !== 'gone') setState(d, 'board');
}

/** QA: nap now (wherever's free), or head for the elevator now. */
export function napDogNow(d: Dog) {
  d.napNow = true;
  d.followUntil = 0;
  d.eagerUntil = 0;
}

export function leaveDogNow(d: Dog) {
  d.leaveAt = d.clock;
  d.followUntil = 0;
  d.partyUntil = 0;
}

/** Whether it's asleep (for the Zzz). */
export const dogAsleep = (d: Dog) => d.state === 'nap' && d.pose === 'sleep';

/** What the hint says it's doing. */
export function dogStatus(d: Dog): string {
  switch (d.state) {
    case 'nap':
      return d.pose === 'sleep' ? 'napping' : 'off for a nap';
    case 'visit':
      return 'keeping someone company';
    case 'party':
      return 'celebrating';
    case 'follow':
      return 'following you';
    case 'eager':
      return 'watching the ball';
    case 'fetch':
    case 'bring':
      return 'fetching';
    case 'leave':
    case 'board':
      return 'off to the elevator';
    case 'sniff':
      return 'sniffing about';
    default:
      return 'wandering';
  }
}

// ---------- the step ----------

/** Advance the dog by dt seconds. Mutates d. */
export function stepDog(d: Dog, dt: number, env: DogEnv) {
  d.clock += dt;
  d.stateTime += dt;
  d.wiggle = Math.max(0, d.wiggle - dt);
  d.pant = Math.max(0, d.pant - dt);
  d.look.on = false;
  const x0 = d.x;
  const z0 = d.z;
  if (d.state === 'gone') {
    d.speed = 0;
    return;
  }
  // quiet: hardly anyone up and about, and no ball in play
  const quiet = env.walkers.length <= 2 && !env.player?.holding && !flying(env);
  d.quietFor = quiet ? d.quietFor + dt : 0;
  if (d.state !== 'nap' || d.napPhase !== 2) d.awake += dt;
  if (env.roomba && Math.hypot(env.roomba.x - d.x, env.roomba.z - d.z) > DOG.roombaGone) d.barked = false;

  watchBall(d, env);
  decide(d, env);
  if (!avoid(d, env, dt)) act(d, env, dt);

  const moved = Math.hypot(d.x - x0, d.z - z0);
  d.speed = dt > 0 ? moved / dt : 0;
  if (d.speed > DOG.trot + 0.3) d.pant = 4;
  d.still = d.speed > 0.05 ? 0 : d.still + dt;
  d.happy += (happyFor(d) - d.happy) * (1 - Math.exp(-dt * 2));
}

function flying(env: DogEnv) {
  for (const b of env.balls) if (b.holder === null && Math.hypot(b.vx, b.vy, b.vz) > 2) return true;
  return false;
}

function happyFor(d: Dog) {
  if (d.wiggle > 0) return 1;
  switch (d.state) {
    case 'party':
    case 'eager':
    case 'fetch':
    case 'bring':
      return 1;
    case 'follow':
      return 0.75;
    case 'visit':
      return 0.3;
    case 'nap':
      return 0.1;
    default:
      return 0.45;
  }
}

function setState(d: Dog, s: DogState) {
  // after a visit, a short while before visiting them again (the two-minute visit sets a long one)
  if (d.state === 'visit' && s !== 'visit' && d.friend) d.cooldown.set(d.friend, Math.max(d.cooldown.get(d.friend) ?? 0, d.clock + 20));
  if (!d.perch && !d.hop.active) d.y = 0; // down from a celebration hop
  d.state = s;
  d.stateTime = 0;
  d.hasGoal = false;
  d.hasSpot = false;
  d.hasBeg = false;
  d.napPhase = 0;
  d.leavePhase = 0;
  d.atFriend = false;
  if (s !== 'visit') d.friend = null;
  if (s !== 'fetch' && s !== 'bring') {
    d.ball = null;
    d.mouth = null;
  }
}

function setTarget(d: Dog, kind: string, id: string | null, x: number, z: number) {
  d.target.kind = kind;
  d.target.id = id;
  d.target.x = x;
  d.target.z = z;
}

const findBall = (env: DogEnv, id: string | null) => {
  if (!id) return undefined;
  for (const b of env.balls) if (b.id === id) return b;
  return undefined;
};

/** Too busy to notice a throw: celebrating, travelling, or asleep or comforting someone with the player far off. */
function mayFetch(d: Dog, p: DogPlayer) {
  const near = Math.hypot(p.x - d.x, p.z - d.z) < 6;
  switch (d.state) {
    case 'party':
    case 'arrive':
    case 'board':
    case 'gone':
    case 'fetch':
    case 'bring':
      return false;
    case 'leave':
      return d.leavePhase === 0;
    case 'nap':
    case 'visit':
      return near;
    default:
      return near || d.state === 'follow' || d.state === 'eager' || Math.hypot(p.x - d.x, p.z - d.z) < 12;
  }
}

function watchBall(d: Dog, env: DogEnv) {
  if (!d.watch) return;
  const b = findBall(env, d.watch);
  const p = env.player;
  if (!b || !p || b.holder === 'player' || b.holder === 'other' || d.clock - d.watchAt > DOG.watchFor) {
    d.watch = null;
    return;
  }
  if (!mayFetch(d, p) || Math.hypot(b.x - p.x, b.z - p.z) < DOG.fetchMin) return;
  setState(d, 'fetch');
  d.ball = b.id;
  d.ballSince = d.clock;
  d.tries = 0;
  d.watch = null;
  d.events |= DOG_EVENT.fetch;
}

/** The player's in the elevator cabin. */
const inCabin = (p: Pt) => p.z > HALF_D - 0.05 && Math.abs(p.x) < ELEVATOR.cabinHalf + 0.1;

function listed(env: DogEnv, id: string | null) {
  for (const f of env.friends) if (f.id === id) return true;
  return false;
}

function friendToVisit(d: Dog, env: DogEnv): DogFriend | null {
  for (const f of env.friends) if (f.id === d.friend && !f.away) return f;
  for (const f of env.friends) if (!f.away && (d.cooldown.get(f.id) ?? -Infinity) <= d.clock) return f;
  return null;
}

function decide(d: Dog, env: DogEnv) {
  const s = d.state;
  const p = env.player;
  if (s === 'arrive' || s === 'board' || s === 'gone') return;
  if (s === 'leave') {
    // turned back by a ball in your hands
    if (d.leavePhase === 0 && p?.holding && Math.hypot(p.x - d.x, p.z - d.z) < DOG.eagerRange) setState(d, 'eager');
    return;
  }
  if (d.clock < d.partyUntil && env.party) {
    if (s !== 'party') setState(d, 'party');
    return;
  }
  if (s === 'party') d.partyUntil = 0;
  if (s === 'fetch' || s === 'bring') return;
  if (p?.holding && (s === 'eager' || Math.hypot(p.x - d.x, p.z - d.z) < (s === 'nap' || s === 'visit' ? 4 : DOG.eagerRange) || d.clock < d.followUntil)) {
    if (s !== 'eager') setState(d, 'eager');
    return;
  }
  if (s === 'eager' && d.clock < d.eagerUntil) return; // just dropped it at your feet: waiting for the next throw
  if (p && d.clock < d.followUntil) {
    if (s !== 'follow') setState(d, 'follow');
    return;
  }
  const f = friendToVisit(d, env);
  if (f) {
    if (s !== 'visit' || d.friend !== f.id) {
      setState(d, 'visit');
      d.friend = f.id;
      d.visitSince = d.clock;
      d.missing = 0;
    }
    return;
  }
  if (s === 'visit' && listed(env, d.friend) && d.missing < DOG.visitWait) return; // up a moment: it waits
  if (s === 'nap') return;
  if (d.napNow || (d.awake > d.sleepy && d.quietFor > DOG.quietAfter)) {
    const spot = napSpot(d, env);
    d.napNow = false;
    if (spot) {
      setState(d, 'nap');
      d.nap = spot;
      d.napUntil = d.clock + 1e9; // set once it lies down
      return;
    }
    d.sleepy += 30; // nowhere free: try again later
  }
  if (env.canLeave && d.clock > d.leaveAt && (s === 'wander' || s === 'sniff' || s === 'rest')) {
    setState(d, 'leave');
    return;
  }
  if (s !== 'wander' && s !== 'sniff' && s !== 'rest') setState(d, 'wander');
}

/** The nearest nap spot nobody (the player, people about) is standing on. */
function napSpot(d: Dog, env: DogEnv): NapSpot | null {
  let best: NapSpot | null = null;
  let bd = Infinity;
  for (const n of env.places.naps) {
    if (env.player && Math.hypot(env.player.x - n.x, env.player.z - n.z) < 1.2) continue;
    let taken = false;
    for (const w of env.walkers) if (Math.hypot(w.x - n.x, w.z - n.z) < 1.2) taken = true;
    if (taken) continue;
    const dist = Math.hypot(n.x - d.x, n.z - d.z) * (0.6 + rand(d) * 0.8);
    if (dist < bd) {
      bd = dist;
      best = n;
    }
  }
  return best;
}

// ---------- moving about ----------

const ARRIVE = 0.1;

function plan(d: Dog, env: DogEnv, x: number, z: number, direct: boolean) {
  d.goal.x = d.planned.x = x;
  d.goal.z = d.planned.z = z;
  d.hasGoal = true;
  d.wp = 0;
  d.noWay = false;
  d.mark.x = d.x;
  d.mark.z = d.z;
  d.stuck = 0;
  if (direct || segmentClear(env.nav.rects, d, d.goal, DOG_R)) {
    d.path = d.straight;
    return;
  }
  const path = planPath(env.nav, d, d.goal);
  d.path = path ?? d.straight;
  d.noWay = !path;
}

function turnTo(d: Dog, heading: number, dt: number) {
  const err = wrap(heading - d.heading);
  d.heading = wrap(d.heading + Math.sign(err) * Math.min(Math.abs(err), DOG.turnRate * dt));
  return Math.abs(err);
}

/**
 * One step towards (x, z) at up to `speed` along the walkways (straight there when `direct`); true once within `near`.
 * Up on the couch, it hops down first. `d.noWay` says when there's no way there.
 */
function go(d: Dog, env: DogEnv, x: number, z: number, speed: number, dt: number, near = ARRIVE, direct = false): boolean {
  if (d.perch) {
    getDown(d, dt);
    return false;
  }
  // Measured from where the path was planned to, not from last step's goal: a goal that moves a little every step (a
  // rolling ball) would otherwise never get a new plan, and the dog would stop at the old path's end as if it had arrived.
  if (!d.hasGoal || Math.abs(x - d.planned.x) + Math.abs(z - d.planned.z) > 0.35) {
    plan(d, env, x, z, direct);
    if (d.noWay) return false; // the caller gives up rather than walk through the furniture
  } else {
    // small moves of a moving goal: just aim at it, the planned path's last corner included
    d.goal.x = x;
    d.goal.z = z;
    const end = d.path[d.path.length - 1];
    end.x = x;
    end.z = z;
  }
  let w = d.path[d.wp];
  while (d.wp < d.path.length - 1 && Math.hypot(w.x - d.x, w.z - d.z) < 0.3) w = d.path[++d.wp];
  const last = d.wp >= d.path.length - 1;
  const dx = w.x - d.x;
  const dz = w.z - d.z;
  const dist = Math.hypot(dx, dz);
  if (last && dist < near) return true;
  const want = Math.atan2(dz, dx);
  const err = turnTo(d, want, dt);
  const top = (last ? Math.min(speed, dist * 3 + 0.25) : speed) * Math.max(0.15, Math.cos(Math.min(err, Math.PI / 2)));
  const step = Math.min(dist, top * dt);
  stepBy(d, env, (dx / dist) * step, (dz / dist) * step);
  // no real progress for a while (blocked by people, say): try a new path, then give up
  if (Math.hypot(d.x - d.mark.x, d.z - d.mark.z) > 0.25) {
    d.mark.x = d.x;
    d.mark.z = d.z;
    d.stuck = 0;
  } else if ((d.stuck += dt) > 4) {
    d.stuck = 0;
    d.hasGoal = false;
    if (++d.stuckCount > 2) {
      d.stuckCount = 0;
      d.noWay = true;
    }
  }
  return false;
}

/** Turns tried, in order, to get round someone in the way (radians off the way it wants to go). */
const ROUND = [0.8, -0.8, 1.5, -1.5];

/**
 * Moves by (mx, mz) unless that closes in on the player or someone walking past; then it tries to step round them
 * (as long as that keeps it off the furniture). False when it can't move at all.
 */
function stepBy(d: Dog, env: DogEnv, mx: number, mz: number) {
  if (tryStep(d, env, mx, mz, false)) return true;
  for (const a of ROUND) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    if (tryStep(d, env, mx * c - mz * s, mx * s + mz * c, true)) return true;
  }
  return false;
}

function tryStep(d: Dog, env: DogEnv, mx: number, mz: number, offPath: boolean) {
  const x = d.x + mx;
  const z = d.z + mz;
  const p = env.player;
  if (p && closer(d, p, x, z, DOG.keepPlayer)) return false;
  for (const w of env.walkers) if (closer(d, w, x, z, DOG.keepPerson)) return false;
  if (offPath && !clear(env.nav.rects, x, z, DOG_R * 0.8)) return false;
  d.x = x;
  d.z = z;
  return true;
}

const closer = (d: Dog, o: Pt, x: number, z: number, keep: number) => {
  const after = Math.hypot(o.x - x, o.z - z);
  return after < keep && after < Math.hypot(o.x - d.x, o.z - d.z);
};

function startHop(d: Dog, tx: number, tz: number, ty: number) {
  const h = d.hop;
  h.active = true;
  h.t = 0;
  h.fx = d.x;
  h.fz = d.z;
  h.fy = d.y;
  h.tx = tx;
  h.tz = tz;
  h.ty = ty;
}

/** One step of a hop onto or off the couch; true once it has landed. */
function hopStep(d: Dog, dt: number) {
  const h = d.hop;
  h.t = Math.min(1, h.t + dt / h.dur);
  const s = smooth(h.t);
  d.x = h.fx + (h.tx - h.fx) * s;
  d.z = h.fz + (h.tz - h.fz) * s;
  d.y = h.fy + (h.ty - h.fy) * h.t + Math.sin(Math.PI * h.t) * 0.25;
  if (Math.hypot(h.tx - h.fx, h.tz - h.fz) > 0.05) turnTo(d, Math.atan2(h.tz - h.fz, h.tx - h.fx), dt);
  if (h.t < 1) return false;
  h.active = false;
  d.y = h.ty;
  d.events |= DOG_EVENT.hop;
  return true;
}

function getDown(d: Dog, dt: number) {
  const from = d.perch?.from;
  if (!from) {
    d.perch = null;
    d.y = 0;
    return;
  }
  if (!d.hop.active) startHop(d, from.x, from.z, 0);
  if (hopStep(d, dt)) d.perch = null;
}

/**
 * Keeping out of the way, before anything else: away from the player when they walk into it, aside for someone walking
 * its way, and off from the roomba (with a bark as it goes by). True while it's busy getting out of the way.
 */
function avoid(d: Dog, env: DogEnv, dt: number): boolean {
  if (d.perch || d.hop.active || d.y > 0.05 || d.state === 'arrive' || d.state === 'board' || (d.state === 'leave' && d.leavePhase === 1)) return false;
  const asleep = d.state === 'nap' && d.napPhase === 2;
  const p = env.player;
  if (p) {
    const dist = Math.hypot(d.x - p.x, d.z - p.z);
    if (dist < DOG.keepPlayer - 0.05) startDodge(d, env, d.x - p.x, d.z - p.z, 0.9);
  }
  if (d.dodge <= 0) {
    for (const w of env.walkers) {
      if (w.speed < 0.2) continue;
      const ox = d.x - w.x;
      const oz = d.z - w.z;
      const dist = Math.hypot(ox, oz);
      const ahead = ox * w.fx + oz * w.fz;
      const side = ox * -w.fz + oz * w.fx; // + is to their right
      if (dist < 0.7 || (dist < 1.8 && ahead > -0.2 && Math.abs(side) < 0.75)) {
        // step aside to whichever side of their path it's already on
        const s = side >= 0 ? 1 : -1;
        startDodge(d, env, -w.fz * s, w.fx * s, 1);
        break;
      }
    }
  }
  const r = env.roomba;
  if (d.dodge <= 0 && r && r.moving) {
    const dist = Math.hypot(d.x - r.x, d.z - r.z);
    if (dist < DOG.roombaKeep + 0.5 && !d.barked && !asleep) {
      d.barked = true;
      d.events |= DOG_EVENT.bark;
    }
    if (dist < (asleep ? 0.8 : DOG.roombaKeep)) startDodge(d, env, d.x - r.x, d.z - r.z, 1.2);
  }
  if (d.dodge <= 0) return false;
  d.dodge -= dt;
  if (d.state === 'nap') setState(d, 'wander'); // woken: it'll find another quiet spot
  const dx = d.dodgeX - d.x;
  const dz = d.dodgeZ - d.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.05) {
    d.dodge = 0;
    return false;
  }
  turnTo(d, Math.atan2(dz, dx), dt);
  const step = Math.min(dist, DOG.trot * dt);
  if (!clear(env.nav.rects, d.x + (dx / dist) * step, d.z + (dz / dist) * step, DOG_R * 0.8) || !stepBy(d, env, (dx / dist) * step, (dz / dist) * step)) d.dodge = 0;
  d.pose = 'stand';
  return true;
}

/** Sets off to get `dist` away along (ux, uz), or the nearest clear way round it. */
function startDodge(d: Dog, env: DogEnv, ux: number, uz: number, dist: number) {
  const len = Math.hypot(ux, uz) || 1;
  const base = Math.atan2(uz / len, ux / len);
  for (let i = 0; i < 7; i++) {
    const a = base + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.45;
    const x = d.x + Math.cos(a) * dist;
    const z = d.z + Math.sin(a) * dist;
    if (clear(env.nav.rects, x, z, DOG_R) && !byDoors(x, z)) {
      d.dodge = 0.9;
      d.dodgeX = x;
      d.dodgeZ = z;
      d.hasGoal = false;
      return;
    }
  }
}

const out = { x: 0, z: 0 };
const front = { x: 0, z: 0 };

/** A clear spot `dist` from the player, on the side `toward` (written into a shared object: copy it to keep it). */
function besidePlayer(env: DogEnv, p: Pt, dist: number, toward: Pt): Pt | null {
  return standNear(env.nav.rects, p.x, p.z, dist, toward, out);
}

// ---------- doing things ----------

function act(d: Dog, env: DogEnv, dt: number) {
  const p = env.player;
  const pl = env.places;
  switch (d.state) {
    case 'arrive': {
      d.pose = 'stand';
      setTarget(d, 'door', null, pl.door.x, pl.door.z);
      if (d.stateTime < DOG.arriveHold) break;
      if (go(d, env, pl.door.x, pl.door.z, DOG.walk, dt, 0.2, true)) setState(d, d.clock < d.followUntil ? 'follow' : 'wander');
      break;
    }
    case 'board': {
      setTarget(d, 'door', null, pl.cabin.x, pl.cabin.z);
      d.pose = 'stand';
      if (go(d, env, pl.cabin.x, pl.cabin.z, DOG.run, dt)) setState(d, 'gone');
      break;
    }
    case 'leave': {
      d.pose = 'stand';
      if (d.leavePhase === 0) {
        setTarget(d, 'door', null, pl.door.x, pl.door.z);
        if (go(d, env, pl.door.x, pl.door.z, DOG.trot, dt, 0.15)) {
          d.leavePhase = 1;
          d.hasGoal = false;
        } else if (d.noWay) {
          d.leaveAt = d.clock + 60;
          setState(d, 'wander');
        }
      } else if (go(d, env, pl.cabin.x, pl.cabin.z, DOG.walk, dt, ARRIVE, true)) {
        setState(d, 'gone');
        d.events |= DOG_EVENT.gone;
      }
      break;
    }
    case 'party': {
      const t = env.party!;
      setTarget(d, 'author', d.partyWith, t.x, t.z);
      const dist = Math.hypot(t.x - d.x, t.z - d.z);
      if (dist > 1.7 || (d.hasGoal && dist > 1.15)) {
        d.y = 0;
        const at = besidePlayer(env, t, 1, d);
        if (at && go(d, env, at.x, at.z, DOG.run, dt, 0.15)) d.hasGoal = false;
        d.pose = 'stand';
        break;
      }
      d.hasGoal = false;
      turnTo(d, Math.atan2(t.z - d.z, t.x - d.x), dt);
      bounce(d, dt);
      break;
    }
    case 'follow': {
      if (!p) {
        setState(d, 'wander');
        break;
      }
      setTarget(d, 'player', null, p.x, p.z);
      if (inCabin(p)) {
        // waits just outside for them (or for the ride, Dog.tsx)
        if (go(d, env, pl.door.x - 0.9, pl.door.z - 0.4, DOG.trot, dt, 0.15)) {
          turnTo(d, Math.PI / 2, dt);
          d.pose = d.still > 1.5 ? 'sit' : 'stand';
        }
        break;
      }
      const dist = Math.hypot(p.x - d.x, p.z - d.z);
      if (dist > DOG.far || (d.hasGoal && dist > DOG.near + 0.2)) {
        const at = besidePlayer(env, p, DOG.near, d);
        if (at && !go(d, env, at.x, at.z, dist > 5 ? DOG.run : DOG.trot, dt, 0.2)) {
          d.pose = 'stand';
          break;
        }
        d.hasGoal = false;
      }
      turnTo(d, Math.atan2(p.z - d.z, p.x - d.x), dt);
      d.pose = d.still > 1.5 ? 'sit' : 'stand';
      lookAtPlayer(d, p);
      break;
    }
    case 'eager': {
      if (!p) {
        setState(d, 'wander');
        break;
      }
      const ball = findBall(env, p.holding);
      if (!ball && d.clock >= d.eagerUntil) {
        setState(d, 'wander');
        break;
      }
      // a spot in front of them, kept unless they've turned or moved well away from it
      front.x = p.x + p.fx * DOG.beg;
      front.z = p.z + p.fz * DOG.beg;
      if (!d.hasBeg || Math.hypot(front.x - d.begAt.x, front.z - d.begAt.z) > 1.2) {
        const at = besidePlayer(env, p, DOG.beg, front);
        if (at) {
          d.begAt.x = at.x;
          d.begAt.z = at.z;
          d.hasBeg = true;
        }
      }
      setTarget(d, ball ? 'ball' : 'player', ball?.id ?? null, ball?.x ?? p.x, ball?.z ?? p.z);
      if (d.hasBeg && Math.hypot(d.begAt.x - d.x, d.begAt.z - d.z) > 0.4 && !go(d, env, d.begAt.x, d.begAt.z, DOG.trot, dt, 0.3)) {
        d.pose = 'stand';
        break;
      }
      d.hasGoal = false;
      turnTo(d, Math.atan2(p.z - d.z, p.x - d.x), dt);
      d.pose = ball ? 'beg' : 'sit';
      if (ball) {
        d.look.on = true;
        d.look.x = ball.x;
        d.look.y = ball.y;
        d.look.z = ball.z;
      } else lookAtPlayer(d, p);
      break;
    }
    case 'fetch':
      fetch(d, env, dt);
      break;
    case 'bring':
      bring(d, env, dt);
      break;
    case 'visit': {
      let f: DogFriend | null = null;
      let still = false; // still having a hard time, if away from their desk for now
      for (const x of env.friends) if (x.id === d.friend) still = !(f = x.away ? null : x);
      if (!f && !still) {
        setState(d, 'wander'); // it got better
        break;
      }
      if (f) {
        d.missing = Math.min(0, d.missing);
        d.lap.x = f.x;
        d.lap.z = f.z;
        d.lap.heading = f.heading;
      } else d.missing = Math.max(0, d.missing) + dt;
      if (d.clock - d.visitSince > DOG.visitFor) {
        const id = d.friend!;
        setState(d, 'wander');
        d.cooldown.set(id, d.clock + DOG.visitAgain);
        break;
      }
      if (d.missing >= DOG.visitWait) {
        setState(d, 'wander'); // they went off somewhere
        break;
      }
      f = d.lap;
      setTarget(d, 'friend', d.friend, f.x, f.z);
      if (d.atFriend && Math.hypot(f.x - d.x, f.z - d.z) > 0.3) d.atFriend = false;
      if (!d.atFriend) {
        d.pose = 'stand';
        if (go(d, env, f.x, f.z, DOG.trot, dt, 0.08)) {
          d.atFriend = true;
          if (d.missing >= 0) d.events |= DOG_EVENT.visit; // once a visit: -1 once it has sat down
          d.missing = -1;
        } else if (d.noWay) {
          const id = d.friend!;
          setState(d, 'wander');
          d.cooldown.set(id, d.clock + DOG.visitAgain);
        }
        break;
      }
      d.hasGoal = false;
      d.pose = turnTo(d, f.heading, dt) < 0.2 ? 'lap' : 'stand';
      break;
    }
    case 'nap':
      napping(d, env, dt);
      break;
    case 'sniff':
    case 'rest': {
      d.pose = d.state === 'sniff' ? 'sniff' : d.stateTime > 0.6 ? 'sit' : 'stand';
      if (d.state === 'sniff') turnTo(d, d.face, dt);
      if ((d.dwell -= dt) <= 0) setState(d, 'wander');
      break;
    }
    case 'wander':
      wander(d, env, dt);
      break;
    case 'gone':
      break;
  }
}

/** Hops on the spot: one every 0.55 s. */
function bounce(d: Dog, dt: number) {
  d.pose = 'hop';
  const was = d.hopClock % 0.55;
  d.hopClock += dt;
  d.y = Math.max(0, Math.sin((d.hopClock % 0.55) / 0.55 * Math.PI)) * 0.18;
  if (d.hopClock % 0.55 < was) d.events |= DOG_EVENT.hop;
}

function lookAtPlayer(d: Dog, p: Pt) {
  d.look.on = true;
  d.look.x = p.x;
  d.look.y = 1.4;
  d.look.z = p.z;
}

function wander(d: Dog, env: DogEnv, dt: number) {
  d.pose = 'stand';
  if (d.perch) {
    getDown(d, dt);
    return;
  }
  if (!d.hasSpot) {
    const sniffs = env.places.sniffs;
    let sniff = -1;
    if (sniffs.length && rand(d) < 0.6) {
      sniff = Math.floor(rand(d) * sniffs.length);
      if (sniff === d.lastSniff) sniff = (sniff + 1) % sniffs.length;
    }
    const at = sniff >= 0 ? sniffs[sniff] : randomSpot(env.places, () => rand(d));
    if (!at) return;
    d.spot.x = at.x;
    d.spot.z = at.z;
    d.hasSpot = true;
    d.lastSniff = sniff;
    d.hasGoal = false;
  }
  const s = d.lastSniff >= 0 ? env.places.sniffs[d.lastSniff] : null;
  setTarget(d, s ? 'sniff' : 'spot', s?.id ?? null, d.spot.x, d.spot.z);
  if (go(d, env, d.spot.x, d.spot.z, d.happy > 0.7 ? DOG.trot : DOG.walk, dt, 0.15)) {
    if (s) {
      setState(d, 'sniff');
      d.dwell = between(d, 2, 5);
      d.face = s.heading;
      d.events |= DOG_EVENT.sniff;
    } else {
      setState(d, 'rest');
      d.dwell = between(d, 3, 8);
    }
  } else if (d.noWay) d.hasSpot = false;
}

function napping(d: Dog, env: DogEnv, dt: number) {
  const n = d.nap;
  if (!n) {
    setState(d, 'wander');
    return;
  }
  setTarget(d, 'nap', n.id, n.x, n.z);
  if (d.napPhase === 0) {
    d.pose = 'stand';
    const to = n.from ?? n;
    if (go(d, env, to.x, to.z, DOG.walk, dt, n.from ? 0.12 : 0.15)) {
      d.hasGoal = false;
      if (n.from) startHop(d, n.x, n.z, n.y);
      d.napPhase = 1;
    } else if (d.noWay) {
      d.sleepy += 30;
      setState(d, 'wander');
    }
    return;
  }
  if (d.napPhase === 1) {
    if (d.hop.active && !hopStep(d, dt)) return;
    if (n.from) d.perch = n;
    d.napPhase = 2;
    d.lieAt = d.clock;
    d.napUntil = d.clock + between(d, DOG.napMin, DOG.napMax);
    d.events |= DOG_EVENT.nap;
    return;
  }
  // lying down, then asleep
  turnTo(d, n.heading, dt);
  d.pose = d.clock - d.lieAt < 2.5 ? 'lie' : 'sleep';
  if (d.clock >= d.napUntil) {
    d.awake = 0;
    d.sleepy = between(d, DOG.sleepyMin, DOG.sleepyMax);
    setState(d, 'wander');
  }
}

function fetch(d: Dog, env: DogEnv, dt: number) {
  const b = findBall(env, d.ball);
  const p = env.player;
  if (b?.holder === 'player') {
    setState(d, 'eager');
    return;
  }
  if (!b || !p || b.holder === 'other' || d.clock - d.ballSince > DOG.fetchGiveUp || (b.y > b.r + 0.5 && Math.hypot(b.vx, b.vy, b.vz) < 0.05)) {
    loseBall(d);
    return;
  }
  setTarget(d, 'ball', b.id, b.x, b.z);
  if (env.holding === b.id) {
    setState(d, 'bring');
    d.ball = b.id;
    d.mouth = b.id;
    return;
  }
  d.look.on = true;
  d.look.x = b.x;
  d.look.y = b.y;
  d.look.z = b.z;
  if (d.mouth) {
    // bit it: wait a moment for the toy world to carry that out, else try again
    d.pose = 'sniff';
    if (d.clock - d.grabAt > 0.5) d.mouth = null;
    return;
  }
  d.pose = 'stand';
  // stand where it holds the ball, on its side of it, a little ahead of where it's rolling
  const v = Math.hypot(b.vx, b.vz);
  const lead = Math.min(0.5, 0.25 * v);
  const bx = b.x + (v > 0.01 ? (b.vx / v) * lead : 0);
  const bz = b.z + (v > 0.01 ? (b.vz / v) * lead : 0);
  const dist = Math.hypot(bx - d.x, bz - d.z);
  const hold = DOG.mouth + b.r;
  if (dist < hold + DOG.reach && b.y < b.r + 0.3 && Math.hypot(b.vx, b.vy, b.vz) < DOG.catchSpeed) {
    if (turnTo(d, Math.atan2(b.z - d.z, b.x - d.x), dt) < 0.5) {
      d.mouth = b.id;
      d.grabAt = d.clock;
    }
    return;
  }
  const k = dist > 0.01 ? hold / dist : 0;
  go(d, env, bx + (d.x - bx) * k, bz + (d.z - bz) * k, dist > 3 ? DOG.run : DOG.trot, dt, 0.1);
  if (d.noWay) loseBall(d);
}

function loseBall(d: Dog) {
  d.events |= DOG_EVENT.lost;
  d.followUntil = Math.max(d.followUntil, d.clock + 15);
  setState(d, 'wander');
}

function bring(d: Dog, env: DogEnv, dt: number) {
  const b = findBall(env, d.ball);
  const p = env.player;
  if (env.holding !== d.ball) {
    // taken out of its mouth by the player, or it got stuck on something: back after it
    if (b?.holder === 'player') setState(d, 'eager');
    else if (b && b.holder === null && d.tries < 2) {
      const id = b.id;
      setState(d, 'fetch');
      d.ball = id;
      d.mouth = null;
      d.ballSince = d.clock;
      d.tries++;
    } else loseBall(d);
    return;
  }
  if (!p || !b) {
    d.mouth = null;
    setState(d, 'wander');
    return;
  }
  setTarget(d, 'player', null, p.x, p.z);
  d.pose = 'stand';
  // where it stands so the ball, held ahead of it, lands at the player's feet
  const want = DOG.feet + DOG.mouth + b.r;
  const dist = Math.hypot(d.x - p.x, d.z - p.z);
  if (dist > want + 0.3 || (d.hasGoal && dist > want + 0.12)) {
    const at = besidePlayer(env, p, want, d);
    if (at && !go(d, env, at.x, at.z, dist > 5 ? DOG.run : DOG.trot, dt, 0.15)) return;
    d.hasGoal = false;
  }
  if (turnTo(d, Math.atan2(p.z - d.z, p.x - d.x), dt) > 0.25) return;
  // drop it
  d.mouth = null;
  d.ball = null;
  d.events |= DOG_EVENT.returned | DOG_EVENT.woof;
  setState(d, 'eager');
  d.eagerUntil = d.clock + 6;
  d.followUntil = Math.max(d.followUntil, d.clock + 25);
  d.leaveAt = Math.max(d.leaveAt, d.clock + 90);
}
