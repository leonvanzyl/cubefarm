import { describe, expect, it } from 'vitest';
import { checkRunOf, readTwice } from './github.ts';

describe('readTwice', () => {
  it('tries a failed read once more', async () => {
    let calls = 0;
    const read = async () => {
      calls++;
      if (calls === 1) throw new Error('gh pr list -R failed: timed out after 60 s');
      return [1, 2];
    };
    await expect(readTwice(read, 0)).resolves.toEqual([1, 2]);
    expect(calls).toBe(2);
  });

  it('gives up with the second error', async () => {
    let calls = 0;
    const read = async () => {
      calls++;
      throw new Error(`failure ${calls}`);
    };
    await expect(readTwice(read, 0)).rejects.toThrow('failure 2');
    expect(calls).toBe(2);
  });
});

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
