import { describe, expect, it } from 'vitest';
import type { AgentCli, EffortLevel } from '../shared/types.ts';
import type { SessionCallbacks, SessionOptions } from './agentRunner.ts';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';
import type { CeoJob } from './ceo.ts';

type CeoAgent = { id: string; cli: AgentCli; effort: EffortLevel | ''; sessionCli: AgentCli | null; sessionId: string | null; sessionEffort?: EffortLevel };
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  runCeoJob(agent: CeoAgent, job: CeoJob): Promise<void>;
  state: { agents: CeoAgent[]; ceo: { queue: CeoJob[] } };
};

async function startCeo(cli: AgentCli, sessionCli: AgentCli | null, runtime: 'terminal' | 'sdk') {
  const backend = createDemoBackend();
  let started: SessionOptions | undefined;
  backend.startSession = (opts) => {
    started = opts;
    return { send: () => undefined, stop: () => undefined };
  };
  const swarm = new Swarm(backend);
  const internals = swarm as unknown as Internals;
  internals.ensureCeo([]);
  swarm.updateSettings({ runtime });
  const ceo = internals.state.agents.find((a) => a.cli === 'claude')!;
  ceo.cli = cli;
  ceo.sessionCli = sessionCli;
  ceo.sessionId = sessionCli ? 'previous-session' : null;
  await internals.runCeoJob(ceo, { kind: 'chat', text: 'Review the team', at: Date.now() });
  return started!;
}

describe('CEO session instructions', () => {
  it('uses the selected CLI namespace when the configured CLI changed', async () => {
    const opts = await startCeo('opencode', 'codex', 'terminal');
    expect(opts.cli).toBe('opencode');
    expect(opts.systemAppend).toContain('Call office_company_status first');
    expect(opts.systemAppend).toContain('office_save_notes');
  });

  it('uses Claude tool names when the Agent SDK runs the CEO', async () => {
    const opts = await startCeo('opencode', null, 'sdk');
    expect(opts.cli).toBeUndefined();
    expect(opts.systemAppend).toContain('Call mcp__office__company_status first');
    expect(opts.systemAppend).not.toContain('office_company_status');
  });

  it('starts a fresh OpenCode session after the CEO effort changes, even if the old turn finishes later', async () => {
    const backend = createDemoBackend();
    let callbacks: SessionCallbacks | undefined;
    backend.startSession = (_opts, cb) => {
      callbacks = cb;
      return { send: () => undefined, stop: () => undefined };
    };
    const swarm = new Swarm(backend);
    const internals = swarm as unknown as Internals;
    internals.ensureCeo([]);
    swarm.updateSettings({ runtime: 'terminal' });
    const ceo = internals.state.agents.find((a) => a.cli === 'claude')!;
    Object.assign(ceo, { cli: 'opencode', effort: 'max', sessionCli: 'opencode', sessionId: 'previous-session' });
    await internals.runCeoJob(ceo, { kind: 'chat', text: 'Review the team', at: Date.now() });
    swarm.updateAgent(ceo.id, { effort: 'high' });
    expect(ceo.sessionId).toBeNull();
    callbacks!.sessionId('previous-session');
    expect(ceo.sessionId).toBeNull();
  });

  it('does not resume an older OpenCode session whose selected effort is unknown', async () => {
    const backend = createDemoBackend();
    let started: SessionOptions | undefined;
    let callbacks: SessionCallbacks | undefined;
    backend.startSession = (opts, cb) => {
      started = opts;
      callbacks = cb;
      return { send: () => undefined, stop: () => undefined };
    };
    const swarm = new Swarm(backend);
    const internals = swarm as unknown as Internals;
    internals.ensureCeo([]);
    swarm.updateSettings({ runtime: 'terminal' });
    const ceo = internals.state.agents.find((a) => a.cli === 'claude')!;
    Object.assign(ceo, { cli: 'opencode', effort: 'high', sessionCli: 'opencode', sessionId: 'old-max-session' });
    await internals.runCeoJob(ceo, { kind: 'chat', text: 'Are you there?', at: Date.now() });
    expect(started?.resumeSessionId).toBeUndefined();
    callbacks!.sessionId('new-high-session');
    expect(ceo.sessionEffort).toBe('high');
  });

  it('resumes a matching OpenCode session and retries a prompt it did not accept', async () => {
    const backend = createDemoBackend();
    let started: SessionOptions | undefined;
    let callbacks: SessionCallbacks | undefined;
    backend.startSession = (opts, cb) => {
      started = opts;
      callbacks = cb;
      return { send: () => undefined, stop: () => undefined };
    };
    const swarm = new Swarm(backend);
    const internals = swarm as unknown as Internals;
    internals.ensureCeo([]);
    swarm.updateSettings({ runtime: 'terminal' });
    const ceo = internals.state.agents.find((a) => a.cli === 'claude')!;
    Object.assign(ceo, { cli: 'opencode', effort: 'high', sessionCli: 'opencode', sessionId: 'high-session', sessionEffort: 'high' });
    await internals.runCeoJob(ceo, { kind: 'chat', text: 'Are you there?', at: Date.now() });
    expect(started?.resumeSessionId).toBe('high-session');
    await swarm.messageCeo('Second question');
    callbacks!.sessionId(null);
    callbacks!.finished({ ok: false, text: '', errors: ['OpenCode did not accept the resumed prompt.'], costUsd: 0, turns: 0 });
    expect(ceo.sessionId).toBeNull();
    expect(internals.state.ceo.queue).toMatchObject([{ kind: 'chat', text: 'Are you there?\nSecond question' }]);
  });

  it('queues messages while OpenCode is busy so each chat starts a submitted turn', async () => {
    const backend = createDemoBackend();
    let sends = 0;
    backend.startSession = () => ({ send: () => { sends += 1; }, stop: () => undefined });
    const swarm = new Swarm(backend);
    const internals = swarm as unknown as Internals;
    internals.ensureCeo([]);
    swarm.updateSettings({ runtime: 'terminal' });
    const ceo = internals.state.agents.find((a) => a.cli === 'claude')!;
    ceo.cli = 'opencode';
    await internals.runCeoJob(ceo, { kind: 'chat', text: 'First', at: Date.now() });
    await swarm.messageCeo('Second');
    expect(sends).toBe(0);
    expect(internals.state.ceo.queue).toMatchObject([{ kind: 'chat', text: 'Second' }]);
  });
});
