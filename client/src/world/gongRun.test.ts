import { describe, expect, it } from 'vitest';
import type { PullInfo, QaView } from '../../../shared/types';
import { mergeAuthor } from './confetti';
import { SIT_SECONDS } from './body';
import { BEATS, REACH_MS, RUN_SPEED, createRuns, elsewhere, nextBeat, nextJob, planGong, runOf, startRun, takenOver, timedOut, type GongJob, type GongRuns } from './gongRun';
import { GONG_GAP_MS } from './gongRules';
import { GONG_SPOT, MAX_DESKS, deskPosition } from './layout';
import { bodyTarget, claimBody, onClaim, onErrand, seatBody, setBody, setErrand } from './people';
import { findPath, walkways } from './walkways';

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

  it('strikes by itself when someone is walking the author by hand (__swarmPeople.walkTo)', () => {
    const q = createRuns();
    const theirs = { mode: 'walking' };
    const taken = elsewhere(theirs, runOf(q, 'a1')?.mine);
    expect(taken).toBe(true);
    expect(planGong({ ...here, agentId: 'a1', elsewhere: taken })).toBe('solo');
    expect(elsewhere(undefined, undefined)).toBe(false); // seated: free to run
  });

  it('an author out on an errand still runs: the gong beats it', () => {
    const errand = { mode: 'walking' };
    const taken = elsewhere(errand, runOf(createRuns(), 'a1')?.mine, true);
    expect(taken).toBe(false);
    expect(planGong({ ...here, agentId: 'a1', elsewhere: taken })).toBe('run');
  });

  it('claiming someone on an errand has the director drop it, and clears their body target for the run', () => {
    const dropped: string[] = [];
    const stop = onClaim((id) => dropped.push(id));
    setBody('e1', { mode: 'walking', x: 3, z: 4 });
    setErrand('e1', { name: 'stretch', phase: 'leaving', spot: 'window-1' });
    expect(onErrand('e1')).toBe(true);
    claimBody('e1');
    stop();
    expect(dropped).toEqual(['e1']);
    expect(onErrand('e1')).toBe(false);
    expect(bodyTarget('e1')).toBeUndefined();
    // walked by hand: no errand, so it's still someone else's
    setBody('h1', { mode: 'walking', x: 1, z: 1 });
    expect(elsewhere(bodyTarget('h1'), undefined, onErrand('h1'))).toBe(true);
    seatBody('h1');
  });

  it('a runner on the way back from the last strike may turn round for the next', () => {
    const q = createRuns();
    const r = startRun({ agentId: 'a1', celebrate: true }, 0, []);
    r.mine = { mode: 'walking' };
    q.home.push(r);
    expect(elsewhere(r.mine, runOf(q, 'a1')?.mine)).toBe(false);
    expect(elsewhere({ mode: 'walking' }, runOf(q, 'a1')?.mine)).toBe(true);
  });
});

describe('someone else taking the runner over', () => {
  it('lets them go once their body target is no longer the run’s own, or is cleared', () => {
    const r = startRun({ agentId: 'a1', celebrate: true }, 0, []);
    const mine = { mode: 'walking' };
    r.mine = mine;
    expect(takenOver(r, mine)).toBe(false);
    expect(takenOver(r, { ...mine })).toBe(true); // walkTo / an errand set a new target
    expect(takenOver(r, undefined)).toBe(true); // someone sat them down
    r.mine = undefined; // the run sat them down itself
    expect(takenOver(r, undefined)).toBe(false);
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

  it('gives up (and the gong strikes by itself) when they haven’t reached it within REACH_MS', () => {
    const r = startRun({ agentId: 'a1', celebrate: true }, 1000, []);
    expect(timedOut(r, 1000 + REACH_MS)).toBe(false);
    expect(timedOut(r, 1001 + REACH_MS)).toBe(true);
    for (const beat of ['take', 'windup', 'strike', 'pose'] as const) {
      r.beat = beat; // at the gong: the strike plays out, however long the run took
      expect(timedOut(r, 1001 + REACH_MS)).toBe(false);
    }
  });

  it('every desk’s developer reaches the gong and winds up well within REACH_MS', () => {
    const w = walkways('office');
    const longest = Math.max(
      ...Array.from({ length: MAX_DESKS }, (_, slot) => {
        // where they stand up: Character.tsx's STAND beside the chair, which Desk.tsx puts 0.8 behind the desk
        const d = deskPosition(slot);
        let at = { x: d.x + 0.62, z: d.z + 0.7 };
        let m = 0;
        for (const p of findPath(w, at, GONG_SPOT)!) {
          m += Math.hypot(p.x - at.x, p.z - at.z);
          at = p;
        }
        return m;
      }),
    );
    expect(longest).toBeGreaterThan(25); // the far corner desk (slot 3)
    // getting up, the run (the corners and speeding up cost about a fifth: allow a quarter, and the step closer to
    // strike), then taking the mallet and the wind-up, which may wait out the last merge's ring
    const ms = SIT_SECONDS * 1000 + ((longest + 1) / (RUN_SPEED * 0.75)) * 1000 + BEATS.take + BEATS.windup + GONG_GAP_MS;
    expect(ms).toBeLessThan(REACH_MS);
  });
});
