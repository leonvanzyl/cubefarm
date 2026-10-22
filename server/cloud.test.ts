import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ANTHROPIC_KEY_ENV, boxLabels, boxName, Cloud, credentialViews, githubEnv, machineOfBox, redact, resolveCredentials, type CredentialInput } from './cloud.ts';
import { CloudError, type BoxApi, type BoxInfo } from './box.ts';

const none: CredentialInput = { claudeToken: '', secrets: {}, ghToken: '' };

describe('resolveCredentials', () => {
  it('gives Claude Code the subscription token when the office has one, and blanks every other Claude variable', () => {
    const c = resolveCredentials('claude', { claudeToken: 'sk-ant-oat01-sub', secrets: { anthropicApiKey: 'sk-ant-api-key' }, ghToken: 'gho_login' });
    expect(c.env).toEqual({ GH_TOKEN: 'gho_login', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-sub', ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '', [ANTHROPIC_KEY_ENV]: '' });
    expect(c.apiKeyHelper).toBeNull();
    expect(c.missing).toEqual([]);
  });

  it('falls back to an Anthropic API key, read through apiKeyHelper rather than ANTHROPIC_API_KEY', () => {
    const c = resolveCredentials('claude', { ...none, secrets: { anthropicApiKey: 'sk-ant-api-key' }, ghToken: 'gho_login' });
    expect(c.env[ANTHROPIC_KEY_ENV]).toBe('sk-ant-api-key');
    expect(c.env.ANTHROPIC_API_KEY).toBe('');
    expect(c.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('');
    expect(c.apiKeyHelper).toBe(`printenv ${ANTHROPIC_KEY_ENV}`);
  });

  it('gives Codex the OpenAI key under both names it reads', () => {
    const c = resolveCredentials('codex', { ...none, secrets: { openaiApiKey: 'sk-openai' }, ghToken: 'gho_login' });
    expect(c.env).toEqual({ GH_TOKEN: 'gho_login', OPENAI_API_KEY: 'sk-openai', CODEX_API_KEY: 'sk-openai' });
    expect(c.env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it("prefers a saved GitHub token to the manager's gh login", () => {
    expect(resolveCredentials('codex', { ...none, secrets: { cloudGithubToken: 'github_pat_x' }, ghToken: 'gho_login' }).env.GH_TOKEN).toBe('github_pat_x');
    expect(githubEnv({ ...none, ghToken: 'gho_login' })).toEqual({ GH_TOKEN: 'gho_login' });
    expect(githubEnv(none)).toEqual({});
  });

  it("says what's missing, and leaves a CLI with no key to its own login in the Box", () => {
    const c = resolveCredentials('claude', none);
    expect(c.missing).toHaveLength(1);
    expect(c.missing[0]).toMatch(/^GitHub/);
    expect(c.ownLogin).toBe(true);
    expect(c.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(''); // its own login, never one from the office's environment
    const codex = resolveCredentials('codex', { ...none, ghToken: 'g' });
    expect(codex.missing).toEqual([]);
    expect(codex.ownLogin).toBe(true);
    expect(resolveCredentials('claude', { ...none, claudeToken: 'sk-ant-oat01-sub' }).ownLogin).toBe(false);
    expect(resolveCredentials('codex', { ...none, secrets: { openaiApiKey: 'sk-openai' } }).ownLogin).toBe(false);
  });
});

describe('credentialViews', () => {
  it('says where each credential comes from, never what it is', () => {
    const view = credentialViews({ claudeToken: 'sk-ant-oat01-secret-token', secrets: { cloudGithubToken: 'github_pat_abcdef1234', openaiApiKey: 'sk-openai-xyz9876' }, ghToken: '' });
    expect(view.github).toEqual({ ready: true, source: 'token', hint: '1234' });
    expect(view.claude).toEqual({ ready: true, source: 'subscription', hint: '' });
    expect(view.codex).toEqual({ ready: true, source: 'apiKey', hint: '9876' });
    expect(JSON.stringify(view)).not.toMatch(/secret-token|abcdef|openai-xyz/);
  });

  it("shows a gh login as the GitHub source, and a coding agent with no key as signing in in each agent's terminal", () => {
    expect(credentialViews({ ...none, ghToken: 'gho_x' }).github).toEqual({ ready: true, source: 'gh', hint: '' });
    expect(credentialViews(none).github).toEqual({ ready: false, source: null, hint: '' });
    expect(credentialViews(none).claude).toEqual({ ready: true, source: 'login', hint: '' });
    expect(credentialViews(none).codex).toEqual({ ready: true, source: 'login', hint: '' });
  });
});

describe('redact', () => {
  it('scrubs every secret out of text, leaving short strings alone', () => {
    expect(redact('push failed: https://x-access-token:ghp_12345678@github.com', ['ghp_12345678'])).toBe('push failed: https://x-access-token:•••@github.com');
    expect(redact('a b c', ['b', ''])).toBe('a b c');
  });
});

describe('Box names', () => {
  it('fit within Upstash label rules and tell offices and machines apart', () => {
    expect(boxName('k3f9qa', 'a1b2c3d4')).toBe('cubefarm-k3f9qa-a1b2c3d4');
    const labels = boxLabels('k3f9qa', 'a1b2c3d4');
    expect(labels.length).toBeLessThanOrEqual(5);
    for (const l of labels) expect(l).toMatch(/^[A-Za-z0-9._:-]{1,20}$/);
    expect(machineOfBox({ labels }, 'k3f9qa')).toBe('a1b2c3d4');
    expect(machineOfBox({ labels }, 'other1')).toBeNull();
    expect(machineOfBox({ labels: ['cubefarm'] }, 'k3f9qa')).toBeNull();
  });
});

/** A fake account: the Boxes given, and a key that works or doesn't. */
function fakeApi(boxes: BoxInfo[], ok = true): BoxApi {
  const fail = async () => {
    throw new CloudError('Upstash turned the Box API key away.', 'auth');
  };
  return {
    list: ok ? async () => boxes : fail,
    remove: async (id: string) => {
      boxes.splice(
        boxes.findIndex((b) => b.id === id),
        1,
      );
    },
  } as unknown as BoxApi;
}

describe('Cloud', () => {
  const setup = async (boxes: BoxInfo[] = [], ok = true) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cubefarm-cloud-'));
    const views: unknown[] = [];
    const cloud = new Cloud({
      secretsFile: path.join(dir, 'secrets.json'),
      env: { CUBEFARM_CLAUDE_TOKEN: 'sk-ant-oat01-from-env' },
      boxes: (key) => fakeApi(boxes, ok && key === 'good-key'),
      ghToken: async () => 'gho_login_token',
      office: () => 'k3f9qa',
      machines: () => new Set(['a1b2c3d4']),
      changed: (v) => views.push(v),
      log: () => undefined,
    });
    await cloud.init();
    return { cloud, dir, views };
  };

  it('checks a key before saving it, and keeps it out of the view', async () => {
    const { cloud, dir } = await setup();
    await expect(cloud.setKey('bad-key')).rejects.toThrow(/turned the Box API key away/);
    expect(cloud.boxApi()).toBeNull();
    const view = await cloud.setKey('good-key');
    expect(view.keySet).toBe(true);
    expect(JSON.stringify(view)).not.toContain('good-key');
    expect(JSON.parse(await fs.readFile(path.join(dir, 'secrets.json'), 'utf8'))).toEqual({ upstashBoxKey: 'good-key' });
  });

  it("counts the account's Boxes and finds this office's orphans", async () => {
    const boxes: BoxInfo[] = [
      { id: '1', name: 'cubefarm-k3f9qa-a1b2c3d4', labels: boxLabels('k3f9qa', 'a1b2c3d4'), status: 'running' },
      { id: '2', name: 'cubefarm-k3f9qa-deadbeef', labels: boxLabels('k3f9qa', 'deadbeef'), status: 'paused' },
      { id: '3', name: 'cf-other1-12345678', labels: boxLabels('other1', '12345678'), status: 'running' },
      { id: '4', name: 'someone-else', labels: [], status: 'idle' },
    ];
    const { cloud } = await setup(boxes);
    await cloud.setKey('good-key');
    expect(cloud.view().boxes).toEqual({ total: 4, running: 1, paused: 1, orphans: 1 });
    expect(await cloud.deleteOrphans()).toEqual({ deleted: 1 });
    expect(boxes.map((b) => b.id)).toEqual(['1', '3', '4']);
  });

  it('reads the subscription token from the environment and lists every secret to scrub', async () => {
    const { cloud } = await setup();
    await cloud.setToken('openai', 'sk-openai-key-1');
    expect((await cloud.credentials('claude')).env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-from-env');
    expect(cloud.secretValues()).toEqual(expect.arrayContaining(['sk-ant-oat01-from-env', 'gho_login_token', 'sk-openai-key-1']));
  });

  it("refuses a setup-token where an Anthropic API key goes, since it belongs in the environment", async () => {
    const { cloud } = await setup();
    await expect(cloud.setToken('anthropic', 'sk-ant-oat01-subscription')).rejects.toThrow(/environment/);
  });
});
