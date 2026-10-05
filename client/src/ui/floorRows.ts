// The floor as a list (FloorList.tsx), for anyone who can't use the 3D view: one row per person with their status in
// words and its shape, and what they're doing. Pure, so the wording is tested.

import type { AgentStatus } from '../../../shared/types';
import type { Agent } from '../store';
import { KIND_ICON, STATUS_KIND, type StatusKind } from './statusLook';

export interface FloorRow {
  id: string;
  name: string;
  role: string;
  status: string;
  kind: StatusKind;
  icon: string;
  doing: string;
}

const STATUS_WORDS: Record<AgentStatus, string> = {
  idle: 'Idle',
  preparing: 'Setting up',
  working: 'Working',
  done: 'Finished',
  error: 'Needs help',
  stopped: 'Stopped',
};

const ROLE_WORDS: Record<Agent['role'], string> = { dev: 'Developer', qa: 'QA tester', ceo: 'CEO' };

/** What someone is on, in words. */
export function doingText(a: Pick<Agent, 'role' | 'status' | 'task' | 'issueNumber' | 'issueTitle' | 'prNumber'>): string {
  const busy = a.status !== 'idle';
  if (a.role === 'ceo') return a.status === 'working' ? (a.issueTitle ?? 'Working') : 'Free for a chat';
  if (!busy) return a.role === 'qa' ? 'Waiting for a PR to test' : 'Nothing assigned';
  if (a.role === 'qa' || a.task === 'qa') return a.prNumber ? `Testing PR #${a.prNumber}${a.issueTitle ? `: ${a.issueTitle}` : ''}` : 'Testing';
  if (a.task === 'fix' && a.prNumber) return `Fixing PR #${a.prNumber}${a.issueTitle ? `: ${a.issueTitle}` : ''}`;
  if (a.issueNumber) return `Issue #${a.issueNumber}${a.issueTitle ? `: ${a.issueTitle}` : ''}`;
  return a.issueTitle ?? 'Working';
}

/** One row per person, in the order given (agentsOnRepo: developers by desk, then testers). */
export function floorRows(agents: Agent[]): FloorRow[] {
  return agents.map((a) => {
    const kind = STATUS_KIND[a.status];
    return {
      id: a.id,
      name: a.name,
      role: a.title || ROLE_WORDS[a.role],
      status: STATUS_WORDS[a.status],
      kind,
      icon: KIND_ICON[kind],
      doing: doingText(a),
    };
  });
}
