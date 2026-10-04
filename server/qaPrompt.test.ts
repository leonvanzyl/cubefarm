import { describe, expect, it } from 'vitest';
import { qaInstructions, type QaPromptInput } from './qaPrompt.ts';

const OLD = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);

const input = (i: Partial<QaPromptInput> = {}): QaPromptInput => ({
  headSha: HEAD,
  checks: 'passing',
  checkNames: ['check (ubuntu-latest)', 'e2e'],
  failedChecks: [],
  pendingChecks: [],
  round: 1,
  fixReason: null,
  lastTestedSha: null,
  summary: null,
  fixInstructions: null,
  defaultBranch: 'main',
  ...i,
});

const TODAYS_STEP = "3. Install dependencies if needed, then run the project's test suite, linters, type checks and build (whichever exist).";

describe('qaInstructions: GitHub checks', () => {
  it('passing: names them and says not to re-run what they cover', () => {
    const qa = qaInstructions(input());
    expect(qa.checks).toBe('GitHub checks right now: passing (check (ubuntu-latest), e2e)');
    expect(qa.testStep).toContain("don't re-run that locally");
    expect(qa.testStep).not.toContain('test suite');
  });

  it('failing: lists the failing checks and asks for them as findings', () => {
    const qa = qaInstructions(input({ checks: 'failing', failedChecks: ['e2e', 'lint'] }));
    expect(qa.checks).toBe('GitHub checks right now: failing: e2e, lint');
    expect(qa.testStep).toContain('A failing check is a finding');
  });

  it('failing while others still run: says which are still running', () => {
    expect(qaInstructions(input({ checks: 'failing', failedChecks: ['e2e'], pendingChecks: ['check (macos-latest)'] })).checks).toBe(
      'GitHub checks right now: failing: e2e; still running: check (macos-latest)',
    );
  });

  it('pending: lists what is still running and still trusts the checks', () => {
    const qa = qaInstructions(input({ checks: 'pending', pendingChecks: ['check (macos-latest)'] }));
    expect(qa.checks).toBe('GitHub checks right now: pending: check (macos-latest)');
    expect(qa.testStep).not.toBe(TODAYS_STEP);
  });

  it('no checks: keeps the full local run', () => {
    const qa = qaInstructions(input({ checks: 'none', checkNames: [] }));
    expect(qa.checks).toBe('GitHub checks right now: none');
    expect(qa.testStep).toBe(TODAYS_STEP);
  });
});

describe('qaInstructions: re-tests', () => {
  const failedRound = { round: 2, fixReason: 'qa' as const, summary: 'The toolbar overflows on phones.', fixInstructions: 'Let it wrap.' };

  it('says nothing extra on a first round', () => {
    expect(qaInstructions(input()).retest).toBe('');
  });

  it('round 2 with the last tested commit: last findings, then the diff since then, no full re-check', () => {
    const retest = qaInstructions(input({ ...failedRound, lastTestedSha: OLD })).retest;
    expect(retest).toContain('The toolbar overflows on phones.');
    expect(retest).toContain('Let it wrap.');
    expect(retest).toContain('Check those first');
    expect(retest).toContain(`git diff ${OLD}..HEAD`);
    expect(retest).toContain('quick smoke test of the main flow');
    expect(retest).not.toMatch(/re-check everything/i);
  });

  it('round 2 without the last tested commit: keeps the full re-check', () => {
    expect(qaInstructions(input({ ...failedRound, lastTestedSha: null })).retest).toBe(
      "\nThis is a re-test after fixes. Last round's findings:\nThe toolbar overflows on phones.\nLet it wrap.\nCheck those first, then re-check everything else.",
    );
  });

  it('a retried session whose head was already recorded: keeps the full re-check', () => {
    const retest = qaInstructions(input({ ...failedRound, lastTestedSha: HEAD })).retest;
    expect(retest).not.toContain('git diff');
    expect(retest).toContain('re-check everything else');
  });

  it('a checks fix: tests what changed since QA passed it', () => {
    const retest = qaInstructions(input({ round: 3, fixReason: 'checks', lastTestedSha: OLD })).retest;
    expect(retest).toContain('fix failing GitHub checks');
    expect(retest).toContain(`git diff ${OLD}..HEAD`);
    expect(retest).not.toMatch(/re-check everything/i);
  });

  it('a checks fix without the last tested commit: keeps the full re-check', () => {
    expect(qaInstructions(input({ round: 3, fixReason: 'checks' })).retest).toBe(
      '\nQA passed it before, but since then the developer changed the code to fix failing GitHub checks. Re-check everything.',
    );
  });

  it('a conflict fix: still re-checks everything, even with the last tested commit', () => {
    const retest = qaInstructions(input({ round: 3, fixReason: 'conflict', lastTestedSha: OLD, defaultBranch: 'develop' })).retest;
    expect(retest).toContain('updated with develop to resolve merge conflicts');
    expect(retest).toContain('Re-check everything');
    expect(retest).not.toContain('git diff');
  });
});
