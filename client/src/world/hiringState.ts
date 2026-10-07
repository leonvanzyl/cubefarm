// In-person hiring, live (hiring.ts has the rules): the lobby's waiting room as Candidates.tsx last laid it out,
// newcomers due a welcome tour when you next come up to their floor (hired from the lobby, added by the manager or by
// the CEO on auto), each tour's progress (ErrandDirector.tsx), and the candidates walking out of the front door
// (Outside.tsx opens it for them). window.__swarmHiring reports all of it, and in the demo office makes requests on demand.

import { api } from '../api';
import { useStore } from '../store';
import { joined, newlyHired, type Lobby, type TourStop } from './hiring';
import { WAITING } from './layout';

/** How long (ms) after someone joins their welcome tour still waits for you to come up to their floor. */
export const WELCOME_MS = 5 * 60_000;

/** touring: on the tour now · done: all of it, then their desk · cut: work came in, straight to their desk · straight: had work on arrival. */
export interface TourInfo {
  state: 'touring' | 'done' | 'cut' | 'straight';
  stop: TourStop['what'] | null;
  stops: TourStop['what'][];
  at: number;
}

let lobby: Lobby | null = null;
const due = new Map<string, number>();
const tours = new Map<string, TourInfo>();
/** Every agent seen in the live office: whoever isn't in it yet has just joined. Null until the first snapshot. */
let known: Set<string> | null = null;
/** Candidates on their way out through the lobby's front door. */
export const doorWalkers = new Set<string>();

/** Candidates.tsx: the waiting room now (null once the lobby isn't drawn). */
export function setLobby(l: Lobby | null) {
  lobby = l;
}

/** Whether `id` joined a moment ago and is still due their welcome tour (and hasn't had it); asking uses it up. */
export function takeWelcome(id: string, now = Date.now()) {
  const at = due.get(id);
  due.delete(id);
  return at !== undefined && now - at < WELCOME_MS && !tours.has(id);
}

export function tourStarted(id: string, stops: readonly TourStop[]) {
  tours.set(id, { state: 'touring', stop: stops[0]?.what ?? null, stops: stops.map((s) => s.what), at: Date.now() });
}

export function tourAt(id: string, stop: TourStop | null) {
  const t = tours.get(id);
  if (t?.state === 'touring') t.stop = stop?.what ?? null;
}

export function tourEnded(id: string, how: 'done' | 'cut' | 'straight') {
  const t = tours.get(id);
  tours.set(id, { state: how, stop: null, stops: t?.stops ?? [], at: Date.now() });
  if (tours.size > 20) tours.delete(tours.keys().next().value!);
}

const start = useStore.getState(); // this module loads with the 3D office, often after the first snapshot
if (start.loaded && !start.replaying) known = new Set(Object.keys(start.agents));

useStore.subscribe((state, prev) => {
  // The time-lapse's people aren't joining anyone: only the live office counts.
  if (!state.loaded || state.replaying) return;
  if (!known) {
    known = new Set(Object.keys(state.agents));
    return;
  }
  if (state.agents === prev.agents && state.requests === prev.requests) return;
  const now = Date.now();
  for (const [id, at] of due) if (now - at >= WELCOME_MS) due.delete(id);
  // Each newcomer is welcomed once, however they show up first: the agent itself, or the approved request (agents
  // come batched, so the approval can be a moment ahead).
  const welcome = (id: string) => {
    if (known!.has(id)) return;
    known!.add(id);
    if (!tours.has(id)) due.set(id, now);
  };
  if (state.agents !== prev.agents) for (const h of joined(known, Object.values(state.agents))) welcome(h.agentId);
  if (state.requests !== prev.requests) for (const h of newlyHired(prev.requests, state.requests)) welcome(h.agentId);
});

if (typeof window !== 'undefined') {
  const describe = (id: string) => {
    const r = useStore.getState().requests.find((x) => x.id === id);
    const floor = r ? (useStore.getState().repos.find((x) => x.id === r.repoId)?.floor ?? null) : null;
    return { name: r?.name ?? null, cli: r?.cli ?? null, floor };
  };
  (window as unknown as Record<string, unknown>).__swarmHiring = {
    /** The candidates in the lobby (null when it isn't drawn): their chair and whether they're waiting or leaving. */
    candidates: () => lobby?.list.map((c) => ({ ...c, ...describe(c.id) })) ?? null,
    /** Every chair in the waiting room and who's in it, plus how many wait outside for one. */
    seats: () => lobby && { seats: WAITING.seats.map((z, seat) => ({ seat, z, candidate: lobby?.list.find((c) => c.seat === seat)?.id ?? null })), outside: lobby.outside },
    /** Welcome tours by agent id, and who is still due one. */
    tours: () => ({ tours: Object.fromEntries(tours), due: [...due.keys()] }),
    /** Demo office only: the CEO grows a floor's team by one (a candidate in the lobby), or shrinks it (an envelope). */
    propose: (kind: 'hire' | 'let-go' = 'hire', floor?: number) => api.demoPropose(kind, floor),
    /** Opens a request's card, as E on the candidate (or the envelope on a desk) does. */
    interview: (requestId: string) => useStore.getState().openOverlay({ kind: 'interview', requestId }),
  };
}
