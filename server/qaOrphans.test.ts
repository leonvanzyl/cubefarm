import { describe, expect, it } from 'vitest';
import { orphanedQa } from './qaOrphans.ts';

const BUSY = ['preparing', 'working'];
const rec = { repoId: 'acme/app', prNumber: 69, status: 'testing', qaAgentId: 'marple' };
const marple = { id: 'marple', repoId: 'acme/app', status: 'working', task: 'qa', prNumber: 69 };

describe('orphanedQa', () => {
  it('leaves a PR alone while its tester is testing it', () => {
    expect(orphanedQa([rec], [marple], BUSY)).toEqual([]);
  });

  it('finds a PR still "testing" after its tester finished (the report never posted)', () => {
    expect(orphanedQa([rec], [{ ...marple, status: 'done' }], BUSY)).toEqual([rec]);
  });

  it('finds it when the tester moved on to another PR, or is gone', () => {
    expect(orphanedQa([rec], [{ ...marple, prNumber: 70 }], BUSY)).toEqual([rec]);
    expect(orphanedQa([rec], [], BUSY)).toEqual([rec]);
  });

  it('ignores PRs that are not "testing"', () => {
    expect(orphanedQa([{ ...rec, status: 'queued' }, { ...rec, status: 'fixing' }], [], BUSY)).toEqual([]);
  });
});
