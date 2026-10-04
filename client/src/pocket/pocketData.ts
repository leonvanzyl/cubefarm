// Pocket mode's reading of the office state: each floor's pipeline, what the manager can do with an agent (the same
// as in their terminal panel), and what's waiting on the manager. Pure, so it's tested without a browser.
import type { HireRequestView, QaView, RepoView } from '../../../shared/types';
import { needsManager } from '../qaCard';
import type { Agent, KanbanCard, KanbanColumns } from '../store';

export interface Pipeline {
  backlog: number;
  building: number; // developers on an issue, before their PR
  qa: number; // PRs waiting for or being tested (and stuck ones the CEO is looking at)
  fixing: number; // failed QA, waiting for or being fixed by a developer
  ready: number; // passed QA, waiting to merge
  needsYou: number; // stuck: the manager decides
}

/** A floor's pipeline, from its Kanban columns. */
export function pipelineOf(cols: KanbanColumns): Pipeline {
  const p: Pipeline = { backlog: cols.backlog.length, building: cols.progress.length, qa: 0, fixing: 0, ready: cols.ready.length, needsYou: 0 };
  for (const c of cols.qa) {
    if (needsManager(c.qa)) p.needsYou++;
    else if (c.qa?.status === 'failed' || c.qa?.status === 'fixing') p.fixing++;
    else p.qa++;
  }
  return p;
}

/** What the manager can do with an agent right now, as in their terminal panel (ui/TerminalView.tsx). */
export function agentActions(a: Pick<Agent, 'role' | 'status' | 'branch'>) {
  const working = a.status === 'preparing' || a.status === 'working';
  return {
    stop: working,
    assign: !working,
    clear: !working && a.status !== 'idle',
    message: working || (a.role !== 'qa' && !!a.branch && a.status !== 'idle'),
  };
}

/** What can be handed to them: backlog issues for a developer; untested, queued or stuck PRs for a QA tester. */
export function assignChoices(role: Agent['role'], cols: KanbanColumns | null): KanbanCard[] {
  if (!cols) return [];
  return role === 'qa' ? cols.qa.filter((c) => !c.qa || c.qa.status === 'needs-human' || c.qa.status === 'queued') : cols.backlog;
}

/** One short line on what they're doing. */
export function doing(a: Pick<Agent, 'status' | 'task' | 'issueNumber' | 'issueTitle' | 'prNumber'>): string {
  if (a.status === 'idle') return 'Free';
  if (a.task === 'qa') return `Testing PR #${a.prNumber ?? '?'}${a.issueTitle ? `: ${a.issueTitle}` : ''}`;
  if (a.task === 'fix') return `Fixing PR #${a.prNumber ?? '?'}${a.issueTitle ? `: ${a.issueTitle}` : ''}`;
  if (a.issueNumber != null) return `#${a.issueNumber}${a.issueTitle ? ` ${a.issueTitle}` : ''}`;
  return a.status === 'done' ? 'Finished' : '';
}

export interface Waiting {
  requests: HireRequestView[];
  /** Open PRs stuck on the manager, oldest first. ceoLooking ones are listed too, as the CEO may still hand them on. */
  stuck: { repo: RepoView; qa: QaView }[];
  /** Passed PRs on floors that don't merge on their own. */
  ready: { repo: RepoView; qa: QaView }[];
}

/** Everything waiting on the manager's decision, for the Approvals tab. */
export function waitingOnYou(repos: RepoView[], qa: Record<string, QaView>, requests: HireRequestView[]): Waiting {
  const open = (r: RepoView, q: QaView) => r.pulls.some((p) => p.number === q.prNumber && p.state === 'OPEN');
  const out: Waiting = { requests: requests.filter((r) => r.status === 'pending'), stuck: [], ready: [] };
  for (const q of Object.values(qa).sort((a, b) => a.updatedAt - b.updatedAt)) {
    const repo = repos.find((r) => r.id === q.repoId);
    if (!repo || !open(repo, q)) continue;
    if (q.status === 'needs-human') out.stuck.push({ repo, qa: q });
    else if (q.status === 'passed' && !repo.autoMerge) out.ready.push({ repo, qa: q });
  }
  return out;
}

/** The Approvals tab's badge: decisions only the manager can make right now. */
export const approvalsBadge = (w: Waiting) => w.requests.length + w.stuck.filter((s) => needsManager(s.qa)).length;
