import { describe, expect, it } from 'vitest';
import {
  ALARM_ERROR_MS,
  DAY_MS,
  emptyHistory,
  floorAlarms,
  HOUR_MS,
  hourlyCounts,
  KEEP_MS,
  loadHistory,
  median,
  opsView,
  recordChecks,
  recordCost,
  recordMerges,
  recordQa,
  startOfDay,
  type OpsFloorState,
  type OpsHistory,
} from './metrics.ts';

// A Wednesday afternoon, local time.
const NOW = new Date(2026, 8, 30, 15, 20).getTime();
const MIN = 60_000;
const iso = (t: number) => new Date(t).toISOString();

const merged = (number: number, mergedAt: number, createdAt: number, issueCreatedAt: number | null = null) => ({
  number,
  state: 'MERGED' as const,
  mergedAt: iso(mergedAt),
  createdAt: iso(createdAt),
  issueCreatedAt: issueCreatedAt === null ? null : iso(issueCreatedAt),
});

function floor(over: Partial<OpsFloorState> = {}): OpsFloorState {
  return { repoId: 'o/a', floor: 1, ready: 0, agents: [], prs: [], ...over };
}

const agent = (over: Partial<OpsFloorState['agents'][number]>) => ({ id: 'x', name: 'Ada', role: 'agent' as const, task: null, status: 'idle' as const, endedAt: null, lastError: null, ...over });
const pr = (number: number, status: string | null, ceoLooking = false, why: string | null = null) => ({
  number,
  qa: status ? { status: status as 'queued', ceoLooking, updatedAt: NOW - 30 * MIN } : null,
  why,
});

describe('recording the history', () => {
  it('records each merge once, with its lead time from when its issue was filed', () => {
    const h = emptyHistory();
    const pulls = [merged(10, NOW - HOUR_MS, NOW - 2 * HOUR_MS, NOW - 5 * HOUR_MS), merged(11, NOW - 10 * MIN, NOW - 40 * MIN), { ...merged(12, NOW, NOW), state: 'OPEN' as const, mergedAt: null }];
    expect(recordMerges(h, 'o/a', pulls, NOW)).toBe(2);
    expect(h.merges).toEqual([
      [NOW - HOUR_MS, 'o/a', 10, 4 * HOUR_MS],
      [NOW - 10 * MIN, 'o/a', 11, 30 * MIN], // no known issue: from the PR's opening
    ]);
    expect(recordMerges(h, 'o/a', pulls, NOW)).toBe(0);
    expect(recordMerges(h, 'o/b', pulls, NOW)).toBe(2); // the same numbers on another floor are other PRs
  });

  it("skips merges older than a week, so they don't come back after pruning", () => {
    const h = emptyHistory();
    expect(recordMerges(h, 'o/a', [merged(3, NOW - KEEP_MS - MIN, NOW - KEEP_MS - HOUR_MS)], NOW)).toBe(0);
  });

  it('records finished check runs per commit and result, and ignores running or untimed ones', () => {
    const h = emptyHistory();
    const done = { ms: 4 * MIN, doneAt: NOW - MIN };
    const pulls = [
      { checks: 'passing' as const, headSha: 'aaaaaaaaaaaa', checkRun: done },
      { checks: 'pending' as const, headSha: 'bbbbbbbbbbbb', checkRun: null },
      { checks: 'failing' as const, headSha: 'cccccccccccc' }, // GitHub gave no times
    ];
    expect(recordChecks(h, 'o/a', pulls, NOW)).toBe(1);
    expect(recordChecks(h, 'o/a', pulls, NOW)).toBe(0);
    expect(h.checks).toEqual([[NOW - MIN, 'o/a', 'aaaaaaaa', true, 4 * MIN]]);
    // a failed run re-run green on the same commit counts again
    expect(recordChecks(h, 'o/a', [{ checks: 'failing', headSha: 'dddddddd', checkRun: done }], NOW)).toBe(1);
    expect(recordChecks(h, 'o/a', [{ checks: 'passing', headSha: 'dddddddd', checkRun: { ms: 3 * MIN, doneAt: NOW } }], NOW)).toBe(1);
  });

  it('leaves out zero costs and prunes anything older than a week', () => {
    const h = emptyHistory();
    recordCost(h, 'o/a', 0, NOW);
    recordCost(h, 'o/a', 0.42, NOW);
    h.qa.push([NOW - KEEP_MS - 1, 'o/a', true, 0]);
    recordQa(h, 'o/a', false, 5 * MIN, NOW);
    expect(h.cost).toEqual([[NOW, 'o/a', 0.42]]);
    expect(h.qa).toEqual([[NOW, 'o/a', false, 5 * MIN]]);
  });

  it('loads only well-formed entries from the state file', () => {
    const h = loadHistory(
      {
        merges: [[NOW - MIN, 'o/a', 3, null], [NOW, 'o/a', 'x', 1], 'junk', [NOW - KEEP_MS - DAY_MS, 'o/a', 1, 2]],
        qa: [[NOW, 'o/a', true, 60]],
        checks: [[NOW, 'o/a', 'abc', true]],
        cost: [[NOW, '', 1.5]],
      },
      NOW,
    );
    expect(h).toEqual({ merges: [[NOW - MIN, 'o/a', 3, null]], qa: [[NOW, 'o/a', true, 60]], checks: [], cost: [[NOW, '', 1.5]] });
    expect(loadHistory(undefined, NOW)).toEqual(emptyHistory());
  });
});

describe('the numbers', () => {
  it('medians', () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('counts per clock hour, the current hour last', () => {
    const top = new Date(2026, 8, 30, 15, 0).getTime();
    const spark = hourlyCounts([NOW, top, top - 1, top - HOUR_MS, top - 23 * HOUR_MS, top - 24 * HOUR_MS, NOW + MIN], NOW);
    expect(spark).toHaveLength(24);
    expect(spark[23]).toBe(2); // 15:20 and 15:00
    expect(spark[22]).toBe(2); // 14:59:59.999 and 14:00
    expect(spark[0]).toBe(1); // 16:00 yesterday; 15:00 yesterday is outside
    expect(spark.reduce((a, b) => a + b)).toBe(5);
  });

  it("splits a floor's open PRs and people into the pipeline and the team", () => {
    const f = floor({
      ready: 3,
      agents: [
        agent({ id: '1', task: 'issue', status: 'working' }),
        agent({ id: '2', task: 'fix', status: 'working' }),
        agent({ id: '3', task: 'issue', status: 'preparing' }),
        agent({ id: '4', status: 'error', endedAt: NOW - MIN }),
        agent({ id: '5', task: 'qa', status: 'working' }),
        agent({ id: '7', role: 'ceo', task: 'issue', status: 'working' }),
        agent({ id: '6', status: 'done' }),
      ],
      prs: [pr(1, null), pr(2, 'queued'), pr(3, 'testing'), pr(4, 'failed'), pr(5, 'fixing'), pr(6, 'passed'), pr(7, 'needs-human'), pr(8, 'needs-human', true)],
    });
    const v = opsView([f], emptyHistory(), NOW);
    expect(v.floors[0]).toMatchObject({ ready: 3, building: 2, inQa: 3, fixing: 2, toMerge: 1, needsYou: 1, triage: 1, busy: 4, errors: 1, idle: 1 });
    expect(v.total).toMatchObject({ ready: 3, building: 2, needsYou: 1, busy: 4 });
  });

  it('throughput, flow, CI and cost per floor, with the CEO counted in the total only', () => {
    const h: OpsHistory = {
      merges: [
        [NOW - 10 * MIN, 'o/a', 1, 2 * HOUR_MS],
        [NOW - 2 * HOUR_MS, 'o/a', 2, 4 * HOUR_MS],
        [NOW - 2 * DAY_MS, 'o/a', 3, 9 * HOUR_MS], // outside the lead-time day
        [NOW - 3 * HOUR_MS, 'o/b', 4, null],
      ],
      qa: [
        [NOW - HOUR_MS, 'o/a', true, 6 * MIN],
        [NOW - 2 * HOUR_MS, 'o/a', false, 2 * MIN],
        [NOW - 3 * DAY_MS, 'o/a', false, 60 * MIN],
      ],
      checks: [
        [NOW - HOUR_MS, 'o/a', 'a', true, 4 * MIN],
        [NOW - 2 * DAY_MS, 'o/a', 'b', false, 8 * MIN],
        [NOW - DAY_MS, 'o/b', 'c', true, 6 * MIN],
      ],
      cost: [
        [NOW - HOUR_MS, 'o/a', 1.25],
        [startOfDay(NOW) - MIN, 'o/a', 9], // yesterday
        [NOW - MIN, '', 0.5],
        [NOW - MIN, 'gone/repo', 7], // a floor that was disconnected
      ],
    };
    const v = opsView([floor(), floor({ repoId: 'o/b', floor: 2 })], h, NOW);
    const a = v.floors[0];
    expect(a).toMatchObject({ mergedToday: 2, mergedHour: 1, leadMs: 3 * HOUR_MS, qaWaitMs: 4 * MIN, ciRuns: 2, ciPass: 0.5, ciMs: 6 * MIN, costToday: 1.25 });
    expect(a.qaPass).toBeCloseTo(1 / 3);
    expect(v.floors[1]).toMatchObject({ mergedToday: 1, leadMs: null, ciPass: 1, costToday: 0 });
    expect(v.total).toMatchObject({ mergedToday: 3, ciRuns: 3, costToday: 1.75 });
    expect(v.ceoCostToday).toBe(0.5);
    expect(v.total.spark.reduce((x, y) => x + y)).toBe(3);
  });

  it('is empty-handed rather than wrong with no history', () => {
    const v = opsView([floor()], emptyHistory(), NOW);
    expect(v.total).toMatchObject({ mergedToday: 0, leadMs: null, qaWaitMs: null, qaPass: null, ciPass: null, ciRuns: 0, ciMs: null, costToday: 0 });
  });
});

describe('alarms', () => {
  it('rings for PRs that need the manager and agents in error over ten minutes, oldest first', () => {
    const f = floor({
      agents: [agent({ id: 'a1', name: 'Ada', status: 'error', endedAt: NOW - ALARM_ERROR_MS, lastError: 'gh: not logged in\nmore' }), agent({ id: 'a2', name: 'Alan', status: 'error', endedAt: NOW - MIN })],
      prs: [pr(7, 'needs-human', false, 'it failed QA 6 times'), pr(8, 'needs-human', true), pr(9, 'failed')],
    });
    const alarms = floorAlarms(f, NOW);
    expect(alarms.map((a) => a.id)).toEqual(['pr:o/a#7', 'agent:a1']);
    expect(alarms[0].text).toBe('PR #7 needs you: it failed QA 6 times');
    expect(alarms[1].text).toBe('Ada is stuck on an error: gh: not logged in');
    const v = opsView([f, floor({ repoId: 'o/b', floor: 2, prs: [{ number: 2, qa: { status: 'needs-human', ceoLooking: false, updatedAt: NOW - DAY_MS }, why: null }] })], emptyHistory(), NOW);
    expect(v.alarms.map((a) => a.id)).toEqual(['pr:o/b#2', 'pr:o/a#7', 'agent:a1']);
    expect(v.floors.map((x) => x.alarms)).toEqual([2, 1]);
  });

  it('stops once handled', () => {
    const f = floor({ agents: [agent({ status: 'working', endedAt: NOW - DAY_MS })], prs: [pr(7, 'queued')] });
    expect(floorAlarms(f, NOW)).toEqual([]);
  });
});
