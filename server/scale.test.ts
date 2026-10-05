import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import type { ServerEvent } from '../shared/types.ts';

// A whole office writes its state, secrets and voice cache: a folder of its own, so other tests' files are left alone.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-scale-'));
process.env.SWARM_HOME = home;
const { createDemoBackend } = await import('./demo.ts');
const { Swarm } = await import('./swarm.ts');

// The scale budget (#228): the demo's big company, 10 floors of 15 busy people, run for a few minutes of fake time,
// must fit the snapshot a tab loads and the traffic one tab gets into budgets, so a change that makes either grow with
// the company (terminal lines in the snapshot, every agent change sent in full) fails here, not in someone's office.

const SNAPSHOT_BUDGET = 600_000; // bytes; it was 2 MB and growing with every log line before #228
const TRAFFIC_BUDGET = 80_000; // bytes per second to a tab on one floor with the workers list out; 124 KB/s before

afterAll(() => {
  vi.useRealTimers();
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 5 });
});

describe('a big company', () => {
  it('fits the snapshot and websocket budgets', { timeout: 120_000 }, async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    for (const m of ['log', 'warn', 'info'] as const) vi.spyOn(console, m).mockImplementation(() => undefined);
    const swarm = new Swarm(createDemoBackend({ floors: 10, agents: 15 }));
    const init = swarm.init();
    await vi.advanceTimersByTimeAsync(5_000);
    await init;
    await vi.advanceTimersByTimeAsync(2 * 60_000); // everyone at work, PRs opened, tested and merged

    const sent: string[] = [];
    const listeners: Record<string, (data: unknown) => void> = {};
    const tab = { OPEN: 1, readyState: 1, send: (m: string) => sent.push(m), on: (ev: string, fn: (data: unknown) => void) => void (listeners[ev] = fn) };
    swarm.addClient(tab as unknown as WebSocket);
    listeners.message?.(JSON.stringify({ type: 'lines', floor: 1, agents: [], workers: true }));
    const snapshot = JSON.parse(sent[0]) as Extract<ServerEvent, { type: 'snapshot' }>;
    expect(snapshot.data.agents).toHaveLength(151);
    expect(snapshot.data.agents.filter((a) => a.status === 'working').length).toBeGreaterThan(60);
    expect(snapshot.data.agents.every((a) => a.log.length === 0)).toBe(true);
    expect(sent[0].length).toBeLessThan(SNAPSHOT_BUDGET);

    sent.length = 0;
    await vi.advanceTimersByTimeAsync(60_000);
    const bytes = sent.reduce((n, m) => n + Buffer.byteLength(m), 0);
    expect(bytes / 60).toBeLessThan(TRAFFIC_BUDGET);
    // only floor 1's terminal lines came, and agent changes came in batches
    const types = sent.map((m) => JSON.parse(m) as ServerEvent);
    const floorOf = new Map(snapshot.data.agents.map((a) => [a.id, snapshot.data.repos.find((r) => r.id === a.repoId)?.floor ?? 0]));
    const lineFloors = new Set(types.flatMap((e) => (e.type === 'logs' ? Object.keys(e.tails).map((id) => floorOf.get(id)) : [])));
    expect([...lineFloors]).toEqual([1]);
    expect(types.filter((e) => e.type === 'agent').length).toBe(0);
    expect(types.filter((e) => e.type === 'agents').length).toBeLessThanOrEqual(4 * 60 + 1);
  });
});
