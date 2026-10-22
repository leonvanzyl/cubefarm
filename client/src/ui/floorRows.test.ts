import { describe, expect, it } from 'vitest';
import type { CliView } from '../../../shared/types';
import type { Agent } from '../store';
import { agentLabel, doingText, floorRows, signInFor } from './floorRows';

const agent = (p: Partial<Agent>): Agent =>
  ({ id: 'a', name: 'Ada', role: 'agent', cli: '', status: 'idle', task: null, issueNumber: null, issueTitle: null, prNumber: null, desk: 0, ...p }) as Agent;
const terminals = { runtime: 'terminal', defaultCli: 'claude' } as const;
const clis = [{ id: 'codex', label: 'Codex CLI' }] as CliView[];

describe('doingText', () => {
  it('says what each person is on', () => {
    expect(doingText(agent({}))).toBe('Nothing assigned');
    expect(doingText(agent({ status: 'working', task: 'issue', issueNumber: 12, issueTitle: 'Add dark mode' }))).toBe('Issue #12: Add dark mode');
    expect(doingText(agent({ status: 'working', task: 'fix', prNumber: 40, issueTitle: 'Add dark mode' }))).toBe('Fixing PR #40: Add dark mode');
    expect(doingText(agent({ status: 'working', task: 'qa', prNumber: 40, issueTitle: 'Dark mode' }))).toBe('Testing PR #40: Dark mode');
    expect(doingText(agent({ role: 'ceo', status: 'working', issueTitle: 'Reviewing the company' }))).toBe('Reviewing the company');
    expect(doingText(agent({ role: 'ceo' }))).toBe('Free for a chat');
  });
});

describe('agentLabel', () => {
  it('names the coding agent they run, or the CEO', () => {
    expect(agentLabel(agent({}), terminals, [])).toBe('Claude Code');
    expect(agentLabel(agent({ cli: 'codex' }), terminals, clis)).toBe('Codex CLI');
    expect(agentLabel(agent({ cli: 'opencode' }), terminals, clis)).toBe('OpenCode');
    expect(agentLabel(agent({ cli: 'codex' }), { runtime: 'sdk', defaultCli: 'codex' }, clis)).toBe('Claude Code'); // the Agent SDK is Claude Code
    expect(agentLabel(agent({ role: 'ceo', cli: 'codex' }), terminals, clis)).toBe('CEO');
  });
});

describe('signInFor', () => {
  it('names the coding agent a cloud agent waits to have signed in, whatever the runtime', () => {
    expect(signInFor(agent({ host: 'box', needsSignIn: true }), { defaultCli: 'claude' })).toBe('Claude Code');
    expect(signInFor(agent({ host: 'box', needsSignIn: true, cli: 'codex' }), { defaultCli: 'claude' })).toBe('Codex');
    expect(signInFor(agent({ host: 'box', needsSignIn: false }), { defaultCli: 'claude' })).toBeNull();
    expect(signInFor(agent({ host: 'local', needsSignIn: true }), { defaultCli: 'claude' })).toBeNull(); // a stale flag from before a move
  });

  it('lists someone waiting to be signed in as needing the manager', () => {
    const [row] = floorRows([agent({ host: 'box', needsSignIn: true, status: 'preparing', task: 'issue', issueNumber: 7, issueTitle: 'Dark mode' })], terminals, []);
    expect(row.status).toBe('Needs you to sign in');
    expect(row.kind).toBe('attention');
    expect(row.doing).toBe('Waiting for Claude Code to be signed in · Issue #7: Dark mode');
  });
});

describe('floorRows', () => {
  it('gives every person a status in words, its kind and its shape', () => {
    const rows = floorRows(
      [
        agent({ id: 'd1', name: 'Ada', status: 'working', task: 'issue', issueNumber: 3, issueTitle: 'Fix login' }),
        agent({ id: 'd2', name: 'Linus', status: 'error', task: 'issue', issueNumber: 4 }),
        agent({ id: 'q1', name: 'Marple', cli: 'codex', status: 'working', task: 'qa', prNumber: 9 }),
      ],
      terminals,
      [],
    );
    expect(rows.map((r) => [r.name, r.agent, r.status, r.icon, r.doing])).toEqual([
      ['Ada', 'Claude Code', 'Working', '▶', 'Issue #3: Fix login'],
      ['Linus', 'Claude Code', 'Needs help', '✕', 'Issue #4'],
      ['Marple', 'Codex', 'Working', '▶', 'Testing PR #9'],
    ]);
    expect(rows[1].kind).toBe('bad');
  });
});
