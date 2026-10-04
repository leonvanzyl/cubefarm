import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { MAX_DESKS, QA_LAB } from '../client/src/world/layout.ts';
import type { HttpError } from './httpError.ts';
import { checkCloseIssue, checkPendingLimit, createOfficeTools, FLOOR_DESKS, IssueCap, jobLabel, MAX_PENDING_PROPOSALS, planRoute, seatCount, specialtyLabel, specialtySlug, type CeoJob, type RouteRequest } from './ceo.ts';

describe('seats', () => {
  it('match the desks and QA stations the client draws', () => {
    expect(FLOOR_DESKS.dev).toBe(MAX_DESKS);
    expect(FLOOR_DESKS.qa).toBe(QA_LAB.stations.length);
  });

  it('count pending proposals as taken, never below zero', () => {
    expect(seatCount(12, 3, 2)).toEqual({ total: 12, taken: 3, proposed: 2, free: 7 });
    expect(seatCount(3, 3, 1).free).toBe(0);
  });

  it('let one empty floor be fully staffed in one go', () => {
    // A new floor starts with one QA tester: 12 developers and 2 more testers.
    expect(MAX_PENDING_PROPOSALS).toBeGreaterThanOrEqual(FLOOR_DESKS.dev + FLOOR_DESKS.qa - 1);
    for (let n = 0; n < FLOOR_DESKS.dev + FLOOR_DESKS.qa - 1; n++) expect(() => checkPendingLimit(n)).not.toThrow();
    expect(() => checkPendingLimit(MAX_PENDING_PROPOSALS)).toThrow(`${MAX_PENDING_PROPOSALS} proposals are already waiting for the manager; propose the rest after they decide.`);
  });
});

describe('specialtySlug', () => {
  it('turns a specialty into a lowercase slug', () => {
    expect(specialtySlug('Three.js graphics')).toBe('three-js-graphics');
    expect(specialtySlug('Testing')).toBe('testing');
    expect(specialtySlug('front_end / UI')).toBe('front-end-ui');
  });

  it('trims separators from both ends', () => {
    expect(specialtySlug('  --Backend!!  ')).toBe('backend');
  });

  it('keeps at most 24 characters', () => {
    expect(specialtySlug('a'.repeat(40))).toBe('a'.repeat(24));
    expect(specialtySlug('infrastructure and devops tooling')).toHaveLength(24);
  });

  // Known bug: the cut happens after the trim, so 'abcdefghijklmnopqrstuvw xyz' becomes 'abcdefghijklmnopqrstuvw-'.
  it.todo('does not end in "-" when the 24-character cut lands on a separator');

  it('is empty for no specialty', () => {
    expect(specialtySlug(undefined)).toBe('');
    expect(specialtySlug('')).toBe('');
    expect(specialtySlug('!!!')).toBe('');
  });

  it('never returns "skip", which means "leave this issue alone"', () => {
    expect(specialtySlug('skip')).toBe('');
    expect(specialtySlug('SKIP')).toBe('');
    expect(specialtySlug(' -skip- ')).toBe('');
    expect(specialtySlug('skipping')).toBe('skipping');
  });

  it('round-trips through specialtyLabel', () => {
    expect(specialtyLabel(specialtySlug('Three.js graphics'))).toBe('swarm:three-js-graphics');
  });
});

describe('jobLabel', () => {
  const job = (kind: CeoJob['kind']): CeoJob => ({ kind, repoId: 'r1', at: 0 });
  const floor = { floor: 3, fullName: 'leonvanzyl/office-swarm' };

  it('names the floor and repo for floor jobs', () => {
    expect(jobLabel(job('onboard'), floor)).toBe('Onboarding floor 3 · office-swarm');
    expect(jobLabel(job('plan'), floor)).toBe('Planning floor 3 · office-swarm');
  });

  it('falls back to the full name when it has no owner', () => {
    expect(jobLabel(job('plan'), { floor: 1, fullName: 'solo' })).toBe('Planning floor 1 · solo');
  });

  it('says so when the floor is gone', () => {
    expect(jobLabel(job('onboard'), null)).toBe('Onboarding a removed floor');
    expect(jobLabel(job('plan'), null)).toBe('Planning a removed floor');
  });

  it('labels company-wide jobs without a floor', () => {
    expect(jobLabel(job('review'), floor)).toBe('Reviewing the company');
    expect(jobLabel(job('review'), null)).toBe('Reviewing the company');
    expect(jobLabel({ kind: 'chat', text: 'hi', at: 0 }, null)).toBe('Replying to you');
  });
});

// The CEO only sees the office tools if the whole list converts to JSON Schema: one schema the SDK can't handle
// (z.record did this) empties tools/list, and the CEO silently loses every tool.
describe('office tools', () => {
  const connect = async () => {
    const floors: unknown[] = [];
    const office = createOfficeTools({
      companyStatus: () => '{}',
      agentDetail: () => '{}',
      setFloorProfile: (a) => (floors.push(a), 'saved'),
      updateJob: () => '',
      proposeHire: () => '',
      proposeLetGo: () => '',
      fileIssue: async () => '',
      routeIssue: async () => '',
      closeIssue: async () => '',
    });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await office.server.instance.connect(serverSide);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientSide);
    return { client, floors };
  };

  it('lists every tool the CEO relies on', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['agent_detail', 'close_issue', 'company_status', 'file_issue', 'propose_hire', 'propose_let_go', 'route_issue', 'set_floor_profile', 'update_job']);
  });

  it('still takes preview_env as a map of strings', async () => {
    const { client, floors } = await connect();
    await client.callTool({ name: 'set_floor_profile', arguments: { floor: 1, preview_env: { VITE_API: 'http://localhost:{port}' } } });
    expect(floors).toEqual([{ floor: 1, preview_env: { VITE_API: 'http://localhost:{port}' } }]);
  });
});

describe('checkCloseIssue (close_issue)', () => {
  const pulls = [
    { number: 20, state: 'OPEN', closesIssues: [4] },
    { number: 21, state: 'MERGED', closesIssues: [5] },
    { number: 22, state: 'CLOSED', closesIssues: [6] },
  ];
  const status = (state: 'OPEN' | 'CLOSED' | null, number = 6) => {
    try {
      checkCloseIssue({ floor: 1, number, state, pulls });
      return 'ok';
    } catch (err) {
      return (err as HttpError).status;
    }
  };

  it('closes an open issue, even one a merged or closed PR once named', () => {
    expect(status('OPEN')).toBe('ok');
    expect(status('OPEN', 5)).toBe('ok');
  });

  it('refuses a closed or unknown issue, which is how another floor\'s issue looks too', () => {
    expect(status('CLOSED')).toBe(404);
    expect(status(null)).toBe(404);
    expect(() => checkCloseIssue({ floor: 2, number: 6, state: 'CLOSED', pulls })).toThrow('#6 on floor 2 is already closed.');
  });

  it('refuses an issue an open PR closes', () => {
    expect(status('OPEN', 4)).toBe(409);
    expect(() => checkCloseIssue({ floor: 1, number: 4, state: 'OPEN', pulls })).toThrow('PR #20 closes #4. Close or finish that pull request first.');
  });
});

describe('planRoute (route_issue)', () => {
  // #1 ← #2 ← #3 is a two-step chain; #5 waits for #4; #9 is closed.
  const base: RouteRequest = {
    floor: 1,
    number: 4,
    issues: [
      { number: 1, body: 'Set up the skeleton', labels: ['swarm:frontend'] },
      { number: 2, body: 'Depends on #1', labels: [] },
      { number: 3, body: 'Depends on #2\n\nThe rest', labels: [] },
      { number: 4, body: 'Some text', labels: ['swarm:backend', 'bug'] },
      { number: 5, body: 'Intro\n\nDepends on #4\n\nMore', labels: [] },
      { number: 6, body: 'Free', labels: [] },
    ],
    closed: (n) => n === 9,
    inProgress: false,
    specialties: ['frontend', 'backend'],
  };
  const route = (over: Partial<RouteRequest>) => planRoute({ ...base, ...over });

  it('re-routes to a specialty on the floor, dropping the old swarm label only', () => {
    expect(route({ specialty: 'Frontend' })).toEqual({ addLabels: ['swarm:frontend'], removeLabels: ['swarm:backend'], body: null, summary: '#4 on floor 1: routed to frontend.' });
    expect(route({ specialty: '' })).toMatchObject({ addLabels: [], removeLabels: ['swarm:backend'], summary: '#4 on floor 1: no specialty.' });
  });

  it('refuses a specialty nobody on the floor or in a pending proposal has', () => {
    expect(() => route({ specialty: 'wizardry' })).toThrow('Nobody on floor 1 has the specialty "wizardry", and no pending proposal does. Specialties there: frontend, backend.');
    expect(() => route({ specialty: '!!!' })).toThrow(/is not a specialty/);
  });

  it('rewrites the Depends on line and leaves the rest of the body alone', () => {
    expect(route({ number: 5, dependsOn: [6] }).body).toBe('Depends on #6\n\nIntro\n\nMore');
    expect(route({ number: 5, dependsOn: [] }).body).toBe('Intro\n\nMore');
    expect(route({ number: 6, dependsOn: [1, 4] })).toMatchObject({ body: 'Depends on #1, #4\n\nFree', summary: '#6 on floor 1: depends on #1, #4.' });
  });

  it('refuses a closed or unknown issue', () => {
    expect(() => route({ number: 9, specialty: 'frontend' })).toThrow('#9 is closed.');
    expect(() => route({ number: 42, specialty: 'frontend' })).toThrow('There is no open issue #42 on floor 1.');
  });

  it('refuses dependencies on itself, on closed and on unknown issues', () => {
    expect(() => route({ dependsOn: [4] })).toThrow("#4 can't depend on itself.");
    expect(() => route({ dependsOn: [9] })).toThrow("#9 is closed, so there's nothing to wait for.");
    expect(() => route({ dependsOn: [42] })).toThrow('There is no open issue #42 on floor 1.');
  });

  it('refuses a cycle', () => {
    expect(() => route({ number: 1, dependsOn: [3] })).toThrow('#3 already waits for #1, directly or through other issues, so that would be a cycle.');
    expect(() => route({ number: 4, dependsOn: [5] })).toThrow(/#5 already waits for #4/);
  });

  it('refuses a chain deeper than two steps', () => {
    expect(() => route({ number: 1, dependsOn: [6] })).toThrow('That makes a dependency chain 3 steps deep through #1.');
    expect(() => route({ number: 6, dependsOn: [3] })).toThrow(/3 steps deep/);
    expect(route({ number: 6, dependsOn: [2] }).body).toBe('Depends on #2\n\nFree');
  });

  it('keeps the specialty but not the dependencies of an issue in progress', () => {
    expect(() => route({ inProgress: true, dependsOn: [] })).toThrow("#4 is already in progress, so its dependencies can't change. Changing its specialty is fine.");
    expect(route({ inProgress: true, specialty: 'frontend' }).addLabels).toEqual(['swarm:frontend']);
  });

  it('needs something to change', () => {
    expect(() => route({})).toThrow(/Nothing to change/);
  });
});

describe('IssueCap', () => {
  it('refuses the 13th issue and says the next manager message allows more', () => {
    const cap = new IssueCap(12);
    for (let i = 0; i < 12; i++) {
      cap.check();
      cap.record('a/b');
    }
    expect(() => cap.check()).toThrow("You already filed 12 issues in this job. That's plenty for one milestone. The manager's next message allows more.");
  });

  it('resets when a manager message arrives, and still counts the whole job', () => {
    const cap = new IssueCap(2);
    cap.record('a/b');
    cap.record('c/d');
    expect(() => cap.check()).toThrow();
    cap.managerMessage();
    expect(() => cap.check()).not.toThrow();
    cap.record('a/b');
    expect(cap.total).toBe(3);
    expect([...cap.repos]).toEqual(['a/b', 'c/d']);
  });
});
