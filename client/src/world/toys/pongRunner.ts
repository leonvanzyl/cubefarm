// Runs ping-pong on one physics ball: the serve (a toss and a hit), the rally (the air's pull and the table's bounce
// from pongPhysics.ts, paddles meeting the ball), the umpire's calls and the score (pongRules.ts), the agents' play
// (pongAi.ts), the player's paddle, the sounds and the reactions. Plain TypeScript over a few rigid-body methods,
// stepped before and after every physics step: PingPong.tsx runs it on the toy world's Rapier ball, and pongSim.ts on
// a bare Rapier world in the tests.

import { PONG_PLAYER, type PongResult } from '../../../../shared/pong';
import type { Gesture } from '../body';
import { aiServe, aiShot, atContact, contactFor, missChance, REACH, reachTo, READY, readyPaddle, skillFor, ratingOf, standFor, swingPaddle, type Contact, type Skill, type Wobble } from './pongAi';
import {
  airStep,
  fromOwn,
  halfAt,
  isSmash,
  offLine,
  onHalf,
  otherEnd,
  overTable,
  ownFrame,
  PONG,
  serveShot,
  solveShot,
  swingShot,
  tableBounce,
  TABLE,
  type BallState,
  type End,
  type Shot,
  type V3,
} from './pongPhysics';
import { newRally, rallyStep, scorePoint, serverOf, toHit, newGame, type Call, type Rally, type RallyEvent } from './pongRules';
import { autopilot, bothReady, leaveSeat, paddle, paddleAt, paddleSwing, pongChanged, pongMatch, rematch, setNpcPong, shakeView, type Match, type Seat } from './pongState';
import { crowdOoh, floorTick, netBrush, paddlePock, smashCrack, tablePock } from './pongSounds';

/** The ball as the runner moves it: the few rigid-body calls it needs (Rapier's RigidBody has them all). */
export interface PongBody {
  translation(): V3;
  linvel(): V3;
  setTranslation(p: V3, wake: boolean): void;
  setLinvel(v: V3, wake: boolean): void;
  setAngvel(w: V3, wake: boolean): void;
  setGravityScale(scale: number, wake: boolean): void;
}

export interface RunnerIo {
  /** Where an agent's body really is (the toy world asks people.ts); null to take them as being where they were sent. */
  bodyAt(id: string): { x: number; z: number } | null;
  /** A game finished: record it on the leaderboard. */
  report(result: PongResult): void;
  /** Speech bubbles over the agents (people.ts say). */
  say?(id: string, text: string | null): void;
  /** Play sounds (off in tests). */
  sounds?: boolean;
  rand?: () => number;
}

const STEP = PONG.step;
const R = PONG.ball.r;
const TOP = TABLE.top;
const NET_TOP = TOP + PONG.net.h;
const HALF_WID = TABLE.wid / 2;

export const TIMING = {
  /** Seconds after a point before the next serve; a let comes back quicker. */
  point: 1.5,
  let: 0.8,
  /** An agent's pause before tossing to serve (plus up to `serveJitter`). */
  serve: 0.9,
  serveJitter: 0.8,
  /** After a game: how long the player has to click for a rematch, and two agents linger. */
  rematch: 12,
  npcLinger: 4,
  /** A rally with nothing happening this long is over. */
  stall: 3,
  /** Returns before the room goes "ooh". */
  ooh: 8,
};
/** The toss: up at this speed from the hand, met on the way down at this height over the table. */
const TOSS = { up: 2.2, hitY: TOP + 0.28 };
/** How near (m) the player's paddle must be to the ball as it passes: across, up and down, and all round for a slow one. */
export const PADDLE_HIT = { lat: 0.21, y: 0.32, near: 0.14 };

/** Faces down the table from `end` (body.ts heading). */
const facing = (end: End) => (end === 'west' ? -Math.PI / 2 : Math.PI / 2);
const ENDS: readonly End[] = ['west', 'east'];
const seatId = (s: Seat | null) => (s ? (s.kind === 'player' ? PONG_PLAYER : s.id) : null);
const agentOf = (s: Seat | null) => (s?.kind === 'agent' ? s.id : null);

interface Plan {
  /** Physics-clock time they start moving for the ball (their reaction), the contact they read, and when it comes. */
  readyAt: number;
  contact: Contact | null;
  hitT: number;
  /** Read again once the ball bounced on their half: whether they'll miss it and what they'll play. */
  decided: boolean;
  willMiss: boolean;
  shot: Shot | null;
  smash: boolean;
  wobble: Wobble | null;
  /** They've swung at this one (hit or whiffed): no second go. */
  swung: boolean;
}

interface AiEnd {
  plan: Plan | null;
  /** The last swing: when, and where it met (or missed) the ball, for the follow-through. */
  swungAt: number;
  metAt: V3 | null;
  stand: { x: number; z: number };
  mood: { gesture: Gesture; until: number } | null;
  sayUntil: number;
}

/** A drill from the probe: balls fed at the player, one at a time, each return checked. */
interface Drill {
  queue: { speed: number; top: number; side: number; lat: number; depth: number }[];
  results: { landed: boolean; why: string }[];
}

export interface PongLive {
  ball: { x: number; y: number; z: number; speed: number; top: number; side: number; live: boolean } | null;
  returns: { tried: number; landed: number };
  drill: { left: number; results: { landed: boolean; why: string }[] } | null;
  lastShot: { by: End; speed: number; top: number; side: number; landsAt: { x: number; z: number } | null; smash: boolean } | null;
  forced: number;
}

export class PongRunner {
  /** The physics clock (s). */
  t = 0;
  private phaseT = 0;
  private matchId = -1;
  private live = false;
  private b: BallState = { p: { x: 0, y: 0, z: 0 }, v: { x: 0, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 } };
  private preV: V3 = { x: 0, y: 0, z: 0 };
  private prevP: V3 = { x: 0, y: 0, z: 0 };
  private padBackPrev = paddle.back;
  private rally: Rally = newRally('west');
  private lastEventT = 0;
  private inNet = false;
  private oohed = false;
  private parked = false;
  private serve: { by: End; tossed: boolean; tossAt: number; delay: number; lat: number } | null = null;
  private nextFirst: End | null = null;
  private ai: Record<End, AiEnd> = { west: this.freshAi('west'), east: this.freshAi('east') };
  private skills = new Map<string, Skill>();
  private drillState: Drill | null = null;
  private drilled: Drill['results'] | null = null;
  private returns = { tried: 0, landed: 0 };
  private lastShot: PongLive['lastShot'] = null;
  private playerPlan: Plan | null = null;
  private lastFloorTick = 0;
  /** The next this many agent returns are clean (the probe forcing a rally). */
  forced = 0;
  private readonly rand: () => number;

  constructor(
    private body: PongBody,
    private io: RunnerIo,
  ) {
    this.rand = io.rand ?? Math.random;
    this.park();
  }

  private freshAi(end: End): AiEnd {
    return { plan: null, swungAt: -Infinity, metAt: null, stand: fromOwn(end, READY.back, READY.lat), mood: null, sayUntil: 0 };
  }

  private skill(id: string): Skill {
    let s = this.skills.get(id);
    if (!s) this.skills.set(id, (s = skillFor(ratingOf(id))));
    return s;
  }

  // ---------- the ball ----------

  /** Out of play, out of sight: under the table's middle, still (PingPong.tsx hides it). */
  private park() {
    if (this.parked) return;
    this.parked = true;
    this.live = false;
    this.body.setGravityScale(0, false);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    this.body.setTranslation({ x: TABLE.x, y: -1, z: TABLE.z }, false);
  }

  /** Whether the ball is parked out of sight. */
  get hidden() {
    return this.parked;
  }

  private hold(p: V3) {
    this.parked = false;
    this.live = false;
    this.body.setGravityScale(0, true);
    this.body.setTranslation(p, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  private launch(v: V3, w: V3) {
    this.parked = false;
    this.live = true;
    this.body.setGravityScale(1, true);
    this.body.setLinvel(v, true);
    this.b.w = { ...w };
    this.body.setAngvel(w, true);
    this.preV = { ...v };
  }

  // ---------- each physics step ----------

  /** Before the physics step: the match's phases, the air on the ball, the agents' feet and paddles. */
  before() {
    this.t += STEP;
    const m = pongMatch();
    if ((m?.id ?? -1) !== this.matchId) this.newMatch(m);
    if (!m) {
      this.park();
      return;
    }
    switch (m.phase) {
      case 'waiting':
        if (this.drillState) break;
        this.park();
        if (bothReady(m)) this.startGame(m);
        break;
      case 'serve':
        this.serving(m);
        break;
      case 'rally':
        this.inPlay(m);
        break;
      case 'point':
        if (this.drillState && this.t - this.phaseT > 0.6) this.feedNext(m);
        else if (!this.drillState && this.t - this.phaseT > (m.last ? TIMING.point : TIMING.let)) this.toServe(m);
        break;
      case 'over':
        this.afterGame(m);
        break;
    }
    this.moveAgents(m);
    this.movePaddle(m);
    this.prevP = this.body.translation();
  }

  /**
   * After the physics step: the table's bounce, the net, a dead ball, and paddles meeting it. The ball doesn't collide
   * with the table top in Rapier (PingPong.tsx's collision groups): the bounce is done here, exactly as the forecasts
   * do it, so what the players read is what happens.
   */
  after() {
    const m = pongMatch();
    const p = this.body.translation();
    const v = this.body.linvel();
    const onTable = !this.parked && v.y < 0 && p.y <= TOP + R && this.prevP.y > TOP + R - 0.05 && overTable(p.x, p.z);
    if (onTable) this.tableTouch(p, v);
    if (!this.live || !m || m.phase !== 'rally') {
      if (!onTable) this.rolling(p, v);
      this.padBackPrev = paddle.back;
      return;
    }
    if (onTable) {
      if (this.io.sounds) tablePock(p, Math.min(1, -v.y / 5));
      this.event(m, { kind: 'bounce', on: halfAt(p.x) });
      if (m.phase !== 'rally') return void (this.padBackPrev = paddle.back);
    }
    const nearNet = Math.abs(p.x - TABLE.x) < R + PONG.net.t / 2 + 0.02 && p.y < NET_TOP + R && p.y > TOP && Math.abs(p.z - TABLE.z) < HALF_WID + PONG.net.overhang + R;
    if (nearNet && !this.inNet) {
      if (this.io.sounds) netBrush(p);
      this.event(m, { kind: 'net' });
    }
    this.inNet = nearNet;
    if (p.y < TOP - 0.05 && !overTable(p.x, p.z)) this.event(m, { kind: 'dead' });
    else if (this.t - this.lastEventT > TIMING.stall) this.event(m, { kind: 'dead' });
    if (m.phase === 'rally') {
      const turn = toHit(this.rally);
      if (turn) this.contact(m, turn, this.body.translation(), this.body.linvel());
    }
    this.padBackPrev = paddle.back;
  }

  /** The ball comes down on the table top: it bounces (pongPhysics), or, barely moving, settles on it and rolls. */
  private tableTouch(p: V3, v: V3) {
    const nv = { x: v.x, y: v.y, z: v.z };
    if (-v.y < 0.4 && !this.live) {
      nv.y = 0;
      nv.x *= 0.985;
      nv.z *= 0.985;
    } else tableBounce(nv, this.b.w);
    this.body.setTranslation({ x: p.x, y: TOP + R, z: p.z }, true);
    this.body.setLinvel(nv, true);
    this.body.setAngvel(this.b.w, true);
    if (!this.live && this.io.sounds && -v.y > 0.8 && this.t - this.lastFloorTick > 0.06) {
      this.lastFloorTick = this.t;
      tablePock(p, Math.min(1, -v.y / 6));
    }
    this.preV = nv;
  }

  /** A ball out of play, rolling about: its knocks on the floor. */
  private rolling(p: V3, v: V3) {
    if (this.parked || !this.io.sounds) return;
    const dv = Math.hypot(v.x - this.preV.x, v.y - this.preV.y + PONG.gravity * STEP, v.z - this.preV.z);
    if (dv > 0.8 && this.t - this.lastFloorTick > 0.06) {
      this.lastFloorTick = this.t;
      floorTick(p, Math.min(1, dv / 6));
    }
    this.preV = { ...v };
  }

  // ---------- the match's phases ----------

  private newMatch(m: Match | null) {
    this.matchId = m?.id ?? -1;
    this.ai = { west: this.freshAi('west'), east: this.freshAi('east') };
    this.serve = null;
    this.nextFirst = null;
    this.drillState = null;
    this.forced = 0;
    this.playerPlan = null;
    for (const end of ENDS) {
      const id = agentOf(m?.seats[end] ?? null);
      if (id) setNpcPong(id, null);
    }
  }

  private setPhase(m: Match, phase: Match['phase']) {
    m.phase = phase;
    m.since = performance.now();
    this.phaseT = this.t;
    pongChanged();
  }

  private startGame(m: Match) {
    const you = ENDS.find((e) => m.seats[e]?.kind === 'player');
    const first = this.nextFirst ?? you ?? (this.rand() < 0.5 ? 'west' : 'east');
    this.nextFirst = null;
    m.game = newGame(first);
    m.last = null;
    m.rally = 0;
    m.longest = 0;
    for (const end of ENDS) this.ai[end].plan = null;
    this.playerPlan = null;
    this.toServe(m);
  }

  private toServe(m: Match) {
    this.serve = null;
    this.live = false;
    m.rally = 0;
    m.ask = null;
    this.oohed = false;
    this.setPhase(m, 'serve');
  }

  private serving(m: Match) {
    const by = serverOf(m.game);
    const seat = m.seats[by];
    if (!seat || !bothReady(m)) return;
    if (!this.serve || this.serve.by !== by) this.serve = { by, tossed: false, tossAt: 0, delay: TIMING.serve + this.rand() * TIMING.serveJitter, lat: (this.rand() * 2 - 1) * 0.3 };
    const sv = this.serve;
    if (!sv.tossed) {
      // the ball in hand: over the player's paddle, or in front of the agent
      const p = seat.kind === 'player' ? { ...paddleAt(by), y: TOSS.hitY - 0.06 } : this.tossSpot(by);
      this.hold(p);
      const go = seat.kind === 'player' ? m.ask === 'serve' || (autopilot.on && this.t - this.phaseT > 0.6) : this.t - this.phaseT > sv.delay;
      if (!go) return;
      m.ask = null;
      sv.tossed = true;
      sv.tossAt = this.t;
      this.parked = false;
      this.body.setGravityScale(1, true);
      this.body.setLinvel({ x: 0, y: TOSS.up, z: 0 }, true);
      return;
    }
    const p = this.body.translation();
    const v = this.body.linvel();
    if (v.y < 0 && p.y <= TOSS.hitY) {
      const shot = seat.kind === 'player' ? serveShot(by, paddle.lat * 0.6, paddleSwing()) : aiServe(this.skill(seat.id), by, this.rand);
      const sol = solveShot(p, by, shot);
      this.launch(sol.v, sol.w);
      this.lastShot = { by, speed: shot.speed, top: shot.top, side: shot.side, landsAt: sol.land, smash: false };
      if (this.io.sounds) paddlePock(p, shot.speed / 13);
      if (seat.kind === 'agent') this.swung(by, p);
      this.rally = newRally(by);
      this.event(m, { kind: 'serve', by });
      this.inNet = false;
      this.setPhase(m, 'rally');
      this.planFor(m, otherEnd(by));
    }
  }

  /** Where an agent serving from `end` holds the ball up: in front of them and to the right, where the paddle meets it. */
  private tossSpot(end: End): V3 {
    const st = this.ai[end].stand;
    const o = ownFrame(end, st.x, st.z);
    return { ...fromOwn(end, o.back - 0.32, o.lat + 0.22), y: TOSS.hitY - 0.06 };
  }

  private inPlay(m: Match) {
    if (!this.live) return;
    const v = this.body.linvel();
    this.b.v = { x: v.x, y: v.y, z: v.z };
    airStep(this.b, STEP);
    this.body.setLinvel(this.b.v, true);
    this.body.setAngvel(this.b.w, true);
    this.preV = { ...this.b.v };
    for (const end of ENDS) if (m.seats[end]?.kind === 'agent' && !this.drillState) this.think(end);
  }

  private afterGame(m: Match) {
    const you = ENDS.find((e) => m.seats[e]?.kind === 'player');
    const long = this.t - this.phaseT;
    if (you && m.ask === 'rematch') {
      m.ask = null;
      this.nextFirst = m.last ? otherEnd(m.last.winner) : you; // the loser serves first
      rematch(m, this.nextFirst);
      return;
    }
    if (long > (you ? TIMING.rematch : TIMING.npcLinger)) {
      // they've had their game: back to their desks (the player stays, and someone else may come)
      for (const end of ENDS) {
        const id = agentOf(m.seats[end]);
        if (id) leaveSeat(id);
      }
    }
  }

  // ---------- the umpire ----------

  private event(m: Match, e: RallyEvent) {
    this.lastEventT = this.t;
    const call = rallyStep(this.rally, e);
    if (e.kind === 'bounce' && !call) this.bounced(m, e.on);
    if (call) this.called(m, call);
  }

  private called(m: Match, call: Call) {
    this.live = false;
    for (const end of ENDS) this.ai[end].plan = null;
    this.playerPlan = null;
    if (this.drillState) {
      const you = ENDS.find((e) => m.seats[e]?.kind === 'player');
      const landed = 'point' in call && call.point === you && (call.why === 'missed' || call.why === 'double-bounce');
      this.drillState.results.push({ landed, why: 'point' in call ? call.why : 'let' });
      this.setPhase(m, 'point');
      return;
    }
    if (!('point' in call)) {
      m.last = null;
      this.setPhase(m, 'point');
      return;
    }
    const winner = call.point;
    const over = scorePoint(m.game, winner);
    m.longest = Math.max(m.longest, m.rally);
    m.last = over ? { winner: over, why: 'game' } : { winner, why: call.why };
    this.react(m, winner, !!over);
    if (over) {
      this.setPhase(m, 'over');
      const players = [seatId(m.seats.west), seatId(m.seats.east)];
      if (players[0] && players[1]) this.io.report({ players: [players[0], players[1]], score: [m.game.score.west, m.game.score.east] });
    } else this.setPhase(m, 'point');
  }

  /** Agents cheer a point won and grumble at one lost; a long rally gets the room's "ooh". */
  private react(m: Match, winner: End, game: boolean) {
    for (const end of ENDS) {
      const id = agentOf(m.seats[end]);
      if (!id) continue;
      const won = end === winner;
      const ai = this.ai[end];
      ai.mood = { gesture: won ? 'cheer' : 'shrug', until: this.t + (game ? 2.6 : 1.1) };
      const chance = game ? 1 : won ? 0.35 : 0.3;
      if (this.io.say && this.rand() < chance) {
        const pick = (xs: string[]) => xs[Math.floor(this.rand() * xs.length)];
        this.io.say(id, game ? (won ? '🏆' : '😩') : won ? pick(['💪', '🎉', '😎', '🙌']) : pick(['😤', '🙈', '🤦', '😬']));
        ai.sayUntil = this.t + (game ? 3 : 1.4);
      }
    }
  }

  private bounced(m: Match, on: End) {
    if (toHit(this.rally) !== on) return;
    // a return of the player's that made it onto the far half
    if (m.seats[this.rally.striker]?.kind === 'player' && this.rally.hits > 0) this.returns.landed++;
    // the ball reached someone's half: an agent there reads it properly now, and decides
    if (m.seats[on]?.kind === 'agent' && !this.drillState) this.decide(on, true);
    if (m.seats[on]?.kind === 'player' && autopilot.on) this.playerPlan = this.read(on, true);
  }

  // ---------- agents ----------

  /** Someone just hit it towards `end`: an agent there starts reading it once their reaction time is up. */
  private planFor(m: Match, end: End) {
    const seat = m.seats[end];
    if (seat?.kind === 'agent') this.ai[end].plan = { readyAt: this.t + this.skill(seat.id).reaction, contact: null, hitT: 0, decided: false, willMiss: false, shot: null, smash: false, wobble: null, swung: false };
    if (seat?.kind === 'player' && autopilot.on) this.playerPlan = this.read(end, false);
  }

  /** Where the ball now in play will meet `end`'s paddle. */
  private read(end: End, bounced: boolean): Plan | null {
    const p = this.body.translation();
    const v = this.body.linvel();
    const c = contactFor({ p, v, w: this.b.w }, end, bounced);
    return c ? { readyAt: this.t, contact: c, hitT: this.t + c.t, decided: bounced, willMiss: false, shot: null, smash: false, wobble: null, swung: false } : null;
  }

  /** An agent's first read, once they've reacted: roughly where it's going (worse players misjudge it more). */
  private think(end: End) {
    const plan = this.ai[end].plan;
    if (!plan || plan.contact || this.t < plan.readyAt) return;
    const id = agentOf(pongMatch()?.seats[end] ?? null);
    if (!id) return;
    const p = this.body.translation();
    const c = contactFor({ p, v: this.body.linvel(), w: this.b.w }, end, false);
    if (!c) return;
    const off = (1 - this.skill(id).rating) * 0.18;
    plan.contact = { ...c, p: { ...c.p, z: c.p.z + (this.rand() * 2 - 1) * off } };
    plan.hitT = this.t + c.t;
  }

  /** After the bounce on their half: where it really meets them, whether they'll miss it, and the return they'll play. */
  private decide(end: End, bounced: boolean) {
    const m = pongMatch();
    const id = agentOf(m?.seats[end] ?? null);
    if (!m || !id) return;
    const s = this.skill(id);
    const read = this.read(end, bounced);
    const ai = this.ai[end];
    if (!read?.contact) {
      ai.plan = null;
      return;
    }
    // how far short their feet will be when it arrives
    const from = this.io.bodyAt(id) ?? ai.stand;
    const to = standFor(end, read.contact.p);
    const left = Math.max(0, read.hitT - this.t);
    const stretch = Math.max(0, Math.hypot(to.x - from.x, to.z - from.z) - s.move * left);
    const forced = this.forced > 0;
    read.willMiss = !forced && this.rand() < missChance(s, read.contact, stretch);
    const { shot, smash, wobble } = aiShot(forced ? { ...s, aim: 0.02 } : s, end, read.contact.p, this.rand);
    read.shot = shot;
    read.smash = smash;
    read.wobble = wobble;
    read.readyAt = Math.min(ai.plan?.readyAt ?? this.t, this.t);
    ai.plan = read;
  }

  private contact(m: Match, end: End, p: V3, v: V3) {
    const seat = m.seats[end];
    if (seat?.kind === 'player') return this.playerContact(m, end, p, v);
    if (seat?.kind !== 'agent' || this.drillState || !atContact(end, p, v)) return;
    const ai = this.ai[end];
    if (ai.plan?.swung) return;
    if (!ai.plan?.decided) this.decide(end, true);
    const plan = ai.plan;
    const stand = this.io.bodyAt(seat.id) ?? ai.stand;
    const reach = reachTo(end, stand, p);
    this.swung(end, p);
    if (plan) plan.swung = true;
    if (!plan?.shot || plan.willMiss || reach > REACH + 0.25) return; // a whiff: the swing goes through, the ball doesn't come back
    if (this.forced > 0) this.forced--;
    this.strike(m, end, p, plan.shot, plan.smash, plan.wobble);
  }

  /** The player's paddle meets the ball if it passed through the paddle's plane close enough (or a slow one came to it). */
  private playerContact(m: Match, end: End, p: V3, v: V3) {
    const o0 = ownFrame(end, this.prevP.x, this.prevP.z);
    const o1 = ownFrame(end, p.x, p.z);
    const rel0 = o0.back - this.padBackPrev;
    const rel1 = o1.back - paddle.back;
    let hit = false;
    if (rel0 < 0 && rel1 >= 0) {
      const k = rel0 / (rel0 - rel1);
      const lat = o0.lat + (o1.lat - o0.lat) * k;
      const y = this.prevP.y + (p.y - this.prevP.y) * k;
      hit = Math.abs(lat - paddle.lat) <= PADDLE_HIT.lat && Math.abs(y - paddle.y) <= PADDLE_HIT.y;
    } else hit = Math.hypot(o1.back - paddle.back, o1.lat - paddle.lat, p.y - paddle.y) <= PADDLE_HIT.near;
    if (!hit) return;
    const swing = paddleSwing();
    const shot = swingShot(end, p, { v, w: this.b.w }, swing);
    this.strike(m, end, p, shot, isSmash(p.y, swing));
  }

  /** A paddle sends the ball back with `shot`. */
  private strike(m: Match, end: End, p: V3, shot: Shot, smash: boolean, wobble: Wobble | null = null) {
    const sol = solveShot(p, end, shot);
    this.launch(wobble ? offLine(sol.v, wobble) : sol.v, sol.w);
    if (m.seats[end]?.kind === 'player') this.returns.tried++;
    this.lastShot = { by: end, speed: shot.speed, top: shot.top, side: shot.side, landsAt: sol.land, smash };
    if (this.io.sounds) {
      paddlePock(p, Math.min(1, shot.speed / 12));
      if (smash) smashCrack(p);
    }
    const you = ENDS.find((e) => m.seats[e]?.kind === 'player');
    if (smash && you) shakeView(end === you ? 1 : 0.6);
    this.inNet = false;
    this.event(m, { kind: 'hit', by: end });
    m.rally++;
    if (m.rally >= TIMING.ooh && !this.oohed && !this.drillState) {
      this.oohed = true;
      if (this.io.sounds) crowdOoh({ x: TABLE.x, y: 1.4, z: TABLE.z + 2 });
    }
    pongChanged();
    this.planFor(m, otherEnd(end));
  }

  private swung(end: End, at: V3) {
    const ai = this.ai[end];
    ai.swungAt = this.t;
    ai.metAt = { ...at };
  }

  /** Every step: where each agent at the table steps to, how they hold the paddle, and their cheers and grumbles. */
  private moveAgents(m: Match) {
    const serving = m.phase === 'serve' ? serverOf(m.game) : null;
    for (const end of ENDS) {
      const seat = m.seats[end];
      if (seat?.kind !== 'agent' || !seat.ready) continue;
      const id = seat.id;
      const ai = this.ai[end];
      const s = this.skill(id);
      const at = this.io.bodyAt(id) ?? ai.stand;
      let paddleAtNow: V3;
      const plan = ai.plan;
      if (serving === end) {
        ai.stand = fromOwn(end, 0.55, this.serve?.lat ?? 0);
        const sv = this.serve;
        const ball = this.body.translation();
        const hitAt = sv?.tossed ? sv.tossAt + (2 * TOSS.up) / PONG.gravity + 0.03 : this.t + 1;
        paddleAtNow = swingPaddle(end, { ...this.tossSpot(end), y: TOSS.hitY }, this.t, hitAt);
        if (!sv?.tossed) paddleAtNow = { ...readyPaddle(end, at), y: ball.y - 0.1 };
      } else if (plan?.contact && this.t >= plan.readyAt) {
        ai.stand = standFor(end, plan.contact.p);
        paddleAtNow = swingPaddle(end, plan.contact.p, this.t, plan.hitT);
      } else if (ai.metAt && this.t - ai.swungAt < 0.35) {
        paddleAtNow = swingPaddle(end, ai.metAt, this.t, ai.swungAt);
      } else {
        if (m.phase !== 'rally' || toHit(this.rally) !== end) ai.stand = fromOwn(end, READY.back, READY.lat);
        paddleAtNow = readyPaddle(end, at);
      }
      const mood = ai.mood && this.t < ai.mood.until ? ai.mood.gesture : null;
      if (ai.sayUntil && this.t > ai.sayUntil) {
        ai.sayUntil = 0;
        this.io.say?.(id, null);
      }
      setNpcPong(id, { x: ai.stand.x, z: ai.stand.z, heading: facing(end), speed: s.move, gesture: mood ?? 'paddle', paddle: mood ? null : paddleAtNow });
    }
  }

  /** The player's paddle: it rises and falls with an incoming ball by itself, and the autopilot (probe) plays for them. */
  private movePaddle(m: Match) {
    const end = ENDS.find((e) => m.seats[e]?.kind === 'player');
    if (!end) return;
    const ball = this.body.translation();
    const coming = this.live && (toHit(this.rally) === end || (halfAt(ball.x) !== end && this.rally.striker !== end));
    let y = TOP + 0.2;
    if (coming) y = Math.min(TOP + 0.95, Math.max(TOP + 0.06, ball.y));
    if (autopilot.on && this.playerPlan?.contact) {
      const c = this.playerPlan.contact;
      const o = ownFrame(end, c.p.x, c.p.z);
      // stand the paddle's plane just past where the ball will cross it, right on its line
      const k = 0.35;
      paddle.lat += (o.lat - paddle.lat) * k;
      paddle.back += (o.back + 0.015 - paddle.back) * k;
      y = c.p.y;
    } else if (autopilot.on && !coming) {
      paddle.lat *= 0.9;
      paddle.back += (0.25 - paddle.back) * 0.1;
    }
    paddle.y += (y - paddle.y) * (coming ? 0.5 : 0.15);
  }

  // ---------- the probe ----------

  /** Feeds `queue` balls at the player one at a time (they need to be at the table); each return is checked. */
  drill(queue: Drill['queue']) {
    const m = pongMatch();
    if (!m || !ENDS.some((e) => m.seats[e]?.kind === 'player')) return false;
    if (m.id !== this.matchId) this.newMatch(m);
    this.drillState = { queue: [...queue], results: [] };
    this.drilled = null;
    this.feedNext(m);
    return true;
  }

  private feedNext(m: Match) {
    const d = this.drillState;
    const you = ENDS.find((e) => m.seats[e]?.kind === 'player');
    if (!d || !you) return;
    const ball = d.queue.shift();
    if (!ball) {
      this.drilled = d.results;
      this.drillState = null;
      this.toServe(m);
      return;
    }
    const far = otherEnd(you);
    const from = { ...fromOwn(far, 0.25, ball.lat * 0.5), y: TOP + 0.28 };
    // a good ball every time: a feed that can't make it over at its pace goes a little quicker
    let sol = solveShot(from, far, { target: onHalf(you, ball.depth, ball.lat), speed: ball.speed, top: ball.top, side: ball.side });
    for (let i = 1; i <= 4 && !sol.land; i++) sol = solveShot(from, far, { target: onHalf(you, ball.depth, ball.lat), speed: ball.speed + 0.6 * i, top: ball.top, side: ball.side });
    this.parked = false;
    this.body.setTranslation(from, true);
    this.launch(sol.v, sol.w);
    this.rally = { striker: far, serving: false, served: true, bounces: 0, net: false, hits: 1 };
    this.lastEventT = this.t;
    this.inNet = false;
    this.prevP = { ...from };
    this.setPhase(m, 'rally');
    if (autopilot.on) this.playerPlan = this.read(you, false);
  }

  /** The probe asks for a serve now: the player's (as if they clicked) or the agent's. */
  serveNow() {
    const m = pongMatch();
    if (!m || m.phase !== 'serve') return false;
    const by = serverOf(m.game);
    if (m.seats[by]?.kind === 'player') m.ask = 'serve';
    else if (this.serve) this.serve.delay = 0;
    return true;
  }

  liveView(): PongLive {
    const p = this.body.translation();
    const v = this.body.linvel();
    const d = this.drillState;
    const len = Math.hypot(v.x, v.z);
    return {
      ball: this.parked ? null : { x: p.x, y: p.y, z: p.z, speed: Math.hypot(v.x, v.y, v.z), top: len > 1e-6 ? (this.b.w.x * v.z - this.b.w.z * v.x) / len : 0, side: -this.b.w.y, live: this.live },
      returns: { ...this.returns },
      drill: d ? { left: d.queue.length, results: [...d.results] } : this.drilled && { left: 0, results: [...this.drilled] },
      lastShot: this.lastShot,
      forced: this.forced,
    };
  }

  /** Stops everything (the floor is going away). */
  stop() {
    const m = pongMatch();
    for (const end of ENDS) {
      const id = agentOf(m?.seats[end] ?? null);
      if (id) setNpcPong(id, null);
    }
    this.park();
  }
}
