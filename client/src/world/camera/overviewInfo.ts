// What the overview and the building view say about people and floors: the status chip over each desk and each floor's
// live summary. Pure, so the tests can check it; OverviewChips.tsx and BuildingView.tsx draw it.

import type { HireRequestView, QaView, RepoView } from '../../../../shared/types';
import { floorPrCounts, type Agent } from '../../store';

export type ChipKind = 'working' | 'testing' | 'fixing' | 'error' | 'idle';

export const CHIP_COLORS: Record<ChipKind, string> = {
  working: '#2dc653',
  testing: '#4cc9f0',
  fixing: '#ff9f1c',
  error: '#ef476f',
  idle: '#adb5bd',
};

/** The chip for someone: in trouble, testing a PR, fixing one, on an issue, or not busy. */
export function chipFor(a: Pick<Agent, 'status' | 'task'>): ChipKind {
  if (a.status === 'error') return 'error';
  if (a.status !== 'working' && a.status !== 'preparing') return 'idle';
  if (a.task === 'qa') return 'testing';
  return a.task === 'fix' ? 'fixing' : 'working';
}

export interface FloorSummary {
  team: number;
  busy: number;
  inQa: number;
  ready: number;
  /** PRs waiting on the manager. */
  needsYou: number;
  /** People stuck on an error. */
  errors: number;
  /** Everyone's chip, by desk. */
  chips: ChipKind[];
}

/** A floor at a glance, matching the HUD and the Kanban's counts. `agents` are the floor's people. */
export function floorSummary(repo: RepoView, agents: Agent[], qa: Record<string, QaView>): FloorSummary {
  const people = agents
    .filter((a) => a.repoId === repo.id && a.role !== 'ceo')
    .sort((a, b) => a.desk - b.desk);
  const chips = people.map(chipFor);
  const prs = floorPrCounts(repo, qa);
  return {
    team: people.length,
    busy: chips.filter((c) => c !== 'idle' && c !== 'error').length,
    inQa: prs.inQa,
    ready: prs.ready,
    needsYou: prs.needsYou,
    errors: chips.filter((c) => c === 'error').length,
    chips,
  };
}

export interface LobbySummary {
  ceo: ChipKind | null;
  /** Candidates on the chairs. */
  waiting: number;
  /** Decisions waiting on the manager: hires and let-gos. */
  needsYou: number;
}

export function lobbySummary(ceo: Agent | undefined, requests: HireRequestView[]): LobbySummary {
  const pending = requests.filter((r) => r.status === 'pending');
  return { ceo: ceo ? chipFor(ceo) : null, waiting: pending.filter((r) => r.kind === 'hire').length, needsYou: pending.length };
}

/** One line for a floor's slice in the building view. */
export function summaryLine(s: FloorSummary) {
  const parts = [`${s.busy}/${s.team} busy`, `${s.inQa} in QA`, `${s.ready} ready`];
  if (s.needsYou) parts.push(`${s.needsYou} need${s.needsYou === 1 ? 's' : ''} you`);
  if (s.errors) parts.push(`${s.errors} stuck`);
  return parts.join(' · ');
}
