// In-person hiring, live (hiring.ts has the rules): the lobby's waiting room as Candidates.tsx last laid it out, new
// hires due a welcome tour when you next come up to their floor, each tour's progress (ErrandDirector.tsx), and the
// candidates walking out of the front door (Outside.tsx opens it for them). window.__swarmHiring reports all of it,
// and in the demo office makes proposals on demand.

import { api } from '../api';
import { useStore } from '../store';
import { newlyHired, type Lobby, type TourStop } from './hiring';
import { WAITING } from './layout';

/** How long (ms) after a hire their welcome tour still waits for you to come up to their floor. */
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
/** Candidates on their way out through the lobby's front door. */
export const doorWalkers = new Set<string>();

/** Candidates.tsx: the waiting room now (null once the lobby isn't drawn). */
export function setLobby(l: Lobby | null) {
  lobby = l;
}

/** Whether `id` was hired a moment ago and is still due their welcome tour (and hasn't had it); asking uses it up. */
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

useStore.subscribe((state, prev) => {
  if (!prev.loaded || state.requests === prev.requests) return;
  const now = Date.now();
  for (const [id, at] of due) if (now - at >= WELCOME_MS) due.delete(id);
  // (a hire seen walking in already had their welcome: the agent arrives just before the proposal says approved)
  for (const h of newlyHired(prev.requests, state.requests)) if (!tours.has(h.agentId)) due.set(h.agentId, now);
});

if (typeof window !== 'undefined') {
  const describe = (id: string) => {
    const r = useStore.getState().requests.find((x) => x.id === id);
    const floor = r ? (useStore.getState().repos.find((x) => x.id === r.repoId)?.floor ?? null) : null;
    return { name: r?.name ?? null, title: r?.title ?? null, floor };
  };
  (window as unknown as Record<string, unknown>).__swarmHiring = {
    /** The candidates in the lobby (null when it isn't drawn): their chair and whether they're waiting or leaving. */
    candidates: () => lobby?.list.map((c) => ({ ...c, ...describe(c.id) })) ?? null,
    /** Every chair in the waiting room and who's in it, plus how many wait outside for one. */
    seats: () => lobby && { seats: WAITING.seats.map((z, seat) => ({ seat, z, candidate: lobby?.list.find((c) => c.seat === seat)?.id ?? null })), outside: lobby.outside },
    /** Welcome tours by agent id, and who is still due one. */
    tours: () => ({ tours: Object.fromEntries(tours), due: [...due.keys()] }),
    /** Demo office only: the CEO proposes a hire (or letting someone go) now. */
    propose: (kind: 'hire' | 'let-go' = 'hire', floor?: number) => api.demoPropose(kind, floor),
    /** Opens the interview card for a proposal, as E on the candidate (or the envelope on a desk) does. */
    interview: (requestId: string) => useStore.getState().openOverlay({ kind: 'interview', requestId }),
  };
}
