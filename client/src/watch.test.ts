import { describe, expect, it } from 'vitest';
import { CEO_ID } from '../../shared/types';
import { currentWatch } from './watch';

describe('currentWatch', () => {
  it('is the floor you are on, the terminal you have open and whether the workers list is out', () => {
    expect(currentWatch({ floor: 3, overlay: null, workersOpen: true })).toEqual({ floor: 3, agents: [], workers: true });
    expect(currentWatch({ floor: 0, overlay: { kind: 'terminal', agentId: 'ken' }, workersOpen: false })).toEqual({ floor: 0, agents: ['ken'], workers: false });
    expect(currentWatch({ floor: 2, overlay: { kind: 'manager', tab: 'ceo' }, workersOpen: false }).agents).toEqual([CEO_ID]);
    expect(currentWatch({ floor: 2, overlay: { kind: 'kanban', repoId: 'r' }, workersOpen: false }).agents).toEqual([]);
  });
});
