import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';

// A cloud agent's coding agent signs in with its own login in their Box (docs/cloud.md). In a demo office the fake
// Upstash account's new Boxes are signed out, the fake sign-in in the agent's terminal signs them in, and
// expireSignIns() signs every Box out again, as a login Anthropic or OpenAI turned away would.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  for (const m of ['log', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function office() {
  const swarm = new Swarm(createDemoBackend());
  const connecting = swarm.connectRepo('demo-co/pixel-todo');
  await vi.advanceTimersByTimeAsync(2_000);
  const repo = await connecting;
  await swarm.setCloudKey('demo-key');
  const agent = (id: string) => swarm.snapshot().agents.find((a) => a.id === id)!;
  return { swarm, repo, agent };
}

/** Someone watching an agent's terminal (as /ws/term does): what they saw, and keys they type. */
function viewer() {
  const seen: string[] = [];
  const on: Record<string, (raw: unknown) => void> = {};
  const ws = { OPEN: 1, readyState: 1, bufferedAmount: 0, send: (m: string) => seen.push(m), close: () => undefined, on: (ev: string, fn: (raw: unknown) => void) => void (on[ev] = fn) };
  return { ws: ws as unknown as WebSocket, seen, type: (data: string) => on.message?.(JSON.stringify({ t: 'input', data })) };
}

describe('signing cloud agents in', () => {
  it('asks to sign a new cloud hire in, keeps work from them meanwhile, and signs them in in their terminal', async () => {
    const { swarm, repo, agent } = await office();
    const ada = swarm.hireAgent(repo.id, { name: 'Ada', host: 'box', strict: true });
    await vi.advanceTimersByTimeAsync(10_000); // their Box is created and set up, then asked
    expect(agent(ada.id).needsSignIn).toBe(true);
    expect(agent(ada.id).terminal).toBe(true);

    // The floor hands out work, but not to someone waiting to be signed in.
    swarm.updateRepo(repo.id, { autoAssign: true });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(agent(ada.id).status).toBe('idle');
    expect(swarm.snapshot().agents.some((a) => a.repoId === repo.id && a.id !== ada.id && a.status !== 'idle')).toBe(true);

    const v = viewer();
    swarm.attachTerminal(ada.id, v.ws);
    await vi.advanceTimersByTimeAsync(100);
    expect(v.seen.join('')).toContain('Paste code here if prompted');
    v.type('\x1b[200~demo-code\x1b[201~\r');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(agent(ada.id).needsSignIn).toBe(false);
    expect(v.seen.join('')).not.toContain('demo-code'); // never echoed, so never in the terminal's copy
  });

  it("holds a task until they're signed in, and again when their sign-in expires mid-task", async () => {
    const { swarm, repo, agent } = await office();
    const ada = swarm.hireAgent(repo.id, { name: 'Ada', host: 'box', strict: true });
    await vi.advanceTimersByTimeAsync(10_000);
    const issue = swarm.snapshot().repos.find((r) => r.id === repo.id)!.issues[0];
    swarm.assign(ada.id, issue.number);
    await vi.advanceTimersByTimeAsync(10_000); // the desk is set up in their Box, then the session would start
    expect(agent(ada.id)).toMatchObject({ status: 'preparing', needsSignIn: true, issueNumber: issue.number });

    const v = viewer();
    swarm.attachTerminal(ada.id, v.ws);
    await vi.advanceTimersByTimeAsync(100);
    v.type('code\r');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(agent(ada.id)).toMatchObject({ status: 'working', needsSignIn: false, issueNumber: issue.number });

    swarm.expireSignIns();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(agent(ada.id)).toMatchObject({ status: 'preparing', needsSignIn: true, issueNumber: issue.number });

    v.type('code again\r');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(agent(ada.id)).toMatchObject({ status: 'working', needsSignIn: false, issueNumber: issue.number });
  });

  it('needs no sign-in once the office has a key for their coding agent', async () => {
    const { swarm, repo, agent } = await office();
    const ada = swarm.hireAgent(repo.id, { name: 'Ada', host: 'box', strict: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(agent(ada.id).needsSignIn).toBe(true);
    await swarm.setCloudToken('anthropic', 'sk-ant-api03-demo-key');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(agent(ada.id).needsSignIn).toBe(false);
    await swarm.setCloudToken('anthropic', '');
  });

  it('only starts a sign-in for a cloud agent who needs one', async () => {
    const { swarm, repo } = await office();
    const lin = swarm.hireAgent(repo.id, { name: 'Lin', host: 'local', strict: true });
    expect(() => swarm.signIn(lin.id)).toThrow(/this computer/);
    expect(() => swarm.expireSignIns()).not.toThrow();
  });
});
