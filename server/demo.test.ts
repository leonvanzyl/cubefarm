import { describe, expect, it } from 'vitest';
import { demoCandidate, demoPastWeek, demoTeam, demoUsage, fixPromptPull } from './demo.ts';
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

describe('demoCandidate', () => {
  it("offers a floor's own hire first, then the shared candidates, never a specialty already taken", () => {
    expect(demoCandidate('demo-co/pixel-todo', [])?.title).toBe('Accessibility engineer');
    const next = demoCandidate('demo-co/pixel-todo', ['a11y', 'frontend']);
    expect(next?.specialty).not.toBe('a11y');
    expect(next?.title).toBe('HTML/CSS front-end developer');
    expect(demoCandidate('demo-co/unknown', [])?.specialty).toBe('frontend'); // a project the demo doesn't know
  });

  it('runs out once every specialty is taken', () => {
    const taken: string[] = [];
    for (let c = demoCandidate('demo-co/weather-api', taken); c; c = demoCandidate('demo-co/weather-api', taken)) {
      expect(taken).not.toContain(c.specialty);
      expect(c.title && c.job_description && c.reason).toBeTruthy();
      taken.push(c.specialty);
    }
    expect(taken.length).toBeGreaterThanOrEqual(6);
    expect(demoCandidate('demo-co/weather-api', taken)).toBeNull();
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
  it('are five developers on floor 1 and three elsewhere, with a tester each, in the usual demo', () => {
    expect(demoTeam(null, 1)).toEqual({ dev: 5, qa: 1 });
    expect(demoTeam(null, 2)).toEqual({ dev: 3, qa: 1 });
  });

  it('fill a big company floor: 15 people are 12 developers and 3 testers', () => {
    expect(demoTeam({ floors: 10, agents: 15 }, 7)).toEqual({ dev: 12, qa: 3 });
    expect(demoTeam({ floors: 3, agents: 4 }, 1)).toEqual({ dev: 3, qa: 1 });
    expect(demoTeam({ floors: 1, agents: 1 }, 1)).toEqual({ dev: 0, qa: 1 });
  });
});
