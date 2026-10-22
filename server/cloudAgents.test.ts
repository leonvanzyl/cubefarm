import { describe, expect, it } from 'vitest';
import { createDemoBackend } from './demo.ts';
import { Swarm } from './swarm.ts';

// Cloud agents (docs/cloud.md) in a demo office: its fake Upstash account takes any key. Agents work on this computer
// unless the manager connects Upstash and asks for the cloud; then they each get a Box.

async function office() {
  const swarm = new Swarm(createDemoBackend());
  const repo = await swarm.connectRepo('demo-co/pixel-todo'); // with its first agent
  const agents = () => swarm.snapshot().agents.filter((a) => a.repoId === repo.id);
  return { swarm, repo, agents };
}

describe('where agents work', () => {
  it('starts on this computer, and the cloud needs an Upstash key first', async () => {
    const { swarm, repo, agents } = await office();
    expect(swarm.snapshot().settings.cloud.machineKind).toBe('local');
    expect(agents()[0].host).toBe('local');
    expect(() => swarm.updateSettings({ cloud: { machineKind: 'box', boxSize: 'small', boxLimit: 10 } })).toThrow(/Upstash Box API key/);
    expect(() => swarm.hireAgent(repo.id, { host: 'box', strict: true })).toThrow(/Upstash Box API key/);
  });

  it('hires cloud agents once Upstash is connected, each with a Box of their own', async () => {
    const { swarm, repo, agents } = await office();
    await swarm.setCloudKey('demo-key');
    swarm.updateSettings({ cloud: { machineKind: 'box', boxSize: 'medium', boxLimit: 10 } });
    const ada = swarm.hireAgent(repo.id, { name: 'Ada', strict: true });
    expect(ada.host).toBe('box');
    expect(ada.cloud).toMatch(/none|creating/);
    const local = swarm.hireAgent(repo.id, { name: 'Lin', host: 'local', strict: true });
    expect(local.host).toBe('local');
    expect(agents().filter((a) => a.host === 'box').map((a) => a.name)).toEqual(['Ada']);
    // The key itself never reaches a tab.
    expect(JSON.stringify(swarm.snapshot())).not.toContain('demo-key');
  });

  it("keeps OpenCode agents and agents past the plan's Box limit on this computer, saying why", async () => {
    const { swarm, repo } = await office();
    await swarm.setCloudKey('demo-key');
    expect(() => swarm.hireAgent(repo.id, { host: 'box', cli: 'opencode', strict: true })).toThrow(/OpenCode/);
    swarm.updateSettings({ cloud: { machineKind: 'box', boxSize: 'small', boxLimit: 1 } });
    swarm.hireAgent(repo.id, { name: 'Ada', strict: true });
    expect(() => swarm.hireAgent(repo.id, { name: 'Bo', strict: true })).toThrow(/Box limit \(1\)/);
    // A floor's own first agent isn't refused: they work on this computer instead.
    expect(swarm.hireAgent(repo.id, { name: 'Cy' }).host).toBe('local');
  });

  it('moves an idle agent to the cloud and back, starting their next session fresh', async () => {
    const { swarm, agents } = await office();
    await swarm.setCloudKey('demo-key');
    const first = agents()[0];
    swarm.updateAgent(first.id, { host: 'box' });
    expect(agents()[0].host).toBe('box');
    expect(() => swarm.updateAgent(first.id, { cli: 'opencode' })).toThrow(/OpenCode/);
    swarm.updateAgent(first.id, { host: 'local' });
    expect(agents()[0].host).toBe('local');
  });

  it('turns the cloud default off when the key is removed', async () => {
    const { swarm } = await office();
    await swarm.setCloudKey('demo-key');
    swarm.updateSettings({ cloud: { machineKind: 'box', boxSize: 'small', boxLimit: 10 } });
    await swarm.setCloudKey('');
    expect(swarm.snapshot().settings.cloud.machineKind).toBe('local');
    expect(swarm.snapshot().cloud?.keySet).toBe(false);
  });
});
