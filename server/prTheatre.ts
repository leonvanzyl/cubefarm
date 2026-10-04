// The PR theatre's decisions, kept pure for tests: which slot, worktree and port a PR preview gets, which one makes
// room for a new one, and when one stops on its own (nobody watching, or its PR is no longer open).

/** PR previews at once, besides each floor's main preview. */
export const MAX_PR_PREVIEWS = 2;
/** How often an open viewer says what it has on screen. */
export const WATCH_EVERY_MS = 30_000;
/** A viewer that hasn't said so for this long has closed. */
export const WATCH_MS = 75_000;

/** A slot's worktree (desks/<slug>) and the branch it checks the PR out on. Slots are reused, so installs can be skipped. */
export const prSlug = (slot: number) => `preview-pr-${slot}`;
export const prBranch = (slot: number) => `swarm-preview-pr-${slot}`;
export const prKey = (repoId: string, pr: number) => `${repoId}#${pr}`;

/**
 * The ports a slot's preview may use, in order: one lane per slot in the hundred above the floor previews' base
 * (6401, 6403 … for slot 1 and 6402, 6404 … for slot 2 by default), never the floor previews' own hundred.
 */
export function prPortCandidates(base: number, slot: number, slots = MAX_PR_PREVIEWS): number[] {
  const out: number[] = [];
  for (let p = base + 100 + slot; p < base + 200; p += slots) out.push(p);
  return out;
}

/** What the rules need to know about a running (or failed) PR preview. */
export interface PrRunInfo {
  key: string;
  repoId: string;
  pr: number;
  slot: number;
  /** Being set up or running; false once it failed. */
  active: boolean;
  viewedAt: number;
}

/** The lowest slot no PR preview holds, or null when they're all taken. */
export function freeSlot(runs: Pick<PrRunInfo, 'slot'>[], slots = MAX_PR_PREVIEWS): number | null {
  for (let s = 1; s <= slots; s++) if (!runs.some((r) => r.slot === s)) return s;
  return null;
}

/** The PR previews some viewer has on screen: each viewer's latest word, if it's recent enough. */
export function onScreen(watches: Iterable<{ key: string | null; at: number }>, now: number, watchMs = WATCH_MS): Set<string> {
  const out = new Set<string>();
  for (const w of watches) if (w.key && now - w.at <= watchMs) out.add(w.key);
  return out;
}

/**
 * Which PR preview stops to make room for a new one: never one on screen; a failed one first, then the one unwatched
 * the longest. Null: every one is on screen.
 */
export function pickEviction(runs: PrRunInfo[], screen: Set<string>): string | null {
  const idle = runs.filter((r) => !screen.has(r.key));
  idle.sort((a, b) => Number(a.active) - Number(b.active) || a.viewedAt - b.viewedAt);
  return idle[0]?.key ?? null;
}

/** PR previews nobody has had on screen for idleMs. */
export function expired(runs: PrRunInfo[], screen: Set<string>, now: number, idleMs: number): string[] {
  return runs.filter((r) => !screen.has(r.key) && now - r.viewedAt >= idleMs).map((r) => r.key);
}

/**
 * The floor's PR previews whose PR merged or closed. A PR missing from the list counts as closed too (closed PRs
 * drop out of it), unless the open list was cut off at its limit.
 */
export function closedPrs(runs: PrRunInfo[], repoId: string, pulls: { number: number; state: string }[], openLimit = 50): string[] {
  const full = pulls.filter((p) => p.state === 'OPEN').length >= openLimit;
  return runs
    .filter((r) => r.repoId === repoId)
    .filter((r) => {
      const p = pulls.find((x) => x.number === r.pr);
      return p ? p.state !== 'OPEN' : !full;
    })
    .map((r) => r.key);
}
