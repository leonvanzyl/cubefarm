import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { AgentStatus } from '../../../shared/types';
import { useRenderPaused } from '../perf';
import { useStore, type Agent } from '../store';
import { ding } from '../ui/sfx';
import { WALK_SPEED, type Gesture } from './body';
import './coffeeErrand';
import {
  HURRY_SPEED,
  admit,
  MAX_WALKERS,
  PASS,
  QUEUE_SECONDS,
  choose,
  enqueue,
  errandNamed,
  errands,
  headingFor,
  homeSpotId,
  isFree,
  mayContinue,
  mayStart,
  nextWaypoint,
  pickSpot,
  prune,
  restlessSeconds,
  spotChoices,
  wanted,
  type Errand,
  type ErrandActor,
  type ErrandPeer,
  type ErrandScript,
  type ErrandState,
  type Me,
  type Queued,
} from './errands';
import { planTour, stepOut, tourScript, waverFor } from './hiring';
import { takeWelcome, tourAt, tourEnded, tourStarted } from './hiringState';
import { HALF_D } from './layout';
import { bodyState, bodyTarget, isSeated, onClaim, placeBody, say, seatBody, setBody, setErrand, takeAsk, trackDirector } from './people';
import { queueFidget } from './reactionFeed';
import { ARRIVE, CABIN, CHAT, CHAT_VENUES, DOORS_SECONDS, LEAVE, arrivalPath, exitPath, floorNews, headingTo, huddle, nearest, pickTopic, planChat } from './socials';
import { countPoke, npcRoomba } from './toys/npc';
import { pokeToy } from './toys/poke';
import './toyErrands';
import './roof/roofErrand';
import type { Pt } from './toys/roombaBrain';
import { findPath, spot as spotById, standable, steer, walkways, type Body, type FloorKind, type Spot } from './walkways';

// The errand director: sends the people on the floor you're on out on errands (errands.ts) and back, a few at a
// time. It runs in the render loop, so it pauses with the render (hidden tab, full-screen panel) and nothing piles
// up meanwhile, and it starts fresh, everyone at their desk, each time you arrive on a floor. It also runs the
// comings and goings (socials.ts): hires stepping out of the elevator for their welcome tour (hiring.ts), `leavers`
// walking out with a box, and chats.

type Phase = 'seated' | 'leaving' | 'there' | 'returning' | 'sitting' | 'exiting';

/** The people in one chat, while they're still in it. */
interface Chat {
  ids: Set<string>;
}

interface Person {
  id: string;
  home: Spot;
  status: AgentStatus;
  /** Director-clock seconds: when their status last changed, when they last sat down. */
  statusAt: number;
  seatedAt: number;
  restless: number;
  roll: number;
  queue: Queued[];
  phase: Phase;
  phaseAt: number;
  errand: Errand | null;
  dest: Spot | null;
  path: Pt[];
  wp: number;
  step: number;
  stepLeft: number;
  hurry: boolean;
  /** Runs an errand with an `act` once there; the spot it last sent them to, and whether they've got there. */
  actor: ErrandActor | null;
  walking: string | null;
  arrived: boolean;
  /** Seconds held up behind another walker, and seconds left walking through them once that lasted too long. */
  waited: number;
  ghost: number;
  /** A scripted errand (Errand.script) while it runs, where its last walk is going (`arrived` above), and where it stands still. */
  script: ErrandScript | null;
  goal: Pt | null;
  pin: Pt;
  walkFace: number;
  /** Seconds left of stopping to poke the roomba, and whether they're near it already (one chance per pass). */
  poke: number;
  byRoomba: boolean;
  /** Seconds to stand still before setting off (a new hire, while the elevator doors open). */
  hold: number;
  chat: Chat | null;
  /** Walked into the elevator: waiting for the floor to stop drawing them. */
  gone: boolean;
}

const TICK = 0.5; // seconds between "who wants to go?" checks
const CARROT = 0.8; // how far ahead (m) a steered walker aims
const GIVE_UP = { leaving: 45, returning: 60, acting: 180, script: 240 }; // seconds before a walk (or an actor or script) that got stuck is cut short
// Walking past the roomba while it's out cleaning: sometimes they stop and poke it (as E does), at most every `gap` s.
const POKE = { reach: 1.3, chance: 0.6, seconds: 1.5, at: 0.45, gap: 20 };
const SETTLE = 1.5; // seconds on a floor before someone new counts as a hire walking in, not already there
const FOLLOW_HOLD = 2.5; // seconds a hire who rode up just behind you waits in the cabin, so you're out of the doorway

/** A new hire's welcome tour: a scripted errand (hiring.ts) from the elevator round the floor, then their desk. */
const TOUR: Errand = {
  name: 'tour',
  when: () => false, // the director starts it when someone joins the floor
  spot: [],
  steps: [],
  speed: 1.35, // a brisk tour: it crosses the whole floor
  end: (id, how) => tourEnded(id, how),
};
const CHAT_WAIT = 10; // seconds the first at a chat waits for the others before starting

export function ErrandDirector({
  floor,
  agents,
  leavers,
  onGone,
  repoId,
}: {
  floor: FloorKind;
  agents: Agent[];
  /** People just let go, still drawn at their old desk until they've walked out (they then call onGone). */
  leavers?: Agent[];
  onGone?: (id: string) => void;
  /** The floor's repo, for what chats are about. */
  repoId?: string;
}) {
  const camera = useThree((s) => s.camera);
  const paused = useRenderPaused();
  const w = walkways(floor);
  const people = useMemo(() => new Map<string, Person>(), []);
  const latest = useRef(agents);
  latest.current = agents;
  const gone = useRef(onGone);
  gone.current = onGone;
  const run = useMemo(() => ({ clock: 0, tick: 0, fresh: true, lastChat: -20, walkers: [] as Body[], pokeAt: 0 }), []);
  const me = useMemo<Me>(() => ({ id: '', x: 0, z: 0, heading: 0, arrived: false, dt: 0, player: { x: 0, z: 0 } }), []);

  // After a pause, the first frame's delta covers the whole gap: skip it.
  useEffect(() => {
    if (!paused) run.fresh = true;
  }, [paused, run]);

  const report = (p: Person) => setErrand(p.id, p.errand && p.dest ? { name: p.errand.name, phase: p.phase, spot: p.dest.id } : null);

  const walk = (p: Person, phase: Phase, errand: Errand, dest: Spot, path: Pt[]) => {
    Object.assign(p, { phase, phaseAt: run.clock, errand, dest, path, wp: 0, hurry: false, waited: 0, ghost: 0, hold: 0 });
    report(p);
  };

  /** A teammate at their desk near `at` waves to the new hire `p` there; where they sit, to wave back at (or null). */
  const welcomeWave = (p: Person, at: Pt): Pt | null => {
    const seated: (Pt & { id: string })[] = [];
    for (const o of people.values()) {
      const b = o.id !== p.id && !o.gone && o.phase === 'seated' ? bodyState(o.id) : undefined;
      if (b?.stage === 'seated') seated.push({ id: o.id, x: b.seatX, z: b.seatZ });
    }
    const t = waverFor(p.id, at, seated);
    if (t) queueFidget(t.id, 'wave', at.x, at.z);
    return t;
  };

  /**
   * A new hire: stood in the elevator, which dings, then out on a welcome tour (the whiteboard, the coffee machine and
   * the gong, a teammate waving at each) and to their desk; straight to it, briskly, if work is already waiting.
   */
  const arrive = (p: Person, hold = DOORS_SECONDS) => {
    const lift = spotById(w, 'elevator');
    if (!lift) return;
    if (isFree(p.status)) {
      const stops = planTour(w, lift);
      placeBody(p.id, CABIN.x, CABIN.z, 0);
      walk(p, 'leaving', TOUR, lift, [{ x: lift.x, z: lift.z }]); // the step out is decided as the doors open
      p.script = tourScript(stops, { arrive: (_, at) => welcomeWave(p, at), progress: (stop) => tourAt(p.id, stop) });
      tourStarted(p.id, stops);
    } else {
      const path = arrivalPath(w, lift, p.home);
      if (!path) return;
      placeBody(p.id, CABIN.x, CABIN.z, 0);
      walk(p, 'leaving', ARRIVE, p.home, path);
      p.hurry = true;
      tourEnded(p.id, 'straight');
    }
    p.hold = hold;
    ding({ x: 0, y: 2.6, z: HALF_D });
  };

  /** Let go: up to the spot behind their chair to pick up a box (then out: see 'there'). */
  const depart = (p: Person) => {
    endScript(p); // let go of a toy first
    p.queue = [];
    walk(p, 'leaving', LEAVE, p.home, [{ x: p.home.x, z: p.home.z }]);
  };

  // Who is on this floor (and has a desk to come back to), and who is on their way out.
  useEffect(() => {
    const seen = new Set<string>();
    const out = new Set((leavers ?? []).map((a) => a.id));
    for (const a of [...agents, ...(leavers ?? [])]) {
      const id = homeSpotId(floor, a);
      const home = id ? spotById(w, id) : undefined;
      if (!home) {
        if (out.has(a.id)) gone.current?.(a.id);
        continue;
      }
      seen.add(a.id);
      const p = people.get(a.id);
      if (p) {
        if (out.has(a.id) && p.errand !== LEAVE) depart(p);
        else if (p.phase === 'seated') p.home = home;
        continue;
      }
      // Someone new while you're here, or hired a moment ago and you've just come up after them (from the lobby, say).
      const due = !out.has(a.id) && takeWelcome(a.id);
      const hire = !out.has(a.id) && (due || run.clock > SETTLE);
      seatBody(a.id); // start fresh: whatever the last visit left behind, they're at their desk
      setErrand(a.id, null);
      say(a.id, null);
      const np: Person = {
        id: a.id,
        home,
        status: a.status,
        statusAt: run.clock,
        seatedAt: run.clock,
        restless: restlessSeconds(Math.random(), true),
        roll: Math.random(),
        queue: [],
        phase: 'seated',
        phaseAt: run.clock,
        errand: null,
        dest: null,
        path: [],
        wp: 0,
        step: 0,
        stepLeft: 0,
        hurry: false,
        actor: null,
        walking: null,
        arrived: false,
        waited: 0,
        ghost: 0,
        script: null,
        goal: null,
        pin: { x: 0, z: 0 },
        walkFace: 0,
        poke: 0,
        byRoomba: false,
        hold: 0,
        chat: null,
        gone: false,
      };
      people.set(a.id, np);
      if (out.has(a.id)) depart(np);
      else if (hire) arrive(np, run.clock > SETTLE ? DOORS_SECONDS : FOLLOW_HOLD);
    }
    for (const [id, p] of people) {
      if (seen.has(id)) continue;
      if (p.errand === TOUR && p.phase !== 'seated') tourEnded(id, 'cut');
      endScript(p);
      p.actor?.abort();
      p.actor?.end(false);
      seatBody(id);
      setErrand(id, null);
      say(id, null);
      people.delete(id);
    }
  }, [agents, leavers, floor, w, people, run]);

  // Leaving the floor: everyone back in their chair for next time.
  useEffect(
    () => () => {
      for (const [id, p] of people) {
        if (p.errand === TOUR && p.phase !== 'seated') tourEnded(id, 'cut');
        endScript(p);
        p.actor?.end(false);
        seatBody(id);
        setErrand(id, null);
        say(id, null);
      }
      people.clear();
    },
    [people],
  );

  useEffect(
    () =>
      trackDirector(() => ({
        floor,
        cap: MAX_WALKERS,
        away: [...people.values()].filter((p) => p.phase !== 'seated').length,
        people: [...people.values()].map((p) => ({
          id: p.id,
          phase: p.phase,
          errand: p.errand?.name ?? null,
          spot: p.dest?.id ?? null,
          hurry: p.hurry,
          chat: p.chat ? [...p.chat.ids] : null,
          doing: p.actor && 'stage' in p.actor ? p.actor.stage : null,
          queued: p.queue.map((q) => q.name),
          restlessIn: p.phase === 'seated' ? Math.max(0, Math.round(p.restless - (run.clock - p.seatedAt))) : null,
        })),
      })),
    [floor, people, run],
  );

  /** Ends a scripted errand, whatever ended it, so it lets go of its toy. */
  function endScript(p: Person) {
    const sc = p.script;
    p.script = null;
    p.goal = null;
    sc?.end();
  }

  const leaveChat = (p: Person) => {
    p.chat?.ids.delete(p.id);
    p.chat = null;
    say(p.id, null);
  };

  const sitDown = (p: Person) => {
    leaveChat(p);
    p.phase = 'seated';
    p.phaseAt = run.clock;
    p.seatedAt = run.clock;
    p.restless = restlessSeconds(Math.random());
    p.roll = Math.random();
    p.errand = null;
    p.dest = null;
    p.hurry = false;
    p.actor?.end(true);
    p.actor = null;
    report(p);
  };

  // Something that beats an errand (the gong run) has them now: drop it on the spot, a mug in hand included, and leave
  // their body alone until they're back in their chair.
  useEffect(
    () =>
      onClaim((id) => {
        const p = people.get(id);
        if (!p || p.phase === 'seated') return;
        p.actor?.abort();
        p.actor?.end(false);
        p.actor = null;
        p.walking = null;
        p.errand?.end?.(p.id, 'cut');
        endScript(p); // a toy in hand is dropped
        p.poke = 0;
        sitDown(p);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sitDown only touches people and run
    [people, run],
  );

  /**
   * Sets off from the desk, or from `from` when already up (turned round on the way somewhere else). False when there's
   * nowhere free to go, null when the errand won't have them yet (its `claim`, asked only once there's a free spot).
   * An errand with a `place` or a `script` needs who's going and the floor (`ctx`).
   */
  const start = (p: Person, e: Errand, from?: Pt, ctx?: { a: Agent; state: ErrandState }): boolean | null => {
    if (e.max !== undefined && [...people.values()].filter((o) => o.errand?.name === e.name).length >= e.max) return false;
    // a spot is someone's while they head there or stand at it, not once they've turned for home
    const taken = new Set<string>();
    // An errand with an actor shares its spots and takes turns there itself (coffee: a line at the machine).
    if (!e.act) for (const o of people.values()) if (o.dest && (o.phase === 'leaving' || o.phase === 'there')) taken.add(o.dest.id);
    const origin = from ?? p.home;
    let dest: Spot | null;
    if (e.place) {
      const s = ctx ? e.place(ctx.a, ctx.state) : null;
      dest = s && !taken.has(s.id) && standable(w, s.x, s.z) ? s : null;
    } else {
      const ids = spotChoices(e.where?.(p.id) ?? e.spot, w.spots.map((s) => s.id), taken);
      dest = pickSpot(ids.map((id) => spotById(w, id)!), origin, Math.random());
    }
    const path = dest && findPath(w, origin, dest);
    if (!dest || !path) return false;
    if (e.claim && !e.claim(p.id)) return null;
    const script = e.script && ctx ? e.script(ctx.a, floor) : null;
    if (e.script && !script) return false;
    // turned round from a coffee break or a game: leave it behind
    if (p.actor) {
      p.actor.abort();
      p.actor.end(false);
      p.actor = null;
    }
    endScript(p);
    p.script = script;
    // Up from the chair to the stand-up spot behind it first, then round the furniture.
    leaveChat(p); // called away from a chat to the board
    walk(p, 'leaving', e, dest, from ? path : [{ x: p.home.x, z: p.home.z }, ...path]);
    return true;
  };

  /** Gathers a few idle people for a chat round a venue; false when they can't all fit or get there. */
  const startChat = (ids: string[], venue: string): boolean => {
    const spots = huddle(CHAT_VENUES[venue], ids.length, (x, z) => standable(w, x, z));
    if (!spots) return false;
    const legs = ids.map((id, i) => {
      const p = people.get(id)!;
      return findPath(w, p.home, spots[i]);
    });
    if (legs.some((l) => !l)) return false;
    const chat: Chat = { ids: new Set(ids) };
    ids.forEach((id, i) => {
      const p = people.get(id)!;
      p.queue = [];
      walk(p, 'leaving', CHAT, { ...spots[i], id: `${venue}-chat-${i}` }, [{ x: p.home.x, z: p.home.z }, ...legs[i]!]);
      p.chat = chat;
    });
    run.lastChat = run.clock;
    return true;
  };

  const goHome = (p: Person, hurry: boolean, at: Pt, how: 'done' | 'cut' = 'cut') => {
    p.errand?.end?.(p.id, how);
    endScript(p);
    p.poke = 0;
    leaveChat(p);
    p.hurry = hurry;
    p.phaseAt = run.clock;
    // Barely left the desk: just sit back down.
    if (Math.hypot(at.x - p.home.x, at.z - p.home.z) < 1.2) {
      p.phase = 'sitting';
      seatBody(p.id);
      report(p);
      return;
    }
    p.phase = 'returning';
    p.path = findPath(w, at, p.home) ?? [{ x: p.home.x, z: p.home.z }];
    p.wp = 0;
    p.waited = p.ghost = 0;
    report(p);
  };

  /** Out with their box: to the elevator and into it. */
  const exit = (p: Person) => {
    const lift = spotById(w, 'elevator');
    const path = (lift && exitPath(w, lift, p.home)) ?? [CABIN];
    walk(p, 'exiting', LEAVE, p.dest ?? p.home, path);
  };

  /** One frame along the path; true once at its end (stopped there, for the errand's spot). */
  const follow = (p: Person, x: number, z: number, speed: number, stop: boolean, dt: number, hands?: Gesture): boolean => {
    p.wp = nextWaypoint(p.path, p.wp, { x, z });
    const goal = p.path[p.wp];
    const last = p.wp === p.path.length - 1;
    const dx = goal.x - x;
    const dz = goal.z - z;
    const d = Math.hypot(dx, dz);
    const gesture =
      hands ??
      (p.phase === 'leaving'
        ? (p.errand?.bring ?? 'none')
        : (p.phase === 'returning' || p.phase === 'exiting') && !p.hurry
          ? (p.actor?.carry ?? p.errand?.carry ?? 'none')
          : 'none');
    if (last && (stop ? d < 0.08 && (bodyState(p.id)?.speed ?? 0) < 0.05 : d < PASS)) return true;
    const face =
      last && p.script && p.phase === 'there'
        ? p.walkFace
        : last && p.dest && p.phase !== 'returning' && p.phase !== 'exiting'
          ? headingFor(p.dest.facing)
          : Math.atan2(-dx, -dz);
    let tx = goal.x;
    let tz = goal.z;
    let sp = speed;
    let hd = face;
    if (d > 0.05) {
      const ux = dx / d;
      const uz = dz / d;
      const player = { x: camera.position.x, z: camera.position.z };
      const s = steer({ id: p.id, x, z, dx: ux, dz: uz }, p.ghost > 0 ? [] : run.walkers, player, (sx, sz) => standable(w, sx, sz));
      if (s.wait) {
        tx = x;
        tz = z;
        hd = bodyState(p.id)?.heading ?? face;
        p.waited += dt;
      } else if (s.speed < 1 || s.side !== 0) {
        // Aim a little ahead, slowed and stepped aside (+side is to the walker's right).
        tx = x + (ux * s.speed - uz * s.side) * CARROT;
        tz = z + (uz * s.speed + ux * s.side) * CARROT;
        sp = speed * Math.min(1, Math.max(0.2, Math.hypot(s.speed, s.side)));
        p.waited = 0;
      } else p.waited = 0;
      // Stuck behind someone for a while: walk on through (people only; the player is always waited for).
      if (p.waited > 3) {
        p.ghost = 1.5;
        p.waited = 0;
      }
    }
    p.ghost = Math.max(0, p.ghost - dt);
    setBody(p.id, { mode: 'walking', x: tx, z: tz, heading: hd, speed: sp, gesture });
    return false;
  };

  /** One frame of a scripted errand: ask the script what to do, and do it. */
  const play = (p: Person, sc: ErrandScript, st: { x: number; z: number; heading: number }, dt: number) => {
    me.id = p.id;
    me.x = st.x;
    me.z = st.z;
    me.heading = st.heading;
    me.arrived = p.arrived;
    me.dt = dt;
    me.player.x = camera.position.x;
    me.player.z = camera.position.z;
    const act = sc.tick(me);
    if (p.script !== sc) return; // it ended meanwhile
    if (act.do === 'done') return goHome(p, false, st, 'done');
    if (act.do === 'stand') {
      if (p.goal) {
        p.goal = null;
        p.pin = { x: st.x, z: st.z }; // stop where they are
      }
      setBody(p.id, { mode: 'standing', x: p.pin.x, z: p.pin.z, heading: act.heading, gesture: act.gesture });
      return;
    }
    if (!p.goal || Math.hypot(p.goal.x - act.x, p.goal.z - act.z) > 0.3) {
      p.goal = { x: act.x, z: act.z };
      p.path = findPath(w, st, p.goal) ?? [p.goal];
      p.wp = 0;
      p.arrived = false;
      p.waited = p.ghost = 0;
    }
    p.walkFace = act.heading;
    if (p.arrived) setBody(p.id, { mode: 'standing', x: p.goal.x, z: p.goal.z, heading: act.heading, gesture: act.gesture });
    else if (follow(p, st.x, st.z, p.errand?.speed ?? WALK_SPEED, true, dt, act.gesture)) {
      p.arrived = true;
      p.pin = p.goal;
    }
  };

  /** Walking past the roomba while it's out: maybe stop and poke it. True while they're busy poking. */
  const pokeRoomba = (p: Person, st: { x: number; z: number }, dt: number): boolean => {
    const rb = npcRoomba();
    if (p.poke > 0) {
      const was = p.poke;
      p.poke -= dt;
      p.phaseAt += dt; // the stop doesn't count towards giving up on the walk
      if (rb && was > POKE.seconds - POKE.at && p.poke <= POKE.seconds - POKE.at) {
        pokeToy('roomba');
        countPoke();
      }
      const heading = rb ? Math.atan2(-(rb.x - p.pin.x), -(rb.z - p.pin.z)) : (bodyState(p.id)?.heading ?? 0);
      setBody(p.id, { mode: 'standing', x: p.pin.x, z: p.pin.z, heading, gesture: p.poke > 0.5 ? 'stoop' : 'none' });
      return p.poke > 0;
    }
    if (!rb || p.hurry || rb.state !== 'cleaning' || rb.move === 'spin') return false;
    const d = Math.hypot(rb.x - st.x, rb.z - st.z);
    if (d > POKE.reach + 1) p.byRoomba = false;
    if (d > POKE.reach || p.byRoomba) return false;
    p.byRoomba = true;
    if (run.clock < run.pokeAt || Math.random() >= POKE.chance) return false;
    run.pokeAt = run.clock + POKE.gap;
    p.poke = POKE.seconds;
    p.pin = { x: st.x, z: st.z };
    return true;
  };

  /** Which way to face for a step at their spot: a look around, or towards the nearest teammate. */
  const stepHeading = (p: Person, dest: Spot, turn = 0, peer = false) => {
    if (peer) {
      const others: Body[] = [];
      for (const o of people.values()) {
        const b = o.id !== p.id && !o.gone ? bodyState(o.id) : undefined;
        if (b) others.push({ id: o.id, x: b.x, z: b.z });
      }
      const n = nearest({ id: p.id, x: dest.x, z: dest.z }, others);
      if (n) return headingTo(dest, n);
    }
    return headingFor(dest.facing) + turn;
  };

  /** Something to say in a chat, fitting what just happened on the floor. */
  const topic = () => {
    const s = useStore.getState();
    const repo = s.repos.find((r) => r.id === repoId);
    const qa = Object.values(s.qa).filter((q) => q.repoId === repoId);
    const working = latest.current.filter((a) => a.status === 'working').length;
    return pickTopic(floorNews(repo, qa, working, Date.now()), Math.random());
  };

  /** One frame of an errand's actor: walk where it says, stand how it says, or head home when it's done. */
  const act = (p: Person, actor: ErrandActor, st: Pt, long: number, dt: number) => {
    const ask = long > GIVE_UP.acting ? 'done' : actor.step(run.clock, p.arrived);
    if (ask === 'done') {
      if (long > GIVE_UP.acting) actor.abort();
      goHome(p, false, st);
      return;
    }
    if ('walk' in ask && ask.walk !== p.walking) {
      const to = spotById(w, ask.walk);
      if (!to) {
        actor.abort();
        goHome(p, false, st);
        return;
      }
      p.walking = ask.walk;
      p.dest = to;
      p.path = findPath(w, st, to) ?? [{ x: to.x, z: to.z }];
      p.wp = 0;
      p.arrived = false;
      p.waited = p.ghost = 0;
      report(p);
    }
    if ('walk' in ask && !p.arrived) {
      p.arrived = follow(p, st.x, st.z, WALK_SPEED, true, dt, ask.gesture);
      return;
    }
    const gesture = 'walk' in ask ? ask.gesture : ask.stand;
    const d = p.dest;
    const t = bodyTarget(p.id);
    if (d && (t?.mode !== 'standing' || t.gesture !== gesture || t.x !== d.x || t.z !== d.z)) {
      setBody(p.id, { mode: 'standing', x: d.x, z: d.z, heading: headingFor(d.facing), gesture });
    }
  };

  useFrame((_, delta) => {
    const dt = run.fresh ? 0 : Math.min(delta, 0.1);
    run.fresh = false;
    run.clock += dt;
    const byId = new Map(latest.current.map((a) => [a.id, a]));

    // Who's up and about, for steering round each other.
    run.walkers.length = 0;
    for (const p of people.values()) {
      const st = bodyState(p.id);
      if (st && st.stage !== 'seated') run.walkers.push({ id: p.id, x: st.x, z: st.z });
    }

    let away = 0;
    for (const p of people.values()) {
      if (p.gone) continue;
      const a = byId.get(p.id);
      const leaving = p.errand === LEAVE;
      if (!a && !leaving) continue;
      if (a && a.status !== p.status) {
        p.status = a.status;
        p.statusAt = run.clock;
      }
      if (p.phase === 'seated') continue;
      away++;
      const st = bodyState(p.id);
      if (!st) continue; // not drawn yet
      const e = p.errand;
      // Work came in: hurry back and sit down (a new hire just walks on, briskly).
      if (e === ARRIVE && !p.hurry && !isFree(p.status)) p.hurry = true;
      if (e && a && !p.hurry && (p.phase === 'leaving' || p.phase === 'there') && !mayContinue(a.status, e)) {
        p.actor?.abort();
        goHome(p, true, st);
      }
      // The rest of a chat went back to work: nobody left to talk to.
      if (p.chat && p.phase === 'there' && p.chat.ids.size < 2) goHome(p, false, st);
      if ((p.phase === 'leaving' || p.phase === 'returning') && pokeRoomba(p, st, dt)) continue;
      const long = run.clock - p.phaseAt;
      switch (p.phase) {
        case 'leaving': {
          if (p.hold > 0) {
            p.hold -= dt;
            // The doors open: out round you if you're in front of them (you may have ridden up together).
            const lift = p.hold <= 0 && e === TOUR ? spotById(w, 'elevator') : undefined;
            if (lift) {
              const out = stepOut(lift, { x: camera.position.x, z: camera.position.z }, planTour(w, lift)[0]?.spot ?? null);
              p.path = [out];
              p.dest = { ...lift, ...out, facing: -Math.PI / 2 };
            }
            break;
          }
          if (long > GIVE_UP.leaving && !leaving) goHome(p, false, st);
          else if (follow(p, st.x, st.z, p.hurry ? HURRY_SPEED : (e?.speed ?? WALK_SPEED), true, dt) && e && p.dest) {
            p.phase = 'there';
            p.phaseAt = run.clock;
            p.step = -1;
            p.stepLeft = 0;
            p.pin = { x: p.dest.x, z: p.dest.z };
            if (e.act) {
              p.actor = e.act(p.id);
              p.walking = p.dest.id;
              p.arrived = true;
            }
            if (p.script) p.arrived = false;
            report(p);
          }
          break;
        }
        case 'there': {
          if (p.script) {
            if (long > GIVE_UP.script) goHome(p, false, st);
            else play(p, p.script, st, dt);
            break;
          }
          if (p.actor) {
            act(p, p.actor, st, long, dt);
            break;
          }
          // The first to a chat waits a little for the others.
          if (p.chat && p.step < 0 && long < CHAT_WAIT && [...p.chat.ids].some((id) => people.get(id)?.phase === 'leaving')) break;
          p.stepLeft -= dt;
          if (p.stepLeft > 0 || !e || !p.dest) break;
          p.step++;
          const s = p.hurry ? undefined : e.steps[p.step];
          if (!s) {
            say(p.id, null);
            if (leaving) exit(p);
            else goHome(p, false, st, 'done');
            break;
          }
          if (s.cue && e.cue && !e.cue(p.id, s.cue)) {
            goHome(p, false, st);
            break;
          }
          p.stepLeft = s.seconds * (0.8 + Math.random() * 0.45);
          say(p.id, s.say ? topic() : null);
          // A few steps to another spot first (along the board): the step lasts at least the walk.
          const next = s.to ? spotById(w, s.to(p.id) ?? '') : undefined;
          const speed = e.speed ?? WALK_SPEED;
          if (next && next !== p.dest) {
            p.stepLeft = Math.max(p.stepLeft, Math.hypot(next.x - p.dest.x, next.z - p.dest.z) / speed + 0.6);
            p.dest = next;
            report(p);
          }
          const heading = stepHeading(p, p.dest, s.turn, s.face === 'peer');
          setBody(p.id, { mode: next ? 'walking' : 'standing', x: p.dest.x, z: p.dest.z, heading, gesture: s.gesture, speed });
          break;
        }
        case 'returning': {
          if (long > GIVE_UP.returning || follow(p, st.x, st.z, p.hurry ? HURRY_SPEED : (e?.speed ?? WALK_SPEED), false, dt)) {
            p.phase = 'sitting';
            p.phaseAt = run.clock;
            seatBody(p.id); // the body walks the last step to beside the chair and sits
            report(p);
          }
          break;
        }
        case 'exiting': {
          if (long > GIVE_UP.returning || follow(p, st.x, st.z, WALK_SPEED, false, dt)) {
            p.gone = true;
            setErrand(p.id, null);
            gone.current?.(p.id);
          }
          break;
        }
        case 'sitting':
          if (st.stage === 'seated') sitDown(p);
          break;
      }
    }

    // Every half second: who wants to go, and who may.
    run.tick -= dt;
    if (run.tick > 0) return;
    run.tick = TICK;
    const others: ErrandPeer[] = [];
    for (const p of people.values()) {
      const a = byId.get(p.id);
      if (a && !p.gone) others.push({ id: p.id, role: a.role, status: a.status, home: p.home });
    }
    const states = new Map<string, ErrandState>();
    const ready: Person[] = [];
    for (const p of people.values()) {
      const a = byId.get(p.id);
      if (!a) continue;
      const state: ErrandState = { floor, statusFor: run.clock - p.statusAt, seatedFor: run.clock - p.seatedAt, restless: p.restless, roll: p.roll, home: p.home, others };
      if (p.phase !== 'seated') {
        // Off on an idle errand, or on the way back, when board work comes in: straight there instead.
        const was = p.errand;
        const st = bodyState(p.id);
        const idle = !!was && !was.work && (p.phase === 'leaving' || p.phase === 'there');
        // a coffee carried home goes on the desk first
        if ((!idle && (p.phase !== 'returning' || p.actor)) || !st || was === TOUR) continue; // a tour cut short goes straight to the desk
        const e = wanted(errands(), a, state).find((x) => x.work);
        if (e && start(p, e, st, { a, state }) && idle) was?.end?.(p.id, 'cut');
        continue;
      }
      if (!isSeated(p.id)) continue; // walked by hand (__swarmPeople) or by the gong run, or not back in their chair yet
      states.set(p.id, state);
      const ask = takeAsk(p.id);
      // every work errand wanted, then one idle errand picked by weight
      const want = wanted(errands(), a, state);
      for (const e of want.filter((x) => x.work)) p.queue = enqueue(p.queue, e.name, run.clock, undefined, true);
      const idle = choose(want.filter((x) => !x.work), Math.random());
      if (idle) p.queue = enqueue(p.queue, idle.name, run.clock);
      // sent on one by hand (__swarmPeople.send): first in the queue
      if (ask && errandNamed(ask)) p.queue = [{ name: ask, at: run.clock - QUEUE_SECONDS / 2 }, ...p.queue.filter((q) => q.name !== ask)];
      const kept = prune(p.queue, run.clock, (n) => {
        const e = errandNamed(n);
        // errands someone claims (the board's) also drop out once they're no longer wanted
        return !!e && mayStart(a.status, e, state.statusFor) && (!e.claim || e.when(a, state));
      });
      // Waited too long for a slot: skip it, and sit a while before trying again.
      if (kept.length < p.queue.length && p.queue.some((q) => run.clock - q.at >= QUEUE_SECONDS)) {
        p.seatedAt = run.clock;
        p.restless = restlessSeconds(Math.random());
      }
      p.queue = kept;
      if (kept.length) ready.push(p);
    }

    // Now and then, a few of the restless ones chat instead (office floors: the cooler or the couch).
    if (floor === 'office') {
      const candidates = [...states].filter(([id]) => isFree(byId.get(id)!.status)).map(([id, s]) => ({ id, home: people.get(id)!.home, seatedFor: s.seatedFor, restless: s.restless }));
      const plan = planChat(candidates, { away, cap: MAX_WALKERS, sinceLast: run.clock - run.lastChat, rand: Math.random, venues: Object.keys(CHAT_VENUES) });
      if (plan && startChat(plan.ids, plan.venue)) away += plan.ids.length;
    }

    for (const p of admit(
      ready.filter((r) => r.phase === 'seated'),
      away,
    )) {
      const [head, ...rest] = p.queue;
      const e = errandNamed(head.name);
      const a = byId.get(p.id);
      const state = states.get(p.id);
      const went = e ? start(p, e, undefined, a && state ? { a, state } : undefined) : false;
      if (went === null || (!went && e?.claim)) continue; // not yet, or its spot is in use: it stays queued
      p.queue = rest;
      if (!went) {
        // nowhere free to go: sit a while longer
        p.seatedAt = run.clock;
        p.restless = restlessSeconds(Math.random());
      }
    }
  });

  return null;
}
