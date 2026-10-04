import { describe, expect, it } from 'vitest';
import { setUpDesk } from './deskSetup.ts';
import { AgentTerminal } from './terminal.ts';

/** Records the steps as they happen; the idle CLI takes a moment to exit, like a real one. */
function recorder() {
  const steps: string[] = [];
  const idle = () => {
    steps.push('close cli');
    return new Promise<void>((resolve) => setTimeout(() => (steps.push('cli exited'), resolve()), 20));
  };
  const desk = {
    release: async () => void steps.push('release desk'),
    prepare: async () => (steps.push('prepare desk'), '/desks/radia'),
  };
  return { steps, idle, desk };
}

describe('setUpDesk', () => {
  it("closes the agent's idle CLI and waits for it to exit before touching the desk", async () => {
    const { steps, idle, desk } = recorder();
    const term = new AgentTerminal();
    term.releaseIdle = idle;
    expect(await setUpDesk(term, desk)).toBe('/desks/radia');
    expect(steps).toEqual(['close cli', 'cli exited', 'release desk', 'prepare desk']);
    term.dispose();
  });

  it('never closes a CLI that is driving a session (it has no releaseIdle then)', async () => {
    const { steps, desk } = recorder();
    const term = new AgentTerminal();
    term.releaseIdle = null;
    expect(await setUpDesk(term, desk)).toBe('/desks/radia');
    expect(steps).toEqual(['release desk', 'prepare desk']);
    term.dispose();
  });

  it('sets up the desk of an agent with no terminal yet', async () => {
    const { steps, desk } = recorder();
    await setUpDesk(null, desk);
    expect(steps).toEqual(['release desk', 'prepare desk']);
  });
});
