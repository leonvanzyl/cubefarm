// The rituals on the floor you're on, a frame at a time (Rituals.tsx mounts one per floor). ritualSchedule.ts
// decides; this carries it out: opens the stand-up's gathering and walks the CEO in to put up the new stickies, sends
// the CEO round the floor, turns lunch and the pizza on and off and sends for the courier, winds the floor down for
// the evening, sends idle people home and brings them back in the morning with a coffee. In the lobby it only sees
// the CEO off on their walks. Everything it moved is put back when the floor goes.

import { CEO_ID, type AgentStatus, type RepoView } from '../../../shared/types';
import { dayPart, standupLine } from '../../../shared/speech';
import { kanbanFor, useStore, type Agent } from '../store';
import { ding, noise } from '../ui/sfx';
import { playClip, speakLine } from '../ui/voicePlayback';
import type { Gesture } from './body';
import { headingFor, homeSpotId, isFree } from './errands';
import { closeGathering, openGathering, type Gathering } from './gathering';
import { GONG_SPOT, HALF_D } from './layout';
import { shade } from './materials';
import { meals, mealsChanged, resetMeals } from './meals';
import { bodyState, isSeated, placeBody, say, seatBody, setBody, setDeskMug, setHandMug, setHidden } from './people';
import { queueFidget } from './reactionFeed';
import { resetRitualLook, ritualLook } from './ritualLook';
import {
  AISLES,
  COURIER_DROP,
  PARKED,
  PRESENTER,
  SLICES,
  STANDUP_SPOTS,
  freshIssues,
  mergeTimes,
  newRitualState,
  nextWalkGap,
  officeClock,
  schedule,
  semicircle,
  stepEvening,
  walkHours,
  type Decision,
  type OfficeClock,
  type Ritual,
  type RitualState,
} from './ritualSchedule';
import { dayTime } from './sky/useDayTime';
import { CABIN, DOORS_SECONDS, shoulderSpot } from './socials';
import { Performer, type Cue } from './stage';
import { holdBackCards, presentSticky, showCards } from './StickyNotes';
import { roombaRound } from './toys/npc';
import { tintMug } from './toys/mugLook';
import { spot, walkways, type Walkways } from './walkways';

/** The pizza courier's id, as people.ts knows them while they're on the floor. */
export const COURIER_ID = 'pizza-courier';

// walkways.ts facings
const NORTH = -Math.PI / 2;
const SOUTH = Math.PI / 2;
const EAST = 0;
const BRISK = 1.5;
const HURRY = 1.9;
const DING_AT = { x: 0, y: 2.6, z: HALF_D };
/** A stand-up that hasn't finished in this long (s) is wrapped up: the stickies show, everyone goes back. */
const STANDUP_MAX = 100;

/**
 * Seconds of watching the office (the ritual clock: it runs while a floor or the lobby is drawn, and stops with the
 * render), and when on it the CEO's next walk is due: shared by every floor, so a walk stays "every so often" however
 * often you change floors.
 */
const shared = { watched: 0, walkAt: -1 };

const busy = (s: AgentStatus) => s === 'working' || s === 'preparing';
const round = (n: number) => Math.round(n * 100) / 100;
/** Eases `from` towards `to` in steps of 0.005 (DayLights only re-lights on a change), at least one step a frame. */
const ease = (from: number, to: number, k: number) => {
  if (Math.abs(to - from) <= 0.005) return to;
  const v = Math.round((from + (to - from) * k) * 200) / 200;
  return v !== from ? v : from + Math.sign(to - from) * 0.005;
};

interface LogEntry {
  t: number;
  what: string;
}

/** The office clock as the rituals see it: the sky's, unless QA pinned it or a forced ritual is playing out. */
interface Override {
  hour?: number;
  weekday?: number;
}

interface Forced extends Override {
  what: Ritual;
  /** The floor counts as idle meanwhile (a forced wind-down). */
  idle?: boolean;
  left: number;
}

function clockWith(o: Override | undefined | null, f: Forced | undefined): OfficeClock {
  const c = officeClock(Date.now(), dayTime.t, dayTime.mode);
  return { ...c, hour: f?.hour ?? o?.hour ?? c.hour, weekday: f?.weekday ?? o?.weekday ?? c.weekday };
}

/** A few claps from where someone stands, in time with their hands (Character.tsx's 'clap'). */
function applause(at: { x: number; z: number }, seconds: number) {
  for (let t = Math.random() * 0.12, first = true; t < seconds; t += 0.45, first = false)
    noise({ name: first ? 'ritual:clap' : undefined, group: 'typing', pos: { x: at.x, y: 1.25, z: at.z }, at: t, dur: 0.04, peak: 0.035, filter: 'bandpass', freq: 1500 + Math.random() * 900, q: 0.8, attack: 0.002 });
}

/** The CEO's line at a stand-up, in their voice when the phone's voice is on. Says how it went, for the probe. */
function sayStandupLine(count: number, hour: number, done: (how: string) => void) {
  const { settings, voiceKeySet, voiceSpeaking } = useStore.getState();
  const v = settings.voice;
  const part = dayPart(hour);
  if (v.provider === 'off') return done('off');
  if (voiceSpeaking !== null) return done('busy'); // a message is being read aloud: never talk over it
  if (v.provider === 'browser') {
    void speakLine(standupLine(count, part), v.voiceName).then((ok) => done(ok ? 'browser' : 'browser failed'));
    return;
  }
  if (!voiceKeySet) return done('no key');
  fetch(`/api/voice/standup?n=${count}&part=${part}`)
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((b) => playClip(b))
    .then((ok) => done(ok ? 'elevenlabs' : 'elevenlabs failed'))
    .catch(() => done('elevenlabs failed'));
}

/** A stand-up under way. */
interface Standup {
  /** The new issues' cards (`i-12`), in the order the CEO puts them up, how many are up, and how many were filed. */
  keys: string[];
  shown: number;
  count: number;
  g: Gathering;
  ceo: Performer;
  stage: 'coming' | 'line' | 'turn' | 'slap' | 'talk' | 'clap' | 'done';
  /** Seconds in this stage, and since it started. */
  t: number;
  age: number;
  /** Who nods along until when (age). */
  nods: Map<string, number>;
  voice: string;
}

// ---------- an office floor ----------

export class OfficeRitualRunner {
  readonly w: Walkways = walkways('office');
  readonly s: RitualState;
  /** Who's drawn as a visitor (Rituals.tsx re-renders through `onCast` when it changes). */
  readonly cast = { ceo: false, courier: false };
  onCast: () => void = () => {};
  standup: Standup | null = null;
  walk: { p: Performer; gong: boolean; host: string | null } | null = null;
  courier: Performer | null = null;
  /** Gone home for the night (out of sight at the back of the elevator), and who's on their way out or in. */
  readonly home = new Set<string>();
  readonly moving = new Map<string, { p: Performer; to: 'home' | 'desk' }>();
  /** QA's pinned clock (__swarmRituals.clock), and a forced ritual's clock, a stretch at a time. */
  pin: Override | null = null;
  forced: Forced[] = [];
  private lamps = 0;
  private dim = 0;
  private seen = new Set<number>();
  private first = true;
  private wait = 0.5;
  private busyAt = -Infinity;
  private nextOut = 0;
  private nextIn = 0;
  private mugs = 0;
  private later: { at: number; fn: () => void }[] = [];
  private log: LogEntry[] = [];
  /** The sky's own frozen phase (null: running) while a forced ritual holds it. */
  private sky: number | null | undefined = undefined;
  /** At home time: idle people kept in their chair (out of the errand director's hands) until it's their turn to go. */
  private readonly packing = new Set<string>();

  constructor(
    public repo: RepoView,
    public agents: Agent[],
  ) {
    if (shared.walkAt < 0) shared.walkAt = shared.watched + nextWalkGap(Math.random(), true);
    // a streak that was over before you arrived doesn't bring the CEO
    this.s = newRitualState(shared.walkAt, Math.max(0, ...mergeTimes(repo.pulls)));
  }

  /** Does `fn` this many seconds from now on the ritual clock. */
  after(seconds: number, fn: () => void) {
    this.later.push({ at: shared.watched + seconds, fn });
  }

  clock(): OfficeClock {
    return clockWith(this.pin, this.forced[0]);
  }

  /** A forced ritual turns the sky to its hour too, so it looks the part; the sky's own clock comes back after. */
  private skyForForced() {
    const f = this.forced[0];
    if (f?.hour !== undefined) {
      if (this.sky === undefined) this.sky = dayTime.frozen;
      dayTime.frozen = f.hour / 24;
    } else if (this.sky !== undefined) {
      dayTime.frozen = this.sky;
      this.sky = undefined;
    }
  }

  private note(what: string) {
    this.log.push({ t: round(shared.watched), what });
    if (this.log.length > 60) this.log.splice(0, this.log.length - 60);
  }

  /** What a frame of the rituals costs (ms, a running average and the worst lately), for the probe. */
  private cost = { avg: 0, max: 0 };

  /** One frame (`dt` seconds of the director's kind of clock: 0 straight after a pause). */
  tick(dt: number) {
    const t0 = performance.now();
    this.frame(dt);
    const ms = performance.now() - t0;
    this.cost.avg += (ms - this.cost.avg) * 0.02;
    this.cost.max = Math.max(ms, this.cost.max * 0.995);
  }

  private frame(dt: number) {
    shared.watched += dt;
    const now = shared.watched;
    for (let i = this.later.length - 1; i >= 0; i--) {
      if (this.later[i].at > now) continue;
      const { fn } = this.later[i];
      this.later.splice(i, 1);
      fn();
    }
    if (this.forced.length && (this.forced[0].left -= dt) <= 0) {
      this.forced.shift();
      this.skyForForced();
    }
    if (this.standup) this.stepStandup(dt);
    if (this.walk && !this.walk.p.tick(dt)) {
      this.walk = null;
      this.ceoGone();
    }
    if (this.courier && !this.courier.tick(dt)) this.courierGone();
    for (const [id, m] of this.moving) if (!m.p.tick(dt)) this.moving.delete(id);
    const k = 1 - Math.exp(-dt * 0.8);
    ritualLook.lamps = ease(ritualLook.lamps, this.lamps, k);
    ritualLook.dim = ease(ritualLook.dim, this.dim, k);
    if ((this.wait -= dt) > 0) return;
    this.wait = 0.5;
    this.look(now);
  }

  /** Every half second: what's new on the floor, and what the scheduler makes of it. */
  private look(now: number) {
    const fresh = freshIssues(
      this.seen,
      this.repo.issues.map((i) => i.number),
    );
    if (!this.first) {
      const st = this.standup;
      for (const n of fresh) {
        this.note(`issue #${n} is new`);
        // filed while the CEO is still on the way to the board: it's in this stand-up too
        if (st && (st.stage === 'coming' || st.stage === 'line')) {
          st.keys.push(`i-${n}`);
          st.count++;
          holdBackCards([`i-${n}`]);
        } else this.s.fresh.push({ n, at: now });
      }
    }
    if (this.agents.some((a) => busy(a.status))) this.busyAt = now;
    const idleFor = this.forced[0]?.idle ? Infinity : now - this.busyAt;
    const clock = this.clock();
    if (this.first) this.settle(clock, idleFor);
    this.first = false;
    const ceo = useStore.getState().agents[CEO_ID];
    const decisions = schedule(this.s, {
      now,
      wall: Date.now(),
      clock,
      idleFor,
      ceoFree: !!ceo && isFree(ceo.status),
      ceoOn: this.standup ? 'standup' : this.walk ? 'walk' : null,
      merged: mergeTimes(this.repo.pulls),
      rand: Math.random,
    });
    shared.walkAt = this.s.walkAt;
    for (const d of decisions) this.apply(d, now);
    this.upkeep(now);
  }

  /** Arriving on the floor in the evening: it's already as the evening left it, nobody walks anywhere. */
  private settle(clock: OfficeClock, idleFor: number) {
    let phase = this.s.evening;
    for (let i = 0; i < 3; i++) phase = stepEvening(phase, clock.hour, idleFor).phase;
    this.s.evening = phase;
    if (phase === 'day') return;
    this.lamps = this.dim = ritualLook.lamps = ritualLook.dim = 1;
    if (phase === 'home') for (const a of this.agents) if (isFree(a.status) && isSeated(a.id)) this.park(a.id);
    this.note(`arrived in the evening (${phase})`);
  }

  private apply(d: Decision, now: number) {
    switch (d.do) {
      case 'standup':
        return this.startStandup(d.issues, d.issues.length);
      case 'ceo-walk':
        return this.startWalk(d.gong);
      case 'pizza':
        return this.sendCourier();
      case 'lunch':
        meals.lunch = d.on;
        if (d.on) meals.ate.clear();
        mealsChanged();
        return this.note(d.on ? 'lunch time' : 'lunch is over');
      case 'winddown':
        return this.windDown();
      case 'home':
        this.clearPizza();
        this.nextOut = now + 1;
        return this.note('home time: idle people head home');
      case 'morning':
        return this.morning(now);
    }
  }

  // ---------- the stand-up ----------

  private startStandup(issues: number[], count: number) {
    // out on a walk round the floor: the CEO goes straight to the board instead
    const here = !!this.walk && this.cast.ceo;
    this.walk = null;
    const open = new Set(this.repo.issues.map((i) => i.number));
    const keys = issues.filter((n) => open.has(n)).map((n) => `i-${n}`);
    holdBackCards(keys);
    const g = openGathering({ name: 'standup', floor: 'office', spots: semicircle(PRESENTER, STANDUP_SPOTS), welcome: (a) => a.role !== 'ceo' });
    const lift = spot(this.w, 'elevator')!;
    const st: Standup = { keys, shown: 0, count: Math.max(1, count), g, stage: 'coming', t: 0, age: 0, nods: new Map(), voice: '', ceo: null as unknown as Performer };
    g.gestureOf = (id) => ((st.nods.get(id) ?? -1) > st.age ? 'nod' : null);
    const arrive: Cue[] = here
      ? [{ run: () => say(CEO_ID, null) }]
      : [{ place: CABIN, face: NORTH }, { run: () => ding(DING_AT) }, { hold: DOORS_SECONDS }, { walk: lift, straight: true, speed: BRISK }];
    st.ceo = new Performer(CEO_ID, this.w, [
      ...arrive,
      { walk: PRESENTER, face: SOUTH, speed: BRISK },
      // a wave while the last of the team gathers
      { until: () => st.g.seats.size > 0 && [...st.g.seats.keys()].every((id) => st.g.there.has(id)), max: 6, face: SOUTH, gesture: 'wave' },
      { run: () => this.present(st) },
      { wait: () => st.stage === 'done' },
      { hold: 0.9, face: SOUTH, gesture: 'wave' },
      { walk: lift, speed: BRISK },
      { walk: CABIN, straight: true },
    ]);
    this.standup = st;
    this.showCeo();
    this.note(`stand-up: ${keys.join(', ') || 'nothing left to put up'}`);
  }

  private present(st: Standup) {
    st.stage = 'line';
    st.t = 0;
    st.g.open = false; // whoever's on their way still comes; nobody else sets off
    say(CEO_ID, '📋');
    sayStandupLine(st.count, this.clock().hour, (how) => {
      st.voice = how;
      this.note(`the CEO's line: ${how}`);
    });
  }

  private stepStandup(dt: number) {
    const st = this.standup!;
    st.age += dt;
    st.t += dt;
    if (!st.ceo.tick(dt) || st.age > STANDUP_MAX) return this.endStandup();
    const stand = (face: number, gesture: Gesture) => setBody(CEO_ID, { mode: 'standing', x: PRESENTER.x, z: PRESENTER.z, heading: headingFor(face), gesture });
    const next = () => {
      st.t = 0;
      if (st.shown < st.keys.length) {
        st.stage = 'turn';
        say(CEO_ID, null);
        return;
      }
      st.stage = 'clap';
      st.g.gesture = 'clap';
      say(CEO_ID, '👏');
      for (const id of st.g.there) {
        const b = bodyState(id);
        if (b) applause(b, 2.6);
      }
    };
    switch (st.stage) {
      case 'line':
        stand(SOUTH, 'talk');
        if (st.t >= 2.4) next();
        return;
      case 'turn':
        stand(NORTH, 'none');
        if (st.t < 0.35) return;
        // up goes the hand, and the sticky flies from it onto the Backlog column
        stand(NORTH, 'post');
        presentSticky(CEO_ID, st.keys[st.shown++]);
        for (const id of st.g.there) if (Math.random() < 0.75) st.nods.set(id, st.age + 0.9 + Math.random() * 0.8);
        st.stage = 'slap';
        st.t = 0;
        return;
      case 'slap':
        stand(NORTH, 'post');
        if (st.t >= 0.8) {
          st.stage = 'talk';
          st.t = 0;
        }
        return;
      case 'talk':
        stand(SOUTH, 'talk');
        if (st.t >= 0.9) next();
        return;
      case 'clap':
        stand(SOUTH, 'cheer');
        if (st.t < 2.8) return;
        st.stage = 'done';
        closeGathering(st.g);
        say(CEO_ID, null);
        this.note('stand-up over');
        return;
    }
  }

  private endStandup() {
    const st = this.standup;
    if (!st) return;
    this.standup = null;
    closeGathering(st.g);
    showCards(st.keys);
    this.ceoGone();
  }

  // ---------- the CEO's walk ----------

  private startWalk(gong: boolean) {
    const lift = spot(this.w, 'elevator')!;
    const working = this.agents.filter((a) => a.role === 'dev' && a.status === 'working');
    const host = working.length ? working[Math.floor(Math.random() * working.length)] : null;
    const desk = host && spot(this.w, `desk-${host.desk}`);
    const aisles = [...AISLES].sort(() => Math.random() - 0.5);
    const cues: Cue[] = [
      { place: CABIN, face: NORTH },
      { run: () => ding(DING_AT) },
      { hold: DOORS_SECONDS },
      { walk: lift, straight: true },
      { walk: aisles[0] },
      { hold: 1.4, face: aisles[1].x < aisles[0].x ? Math.PI : EAST },
      { walk: aisles[1] },
    ];
    if (host && desk) {
      // behind someone hard at work: a look at their screen, and a thumbs-up
      cues.push(
        { walk: shoulderSpot({ id: host.id, role: host.role, status: host.status, home: desk }), face: NORTH },
        { hold: 2.4, face: NORTH },
        { run: () => say(CEO_ID, '👍') },
        { hold: 1.8, face: NORTH, gesture: 'thumbs' },
        { run: () => say(CEO_ID, null) },
      );
    }
    if (gong) cues.push({ walk: GONG_SPOT, face: NORTH }, { run: () => say(CEO_ID, '🎉') }, { hold: 1.8, face: NORTH, gesture: 'cheer' }, { run: () => say(CEO_ID, null) });
    cues.push({ walk: lift }, { walk: CABIN, straight: true });
    this.walk = { p: new Performer(CEO_ID, this.w, cues), gong, host: host?.id ?? null };
    this.showCeo();
    this.note(`the CEO walks the floor${host ? `, watching ${host.name}` : ''}${gong ? ', by the gong' : ''}`);
  }

  private showCeo() {
    this.cast.ceo = true;
    this.onCast();
  }

  /** The CEO's back in the elevator: not drawn here any more, and seated for the lobby. */
  private ceoGone() {
    seatBody(CEO_ID);
    say(CEO_ID, null);
    this.cast.ceo = false;
    this.onCast();
  }

  // ---------- Friday pizza ----------

  private sendCourier() {
    if (this.courier) return;
    const lift = spot(this.w, 'elevator')!;
    this.courier = new Performer(COURIER_ID, this.w, [
      { place: CABIN, face: NORTH },
      { run: () => ding(DING_AT) },
      { hold: DOORS_SECONDS, gesture: 'hold' },
      { walk: lift, straight: true, speed: BRISK, gesture: 'hold' },
      { walk: COURIER_DROP, face: COURIER_DROP.facing, speed: BRISK, gesture: 'hold' },
      { hold: 0.3, gesture: 'hold' },
      // the boxes go from their hands onto the table
      { run: () => this.pizzaArrives() },
      { hold: 0.9, gesture: 'stoop' },
      { run: () => say(COURIER_ID, '🍕') },
      { hold: 1.6, face: EAST, gesture: 'wave' },
      { run: () => say(COURIER_ID, null) },
      { walk: lift, speed: BRISK },
      { walk: CABIN, straight: true },
    ]);
    this.cast.courier = true;
    this.onCast();
    this.note('pizza is on its way up');
  }

  private pizzaArrives() {
    Object.assign(meals, { pizza: true, slices: SLICES });
    meals.had.clear();
    ritualLook.pizza = true;
    mealsChanged();
    noise({ name: 'ritual:pizza', group: 'typing', pos: { x: COURIER_DROP.x - 1, y: 0.5, z: COURIER_DROP.z }, dur: 0.08, peak: 0.05, freq: 700, q: 0.7, attack: 0.002 });
    this.note('pizza is on the coffee table');
  }

  private courierGone() {
    this.courier = null;
    seatBody(COURIER_ID);
    say(COURIER_ID, null);
    this.cast.courier = false;
    this.onCast();
  }

  private clearPizza() {
    if (!meals.pizza) return;
    Object.assign(meals, { pizza: false, slices: 0 });
    meals.had.clear();
    ritualLook.pizza = false;
    mealsChanged();
  }

  // ---------- the evening ----------

  private windDown() {
    this.lamps = this.dim = 1;
    if (roombaRound()) this.note("the roomba's evening round");
    for (const a of this.agents) {
      if (!isFree(a.status) || !isSeated(a.id)) continue;
      const r = Math.random();
      const fidget = r < 0.45 ? 'stretch' : r < 0.8 ? 'leanBack' : null;
      if (fidget) this.after(Math.random() * 6, () => queueFidget(a.id, fidget));
    }
    this.note('winding down: lamps on, lights down');
  }

  private morning(now: number) {
    this.lamps = this.dim = 0;
    this.nextIn = now + 1;
    this.note(`morning: lights up${this.home.size ? `, ${this.home.size} coming in` : ''}`);
  }

  /**
   * Every look: anyone home who has work now comes straight in, and by day the rest come in one by one with a coffee;
   * at home time the idle ones pack up and go, a few at a time.
   */
  private upkeep(now: number) {
    for (const id of [...this.home]) {
      const a = this.agents.find((x) => x.id === id);
      if (!a) this.unpark(id);
      else if (!isFree(a.status) && !this.moving.has(id)) this.comeIn(a, false);
      else if (this.s.evening === 'day' && now >= this.nextIn && !this.moving.has(id)) {
        this.comeIn(a, true);
        this.nextIn = now + 2.8;
      }
    }
    // winding down: now and then someone leans back
    if (this.s.evening === 'winddown' && Math.random() < 0.05) {
      const idle = this.agents.filter((a) => isFree(a.status) && isSeated(a.id));
      if (idle.length) queueFidget(idle[Math.floor(Math.random() * idle.length)].id, 'leanBack');
    }
    // packed up and waiting to go, then given work: back to it
    for (const id of [...this.packing]) {
      const a = this.agents.find((x) => x.id === id);
      if (a && isFree(a.status) && this.s.evening === 'home') continue;
      this.packing.delete(id);
      seatBody(id);
    }
    if (this.s.evening !== 'home') return;
    // home time: everyone idle at their desk packs up (the errand director lets them be), then they go, a few at a time
    for (const a of this.agents) {
      if (!isFree(a.status) || !isSeated(a.id) || this.home.has(a.id) || this.moving.has(a.id)) continue;
      setBody(a.id, { mode: 'seated' });
      this.packing.add(a.id);
    }
    if (now < this.nextOut || [...this.moving.values()].filter((m) => m.to === 'home').length >= 3) return;
    const id = this.packing.values().next().value;
    const a = id && this.agents.find((x) => x.id === id);
    if (!a) return;
    this.packing.delete(a.id);
    this.goHome(a);
    this.nextOut = now + 1.2 + Math.random();
  }

  private goHome(a: Agent) {
    const lift = spot(this.w, 'elevator')!;
    const p = new Performer(a.id, this.w, [{ walk: lift }, { walk: CABIN, straight: true }, { run: () => this.park(a.id) }]);
    this.moving.set(a.id, { p, to: 'home' });
    this.note(`${a.name} heads home`);
  }

  /** Out of sight at the back of the elevator until the morning (or until there's work). */
  private park(id: string) {
    setHidden(id, true);
    placeBody(id, PARKED.x, PARKED.z, 0);
    this.home.add(id);
  }

  private unpark(id: string) {
    setHidden(id, false);
    seatBody(id);
    this.home.delete(id);
  }

  /** In by the elevator and back to their desk: with a coffee in the morning, briskly when there's work. */
  private comeIn(a: Agent, coffee: boolean) {
    const lift = spot(this.w, 'elevator')!;
    const home = spot(this.w, homeSpotId('office', a) ?? '');
    if (!home) return this.unpark(a.id);
    const mug = coffee ? { id: `mug-${a.id}-${++this.mugs}`, sips: 3 } : null;
    if (mug) tintMug(mug.id, shade(a.color, 0.1));
    const gesture: Gesture = mug ? 'mug' : 'none';
    const speed = coffee ? undefined : HURRY;
    const p = new Performer(a.id, this.w, [
      {
        run: () => {
          setHidden(a.id, false);
          this.home.delete(a.id);
        },
      },
      { place: CABIN, face: NORTH },
      {
        run: () => {
          ding(DING_AT);
          if (mug) setHandMug(a.id, mug);
        },
      },
      { hold: DOORS_SECONDS, gesture },
      { walk: lift, straight: true, speed, gesture },
      { walk: home, face: home.facing, speed, gesture },
      { run: () => seatBody(a.id) },
      { wait: () => bodyState(a.id)?.stage === 'seated', max: 8 },
      {
        run: () => {
          if (!mug) return;
          setHandMug(a.id, null);
          setDeskMug(a.id, mug, 120);
        },
      },
    ]);
    this.moving.set(a.id, { p, to: 'desk' });
    this.note(`${a.name} comes in${coffee ? ' with a coffee' : ' to work'}`);
  }

  // ---------- QA ----------

  /** Starts a ritual now, whatever the clock says. False when it can't (the CEO is busy with another). */
  force(kind: Ritual): boolean {
    this.note(`forced: ${kind}`);
    switch (kind) {
      case 'standup': {
        if (this.standup) return false;
        const backlog = kanbanFor(this.repo, this.agents, useStore.getState().qa).backlog.map((c) => c.number);
        const issues = backlog.sort((a, b) => b - a).slice(0, 3);
        this.s.standupAt = shared.watched;
        this.startStandup(issues, issues.length);
        return true;
      }
      case 'ceo-walk':
        if (this.standup || this.walk) return false;
        this.startWalk(true);
        return true;
      case 'pizza':
        this.s.pizza = this.clock().day;
        this.sendCourier();
        return true;
      case 'lunch':
        this.forced = [{ what: kind, hour: 12.25, left: 150 }];
        this.skyForForced();
        return true;
      case 'winddown':
        // the evening at a gallop: winding down, home time, then the morning after
        this.forced = [
          { what: kind, hour: 19.5, idle: true, left: 30 },
          { what: kind, hour: 23, idle: true, left: 45 },
          { what: kind, hour: 8.25, left: 25 },
        ];
        this.skyForForced();
        return true;
    }
  }

  state() {
    const c = this.clock();
    const st = this.standup;
    return {
      floor: this.repo.id,
      watched: round(shared.watched),
      clock: { hour: round(c.hour), weekday: c.weekday, day: c.day, forced: this.forced[0]?.what ?? null, pinned: this.pin },
      evening: this.s.evening,
      lamps: ritualLook.lamps,
      dim: ritualLook.dim,
      lunch: { on: meals.lunch, ate: [...meals.ate], eating: Object.fromEntries(meals.spots) },
      pizza: { out: meals.pizza, slices: meals.slices, had: [...meals.had], day: this.s.pizza, courier: this.courier ? this.courier.at : null },
      standup: st && {
        stage: st.stage,
        cards: st.keys,
        shown: st.shown,
        attendees: [...st.g.seats.keys()],
        there: [...st.g.there],
        came: [...st.g.came],
        age: round(st.age),
        voice: st.voice,
      },
      ceoWalk: this.walk && { cue: this.walk.p.at, gong: this.walk.gong, host: this.walk.host },
      nextCeoWalkIn: round(this.s.walkAt - shared.watched),
      fresh: this.s.fresh.map((f) => f.n),
      home: [...this.home],
      packing: [...this.packing],
      moving: [...this.moving].map(([id, m]) => ({ id, to: m.to })),
      cast: { ...this.cast },
      frameMs: { avg: Math.round(this.cost.avg * 1000) / 1000, max: round(this.cost.max) },
      log: [...this.log],
    };
  }

  /** The floor went away: everyone back in their chair and in sight, the board as it is, nothing on. */
  dispose() {
    if (this.standup) closeGathering(this.standup.g);
    this.standup = null;
    showCards();
    this.forced = [];
    this.skyForForced();
    for (const id of new Set([...this.home, ...this.moving.keys(), ...this.packing])) {
      setHidden(id, false);
      setHandMug(id, null);
      seatBody(id);
    }
    for (const id of [CEO_ID, COURIER_ID]) {
      seatBody(id);
      say(id, null);
    }
    resetMeals();
    resetRitualLook();
  }
}

// ---------- the lobby ----------

/** The lobby's part: now and then the CEO gets up from their desk and takes the elevator for a walk round the floors. */
export class LobbyRitualRunner {
  readonly w: Walkways = walkways('lobby');
  pin: Override | null = null;
  private p: Performer | null = null;
  private out = false;
  private awayFor = 0;
  private away = 0;
  private wait = 0.5;
  private log: LogEntry[] = [];
  private later: { at: number; fn: () => void }[] = [];

  constructor() {
    if (shared.walkAt < 0) shared.walkAt = shared.watched + nextWalkGap(Math.random(), true);
  }

  after(seconds: number, fn: () => void) {
    this.later.push({ at: shared.watched + seconds, fn });
  }

  tick(dt: number) {
    shared.watched += dt;
    const due = this.later.filter((l) => l.at <= shared.watched);
    if (due.length) this.later = this.later.filter((l) => l.at > shared.watched);
    for (const l of due) l.fn();
    if (this.out) this.away += dt;
    if (this.p && !this.p.tick(dt)) this.p = null;
    if ((this.wait -= dt) > 0) return;
    this.wait = 0.5;
    const ceo = useStore.getState().agents[CEO_ID];
    if (this.p || !ceo || shared.watched < shared.walkAt) return;
    if (walkHours(clockWith(this.pin, undefined).hour) && isFree(ceo.status) && isSeated(CEO_ID)) this.leave();
  }

  private leave() {
    shared.walkAt = shared.watched + nextWalkGap(Math.random());
    const lift = spot(this.w, 'elevator')!;
    const desk = spot(this.w, 'ceo')!;
    const status = () => useStore.getState().agents[CEO_ID]?.status ?? 'idle';
    this.awayFor = 35 + Math.random() * 40;
    this.p = new Performer(CEO_ID, this.w, [
      { walk: lift },
      { walk: CABIN, straight: true },
      {
        run: () => {
          setHidden(CEO_ID, true);
          placeBody(CEO_ID, PARKED.x, PARKED.z, 0);
          this.out = true;
          this.away = 0;
          this.note('the CEO is off round the floors');
        },
      },
      // back after a while, or as soon as there's work for them
      { wait: () => this.away >= this.awayFor || busy(status()) },
      {
        run: () => {
          setHidden(CEO_ID, false);
          this.out = false;
        },
      },
      { place: CABIN, face: NORTH },
      { run: () => ding(DING_AT) },
      { hold: DOORS_SECONDS },
      { walk: lift, straight: true },
      { walk: desk, face: desk.facing },
      { run: () => seatBody(CEO_ID) },
      { wait: () => bodyState(CEO_ID)?.stage === 'seated', max: 8 },
      { run: () => this.note('the CEO is back at their desk') },
    ]);
    this.note('the CEO gets up for a walk');
  }

  private note(what: string) {
    this.log.push({ t: round(shared.watched), what });
    if (this.log.length > 30) this.log.splice(0, this.log.length - 30);
  }

  force(kind: Ritual): boolean {
    if (kind !== 'ceo-walk' || this.p || !isSeated(CEO_ID)) return false;
    this.leave();
    return true;
  }

  state() {
    const c = clockWith(this.pin, undefined);
    return {
      floor: 'lobby',
      watched: round(shared.watched),
      clock: { hour: round(c.hour), weekday: c.weekday, day: c.day, forced: null, pinned: this.pin },
      ceoOut: this.out,
      ceoWalk: this.p ? { cue: this.p.at } : null,
      nextCeoWalkIn: round(shared.walkAt - shared.watched),
      log: [...this.log],
    };
  }

  dispose() {
    setHidden(CEO_ID, false);
    seatBody(CEO_ID);
  }
}
