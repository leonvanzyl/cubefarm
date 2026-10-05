import { describe, expect, it } from 'vitest';
import type { Agent } from '../store';
import { doingText, floorRows } from './floorRows';

const agent = (p: Partial<Agent>): Agent =>
  ({ id: 'a', name: 'Ada', role: 'dev', title: '', status: 'idle', task: null, issueNumber: null, issueTitle: null, prNumber: null, desk: 0, ...p }) as Agent;

describe('doingText', () => {
  it('says what each person is on', () => {
    expect(doingText(agent({}))).toBe('Nothing assigned');
    expect(doingText(agent({ status: 'working', task: 'issue', issueNumber: 12, issueTitle: 'Add dark mode' }))).toBe('Issue #12: Add dark mode');
    expect(doingText(agent({ status: 'working', task: 'fix', prNumber: 40, issueTitle: 'Add dark mode' }))).toBe('Fixing PR #40: Add dark mode');
    expect(doingText(agent({ role: 'qa', status: 'working', task: 'qa', prNumber: 40, issueTitle: 'Dark mode' }))).toBe('Testing PR #40: Dark mode');
    expect(doingText(agent({ role: 'qa' }))).toBe('Waiting for a PR to test');
    expect(doingText(agent({ role: 'ceo', status: 'working', issueTitle: 'Reviewing the company' }))).toBe('Reviewing the company');
    expect(doingText(agent({ role: 'ceo' }))).toBe('Free for a chat');
  });
});

describe('floorRows', () => {
  it('gives every person a status in words, its kind and its shape', () => {
    const rows = floorRows([
      agent({ id: 'd1', name: 'Ada', status: 'working', task: 'issue', issueNumber: 3, issueTitle: 'Fix login' }),
      agent({ id: 'd2', name: 'Linus', status: 'error', task: 'issue', issueNumber: 4 }),
      agent({ id: 'q1', name: 'Marple', role: 'qa', title: 'QA lead' }),
    ]);
    expect(rows.map((r) => [r.name, r.role, r.status, r.icon, r.doing])).toEqual([
      ['Ada', 'Developer', 'Working', '▶', 'Issue #3: Fix login'],
      ['Linus', 'Developer', 'Needs help', '✕', 'Issue #4'],
      ['Marple', 'QA lead', 'Idle', '○', 'Waiting for a PR to test'],
    ]);
    expect(rows[1].kind).toBe('bad');
  });
});
