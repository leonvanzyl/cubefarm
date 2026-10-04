import { describe, expect, it } from 'vitest';
import { demoCandidate, fixPromptPull } from './demo.ts';

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
