import { describe, expect, it, vi } from 'vitest';
import type { AgentView, HireRequestView, PullInfo, QaView, RepoView } from '../../../../shared/types';

// overviewInfo counts PRs with the store's floorPrCounts; the store's sounds and gong need a browser.
vi.mock('../../ui/sfx', () => ({ audioUnlocked: () => false, chirp: vi.fn(), cue: vi.fn() }));
vi.mock('../gongRunner', () => ({ gongForMerge: vi.fn(() => 'solo') }));

const { chipFor, floorSummary, lobbySummary, summaryLine } = await import('./overviewInfo');

const agent = (p: Partial<AgentView>) => ({ id: 'a', name: 'Ada', repoId: 'acme/app', role: 'agent', task: null, status: 'idle', desk: 0, ...p }) as AgentView;

describe('chipFor', () => {
  it('names what someone is doing', () => {
    expect(chipFor(agent({ status: 'working', task: 'issue' }))).toBe('working');
    expect(chipFor(agent({ status: 'preparing', task: 'issue' }))).toBe('working');
    expect(chipFor(agent({ status: 'working', task: 'fix' }))).toBe('fixing');
    expect(chipFor(agent({ status: 'working', task: 'qa' }))).toBe('testing');
    expect(chipFor(agent({ status: 'error', task: 'issue' }))).toBe('error');
    expect(chipFor(agent({ status: 'idle' }))).toBe('idle');
    expect(chipFor(agent({ status: 'done', task: 'issue' }))).toBe('idle');
    expect(chipFor(agent({ status: 'stopped', task: 'fix' }))).toBe('idle');
  });
});

describe('floorSummary', () => {
  const pr = (number: number, state: PullInfo['state'] = 'OPEN') => ({ number, state, headRefName: `f/${number}` }) as PullInfo;
  const repo = { id: 'acme/app', floor: 1, pulls: [pr(1), pr(2), pr(3), pr(4, 'MERGED')], issues: [], autoMerge: false } as unknown as RepoView;
  const qa: Record<string, QaView> = {
    'acme/app#1': { repoId: 'acme/app', prNumber: 1, status: 'passed' } as QaView,
    'acme/app#2': { repoId: 'acme/app', prNumber: 2, status: 'needs-human' } as QaView,
  };

  it('counts the team, who is busy, the PRs and what needs the manager', () => {
    const s = floorSummary(
      repo,
      [
        agent({ id: 'q', desk: 12, status: 'working', task: 'qa' }),
        agent({ id: 'b', desk: 1, status: 'error', task: 'issue' }),
        agent({ id: 'a', desk: 0, status: 'working', task: 'issue' }),
        agent({ id: 'x', repoId: 'other/repo', status: 'working' }),
        agent({ id: 'ceo', role: 'ceo', status: 'working' }),
      ],
      qa,
    );
    expect(s).toEqual({ team: 3, busy: 2, inQa: 2, ready: 1, needsYou: 1, errors: 1, chips: ['working', 'error', 'testing'] });
    expect(summaryLine(s)).toBe('2/3 busy · 2 in QA · 1 ready · 1 needs you · 1 stuck');
  });

  it('reads plainly for a quiet floor', () => {
    const s = floorSummary({ ...repo, pulls: [] } as RepoView, [], {});
    expect(summaryLine(s)).toBe('0/0 busy · 0 in QA · 0 ready');
  });
});

describe('lobbySummary', () => {
  it('counts candidates and decisions waiting', () => {
    const req = (kind: HireRequestView['kind'], status: HireRequestView['status']) => ({ kind, status }) as HireRequestView;
    const s = lobbySummary(agent({ role: 'ceo', status: 'working' }), [req('hire', 'pending'), req('let-go', 'pending'), req('hire', 'approved')]);
    expect(s).toEqual({ ceo: 'working', waiting: 1, needsYou: 2 });
    expect(lobbySummary(undefined, []).ceo).toBeNull();
  });
});
