import { describe, expect, it } from 'vitest';
import { orphanedQa } from './qaOrphans.ts';
import {
  afterClose,
  ASK_AGAIN_MS,
  closedWhy,
  closuresHeld,
  forgettable,
  issueOpen,
  MAX_ASKS,
  pullNow,
  stillOpen,
  stoppedMessage,
  toAsk,
  toHold,
  type Closure,
  type FloorState,
  type HeldRecord,
  type Holder,
  type KnownPull,
  type LearnedPull,
} from './closeCleanup.ts';

const BUSY = ['preparing', 'working'];
const T = 1_000_000; // when the last sync's fetch started

const pull = (number: number, state: KnownPull['state'] = 'OPEN', headRefName = `swarm/issue-${number - 100}-ada`, closesIssues = [number - 100]): KnownPull => ({ number, state, headRefName, closesIssues });
const floor = (f: Partial<FloorState> = {}): FloorState => ({ fetchedAt: T, openIssues: [], pulls: [], closedIssues: new Map(), closedPulls: new Map(), ...f });
const learned = (p: KnownPull, at = T + 1): [number, LearnedPull] => [p.number, { ...p, at }];

// The 2026-10-04 cast: Barbara on issue #192 (her PR #198, branch swarm/issue-192-barbara), Guido fixing it, Marple testing.
const barbara: Holder = { id: 'barbara', role: 'agent', status: 'working', task: 'issue', issueNumber: 192, prNumber: null, branch: 'swarm/issue-192-barbara' };
const guido: Holder = { id: 'guido', role: 'agent', status: 'working', task: 'fix', issueNumber: 192, prNumber: 198, branch: 'swarm/issue-192-barbara' };
const marple: Holder = { id: 'marple', role: 'agent', status: 'working', task: 'qa', issueNumber: 192, prNumber: 198, branch: 'qa/pr-198-marple' };
const rec = (status: string, more: Partial<HeldRecord> = {}): HeldRecord => ({ prNumber: 198, status, qaAgentId: 'marple', devAgentId: 'barbara', ...more });
const closed198: Closure = { kind: 'pr', number: 198, merged: false, headRefName: 'swarm/issue-192-barbara' };
const merged198: Closure = { ...closed198, merged: true };
const issue192: Closure = { kind: 'issue', number: 192, mergedBy: [] };

describe('what the office knows', () => {
  it('trusts what it learned after the last list was fetched over that list', () => {
    const f = floor({ openIssues: [192], pulls: [pull(198)], closedIssues: new Map([[192, T + 5]]), closedPulls: new Map([learned(pull(198, 'CLOSED'))]) });
    expect(issueOpen(192, f)).toBe(false);
    expect(pullNow(198, f)?.state).toBe('CLOSED');
  });

  it('takes a newer list showing it open again as a reopen', () => {
    const f = floor({ openIssues: [192], pulls: [pull(198)], closedIssues: new Map([[192, T - 5]]), closedPulls: new Map([learned(pull(198, 'CLOSED'), T - 5)]) });
    expect(issueOpen(192, f)).toBe(true);
    expect(pullNow(198, f)?.state).toBe('OPEN');
    expect(forgettable(f, T)).toEqual({ issues: [192], pulls: [198] });
  });

  it("can't tell about what the lists leave out (100 open issues, 50 open and 8 merged PRs) until GitHub is asked", () => {
    expect(issueOpen(5, floor())).toBeNull();
    expect(pullNow(7, floor())).toBeNull();
    expect(issueOpen(5, floor({ closedIssues: new Map([[5, T - 60_000]]) }))).toBe(false); // not listed: still closed
  });

  it('forgets what it learned after a day', () => {
    const f = floor({ closedIssues: new Map([[1, T - 25 * 3_600_000], [2, T]]), closedPulls: new Map([learned(pull(9, 'MERGED'), T - 25 * 3_600_000)]) });
    expect(forgettable(f, T)).toEqual({ issues: [1], pulls: [9] });
  });
});

describe('may this task start? (stillOpen)', () => {
  const f = floor({ openIssues: [5], pulls: [pull(105), pull(106, 'MERGED')], closedIssues: new Map([[192, T + 1]]), closedPulls: new Map([learned(pull(198, 'CLOSED'))]) });

  it('refuses a closed issue, and a closed or merged PR', () => {
    expect(stillOpen({ kind: 'issue', number: 192 }, f)).toBe(false);
    expect(stillOpen({ kind: 'pr', number: 198 }, f)).toBe(false);
    expect(stillOpen({ kind: 'pr', number: 106 }, f)).toBe(false);
  });

  it('starts an open one, and never refuses on a guess', () => {
    expect(stillOpen({ kind: 'issue', number: 5 }, f)).toBe(true);
    expect(stillOpen({ kind: 'pr', number: 105 }, f)).toBe(true);
    expect(stillOpen({ kind: 'issue', number: 77 }, f)).toBe(true); // not listed: past the list's limit, perhaps
    expect(stillOpen({ kind: 'pr', number: 77 }, f)).toBe(true);
  });

  it("goes by GitHub's answer just now when there is one", () => {
    expect(stillOpen({ kind: 'issue', number: 5 }, f, 'CLOSED')).toBe(false); // closed since the last sync
    expect(stillOpen({ kind: 'pr', number: 105 }, f, 'MERGED')).toBe(false);
    expect(stillOpen({ kind: 'pr', number: 198 }, f, 'OPEN')).toBe(true); // reopened
    expect(stillOpen({ kind: 'issue', number: 192 }, f, null)).toBe(false); // couldn't ask: the office's view
  });
});

describe('toAsk', () => {
  it('asks about held issues and PRs the sync does not list, once each', () => {
    const agents: Holder[] = [barbara, { ...guido, status: 'done' }, marple, { ...barbara, id: 'idle', status: 'idle', issueNumber: 3 }];
    expect(toAsk(agents, [rec('fixing'), { ...rec('queued'), prNumber: 300 }], [], floor(), new Map(), T)).toEqual({ issues: [192], pulls: [198, 300] });
  });

  it('leaves alone what the sync lists, and what GitHub said is open a moment ago', () => {
    const f = floor({ openIssues: [192], pulls: [pull(198, 'MERGED')] });
    expect(toAsk([barbara, guido], [rec('passed')], [], f, new Map(), T)).toEqual({ issues: [], pulls: [] });
    const openAt = new Map([['issue#192', T - 1000], ['pr#198', T - ASK_AGAIN_MS - 1]]);
    expect(toAsk([barbara, guido], [], [], floor(), openAt, T)).toEqual({ issues: [], pulls: [198] });
  });

  it('asks about held issues the sync does not list, so a hold on an issue closed on GitHub ends', () => {
    expect(toAsk([], [], [8, 192], floor({ openIssues: [192] }), new Map(), T)).toEqual({ issues: [8], pulls: [] });
  });

  it('asks about a few at a time', () => {
    const records = Array.from({ length: 10 }, (_, i) => ({ ...rec('queued'), prNumber: 400 + i }));
    expect(toAsk([], records, [], floor(), new Map(), T).pulls).toHaveLength(MAX_ASKS);
  });
});

describe('closuresHeld', () => {
  it('finds the closed PRs agents or records hold, then the closed issues', () => {
    const f = floor({ pulls: [pull(105, 'MERGED')], closedIssues: new Map([[192, T + 1]]), closedPulls: new Map([learned(pull(198, 'CLOSED', 'swarm/issue-192-barbara', [192]))]) });
    const ada: Holder = { ...barbara, id: 'ada', status: 'done', issueNumber: 5, prNumber: 105, branch: 'swarm/issue-5-ada' };
    expect(closuresHeld([barbara, guido, ada], [rec('fixing')], f)).toEqual([closed198, { kind: 'pr', number: 105, merged: true, headRefName: 'swarm/issue-5-ada' }, issue192]);
  });

  it('knows an issue its PR closed by merging', () => {
    const f = floor({ pulls: [pull(105, 'MERGED')], closedIssues: new Map([[5, T + 1]]) });
    expect(closuresHeld([{ ...barbara, issueNumber: 5 }], [], f)).toEqual([{ kind: 'issue', number: 5, mergedBy: [{ number: 105, headRefName: 'swarm/issue-5-ada' }] }]);
  });

  it('holds nothing for idle agents, the CEO, or open work', () => {
    const f = floor({ openIssues: [192], pulls: [pull(198)] });
    expect(closuresHeld([{ ...barbara, status: 'idle' }, { ...barbara, role: 'ceo', issueNumber: 1 }, barbara, guido], [rec('queued')], f)).toEqual([]);
  });
});

describe('afterClose', () => {
  it('stops an agent on an issue closed as not planned; the PR flow is left alone', () => {
    expect(afterClose(issue192, [barbara, marple], [rec('queued')], BUSY)).toEqual({ stop: ['barbara'], clear: [], dropQa: false });
  });

  it("clears the desk of an agent whose card still shows the closed issue (the old \"finished · no PR\")", () => {
    expect(afterClose(issue192, [{ ...barbara, status: 'done' }], [], BUSY)).toEqual({ stop: [], clear: ['barbara'], dropQa: false });
    expect(afterClose(issue192, [{ ...barbara, status: 'error' }, { ...barbara, id: 'b2', status: 'stopped' }], [], BUSY).clear).toEqual(['barbara', 'b2']);
  });

  it('drops a PR closed while queued for a fix: nobody stops, and nobody is handed the fix', () => {
    const author = { ...barbara, status: 'done', prNumber: 198 };
    expect(afterClose(closed198, [author, { ...marple, status: 'done' }], [rec('failed')], BUSY)).toEqual({ stop: [], clear: ['barbara', 'marple'], dropQa: true });
  });

  it('stops a fix session on a closed PR', () => {
    expect(afterClose(closed198, [guido], [rec('fixing', { devAgentId: 'guido' })], BUSY)).toEqual({ stop: ['guido'], clear: [], dropQa: true });
    expect(afterClose(closed198, [{ ...guido, status: 'preparing' }], [rec('fixing', { devAgentId: 'guido' })], BUSY).stop).toEqual(['guido']);
  });

  it('stops a QA run on a closed PR', () => {
    expect(afterClose(closed198, [marple], [rec('testing')], BUSY)).toEqual({ stop: ['marple'], clear: [], dropQa: true });
  });

  it('stops the session that opened the PR, before the office knows its number', () => {
    expect(afterClose(closed198, [barbara], [rec('queued')], BUSY).stop).toEqual(['barbara']);
    expect(afterClose({ ...closed198, headRefName: '' }, [barbara], [], BUSY).stop).toEqual([]); // head unknown: no guessing
  });

  it("never stops anyone for a merge: the author's follow-up, a fix or a QA run carries on", () => {
    const author = { ...barbara, prNumber: 198 };
    expect(afterClose(merged198, [author, guido, marple], [rec('fixing', { devAgentId: 'guido' })], BUSY)).toEqual({ stop: [], clear: [], dropQa: false });
    expect(afterClose(merged198, [marple], [rec('testing')], BUSY).dropQa).toBe(false); // it leaves QA once the run ends
  });

  it('clears a merged PR from the cards it is on, but leaves whoever tested it their last run', () => {
    const author = { ...barbara, status: 'done', prNumber: 198 };
    expect(afterClose(merged198, [author, { ...marple, status: 'done' }], [rec('passed')], BUSY)).toEqual({ stop: [], clear: ['barbara'], dropQa: true });
    expect(afterClose(merged198, [{ ...guido, status: 'done' }], [], BUSY).clear).toEqual(['guido']); // whoever fixed it
  });

  it("doesn't stop an issue's author when their own PR's merge closed it, but does stop anyone else on it", () => {
    const byMerge: Closure = { kind: 'issue', number: 192, mergedBy: [{ number: 198, headRefName: 'swarm/issue-192-barbara' }] };
    const other: Holder = { ...barbara, id: 'linus', branch: 'swarm/issue-192-linus' };
    expect(afterClose(byMerge, [barbara, { ...barbara, id: 'b2', prNumber: 198, branch: null }, other], [], BUSY)).toEqual({ stop: ['linus'], clear: [], dropQa: false });
  });

  it('leaves the CEO, idle agents and work on other issues and PRs alone', () => {
    const ceo: Holder = { ...barbara, id: 'ceo', role: 'ceo' };
    const ada: Holder = { ...barbara, id: 'ada', issueNumber: 5, prNumber: 105, branch: 'swarm/issue-5-ada' };
    expect(afterClose(issue192, [ceo, { ...barbara, status: 'idle' }, ada], [], BUSY)).toEqual({ stop: [], clear: [], dropQa: false });
    expect(afterClose(closed198, [ada], [{ ...rec('queued'), prNumber: 105 }], BUSY)).toEqual({ stop: [], clear: [], dropQa: false });
  });

  describe('after a restart', () => {
    // Startup marks everyone the restart cut off as stopped, and its sync then learns the PR closed while it was down.
    const cutOff = (a: Holder): Holder => ({ ...a, status: 'stopped' });

    it('clears a fix or QA run cut off by the restart instead of resuming or re-queueing it, and stops nobody', () => {
      const records = [rec('fixing', { devAgentId: 'guido' })];
      expect(afterClose(closed198, [cutOff(guido), cutOff(marple)], records, BUSY)).toEqual({ stop: [], clear: ['guido', 'marple'], dropQa: true });
    });

    it('drops a record left "testing" with nobody on it, so the orphan sweep never re-queues it', () => {
      const records = [{ ...rec('testing'), repoId: 'acme/app' }];
      expect(orphanedQa(records, [], BUSY)).toEqual(records); // what the sweep would re-queue …
      expect(afterClose(closed198, [], records, BUSY).dropQa).toBe(true); // … but the startup sync drops it first
      expect(afterClose(merged198, [], records, BUSY).dropQa).toBe(true); // a merged one too: its run was lost
    });
  });
});

describe('toHold: closing a PR never puts its issue back in line by itself', () => {
  const f = floor({ openIssues: [192, 5] });

  it("holds a closed PR's open issues for the manager", () => {
    expect(toHold(pull(198, 'CLOSED', 'swarm/issue-192-barbara', [192]), f)).toEqual([192]);
    expect(toHold(pull(198, 'CLOSED', 'feature/x', [5, 192]), f)).toEqual([5, 192]); // a person's PR: what it links
  });

  it('never holds an issue that is closed, or anything after a merge', () => {
    expect(toHold(pull(198, 'CLOSED', 'swarm/issue-192-barbara', [192]), floor({ closedIssues: new Map([[192, T]]) }))).toEqual([]);
    expect(toHold(pull(198, 'MERGED', 'swarm/issue-192-barbara', [192]), f)).toEqual([]);
  });
});

describe('what the manager reads', () => {
  it('names who was stopped and why', () => {
    expect(stoppedMessage(['Barbara'], issue192, 'acme/app')).toBe('🛑 Stopped Barbara: issue #192 on acme/app was closed.');
    expect(stoppedMessage(['Guido', 'Marple'], closed198, 'acme/app')).toBe('🛑 Stopped Guido and Marple: PR #198 on acme/app was closed.');
    expect(stoppedMessage(['A', 'B', 'C'], { kind: 'issue', number: 5, mergedBy: [{ number: 9, headRefName: 'x' }] }, 'o/r')).toBe('🛑 Stopped A, B and C: issue #5 on o/r was closed by PR #9.');
  });

  it('says what happened in their log', () => {
    expect(closedWhy(issue192)).toBe('issue #192 was closed');
    expect(closedWhy(merged198)).toBe('PR #198 was merged');
  });
});
