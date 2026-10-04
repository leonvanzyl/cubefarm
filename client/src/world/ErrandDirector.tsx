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
  type Queued,
} from './errands';
import { bodyState, bodyTarget, seatBody, setBody, setErrand, takeAsk, trackDirector } from './people';
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
}

const TICK = 0.5; // seconds between "who wants to go?" checks
const CARROT = 0.8; // how far ahead (m) a steered walker aims
const GIVE_UP = { leaving: 45, returning: 60, acting: 180 }; // seconds before a walk (or an actor) that got stuck is cut short

export function ErrandDirector({ floor, agents }: { floor: FloorKind; agents: Agent[] }) {
  const camera = useThree((s) => s.camera);
  const paused = useRenderPaused();
  const w = walkways(floor);
  const people = useMemo(() => new Map<string, Person>(), []);
  const latest = useRef(agents);
  latest.current = agents;
  const run = useMemo(() => ({ clock: 0, tick: 0, fresh: true, walkers: [] as Body[] }), []);

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
      });
    }
    for (const [id, p] of people) {
      if (seen.has(id)) continue;
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

  const report = (p: Person) => setErrand(p.id, p.errand && p.dest ? { name: p.errand.name, phase: p.phase, spot: p.dest.id } : null);

  const sitDown = (p: Person) => {
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

  const start = (p: Person, e: Errand): boolean => {
    if (e.max !== undefined && [...people.values()].filter((o) => o.errand?.name === e.name).length >= e.max) return false;
    const taken = new Set<string>();
    // An errand with an actor shares its spots and takes turns there itself (coffee: a line at the machine).
    if (!e.act) for (const o of people.values()) if (o.dest) taken.add(o.dest.id);
    const ids = spotChoices(e.spot, w.spots.map((s) => s.id), taken);
    const dest = pickSpot(ids.map((id) => spotById(w, id)!), p.home, Math.random());
    const path = dest && findPath(w, p.home, dest);
    if (!dest || !path) return false;
    // Up from the chair to the stand-up spot behind it first, then round the furniture.
    Object.assign(p, { phase: 'leaving', phaseAt: run.clock, errand: e, dest, path: [{ x: p.home.x, z: p.home.z }, ...path], wp: 0, hurry: false, waited: 0, ghost: 0 });
    report(p);
    return true;
  };

  const goHome = (p: Person, hurry: boolean, at: Pt) => {
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
    const gesture = hands ?? (p.phase === 'returning' && !p.hurry ? (p.actor?.carry ?? p.errand?.carry ?? 'none') : 'none');
    if (last && (stop ? d < 0.08 && (bodyState(p.id)?.speed ?? 0) < 0.05 : d < PASS)) return true;
    const face = last && p.dest && p.phase !== 'returning' ? headingFor(p.dest.facing) : Math.atan2(-dx, -dz);
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
      const long = run.clock - p.phaseAt;
      switch (p.phase) {
        case 'leaving': {
          if (long > GIVE_UP.leaving) goHome(p, false, st);
          else if (follow(p, st.x, st.z, WALK_SPEED, true, dt) && e && p.dest) {
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
          p.stepLeft -= dt;
          if (p.stepLeft > 0 || !e || !p.dest) break;
          p.step++;
          const s = e.steps[p.step];
          if (!s) {
            goHome(p, false, st);
            break;
          }
          p.stepLeft = s.seconds * (0.8 + Math.random() * 0.45);
          setBody(p.id, { mode: 'standing', x: p.dest.x, z: p.dest.z, heading: headingFor(p.dest.facing), gesture: s.gesture });
          break;
        }
        case 'returning': {
          if (long > GIVE_UP.returning || follow(p, st.x, st.z, p.hurry ? HURRY_SPEED : WALK_SPEED, false, dt)) {
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
      if (!a || p.phase !== 'seated') continue;
      if (bodyTarget(p.id)) continue; // someone's walking them by hand (__swarmPeople)
      const ask = takeAsk(p.id);
      if (ask && errandNamed(ask) && mayStart(a.status, errandNamed(ask)!)) p.queue = enqueue(p.queue, ask, run.clock);
      const state = { floor, statusFor: run.clock - p.statusAt, seatedFor: run.clock - p.seatedAt, restless: p.restless };
      for (const e of wanted(errands(), a, state)) p.queue = enqueue(p.queue, e.name, run.clock);
      const kept = prune(p.queue, run.clock, (n) => {
        const e = errandNamed(n);
        return !!e && mayStart(a.status, e);
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
      p.queue = rest;
      const e = errandNamed(head.name);
      if (!e || !start(p, e)) {
        // nowhere free to go: sit a while longer
        p.seatedAt = run.clock;
        p.restless = restlessSeconds(Math.random());
      }
    }
  });

  return null;
}
