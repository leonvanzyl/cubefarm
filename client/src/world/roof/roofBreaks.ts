// Roof breaks: now and then an idle agent rides the elevator up to the roof for a sit in a deck chair,
// and the CEO goes up to take a call. Who is up there is kept here, shared by the floors' errand (roofErrand.ts: into
// the elevator and, a while later, back out of it) and the roof's own visitors (RoofPeople.tsx: out of the elevator,
// to a deck chair and back), so whoever you follow up finds them there. The rules are pure; times are Date.now() ms.

export type VisitKind = 'break' | 'call';

export interface RoofVisit {
  id: string;
  kind: VisitKind;
  /** When they step out of the elevator up top, and when they head back down. */
  arrive: number;
  leave: number;
  /** Their deck chair on a break; -1 for a call. */
  chair: number;
}

export const ROOF_BREAK = {
  /** Seconds up there on a break, and on a call. */
  stay: [50, 100] as const,
  call: [35, 70] as const,
  /** Seconds the elevator takes between a floor and the roof. */
  ride: 4,
  /** At most this many on a break at once; the CEO's call comes on top. */
  max: 2,
  /** How likely a roof break is among the idle errands someone fancies (rare), and the CEO's call among theirs. */
  weight: 0.12,
  callWeight: 0.35,
};

const SECOND = 1000;

/** Whether a visit is still on at `now`: on the way up, up there, or riding back down. */
export const visitOn = (v: RoofVisit, now: number) => now < v.leave + ROOF_BREAK.ride * SECOND;

/** Where a visit is at `now`: riding up, up on the roof, or heading back down (and then gone). */
export function visitStage(v: RoofVisit, now: number): 'riding' | 'up' | 'down' {
  if (now < v.arrive) return 'riding';
  return now < v.leave ? 'up' : 'down';
}

/** A deck chair for a new visitor: one nobody is in or heading for (the player's included), or -1 when all are taken. */
export function freeChair(visits: readonly RoofVisit[], chairs: number, playerChair: number | null, rand: number): number {
  const taken = new Set(visits.filter((v) => v.kind === 'break').map((v) => v.chair));
  if (playerChair !== null) taken.add(playerChair);
  const free = Array.from({ length: chairs }, (_, i) => i).filter((i) => !taken.has(i));
  return free.length ? free[Math.min(free.length - 1, Math.floor(rand * free.length))] : -1;
}

/** Whether there's room up there for another visit of this kind (someone already up can't go again). */
export function roomFor(visits: readonly RoofVisit[], id: string, kind: VisitKind, now: number): boolean {
  const on = visits.filter((v) => visitOn(v, now));
  if (on.some((v) => v.id === id)) return false;
  return kind === 'call' ? !on.some((v) => v.kind === 'call') : on.filter((v) => v.kind === 'break').length < ROOF_BREAK.max;
}

/**
 * A new visit for `id`, stepping out up top `ride` seconds from now (the elevator) and staying a while (`rand` in
 * [0, 1) picks how long). Null when there's no room or no free chair.
 */
export function planVisit(
  visits: readonly RoofVisit[],
  id: string,
  kind: VisitKind,
  now: number,
  rand: number,
  o: { chairs: number; playerChair: number | null; ride?: number; stay?: number },
): RoofVisit | null {
  if (!roomFor(visits, id, kind, now)) return null;
  const on = visits.filter((v) => visitOn(v, now));
  const chair = kind === 'break' ? freeChair(on, o.chairs, o.playerChair, rand) : -1;
  if (kind === 'break' && chair < 0) return null;
  const [lo, hi] = kind === 'call' ? ROOF_BREAK.call : ROOF_BREAK.stay;
  const arrive = now + (o.ride ?? ROOF_BREAK.ride) * SECOND;
  return { id, kind, arrive, leave: arrive + Math.round((o.stay ?? lo + rand * (hi - lo)) * SECOND), chair };
}

// ---------- who's up there now ----------

const visits = new Map<string, RoofVisit>();

/** Every visit still on (stale ones are dropped as they're read). */
export function roofVisits(now = Date.now()): RoofVisit[] {
  for (const [id, v] of visits) if (!visitOn(v, now)) visits.delete(id);
  return [...visits.values()];
}

/** `id`'s visit while it's on, or null. */
export function roofVisit(id: string, now = Date.now()): RoofVisit | null {
  const v = visits.get(id);
  return v && visitOn(v, now) ? v : null;
}

export function startVisit(v: RoofVisit) {
  visits.set(v.id, v);
}

/** Over: they're back down (or never got there). */
export function endVisit(id: string) {
  visits.delete(id);
}

/** Changes a visit (heading down early when work comes in, say). */
export function updateVisit(id: string, patch: Partial<Omit<RoofVisit, 'id'>>) {
  const v = visits.get(id);
  if (v) visits.set(id, { ...v, ...patch });
}
