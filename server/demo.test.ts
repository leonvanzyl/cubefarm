import { describe, expect, it } from 'vitest';
import { demoGrow, demoPastWeek, demoShrink, demoTeam, demoUsage, fixPromptPull, type DemoFloor } from './demo.ts';
import { KEEP_MS, opsView, startOfDay } from './metrics.ts';

describe('fixPromptPull', () => {
  it('reads the PR from a pre-QA conflict prompt, which starts with a capital P', () => {
    const prompt =
      'Pull request #6 (https://github.com/demo-co/pixel-todo/pull/6) conflicts with main because other work was merged first, so it comes back to you before QA tests it.';
    expect(fixPromptPull(prompt).number).toBe(6);
  });

  it('reads the PR from QA and takeover prompts', () => {
    expect(fixPromptPull('QA passed pull request #12 (url), but GitHub checks failed on it.').number).toBe(12);
    expect(fixPromptPull('You are taking over pull request #3 (url), written by a teammate').number).toBe(3);
    expect(fixPromptPull('Please QA pull request #9: Add dark mode')).toEqual({ number: 9, title: 'Add dark mode' });
  });

  it('falls back to 0 when no PR is named', () => {
    expect(fixPromptPull('Work on issue #4: Add socks').number).toBe(0);
  });
});

describe("the demo's mission control", () => {
  const NOW = new Date(2026, 8, 30, 15, 20).getTime();
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  it('makes up a past week with sensible numbers, nothing from later today', () => {
    const h = demoPastWeek(['demo-co/a', 'demo-co/b'], NOW, rand);
    for (const list of [h.merges, h.qa, h.checks, h.cost]) {
      expect(list.length).toBeGreaterThan(0);
      for (const e of list) expect(e[0] <= NOW && NOW - e[0] <= KEEP_MS).toBe(true);
    }
    expect(h.merges.every((m) => m[2] === 0)).toBe(true); // never mistaken for a real PR the demo merges later
    const v = opsView(
      [
        { repoId: 'demo-co/a', floor: 1, ready: 0, agents: [], prs: [] },
        { repoId: 'demo-co/b', floor: 2, ready: 0, agents: [], prs: [] },
      ],
      h,
      NOW,
    );
    expect(v.floors[0].ciPass).toBeGreaterThan(0.6);
    expect(v.floors[0].ciMs).toBeGreaterThan(2 * 60_000);
    expect(v.total.leadMs).toBeGreaterThan(20 * 60_000);
    expect(v.ceoCostToday).toBeGreaterThan(0);
    expect(v.total.spark.some((n) => n > 0)).toBe(true);
    expect(h.merges.filter((m) => m[1] === 'demo-co/a').length).toBeGreaterThan(h.merges.filter((m) => m[1] === 'demo-co/b').length);
  });

  it('warns about the weekly limit until midnight, or reaches the limit for 3 minutes', () => {
    expect(demoUsage('warning', NOW)).toEqual({ resetsAt: startOfDay(NOW) + 24 * 3_600_000, rateLimitType: 'seven_day', utilization: 0.91 });
    expect(demoUsage('limit', NOW)).toEqual({ limitResetsAt: NOW + 3 * 60_000 });
  });
});

describe("the demo's teams", () => {
  it('are six agents on floor 1 and four elsewhere in the usual demo', () => {
    expect(demoTeam(null, 1)).toBe(6);
    expect(demoTeam(null, 2)).toBe(4);
  });

  it("fill a big company's floors, up to the room's desks", () => {
    expect(demoTeam({ floors: 10, agents: 15 }, 7)).toBe(15);
    expect(demoTeam({ floors: 3, agents: 4 }, 1)).toBe(4);
    expect(demoTeam({ floors: 1, agents: 1 }, 1)).toBe(1);
    expect(demoTeam({ floors: 1, agents: 40 }, 1)).toBe(15);
  });
});

describe("the demo CEO's team sizes", () => {
  const floor = (team: Partial<DemoFloor['team']> = {}, capacity: Partial<DemoFloor['capacity']> = {}): DemoFloor => ({
    floor: 2,
    repo: 'demo-co/weather-api',
    brief: null,
    team: { size: 2, max: 10, free: 0, pendingHires: 0, pendingLetGos: 0, ...team },
    capacity: { issuesReadyToStart: 0, prsAwaitingQa: 0, ...capacity },
    backlog: [],
    pullRequests: [],
  });

  it('grows a floor when ready issues outnumber its free agents, up to six and the max', () => {
    expect(demoGrow(floor({ free: 1 }), 3)).toMatchObject({ size: 4 });
    expect(demoGrow(floor({ free: 1 }), 3)?.reason).toContain('3 issues are ready to start on floor 2 and 1 agent is free');
    expect(demoGrow(floor(), 12)?.size).toBe(6);
    expect(demoGrow(floor({ max: 3 }), 12)?.size).toBe(3);
    expect(demoGrow(floor({ size: 6 }), 12)).toBeNull(); // big enough: more agents mostly add conflicts
    expect(demoGrow(floor({ free: 3 }), 3)).toBeNull();
  });

  it('counts the agents already on their way', () => {
    expect(demoGrow(floor({ pendingHires: 2 }), 2)).toBeNull();
    expect(demoGrow(floor({ pendingHires: 1 }), 3)?.size).toBe(5);
  });

  it('shrinks a floor whose agents sit idle with nothing to start or test, never below one', () => {
    expect(demoShrink(floor({ size: 5, free: 3 }))).toMatchObject({ size: 3 });
    expect(demoShrink(floor({ size: 2, free: 2 }))?.size).toBe(1);
    expect(demoShrink(floor({ size: 1, free: 1 }))).toBeNull();
    expect(demoShrink(floor({ size: 5, free: 3 }, { issuesReadyToStart: 1 }))).toBeNull();
    expect(demoShrink(floor({ size: 5, free: 3 }, { prsAwaitingQa: 1 }))).toBeNull();
    expect(demoShrink(floor({ size: 5, free: 3, pendingLetGos: 2 }))).toBeNull(); // already on their way out
  });
});
