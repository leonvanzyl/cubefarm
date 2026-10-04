import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { AgentStatus } from '../../../shared/types';
import { useRenderPaused } from '../perf';
import type { Agent } from '../store';
import { WALK_SPEED, type Gesture } from './body';
import './coffeeErrand';
import {
  HURRY_SPEED,
  admit,
  MAX_WALKERS,
  PASS,
  QUEUE_SECONDS,
  enqueue,
  errandNamed,
  errands,
  headingFor,
  homeSpotId,
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
  type ErrandAgent,
  type ErrandScript,
  type Me,
  type Queued,
} from './errands';
import { bodyState, bodyTarget, seatBody, setBody, setErrand, takeAsk, trackDirector } from './people';
import { countPoke, npcRoomba } from './toys/npc';
import { pokeToy } from './toys/poke';
import './toyErrands';
import type { Pt } from './toys/roombaBrain';
import { findPath, spot as spotById, standable, steer, walkways, type Body, type FloorKind, type Spot } from './walkways';

// The errand director: sends the people on the floor you're on out on errands (errands.ts) and back, a few at a
// time. It runs in the render loop, so it pauses with the render (hidden tab, full-screen panel) and nothing piles
// up meanwhile, and it starts fresh, everyone at their desk, each time you arrive on a floor.

type Phase = 'seated' | 'leaving' | 'there' | 'returning' | 'sitting';

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
}

const TICK = 0.5; // seconds between "who wants to go?" checks
const CARROT = 0.8; // how far ahead (m) a steered walker aims
const GIVE_UP = { leaving: 45, returning: 60, acting: 180, script: 240 }; // seconds before a walk (or an actor or script) that got stuck is cut short
// Walking past the roomba while it's out cleaning: sometimes they stop and poke it (as E does), at most every `gap` s.
const POKE = { reach: 1.3, chance: 0.6, seconds: 1.5, at: 0.45, gap: 20 };

export function ErrandDirector({ floor, agents }: { floor: FloorKind; agents: Agent[] }) {
  const camera = useThree((s) => s.camera);
  const paused = useRenderPaused();
  const w = walkways(floor);
  const people = useMemo(() => new Map<string, Person>(), []);
  const latest = useRef(agents);
  latest.current = agents;
  const run = useMemo(() => ({ clock: 0, tick: 0, fresh: true, walkers: [] as Body[], pokeAt: 0 }), []);
  const me = useMemo<Me>(() => ({ id: '', x: 0, z: 0, heading: 0, arrived: false, dt: 0, player: { x: 0, z: 0 } }), []);

  // After a pause, the first frame's delta covers the whole gap: skip it.
  useEffect(() => {
    if (!paused) run.fresh = true;
  }, [paused, run]);

  // Who is on this floor (and has a desk to come back to).
  useEffect(() => {
    const seen = new Set<string>();
    for (const a of agents) {
      const id = homeSpotId(floor, a);
      const home = id ? spotById(w, id) : undefined;
      if (!home) continue;
      seen.add(a.id);
      const p = people.get(a.id);
      if (p) {
        if (p.phase === 'seated') p.home = home;
        continue;
      }
      seatBody(a.id); // start fresh: whatever the last visit left behind, they're at their desk
      setErrand(a.id, null);
      people.set(a.id, {
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
      });
    }
    for (const [id, p] of people) {
      if (seen.has(id)) continue;
      endScript(p);
      p.actor?.abort();
      p.actor?.end(false);
      seatBody(id);
      setErrand(id, null);
      people.delete(id);
    }
  }, [agents, floor, w, people, run]);

  // Leaving the floor: everyone back in their chair for next time.
  useEffect(
    () => () => {
      for (const [id, p] of people) {
        endScript(p);
        p.actor?.end(false);
        seatBody(id);
        setErrand(id, null);
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

  const report = (p: Person) => setErrand(p.id, p.errand && p.dest ? { name: p.errand.name, phase: p.phase, spot: p.dest.id } : null);

  const sitDown = (p: Person) => {
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

  /**
   * Sets off from the desk, or from `from` when already up (turned round on the way somewhere else). False when there's
   * nowhere free to go, null when the errand won't have them yet (its `claim`, asked only once there's a free spot).
   */
  const start = (p: Person, e: Errand, a: ErrandAgent, from?: Pt): boolean | null => {
    if (e.max !== undefined && [...people.values()].filter((o) => o.errand?.name === e.name).length >= e.max) return false;
    // a spot is someone's while they head there or stand at it, not once they've turned for home
    const taken = new Set<string>();
    // An errand with an actor shares its spots and takes turns there itself (coffee: a line at the machine).
    if (!e.act) for (const o of people.values()) if (o.dest && (o.phase === 'leaving' || o.phase === 'there')) taken.add(o.dest.id);
    const ids = spotChoices(e.where?.(p.id) ?? e.spot, w.spots.map((s) => s.id), taken);
    const origin = from ?? p.home;
    const dest = pickSpot(ids.map((id) => spotById(w, id)!), origin, Math.random());
    const path = dest && findPath(w, origin, dest);
    if (!dest || !path) return false;
    if (e.claim && !e.claim(p.id)) return null;
    const script = e.script ? e.script(a, floor) : null;
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
    const route = from ? path : [{ x: p.home.x, z: p.home.z }, ...path];
    Object.assign(p, { phase: 'leaving', phaseAt: run.clock, errand: e, dest, path: route, wp: 0, hurry: false, waited: 0, ghost: 0 });
    report(p);
    return true;
  };

  const goHome = (p: Person, hurry: boolean, at: Pt, how: 'done' | 'cut' = 'cut') => {
    p.errand?.end?.(p.id, how);
    endScript(p);
    p.poke = 0;
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
      (p.phase === 'leaving' ? (p.errand?.bring ?? 'none') : p.phase === 'returning' && !p.hurry ? (p.actor?.carry ?? p.errand?.carry ?? 'none') : 'none');
    if (last && (stop ? d < 0.08 && (bodyState(p.id)?.speed ?? 0) < 0.05 : d < PASS)) return true;
    const face = last && p.script && p.phase === 'there' ? p.walkFace : last && p.dest && p.phase !== 'returning' ? headingFor(p.dest.facing) : Math.atan2(-dx, -dz);
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
    else if (follow(p, st.x, st.z, WALK_SPEED, true, dt, act.gesture)) {
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
      const a = byId.get(p.id);
      if (!a) continue;
      if (a.status !== p.status) {
        p.status = a.status;
        p.statusAt = run.clock;
      }
      if (p.phase === 'seated') continue;
      away++;
      const st = bodyState(p.id);
      if (!st) continue; // not drawn yet
      const e = p.errand;
      // Work came in: hurry back and sit down.
      if (e && !p.hurry && (p.phase === 'leaving' || p.phase === 'there') && !mayContinue(a.status, e)) {
        p.actor?.abort();
        goHome(p, true, st);
      }
      if ((p.phase === 'leaving' || p.phase === 'returning') && pokeRoomba(p, st, dt)) continue;
      const long = run.clock - p.phaseAt;
      switch (p.phase) {
        case 'leaving': {
          if (long > GIVE_UP.leaving) goHome(p, false, st);
          else if (follow(p, st.x, st.z, e?.speed ?? WALK_SPEED, true, dt) && e && p.dest) {
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
          p.stepLeft -= dt;
          if (p.stepLeft > 0 || !e || !p.dest) break;
          p.step++;
          const s = e.steps[p.step];
          if (!s) {
            goHome(p, false, st, 'done');
            break;
          }
          if (s.cue && e.cue && !e.cue(p.id, s.cue)) {
            goHome(p, false, st);
            break;
          }
          p.stepLeft = s.seconds * (0.8 + Math.random() * 0.45);
          // A few steps to another spot first (along the board): the step lasts at least the walk.
          const next = s.to ? spotById(w, s.to(p.id) ?? '') : undefined;
          const speed = e.speed ?? WALK_SPEED;
          if (next && next !== p.dest) {
            p.stepLeft = Math.max(p.stepLeft, Math.hypot(next.x - p.dest.x, next.z - p.dest.z) / speed + 0.6);
            p.dest = next;
            report(p);
          }
          setBody(p.id, { mode: next ? 'walking' : 'standing', x: p.dest.x, z: p.dest.z, heading: headingFor(p.dest.facing), gesture: s.gesture, speed });
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
        case 'sitting':
          if (st.stage === 'seated') sitDown(p);
          break;
      }
    }

    // Every half second: who wants to go, and who may.
    run.tick -= dt;
    if (run.tick > 0) return;
    run.tick = TICK;
    const ready: Person[] = [];
    for (const p of people.values()) {
      const a = byId.get(p.id);
      if (!a) continue;
      const state = { floor, statusFor: run.clock - p.statusAt, seatedFor: run.clock - p.seatedAt, restless: p.restless, roll: p.roll };
      if (p.phase !== 'seated') {
        // Off on an idle errand, or on the way back, when board work comes in: straight there instead.
        const was = p.errand;
        const st = bodyState(p.id);
        const idle = !!was && !was.work && (p.phase === 'leaving' || p.phase === 'there');
        // a coffee carried home goes on the desk first
        if ((!idle && (p.phase !== 'returning' || p.actor)) || !st) continue;
        const e = wanted(errands(), a, state).find((x) => x.work);
        if (e && start(p, e, a, st) && idle) was?.end?.(p.id, 'cut');
        continue;
      }
      if (bodyTarget(p.id)) continue; // someone's walking them by hand (__swarmPeople)
      const ask = takeAsk(p.id);
      for (const e of wanted(errands(), a, state)) p.queue = enqueue(p.queue, e.name, run.clock, undefined, e.work);
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
    for (const p of admit(ready, away)) {
      const [head, ...rest] = p.queue;
      const e = errandNamed(head.name);
      const a = byId.get(p.id);
      const went = e && a ? start(p, e, a) : false;
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
