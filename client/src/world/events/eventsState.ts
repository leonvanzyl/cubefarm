import { create } from 'zustand';
import { useStore } from '../../store';
import type { Side } from '../layout';
import { nightFactor } from '../sky/time';
import { dayTime } from '../sky/useDayTime';
import { weather } from '../weather/weatherState';
import { EVENTS, newDirector, parseEventId, parseEventParam, startRunning, stepDirector, stopRunning, type EventId, type Moment } from './director';

// The world events that are on now: the director (director.ts) stepped with the render, so nothing happens while the
// office isn't on screen, each running event's own clock (scenes read `run.t` in their frame loop), and what ran
// before. React sees the list only change when an event starts or ends (WorldEvents.tsx mounts a scene per run).
// QA: `?event=kaiju` starts one a couple of seconds in; window.__swarmEvents shows the schedule and can trigger().

/** One event as it plays out. */
export interface EventRun {
  key: number;
  id: EventId;
  /** The side of the building it's on (where the windows to watch it from are). */
  side: Side;
  /** Fixed for the run: its own randomness (paths, colours). */
  seed: number;
  seconds: number;
  /** Seconds since it started, render time. */
  t: number;
  forced: boolean;
}

const HISTORY = 20;

const state = {
  director: newDirector((Date.now() ^ 0x5eed) >>> 0, 'normal'),
  runs: [] as EventRun[],
  history: [] as { id: EventId; side: Side; at: number; forced: boolean }[],
  seq: 0,
  /** ?event=: started once the office has rendered a couple of seconds. */
  pending: (() => {
    try {
      return parseEventParam(window.location.search);
    } catch {
      return null;
    }
  })() as EventId | null,
  /** Director-clock seconds it last rained (for the rainbow), -Infinity: not since you arrived. */
  rainedAt: -Infinity,
  moment: { frequency: 'normal', calm: false, night: false, weather: true, rain: 0, sinceRain: Infinity } as Moment,
};

const useRuns = create<{ runs: EventRun[] }>(() => ({ runs: [] }));

/** For React: the events running now (changes only as they start and end). */
export const useEventRuns = () => useRuns((s) => s.runs);

const publish = () => useRuns.setState({ runs: [...state.runs] });

/** The big event on now, if any: what idle people go to the windows to watch. */
export const bigEvent = (): EventRun | null => state.runs.find((r) => EVENTS[r.id].big) ?? null;

/** Every event running now (for the scenes' coordination: the rainbow knows about the rain). */
export const runningEvents = (): readonly EventRun[] => state.runs;

/** Starts `id` now (on `side`, or a random one). A big event first ends any other big one, so two never overlap. */
export function triggerEvent(id: EventId, side?: Side, forced = true): EventRun {
  if (EVENTS[id].big) for (const r of state.runs.filter((x) => EVENTS[x.id].big)) endEvent(r.key);
  const same = state.runs.find((r) => r.id === id);
  if (same) endEvent(same.key);
  const run: EventRun = {
    key: ++state.seq,
    id,
    side: side ?? (Math.random() < 0.5 ? 'west' : 'east'),
    seed: Math.floor(Math.random() * 2 ** 31),
    seconds: EVENTS[id].seconds,
    t: 0,
    forced,
  };
  state.runs.push(run);
  startRunning(state.director, run.key, id, run.seconds);
  state.history.push({ id, side: run.side, at: Date.now(), forced });
  if (state.history.length > HISTORY) state.history.splice(0, state.history.length - HISTORY);
  if (EVENTS[id].toast) useStore.getState().pushToast('info', `👀 Something's happening outside, ${run.side} side!`);
  publish();
  return run;
}

/** Ends an event (its time is up, or it was replaced): its scene unmounts and tears itself down. */
export function endEvent(key: number) {
  const i = state.runs.findIndex((r) => r.key === key);
  if (i < 0) return;
  state.runs.splice(i, 1);
  stopRunning(state.director, key);
  publish();
}

/** The moment for the director, filled in place (it's read every frame). */
function moment(): Moment {
  const s = useStore.getState();
  const m = state.moment;
  if (weather.mix.rain > 0.2) state.rainedAt = state.director.clock;
  m.frequency = s.settings.worldEvents?.frequency ?? 'normal';
  m.calm = s.settings.worldEvents?.calm ?? false;
  m.night = nightFactor(dayTime.t) > 0.5;
  m.weather = (s.settings.weather?.mode ?? 'cycle') !== 'off' || weather.source === 'url' || weather.source === 'probe';
  m.rain = weather.mix.rain;
  m.sinceRain = state.director.clock - state.rainedAt;
  return m;
}

/** Moves the events on by dt seconds of render time (WorldEvents.tsx, every frame). */
export function stepEvents(dt: number) {
  for (let i = state.runs.length - 1; i >= 0; i--) {
    const r = state.runs[i];
    r.t += dt;
    if (r.t >= r.seconds) endEvent(r.key);
  }
  const id = stepDirector(state.director, dt, moment());
  if (id) triggerEvent(id, undefined, false);
  if (state.pending && state.director.clock > 2) {
    const p = state.pending;
    state.pending = null;
    triggerEvent(p);
  }
}

// For QA: __swarmEvents shows the schedule, what's on and what ran, and trigger('kaiju', 'west') starts one now.
if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmEvents')) {
  const view = (r: EventRun) => ({ key: r.key, id: r.id, side: r.side, t: Math.round(r.t * 10) / 10, seconds: r.seconds, big: EVENTS[r.id].big, forced: r.forced });
  Object.defineProperty(window, '__swarmEvents', {
    value: {
      get schedule() {
        const d = state.director;
        return { clock: Math.round(d.clock), nextIn: Number.isFinite(d.nextAt) ? Math.max(0, Math.round(d.nextAt - d.clock)) : null, frequency: d.frequency, moment: { ...state.moment } };
      },
      get current() {
        return state.runs.map(view);
      },
      get history() {
        return state.history.map((h) => ({ ...h }));
      },
      get catalog() {
        return Object.values(EVENTS).map((e) => ({ id: e.id, label: e.label, tier: e.tier, big: e.big, seconds: e.seconds, when: e.when }));
      },
      /** Starts an event now ('kaiju', 'duck', 'plane'…), on 'west' or 'east' (random by default). Null for an unknown name. */
      trigger(name: string, side?: Side) {
        const id = parseEventId(name);
        return id ? view(triggerEvent(id, side === 'west' || side === 'east' ? side : undefined)) : null;
      },
      /** Ends the running event with this name (or all of them). */
      end(name?: string) {
        for (const r of state.runs.filter((x) => !name || x.id === parseEventId(name))) endEvent(r.key);
      },
      /** Jumps a running event to `t` seconds in (screenshots of its middle without waiting for it). */
      seek(name: string, t: number) {
        const r = state.runs.find((x) => x.id === parseEventId(name));
        if (r && Number.isFinite(t)) r.t = Math.max(0, Math.min(r.seconds - 0.5, t));
        return r ? view(r) : null;
      },
      /** Moves the next scheduled event this many seconds from now (QA: watch the director pick one). */
      soon(seconds = 1) {
        state.director.nextAt = state.director.clock + Math.max(0, seconds);
      },
    },
    enumerable: false,
    configurable: false,
  });
}
