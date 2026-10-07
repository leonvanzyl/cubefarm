import { describe, expect, it } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { HttpError } from './httpError.ts';
import { Swarm } from './swarm.ts';

// Team changes (docs/agents.md): the demo office grows or shrinks a floor on demand through the CEO's own scale_team,
// a new agent waits in the lobby until the manager sets them up and hires them, and their note reaches the CEO.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  applyTeamChanges(): void;
  state: { agents: { id: string; status: string; repoId: string }[] };
};

async function office() {
  const swarm = new Swarm(createDemoBackend());
  const repo = await swarm.connectRepo('demo-co/pixel-todo'); // with its first agent
  // as start() does: the company always has a CEO (team changes are in their name)
  (swarm as unknown as Internals).ensureCeo([]);
  swarm.hireAgent(repo.id, {});
  swarm.hireAgent(repo.id, {});
  return { swarm, repo, team: () => swarm.snapshot().agents.filter((a) => a.repoId === repo.id) };
}

describe('team changes waiting for the manager', () => {
  it('a new agent waits in the lobby and joins as the manager set them up, with their note', async () => {
    const { swarm, team } = await office();
    swarm.demoPropose('hire');
    swarm.demoPropose('hire');
    const hires = swarm.snapshot().requests.filter((r) => r.kind === 'hire');
    expect(hires.map((r) => r.status)).toEqual(['pending', 'pending']);
    expect(hires[0].name).not.toBe(hires[1].name);
    expect(swarm.snapshot().messages.filter((m) => m.from === 'ceo' && m.requestId).length).toBe(2);
    expect(team()).toHaveLength(3); // nobody joins before the manager says so

    swarm.approveRequest(hires[0].id, { note: 'Start with the keyboard shortcuts', cli: 'codex', model: 'gpt-6', effort: 'high' });
    swarm.rejectRequest(hires[1].id, 'Not this quarter');
    const after = swarm.snapshot();
    const hired = after.requests.find((r) => r.id === hires[0].id)!;
    expect(hired).toMatchObject({ status: 'approved', note: 'Start with the keyboard shortcuts', decidedBy: 'manager', cli: 'codex', model: 'gpt-6', effort: 'high' });
    // the same id as the request, so the candidate in the lobby and the new agent at their desk look alike
    expect(hired.agentId).toBe(hired.id);
    expect(after.agents.find((a) => a.id === hired.agentId)).toMatchObject({ role: 'agent', cli: 'codex', model: 'gpt-6', effort: 'high', color: hired.color, look: hired.look, desk: 3 });
    expect(after.requests.find((r) => r.id === hires[1].id)).toMatchObject({ status: 'rejected', note: 'Not this quarter' });
    expect(after.messages.some((m) => m.from === 'office' && m.text.includes('Start with the keyboard shortcuts'))).toBe(true);
  });

  it('a smaller team is a let-go of an idle agent, decided by the manager', async () => {
    const { swarm, team } = await office();
    swarm.demoPropose('let-go');
    const letGo = swarm.snapshot().requests.find((r) => r.kind === 'let-go')!;
    expect(letGo.status).toBe('pending');
    expect(team().find((a) => a.id === letGo.agentId)?.desk).toBe(2); // the highest desk of the idle ones
    swarm.approveRequest(letGo.id);
    expect(team().map((a) => a.desk)).toEqual([0, 1]);
  });

  it("grows no team past the floor's max, and keeps one agent", async () => {
    const { swarm, team } = await office();
    swarm.updateSettings({ maxAgents: 3 });
    expect(() => swarm.demoPropose('hire')).toThrow('Every floor already has its most agents');
    swarm.updateSettings({ maxAgents: 10 });
    swarm.demoPropose('let-go');
    swarm.approveRequest(swarm.snapshot().requests.find((r) => r.status === 'pending')!.id);
    swarm.demoPropose('let-go');
    swarm.approveRequest(swarm.snapshot().requests.find((r) => r.status === 'pending')!.id);
    expect(team()).toHaveLength(1);
    expect(() => swarm.demoPropose('let-go')).toThrow('No floor has an idle agent to let go');
    expect(() => swarm.fireAgent(team()[0].id)).toThrow('every floor keeps at least one');
  });

  it('refuses outside the demo, without floors, and for anything but a hire or a let-go', async () => {
    const real = new Swarm({ ...createDemoBackend(), demo: false });
    expect(() => real.demoPropose('hire')).toThrow(HttpError);
    const demo = new Swarm(createDemoBackend());
    expect(() => demo.demoPropose('hire')).toThrow(/no floors/);
    await demo.connectRepo('demo-co/weather-api');
    expect(() => demo.demoPropose('promote')).toThrow(/kind/);
    expect(() => demo.demoPropose('hire', 7)).toThrow(/no floor 7/);
  });
});

describe('team changes applied straight away', () => {
  it('new agents join at once; busy agents leave when their task is over', async () => {
    const { swarm, team } = await office();
    swarm.updateSettings({ scaling: 'auto' });
    swarm.demoPropose('hire');
    expect(team()).toHaveLength(4);
    expect(swarm.snapshot().requests.find((r) => r.kind === 'hire')).toMatchObject({ status: 'approved', decidedBy: 'auto' });

    const internals = swarm as unknown as Internals;
    const busy = internals.state.agents.filter((a) => a.repoId === team()[0].repoId);
    for (const a of busy) a.status = 'working';
    busy[0].status = 'idle';
    // From 4 to 2: the idle one leaves now, a busy one after their task.
    const text = (swarm as unknown as { scaleTeam(x: object): string }).scaleTeam({ floor: 1, size: 2, reason: 'Nothing ready to start.' });
    expect(text).toMatch(/left; .+ will leave after their current task/);
    expect(team()).toHaveLength(3);
    const leaving = swarm.snapshot().requests.find((r) => r.kind === 'let-go' && r.status === 'pending')!;
    const agent = internals.state.agents.find((a) => a.id === leaving.agentId)!;
    agent.status = 'done';
    internals.applyTeamChanges();
    expect(team()).toHaveLength(2);
  });

  it("never lets a floor's last agent go", async () => {
    const { swarm, team } = await office();
    swarm.updateSettings({ scaling: 'auto' });
    const internals = swarm as unknown as Internals;
    for (const a of internals.state.agents) if (a.repoId === team()[0].repoId) a.status = 'working';
    (swarm as unknown as { scaleTeam(x: object): string }).scaleTeam({ floor: 1, size: 1, reason: 'Quiet week.' });
    expect(swarm.snapshot().requests.filter((r) => r.kind === 'let-go' && r.status === 'pending')).toHaveLength(2);
    // The manager lets two go by hand meanwhile: one of those leaving is now the floor's only agent.
    const [first, second] = team().map((a) => a.id);
    for (const a of internals.state.agents) a.status = 'idle';
    const keep = swarm.snapshot().requests.filter((r) => r.kind === 'let-go').map((r) => r.agentId);
    for (const id of [first, second].filter((id) => !keep.includes(id))) swarm.fireAgent(id);
    swarm.fireAgent(keep[0]!);
    internals.applyTeamChanges();
    expect(team()).toHaveLength(1);
    expect(swarm.snapshot().requests.find((r) => r.agentId === keep[1])).toMatchObject({ status: 'rejected', decidedBy: 'auto' });
  });
});
