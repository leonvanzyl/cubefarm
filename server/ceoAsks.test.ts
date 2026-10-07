import { describe, expect, it } from 'vitest';
import { askedFor, ceoJobPrompt, ceoSystemPrompt, NOT_ASKED } from './ceo.ts';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';

// Only the manager decides on new work: the CEO files issues only in a job the manager started by asking for work
// (a plan from their brief, or their message), never in its own reviews, onboarding or triage.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  fileIssue(x: { floor: number; title: string; body: string }): Promise<string>;
  ceoAsked: boolean;
  state: { ceo: { queue: { kind: string; repoId?: string }[] } };
};

describe('who asks for new work', () => {
  it("is the manager: their plans and messages, not the CEO's own jobs", () => {
    expect(askedFor({ kind: 'plan' })).toBe(true);
    expect(askedFor({ kind: 'chat' })).toBe(true);
    for (const kind of ['review', 'onboard', 'triage'] as const) expect(askedFor({ kind })).toBe(false);
  });

  it('is in the prompts: reviews and onboarding suggest work instead of filing it', () => {
    const system = ceoSystemPrompt({ name: 'Luna', company: 'Acme', manager: 'Sam', notesFile: 'notes.md', sessionLimit: 0, maxAgents: 10, scaling: 'approve' });
    expect(system).toContain('Never decide on new work yourself.');
    const review = ceoJobPrompt({ kind: 'review', at: 0 }, null);
    expect(review).not.toContain('plan the next milestone');
    expect(review).toContain('file no issues');
    const floor = { floor: 2, fullName: 'acme/app', clone: '/clones/app', mission: 'Add voice messages', backlog: 0 };
    const onboard = ceoJobPrompt({ kind: 'onboard', repoId: 'r1', at: 0 }, floor);
    expect(onboard).toContain('File no issues');
    expect(onboard).not.toContain('plan the first milestone');
    expect(ceoJobPrompt({ kind: 'onboard', repoId: 'r1', at: 0 }, { ...floor, mission: '', backlog: 3 })).toContain('file no new ones');
  });
});

describe("the CEO's file_issue", () => {
  async function office(mission?: string) {
    const swarm = new Swarm(createDemoBackend());
    await swarm.connectRepo('demo-co/pixel-todo', { mission });
    const internals = swarm as unknown as Internals;
    internals.ensureCeo([]);
    return { swarm, internals };
  }

  it("is refused in a job the manager didn't ask for", async () => {
    const { internals } = await office();
    internals.ceoAsked = false;
    await expect(internals.fileIssue({ floor: 1, title: 'Add a dark mode', body: 'Nobody asked.' })).rejects.toThrow(NOT_ASKED);
  });

  it('files work the manager asked for', async () => {
    const { internals } = await office();
    internals.ceoAsked = true;
    await expect(internals.fileIssue({ floor: 1, title: 'Add a dark mode', body: 'The manager asked.' })).resolves.toMatch(/^Filed #\d+ on floor 1: Add a dark mode\.$/);
  });

  it('plans a brief given when the project moves in, as a job of its own after onboarding', async () => {
    expect((await office('A cozy island bakery')).internals.state.ceo.queue.map((j) => j.kind)).toEqual(['onboard', 'plan']);
    expect((await office()).internals.state.ceo.queue.map((j) => j.kind)).toEqual(['onboard']);
  });
});
