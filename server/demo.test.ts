import { describe, expect, it } from 'vitest';
import { fixPromptPull } from './demo.ts';

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
