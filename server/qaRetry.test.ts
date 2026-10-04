import { describe, expect, it } from 'vitest';
import { qaRetry, type QaEnding } from './qaRetry.ts';

const ending = (e: Partial<QaEnding> = {}): QaEnding => ({ stopped: false, limited: false, ok: true, report: false, canResume: true, ...e });

describe('qaRetry', () => {
  it('posts a report whenever there is one', () => {
    expect(qaRetry(ending({ report: true }))).toBe('report');
    expect(qaRetry(ending({ report: true, canResume: false }))).toBe('report');
  });

  it('resumes a session that ended normally without a report, once', () => {
    expect(qaRetry(ending())).toBe('resume');
    // the resumed session missed it too: today's path (count the failure, requeue)
    expect(qaRetry(ending({ canResume: false }))).toBe('give-up');
  });

  it('never resumes a stopped, usage-limited or failed session', () => {
    expect(qaRetry(ending({ stopped: true }))).toBe('give-up');
    expect(qaRetry(ending({ stopped: true, report: true }))).toBe('give-up');
    expect(qaRetry(ending({ limited: true }))).toBe('give-up');
    expect(qaRetry(ending({ ok: false }))).toBe('give-up');
  });
});
