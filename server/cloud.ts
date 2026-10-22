// The cloud account (docs/cloud.md): the Upstash Box API key, and what cloud agents sign in with. Keys and tokens the
// manager pastes live in secrets.json (never in the state, the snapshot, events, logs or a Box's files). The Claude
// subscription token is read from the office's environment (CUBEFARM_CLAUDE_TOKEN) and never written down: Anthropic's
// terms bar apps like this one from storing Claude.ai tokens. A Box gets each credential only as the environment of
// the one command that needs it. Without one for its CLI, a cloud agent's CLI uses its own login in their Box, which
// the manager signs in once in the agent's terminal (Swarm's sign-in): the office never sees that login.

import { HttpError } from './httpError.ts';
import { mergeSecrets, readSecrets } from './secrets.ts';
import { CloudError, type BoxApi, type BoxInfo } from './box.ts';
import type { AgentCli, CloudCredentialView, CloudView } from '../shared/types.ts';

/** The environment variable the manager keeps their `claude setup-token` token in. */
export const CLAUDE_TOKEN_ENV = 'CUBEFARM_CLAUDE_TOKEN';
/** Where a Box session keeps the Anthropic API key for Claude Code's apiKeyHelper (not ANTHROPIC_API_KEY, which asks first). */
export const ANTHROPIC_KEY_ENV = 'CUBEFARM_ANTHROPIC_KEY';

export interface CloudSecrets {
  upstashBoxKey?: string;
  cloudGithubToken?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
}

export type CloudTokenKind = 'github' | 'anthropic' | 'openai';
const TOKEN_FIELD: Record<CloudTokenKind, keyof CloudSecrets> = { github: 'cloudGithubToken', anthropic: 'anthropicApiKey', openai: 'openaiApiKey' };

// ---------- Box names ----------

/** An office's id on a shared Upstash account: 6 lowercase letters and digits. */
export const officeId = () => Math.random().toString(36).slice(2, 8).padEnd(6, '0');

/**
 * A cloud agent's Box: `cubefarm-<office>-<machine>`, so it stands out among Boxes the account has for other apps,
 * and labels Upstash accepts (≤ 20 characters each, ≤ 5).
 */
export const boxName = (office: string, machine: string) => `cubefarm-${office}-${machine}`;
export const boxLabels = (office: string, machine: string) => ['cubefarm', `cf:${office}`, `m:${machine}`];

/** The machine a Box is for when it's this office's, else null. */
export function machineOfBox(box: Pick<BoxInfo, 'labels'>, office: string): string | null {
  if (!box.labels.includes(`cf:${office}`)) return null;
  return box.labels.find((l) => l.startsWith('m:'))?.slice(2) || null;
}

// ---------- credentials ----------

/** Every Claude Code credential variable: exactly one is set in a Box session, the others are blanked. */
const CLAUDE_VARS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', ANTHROPIC_KEY_ENV];

export interface CredentialInput {
  claudeToken: string; // from the office's environment ('' when not set)
  secrets: CloudSecrets;
  ghToken: string; // the manager's gh login ('' when gh isn't signed in)
}

/** What one Box command runs with for a CLI, or what's missing. */
export interface Credentials {
  env: Record<string, string>;
  /** Claude Code reads its API key through this setting (no "use this key?" question, nothing on disk). */
  apiKeyHelper: string | null;
  /** The office has no credential for the CLI: it uses its own login in the Box, signed in in the agent's terminal. */
  ownLogin: boolean;
  missing: string[];
}

const github = (i: CredentialInput) => i.secrets.cloudGithubToken || i.ghToken;

/** The environment a cloud agent's CLI gets in its Box: GitHub, and the one credential its CLI signs in with. */
export function resolveCredentials(cli: AgentCli, i: CredentialInput): Credentials {
  const env: Record<string, string> = {};
  const missing: string[] = [];
  let apiKeyHelper: string | null = null;
  let ownLogin = false;
  const gh = github(i);
  if (gh) env.GH_TOKEN = gh;
  else missing.push('GitHub (sign in with gh auth login, or paste a token in Settings → Cloud agents)');
  if (cli === 'claude') {
    for (const k of CLAUDE_VARS) env[k] = '';
    if (i.claudeToken) env.CLAUDE_CODE_OAUTH_TOKEN = i.claudeToken;
    else if (i.secrets.anthropicApiKey) {
      env[ANTHROPIC_KEY_ENV] = i.secrets.anthropicApiKey;
      apiKeyHelper = `printenv ${ANTHROPIC_KEY_ENV}`;
    } else ownLogin = true;
  } else if (cli === 'codex') {
    if (i.secrets.openaiApiKey) Object.assign(env, { OPENAI_API_KEY: i.secrets.openaiApiKey, CODEX_API_KEY: i.secrets.openaiApiKey });
    else ownLogin = true;
  }
  return { env, apiKeyHelper, ownLogin, missing };
}

/** The same, for a command that needs GitHub but no coding agent (cloning, fetching, installing). */
export function githubEnv(i: CredentialInput): Record<string, string> {
  const gh = github(i);
  return gh ? { GH_TOKEN: gh } : {};
}

/** The environment every Box command starts from: never the office's own (a Windows PATH, the manager's other secrets). */
export const BOX_ENV: Record<string, string> = { TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'C.UTF-8', DISABLE_AUTOUPDATER: '1' };

const hint = (s: string | undefined) => (s ? s.slice(-4) : '');

/** Settings' rows: ready or not, and from where. Never a value. Without a key, each agent signs in in their terminal. */
export function credentialViews(i: CredentialInput): Pick<CloudView, 'github' | 'claude' | 'codex'> {
  const login: CloudCredentialView = { ready: true, source: 'login', hint: '' };
  const gh: CloudCredentialView = i.secrets.cloudGithubToken
    ? { ready: true, source: 'token', hint: hint(i.secrets.cloudGithubToken) }
    : { ready: !!i.ghToken, source: i.ghToken ? 'gh' : null, hint: '' };
  const claude: CloudCredentialView = i.claudeToken
    ? { ready: true, source: 'subscription', hint: '' }
    : i.secrets.anthropicApiKey
      ? { ready: true, source: 'apiKey', hint: hint(i.secrets.anthropicApiKey) }
      : login;
  const codex: CloudCredentialView = i.secrets.openaiApiKey ? { ready: true, source: 'apiKey', hint: hint(i.secrets.openaiApiKey) } : login;
  return { github: gh, claude, codex };
}

/** Text with every secret in it replaced, before it reaches a log, a phone message or the journal. */
export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join('•••');
  return out;
}

// ---------- the account ----------

export interface CloudDeps {
  secretsFile: string;
  env: Record<string, string | undefined>;
  /** The Box API behind a key: Upstash's, or the demo's fake. */
  boxes: (key: string) => BoxApi;
  /** The manager's gh login token ('' when gh isn't signed in). */
  ghToken: () => Promise<string>;
  /** This office's id on the account. */
  office: () => string;
  /** The machines that have an agent (a Box of this office for any other machine is an orphan). */
  machines: () => Set<string>;
  changed: (view: CloudView) => void;
  log: (line: string) => void;
}

export class Cloud {
  private secrets: CloudSecrets = {};
  private api: BoxApi | null = null;
  private keyError: string | null = null;
  private gh = '';
  private ghAt = 0;
  private boxes: CloudView['boxes'] = null;

  constructor(private deps: CloudDeps) {}

  async init() {
    const s = await readSecrets(this.deps.secretsFile);
    for (const k of ['upstashBoxKey', 'cloudGithubToken', 'anthropicApiKey', 'openaiApiKey'] as const) if (typeof s[k] === 'string' && s[k]) this.secrets[k] = s[k] as string;
    if (this.secrets.upstashBoxKey) this.api = this.deps.boxes(this.secrets.upstashBoxKey);
    await this.refreshGh(true);
  }

  /** The Box API, or null while no key is saved. */
  boxApi(): BoxApi | null {
    return this.api;
  }

  private claudeToken = () => (this.deps.env[CLAUDE_TOKEN_ENV] ?? '').trim();

  /** The gh login token, re-read at most once a minute (the manager may sign in or out meanwhile). */
  private async refreshGh(force = false) {
    if (!force && Date.now() - this.ghAt < 60_000) return this.gh;
    this.ghAt = Date.now();
    this.gh = await this.deps.ghToken().catch(() => '');
    return this.gh;
  }

  private async input(): Promise<CredentialInput> {
    return { claudeToken: this.claudeToken(), secrets: this.secrets, ghToken: this.secrets.cloudGithubToken ? '' : await this.refreshGh() };
  }

  view(): CloudView {
    return {
      keySet: !!this.secrets.upstashBoxKey,
      keyHint: hint(this.secrets.upstashBoxKey),
      keyError: this.keyError,
      ...credentialViews({ claudeToken: this.claudeToken(), secrets: this.secrets, ghToken: this.gh }),
      boxes: this.boxes,
    };
  }

  /** Every saved key and token, so they're scrubbed from anything the office writes or shows. */
  secretValues(): string[] {
    return [...Object.values(this.secrets), this.claudeToken(), this.gh].filter((s): s is string => !!s);
  }

  /** What a CLI runs with in a Box. */
  async credentials(cli: AgentCli): Promise<Credentials> {
    return resolveCredentials(cli, await this.input());
  }

  /** What a command that only needs GitHub (a clone, a fetch) runs with. */
  async githubEnv(): Promise<Record<string, string>> {
    return githubEnv(await this.input());
  }

  /** PUT /api/cloud/key: '' disconnects; anything else must list the account's Boxes first. */
  async setKey(raw: string): Promise<CloudView> {
    const key = raw.trim();
    if (key) {
      if (key.length > 400 || /\s/.test(key)) throw new HttpError(400, "That doesn't look like an Upstash Box API key.");
      const api = this.deps.boxes(key);
      try {
        await api.list();
      } catch (err) {
        const e = err instanceof CloudError ? err : new CloudError((err as Error).message, 'other');
        throw new HttpError(e.kind === 'auth' ? 400 : 502, e.message);
      }
      this.api = api;
    } else this.api = null;
    this.secrets.upstashBoxKey = key || undefined;
    this.keyError = null;
    await mergeSecrets(this.deps.secretsFile, { upstashBoxKey: key || undefined });
    await this.count();
    return this.emit();
  }

  /** PUT /api/cloud/token: a GitHub token, an Anthropic or an OpenAI API key for cloud agents ('' removes it). */
  async setToken(kind: CloudTokenKind, raw: string): Promise<CloudView> {
    const value = raw.trim();
    if (value.length > 400 || /\s/.test(value)) throw new HttpError(400, "That doesn't look like a token or an API key.");
    if (kind === 'anthropic' && value.startsWith('sk-ant-oat')) {
      throw new HttpError(400, `That's a claude setup-token token: it goes in your environment as ${CLAUDE_TOKEN_ENV} (see the steps above), not in the office.`);
    }
    if (kind === 'anthropic' && value && !value.startsWith('sk-ant-')) throw new HttpError(400, 'Anthropic API keys start with sk-ant-.');
    const field = TOKEN_FIELD[kind];
    this.secrets[field] = value || undefined;
    await mergeSecrets(this.deps.secretsFile, { [field]: value || undefined });
    if (kind === 'github') await this.refreshGh(true);
    return this.emit();
  }

  /** POST /api/cloud/test: check the key and count the Boxes again. */
  async test(): Promise<CloudView> {
    await this.refreshGh(true);
    if (!this.api) throw new HttpError(400, 'Save your Upstash Box API key first.');
    await this.count(true);
    if (this.keyError) throw new HttpError(502, this.keyError);
    return this.view();
  }

  /** The account's Boxes, counted for Settings and the Box limit. */
  async count(strict = false): Promise<BoxInfo[]> {
    if (!this.api) {
      this.boxes = null;
      return [];
    }
    try {
      const all = await this.api.list();
      const office = this.deps.office();
      const machines = this.deps.machines();
      const ours = all.filter((b) => b.labels.includes(`cf:${office}`));
      this.boxes = {
        total: all.filter((b) => b.status !== 'deleted').length,
        running: ours.filter((b) => b.status === 'running' || b.status === 'idle' || b.status === 'creating').length,
        paused: ours.filter((b) => b.status === 'paused').length,
        orphans: ours.filter((b) => !machines.has(machineOfBox(b, office) ?? '')).length,
      };
      this.keyError = null;
      this.emit();
      return all;
    } catch (err) {
      this.keyError = (err as Error).message;
      this.emit();
      if (strict) return [];
      throw err;
    }
  }

  /** POST /api/cloud/orphans: delete this office's Boxes whose agent is gone. */
  async deleteOrphans(): Promise<{ deleted: number }> {
    if (!this.api) throw new HttpError(400, 'Save your Upstash Box API key first.');
    const office = this.deps.office();
    const machines = this.deps.machines();
    const doomed = (await this.count()).filter((b) => b.labels.includes(`cf:${office}`) && !machines.has(machineOfBox(b, office) ?? ''));
    let deleted = 0;
    for (const b of doomed) {
      await this.api
        .remove(b.id)
        .then(() => deleted++)
        .catch((err) => this.deps.log(`could not delete the orphan Box ${b.name}: ${(err as Error).message}`));
    }
    await this.count().catch(() => undefined);
    return { deleted };
  }

  private emit(): CloudView {
    const view = this.view();
    this.deps.changed(view);
    return view;
  }
}
