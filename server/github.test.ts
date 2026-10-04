import { describe, expect, it } from 'vitest';
import { checkRunOf } from './github.ts';

describe('checkRunOf', () => {
  const run = (startedAt: string, completedAt: string | undefined, status = 'COMPLETED') => ({ name: 'build', status, conclusion: completedAt ? 'SUCCESS' : '', startedAt, completedAt });

  it('times the check runs from the first start to the last finish', () => {
    expect(checkRunOf([run('2026-10-04T17:38:00Z', '2026-10-04T17:38:42Z'), run('2026-10-04T17:38:08Z', '2026-10-04T17:41:01Z')])).toEqual({
      ms: (3 * 60 + 1) * 1000,
      doneAt: Date.parse('2026-10-04T17:41:01Z'),
    });
  });

  it('has nothing while a check still runs, without times, or without checks', () => {
    expect(checkRunOf([run('2026-10-04T17:38:00Z', '2026-10-04T17:38:42Z'), run('2026-10-04T17:38:08Z', undefined, 'IN_PROGRESS')])).toBeNull();
    expect(checkRunOf([{ context: 'Vercel', state: 'SUCCESS' }])).toBeNull();
    expect(checkRunOf([])).toBeNull();
    expect(checkRunOf(null)).toBeNull();
  });
});
