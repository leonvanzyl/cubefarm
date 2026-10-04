import { describe, expect, it } from 'vitest';
import type { PullInfo, QaView } from '../../../shared/types';
import { mergeAuthor } from './confetti';
import { BEATS, REACH_MS, createRuns, nextBeat, nextJob, planGong, startRun, timedOut, type GongJob, type GongRuns } from './gongRun';
import { GONG_GAP_MS } from './gongRules';

const agents = [
  { id: 'a1', name: 'Ada', role: 'dev' as const, repoId: 'o/r' },
  { id: 'a2', name: 'Grace Hopper', role: 'dev' as const, repoId: 'o/r' },
];
const pr = (headRefName: string) => ({ headRefName }) as PullInfo;
const qa = (devAgentId: string | null) => ({ repoId: 'o/r', prNumber: 7, devAgentId }) as QaView;
const here = { repoId: 'o/r', here: 'o/r', present: true, covered: false };

describe('who runs to the gong', () => {
  const plan = (head: string, q?: QaView) => {
    const agentId = mergeAuthor('o/r', pr(head), q, agents);
    return { agentId, plan: planGong({ ...here, agentId }) };
  };

  it('the QA record’s developer, else the one named in the branch, else nobody (it strikes by itself)', () => {
    expect(plan('swarm/issue-7-ada', qa('a2'))).toEqual({ agentId: 'a2', plan: 'run' });
    expect(plan('swarm/issue-7-GRACE-HOPPER')).toEqual({ agentId: 'a2', plan: 'run' });
    expect(plan('feature/login')).toEqual({ agentId: null, plan: 'solo' });
  });

  it('strikes by itself when the author isn’t drawn or the view is hidden, and does nothing off this floor', () => {
    expect(planGong({ ...here, agentId: 'a1', present: false })).toBe('solo');
    expect(planGong({ ...here, agentId: 'a1', covered: true })).toBe('solo');
    expect(planGong({ ...here, agentId: 'a1', here: 'o/other' })).toBe('absent');
    expect(planGong({ ...here, agentId: null, here: null })).toBe('absent');
  });
});

describe('the gong queue', () => {
  const queue = (...jobs: GongJob[]): GongRuns => ({ ...createRuns(), queue: jobs });
  const solo = { agentId: null, celebrate: true };
  const ada = { agentId: 'a1', celebrate: true };

  it('two strikes by themselves boom in order, each once the gong would boom again', () => {
    const q = queue(solo, { ...solo, celebrate: false });
    let hitAt = -Infinity;
    expect(nextJob(q, 1000, hitAt)).toEqual(solo); // the first, straight away
    hitAt = 1000;
    expect(nextJob(q, 1000 + GONG_GAP_MS - 1, hitAt)).toBeNull();
    expect(nextJob(q, 1000 + GONG_GAP_MS, hitAt)).toEqual({ agentId: null, celebrate: false });
    expect(q.queue).toEqual([]);
  });

  it('one runner at the gong at a time: the next waits until they head back', () => {
    const q = queue(ada, { agentId: 'a2', celebrate: true }, solo);
    const job = nextJob(q, 0, -Infinity)!;
    expect(job.agentId).toBe('a1');
    q.run = startRun(ada, 0, []);
    expect(nextJob(q, 5000, -Infinity)).toBeNull();
    q.run = null; // a1 left the gong
    expect(nextJob(q, 5000, -Infinity)?.agentId).toBe('a2');
    expect(q.queue).toEqual([solo]);
  });

  it('a runner doesn’t wait for the gong to stop ringing before setting off', () => {
    expect(nextJob(queue(ada), 100, 0)).toEqual(ada);
  });
});

describe('a run at the gong', () => {
  it('takes the mallet, winds up, strikes, poses and heads back, on time', () => {
    const r = startRun({ agentId: 'a1', celebrate: true }, 0, []);
    r.beat = 'take';
    r.since = 3000;
    expect(nextBeat(r, 3000 + BEATS.take - 1, -Infinity)).toBeNull();
    expect(nextBeat(r, 3000 + BEATS.take, -Infinity)).toBe('windup');
    Object.assign(r, { beat: 'windup', since: 4000 });
    expect(nextBeat(r, 4000 + BEATS.windup, -Infinity)).toBe('strike');
    Object.assign(r, { beat: 'strike', since: 5000 });
    expect(nextBeat(r, 5000 + BEATS.strike, 5000)).toBe('pose');
    Object.assign(r, { beat: 'pose', since: 6000 });
    expect(nextBeat(r, 6000 + BEATS.pose, 5000)).toBe('back');
    Object.assign(r, { beat: 'run' });
    expect(nextBeat(r, 99_000, -Infinity)).toBeNull(); // running ends on arrival, not on a clock
  });

  it('holds the wind-up while the gong still rings from the last merge, so each gets its own boom', () => {
    const r = Object.assign(startRun({ agentId: 'a1', celebrate: true }, 0, []), { beat: 'windup', since: 1000 });
    const hitAt = 1200;
    expect(nextBeat(r, hitAt + GONG_GAP_MS - 1, hitAt)).toBeNull();
    expect(nextBeat(r, hitAt + GONG_GAP_MS, hitAt)).toBe('strike');
  });

  it('gives up (and the gong strikes by itself) when they haven’t struck within REACH_MS', () => {
    const r = startRun({ agentId: 'a1', celebrate: true }, 1000, []);
    expect(timedOut(r, 1000 + REACH_MS)).toBe(false);
    expect(timedOut(r, 1001 + REACH_MS)).toBe(true);
    r.beat = 'windup';
    expect(timedOut(r, 1001 + REACH_MS)).toBe(true);
    r.beat = 'pose'; // already struck: nothing to give up on
    expect(timedOut(r, 1001 + REACH_MS)).toBe(false);
  });
});
