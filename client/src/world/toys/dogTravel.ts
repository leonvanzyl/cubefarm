import type { AgentView, PullInfo, QaView, RepoView } from '../../../../shared/types';

// The office dog across the building, as pure rules (dogState.ts runs them): one dog, on one floor at a time, which now
// and then takes the elevator somewhere else while you aren't watching it (and, while you are, when its brain says
// so). Plus who on a floor is having a hard time, for its visits. Times are performance.now() milliseconds.

/** How long it stays on a floor you aren't on before taking the elevator elsewhere. */
export const STAY = { min: 120_000, max: 300_000 };
/** Arriving on a floor this recently, it's still stepping out of the elevator when you get there. */
export const FRESH = 8_000;

/** How the dog shows up when its floor is drawn: out of the elevator, beside the player (they rode up together), or already about. */
export type Arrival = 'cabin' | 'player' | 'here';

export interface DogWhere {
  floor: number;
  since: number;
  stay: number;
  arriving: 'cabin' | 'player' | null;
  /** Where it was when you last left it on this floor (brain heading), to carry on from there. */
  seen: { x: number; z: number; heading: number } | null;
  /** Called to the player: it follows them once it's there. */
  called: boolean;
  /** Seconds of following left when it rode the elevator with you. */
  follow: number;
  rides: number;
}

export function createWhere(floor: number, now: number, rand: number): DogWhere {
  return { floor, since: now, stay: STAY.min + (STAY.max - STAY.min) * rand, arriving: null, seen: null, called: false, follow: 0, rides: 0 };
}

/**
 * The next floor to go to: any other floor of the building, the player's twice as likely (it likes company) and one
 * where someone's having a hard time three times as likely. `rand` in [0, 1). The same floor when there's no other.
 */
export function pickFloor(cur: number, floors: readonly number[], player: number, troubled: ReadonlySet<number>, rand: number): number {
  const others = floors.filter((f) => f !== cur);
  if (!others.length) return cur;
  const weight = (f: number) => (troubled.has(f) ? 3 : 1) * (f === player ? 2 : 1);
  const total = others.reduce((s, f) => s + weight(f), 0);
  let r = rand * total;
  for (const f of others) {
    r -= weight(f);
    if (r < 0) return f;
  }
  return others[others.length - 1];
}

/** It got to `floor` (by elevator, alone or with the player). */
export function arriveAt(w: DogWhere, floor: number, now: number, how: 'cabin' | 'player', rand: number) {
  w.floor = floor;
  w.since = now;
  w.stay = STAY.min + (STAY.max - STAY.min) * rand;
  w.arriving = how;
  w.seen = null;
  w.rides++;
}

/**
 * Moves the dog on when it has stayed long enough on a floor nobody is watching it on (`watched`: it's drawn on the
 * player's floor, where its brain decides), or at once when its floor is gone. True when it moved.
 */
export function settle(w: DogWhere, now: number, watched: boolean, floors: readonly number[], player: number, troubled: ReadonlySet<number>, rand: () => number): boolean {
  if (!floors.includes(w.floor)) {
    arriveAt(w, floors.includes(player) ? player : (floors[0] ?? 0), now, 'cabin', rand());
    return true;
  }
  if (watched || now - w.since < w.stay) return false;
  const next = pickFloor(w.floor, floors, player, troubled, rand());
  if (next === w.floor) {
    w.since = now;
    return false;
  }
  arriveAt(w, next, now, 'cabin', rand());
  return true;
}

/** How it shows up on `floor` when that floor is drawn now (it's there). */
export function arrival(w: DogWhere, now: number): Arrival {
  if (w.arriving === 'player') return 'player';
  if (w.arriving === 'cabin' && now - w.since < FRESH) return 'cabin';
  return 'here';
}

type Teammate = Pick<AgentView, 'id' | 'role' | 'task' | 'repoId' | 'prNumber' | 'branch'>;

/** Whether an open PR has its author having a hard time: CI red, stuck for a human, or a third round of fixes. */
export function troubledPr(p: Pick<PullInfo, 'state' | 'checks'>, rec: Pick<QaView, 'status' | 'round'> | undefined): boolean {
  if (p.state !== 'OPEN') return false;
  if (p.checks === 'failing' || rec?.status === 'needs-human') return true;
  return !!rec && rec.round >= 3 && (rec.status === 'failed' || rec.status === 'fixing');
}

/**
 * The agents on `repo`'s floor having a hard time: their PR's checks are red, it needs a human, or it's on its
 * third round of fixes (QA's round 3 or later, failed or being fixed). `forced` adds anyone by hand (QA's probe).
 */
export function hardTimes(repo: Pick<RepoView, 'id' | 'pulls'>, agents: readonly Teammate[], qa: Record<string, QaView>, forced: ReadonlySet<string> = new Set()): string[] {
  const team = agents.filter((a) => a.repoId === repo.id && a.role !== 'ceo');
  // an agent testing a PR has its number too, but didn't write it
  const authors = team.filter((a) => a.task !== 'qa');
  const out = new Set(team.filter((a) => forced.has(a.id)).map((a) => a.id));
  for (const p of repo.pulls) {
    const rec = qa[`${repo.id}#${p.number}`];
    if (!troubledPr(p, rec)) continue;
    const author = team.find((a) => a.id === rec?.devAgentId) ?? authors.find((a) => a.prNumber === p.number) ?? authors.find((a) => !!a.branch && a.branch === p.headRefName);
    if (author) out.add(author.id);
  }
  return [...out].sort();
}
