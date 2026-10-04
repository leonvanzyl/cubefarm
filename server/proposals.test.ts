import { describe, expect, it } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { HttpError } from './httpError.ts';
import { Swarm } from './swarm.ts';

// In-person hiring (#227): the demo office makes proposals on demand through the CEO's own path, and a decision made
// face to face carries the manager's note to the CEO, hire or decline.
describe('proposals made and decided in person', () => {
  it('the demo proposes a hire for a free desk and a let-go on demand; the manager hires with a note', async () => {
    const swarm = new Swarm(createDemoBackend());
    const repo = await swarm.connectRepo('demo-co/pixel-todo');
    // as start() does: the company always has a CEO (proposals are in their name)
    (swarm as unknown as { ensureCeo(interrupted: unknown[]): void }).ensureCeo([]);
    swarm.hireAgent(repo.id, {});
    swarm.hireAgent(repo.id, {});

    swarm.demoPropose('hire');
    swarm.demoPropose('hire');
    const hires = swarm.snapshot().requests.filter((r) => r.kind === 'hire');
    expect(hires.map((r) => r.status)).toEqual(['pending', 'pending']);
    expect(hires[0].title).toBe('Accessibility engineer');
    expect(hires[1].specialty).not.toBe(hires[0].specialty);
    expect(swarm.snapshot().messages.filter((m) => m.from === 'ceo' && m.requestId).length).toBe(2);

    swarm.approveRequest(hires[0].id, { note: 'Start with the keyboard shortcuts' });
    swarm.rejectRequest(hires[1].id, 'Not this quarter');
    const after = swarm.snapshot();
    const hired = after.requests.find((r) => r.id === hires[0].id)!;
    expect(hired).toMatchObject({ status: 'approved', note: 'Start with the keyboard shortcuts', decidedBy: 'manager' });
    // the same id as the proposal, so the candidate in the lobby and the new hire at their desk look alike
    expect(hired.agentId).toBe(hired.id);
    expect(after.agents.some((a) => a.id === hired.agentId && a.title === 'Accessibility engineer' && a.color === hired.color && a.look === hired.look)).toBe(true);
    expect(after.requests.find((r) => r.id === hires[1].id)).toMatchObject({ status: 'rejected', note: 'Not this quarter' });
    expect(after.messages.some((m) => m.from === 'office' && m.text.includes('Start with the keyboard shortcuts'))).toBe(true);

    swarm.demoPropose('let-go', repo.floor);
    const letGo = swarm.snapshot().requests.find((r) => r.kind === 'let-go')!;
    expect(letGo.status).toBe('pending');
    expect(after.agents.some((a) => a.id === letGo.agentId && a.role === 'dev')).toBe(true);
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
