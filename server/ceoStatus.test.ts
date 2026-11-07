import { describe, expect, it } from 'vitest';
import type { SessionCallbacks } from './agentRunner.ts';
import type { CeoJob } from './ceo.ts';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';

// The CEO's status follows what it's doing: the manager's message mid-job relabels it, and a finished session
// leaves no job label behind.
type Internals = {
  ensureCeo(interrupted: unknown[]): void;
  ceo(): { status: string; issueTitle: string | null };
  runCeoJob(a: unknown, job: CeoJob): Promise<void>;
  state: { ceo: { job: CeoJob | null } };
};

async function office() {
  const backend = createDemoBackend();
  const sent: string[] = [];
  let cb: SessionCallbacks | null = null;
  backend.startSession = (_opts, callbacks) => {
    cb = callbacks;
    return { send: (t) => sent.push(t), stop: () => undefined };
  };
  const swarm = new Swarm(backend);
  const internals = swarm as unknown as Internals;
  internals.ensureCeo([]);
  const ceo = internals.ceo();
  await internals.runCeoJob(ceo, { kind: 'review', at: 0 });
  return { swarm, internals, ceo, sent, finish: (ok: boolean) => cb!.finished({ ok, text: '', costUsd: 0, turns: 1, errors: ok ? [] : ['boom'] }) };
}

describe("the CEO's status", () => {
  it("switches to the reply when the manager writes mid-job, and keeps the job's own record", async () => {
    const { swarm, internals, ceo, sent } = await office();
    expect(ceo.issueTitle).toBe('Reviewing the company');
    await swarm.messageCeo('How is floor 1 doing?');
    expect(sent).toHaveLength(1);
    expect(ceo.issueTitle).toBe('Replying to you');
    expect(internals.state.ceo.job?.kind).toBe('review');
  });

  it('clears the job label when the session ends, done or failed', async () => {
    for (const ok of [true, false]) {
      const { ceo, finish } = await office();
      finish(ok);
      expect(ceo.status).toBe(ok ? 'done' : 'error');
      expect(ceo.issueTitle).toBeNull();
    }
  });
});
