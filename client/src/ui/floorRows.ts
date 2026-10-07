// The floor as a list (FloorList.tsx), for anyone who can't use the 3D view: one row per person with their status in
// words and its shape, the coding agent they run, and what they're doing. Pure, so the wording is tested.

import type { AgentCli, AgentStatus, CliView, SwarmSettings } from '../../../shared/types';
import type { Agent } from '../store';
import { KIND_ICON, STATUS_KIND, type StatusKind } from './statusLook';

export interface FloorRow {
  id: string;
  name: string;
  /** "CEO", or the coding agent they run ("Claude Code", "Codex"…). */
  agent: string;
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

/** The coding agents' names until the office has listed them (CliView.label). */
const CLI_NAMES: Record<AgentCli, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' };

type Runtime = Pick<SwarmSettings, 'runtime' | 'defaultCli'>;

/** The coding agent someone runs: their own pick in Real terminals; the Agent SDK is Claude Code for everyone. */
export const workerCli = (a: Pick<Agent, 'cli' | 'role'>, settings: Runtime): AgentCli =>
  a.role === 'ceo' || settings.runtime !== 'terminal' ? 'claude' : a.cli || settings.defaultCli;

/** What someone is, in a word or two: the CEO, or the coding agent they run. */
export function agentLabel(a: Pick<Agent, 'cli' | 'role'>, settings: Runtime, clis: CliView[]): string {
  if (a.role === 'ceo') return 'CEO';
  const id = workerCli(a, settings);
  return clis.find((c) => c.id === id)?.label ?? CLI_NAMES[id];
}

/** What someone is on, in words. */
export function doingText(a: Pick<Agent, 'role' | 'status' | 'task' | 'issueNumber' | 'issueTitle' | 'prNumber'>): string {
  if (a.role === 'ceo') return a.status === 'working' ? (a.issueTitle ?? 'Working') : 'Free for a chat';
  if (a.status === 'idle') return 'Nothing assigned';
  if (a.task === 'qa') return a.prNumber ? `Testing PR #${a.prNumber}${a.issueTitle ? `: ${a.issueTitle}` : ''}` : 'Testing';
  if (a.task === 'fix' && a.prNumber) return `Fixing PR #${a.prNumber}${a.issueTitle ? `: ${a.issueTitle}` : ''}`;
  if (a.issueNumber) return `Issue #${a.issueNumber}${a.issueTitle ? `: ${a.issueTitle}` : ''}`;
  return a.issueTitle ?? 'Working';
}

/** One row per person, in the order given (agentsOnRepo: by desk). */
export function floorRows(agents: Agent[], settings: Runtime, clis: CliView[]): FloorRow[] {
  return agents.map((a) => {
    const kind = STATUS_KIND[a.status];
    return {
      id: a.id,
      name: a.name,
      agent: agentLabel(a, settings, clis),
      status: STATUS_WORDS[a.status],
      kind,
      icon: KIND_ICON[kind],
      doing: doingText(a),
    };
  });
}
