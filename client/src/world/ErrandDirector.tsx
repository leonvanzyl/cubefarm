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
  type ErrandState,
  type Queued,
} from './errands';
import { HALF_D } from './layout';
import { bodyState, bodyTarget, placeBody, say, seatBody, setBody, setErrand, takeAsk, trackDirector } from './people';
import { ARRIVE, CABIN, CHAT, CHAT_VENUES, DOORS_SECONDS, LEAVE, arrivalPath, exitPath, floorNews, headingTo, huddle, nearest, pickTopic, planChat } from './socials';
import type { Pt } from './toys/roombaBrain';
import { findPath, spot as spotById, standable, steer, walkways, type Body, type FloorKind, type Spot } from './walkways';

// The errand director: sends the people on the floor you're on out on errands (errands.ts) and back, a few at a
// time. It runs in the render loop, so it pauses with the render (hidden tab, full-screen panel) and nothing piles
// up meanwhile, and it starts fresh, everyone at their desk, each time you arrive on a floor. It also runs the
// comings and goings (socials.ts): hires stepping out of the elevator, `leavers` walking out with a box, and chats.

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
  /** Seconds to stand still before setting off (a new hire, while the elevator doors open). */
  hold: number;
  chat: Chat | null;
  /** Walked into the elevator: waiting for the floor to stop drawing them. */
  gone: boolean;
}

const TICK = 0.5; // seconds between "who wants to go?" checks
const CARROT = 0.8; // how far ahead (m) a steered walker aims
const GIVE_UP = { leaving: 45, returning: 60, acting: 180 }; // seconds before a walk (or an actor) that got stuck is cut short
const SETTLE = 1.5; // seconds on a floor before someone new counts as a hire walking in, not already there
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
  const run = useMemo(() => ({ clock: 0, tick: 0, fresh: true, lastChat: -20, walkers: [] as Body[] }), []);

  // After a pause, the first frame's delta covers the whole gap: skip it.
  useEffect(() => {
    if (!paused) run.fresh = true;
  }, [paused, run]);

  const report = (p: Person) => setErrand(p.id, p.errand && p.dest ? { name: p.errand.name, phase: p.phase, spot: p.dest.id } : null);

  const walk = (p: Person, phase: Phase, errand: Errand, dest: Spot, path: Pt[]) => {
    Object.assign(p, { phase, phaseAt: run.clock, errand, dest, path, wp: 0, hurry: false, waited: 0, ghost: 0, hold: 0 });
    report(p);
  };

  /** A new hire: stood in the elevator, which dings, then out to their desk (briskly if work is waiting). */
  const arrive = (p: Person) => {
    const lift = spotById(w, 'elevator');
    const path = lift && arrivalPath(w, lift, p.home);
    if (!path) return;
    placeBody(p.id, CABIN.x, CABIN.z, 0);
    walk(p, 'leaving', ARRIVE, p.home, path);
    p.hold = DOORS_SECONDS;
    p.hurry = !isFree(p.status);
    ding({ x: 0, y: 2.6, z: HALF_D });
  };

  /** Let go: up to the spot behind their chair to pick up a box (then out: see 'there'). */
  const depart = (p: Person) => {
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
      const hire = run.clock > SETTLE && !out.has(a.id);
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
        hold: 0,
        chat: null,
        gone: false,
      };
      people.set(a.id, np);
      if (out.has(a.id)) depart(np);
      else if (hire) arrive(np);
    }
    for (const [id, p] of people) {
      if (seen.has(id)) continue;
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
    p.errand = null;
    p.dest = null;
    p.hurry = false;
    p.actor?.end(true);
    p.actor = null;
    report(p);
  };

  /**
   * Sets off from the desk, or from `from` when already up (turned round on the way somewhere else). False when there's
   * nowhere free to go, null when the errand won't have them yet (its `claim`, asked only once there's a free spot).
   * An errand with a `place` needs who's going and the floor (`ctx`).
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
    // turned round from a coffee break: leave it behind
    if (p.actor) {
      p.actor.abort();
      p.actor.end(false);
      p.actor = null;
    }
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
    const face = last && p.dest && p.phase !== 'returning' && p.phase !== 'exiting' ? headingFor(p.dest.facing) : Math.atan2(-dx, -dz);
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
      const long = run.clock - p.phaseAt;
      switch (p.phase) {
        case 'leaving': {
          if (p.hold > 0) {
            p.hold -= dt;
            break;
          }
          if (long > GIVE_UP.leaving && !leaving) goHome(p, false, st);
          else if (follow(p, st.x, st.z, p.hurry ? HURRY_SPEED : (e?.speed ?? WALK_SPEED), true, dt) && e && p.dest) {
            p.phase = 'there';
            p.phaseAt = run.clock;
            p.step = -1;
            p.stepLeft = 0;
            if (e.act) {
              p.actor = e.act(p.id);
              p.walking = p.dest.id;
              p.arrived = true;
            }
            report(p);
          }
          break;
        }
        case 'there': {
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
      const state: ErrandState = { floor, statusFor: run.clock - p.statusAt, seatedFor: run.clock - p.seatedAt, restless: p.restless, home: p.home, others };
      if (p.phase !== 'seated') {
        // Off on an idle errand, or on the way back, when board work comes in: straight there instead.
        const was = p.errand;
        const st = bodyState(p.id);
        const idle = !!was && !was.work && (p.phase === 'leaving' || p.phase === 'there');
        // a coffee carried home goes on the desk first
        if ((!idle && (p.phase !== 'returning' || p.actor)) || !st) continue;
        const e = wanted(errands(), a, state).find((x) => x.work);
        if (e && start(p, e, st) && idle) was?.end?.(p.id, 'cut');
        continue;
      }
      if (bodyTarget(p.id)) continue; // someone's walking them by hand (__swarmPeople)
      states.set(p.id, state);
      const ask = takeAsk(p.id);
      if (ask && errandNamed(ask) && mayStart(a.status, errandNamed(ask)!)) p.queue = enqueue(p.queue, ask, run.clock);
      // every work errand wanted, then one idle errand picked by weight
      const want = wanted(errands(), a, state);
      for (const e of want.filter((x) => x.work)) p.queue = enqueue(p.queue, e.name, run.clock, undefined, true);
      const idle = choose(want.filter((x) => !x.work), Math.random());
      if (idle) p.queue = enqueue(p.queue, idle.name, run.clock);
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
