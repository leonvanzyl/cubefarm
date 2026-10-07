import { describe, expect, it } from 'vitest';
import { reconcileStep, restartMessage, sessionStart, workState, type ReconcileAgent } from './reconcile.ts';

const agent = (over: Partial<ReconcileAgent> = {}): ReconcileAgent => ({
  role: 'agent',
  status: 'working',
  task: 'issue',
  work: 'open',
  deskExists: true,
  cliAlive: false,
  resumable: true,
  ...over,
});

describe('workState', () => {
  it('reads GitHub: a merge wins, a closed issue or PR ends the work, unknown when nobody answered', () => {
    expect(workState('OPEN', 'MERGED')).toBe('merged');
    expect(workState('CLOSED', null)).toBe('closed');
    expect(workState('OPEN', 'CLOSED')).toBe('closed');
    expect(workState(null, 'OPEN')).toBe('open');
    expect(workState('OPEN', null)).toBe('open');
    expect(workState(null, null)).toBe('unknown');
  });
});

describe('reconcileStep', () => {
  it('leaves the CEO and agents without a task alone', () => {
    expect(reconcileStep(agent({ role: 'ceo' }))).toBe('none');
    expect(reconcileStep(agent({ task: null }))).toBe('none');
  });

  it('clears work that closed or merged while the office was down, whatever the agent was doing', () => {
    // This morning: seven agents on issues and a PR that were all finished, their desks gone.
    for (const status of ['working', 'preparing', 'error', 'stopped', 'done']) {
      expect(reconcileStep(agent({ status, work: 'closed', deskExists: false }))).toBe('clear');
      expect(reconcileStep(agent({ status, task: 'fix', work: 'merged', cliAlive: true }))).toBe('clear');
    }
  });

  it('reattaches a live CLI only when its desk is still there', () => {
    expect(reconcileStep(agent({ cliAlive: true }))).toBe('reattach');
    expect(reconcileStep(agent({ cliAlive: true, work: 'unknown' }))).toBe('reattach');
    expect(reconcileStep(agent({ cliAlive: true, deskExists: false }))).toBe('requeue');
  });

  it('never resumes a session in a desk that is gone (exit 267: the directory name is invalid)', () => {
    expect(reconcileStep(agent({ deskExists: false }))).toBe('requeue');
    expect(reconcileStep(agent({ status: 'preparing', deskExists: false, resumable: false }))).toBe('requeue');
  });

  it('resumes what can be resumed and puts the rest back in line', () => {
    expect(reconcileStep(agent())).toBe('resume');
    expect(reconcileStep(agent({ resumable: false }))).toBe('requeue');
    expect(reconcileStep(agent({ task: 'qa', resumable: false }))).toBe('requeue');
  });

  it('keeps cards that wait for something, and requeues a failed or stopped one whose desk is gone', () => {
    expect(reconcileStep(agent({ status: 'done', deskExists: false }))).toBe('keep');
    expect(reconcileStep(agent({ status: 'error' }))).toBe('keep');
    expect(reconcileStep(agent({ status: 'stopped' }))).toBe('keep');
    expect(reconcileStep(agent({ status: 'error', deskExists: false }))).toBe('requeue');
    expect(reconcileStep(agent({ status: 'stopped', deskExists: false }))).toBe('requeue');
  });
});

describe('sessionStart', () => {
  it('sets a missing desk up before any new or resumed session starts in it', () => {
    expect(sessionStart(true, null)).toBe('start');
    expect(sessionStart(false, null)).toBe('prepare');
  });

  it('follows a CLI that is already running without waiting for a desk', () => {
    expect(sessionStart(false, 'reattach')).toBe('start');
    expect(sessionStart(false, 'typed')).toBe('start');
  });
});

describe('restartMessage', () => {
  it('says what the restart did in one message', () => {
    expect(restartMessage({ cleared: 7, reattached: 2, resumed: 0, requeued: 0 })).toBe('↻ Restarted: cleared 7 finished tasks and reattached 2 live sessions.');
    expect(restartMessage({ cleared: 1, reattached: 1, resumed: 1, requeued: 1 })).toBe('↻ Restarted: cleared 1 finished task, reattached 1 live session, resumed 1 session and put 1 task back in line.');
    expect(restartMessage({ cleared: 0, reattached: 0, resumed: 0, requeued: 3 })).toBe('↻ Restarted: put 3 tasks back in line.');
  });

  it('says nothing when there was nothing to do', () => {
    expect(restartMessage({ cleared: 0, reattached: 0, resumed: 0, requeued: 0 })).toBeNull();
  });
});
