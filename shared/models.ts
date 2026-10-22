import type { AgentCli } from './types.ts';

// Which model an agent's session asks for. The office's default model belongs to its default coding agent, and each
// worker can name their own; a model only goes to an agent that understands it (no Claude model for Codex).

/** Claude Code's model names and aliases. */
export const isClaudeModel = (model: string) => /^(claude|opus|sonnet|haiku|fable|default|best|opusplan)\b/i.test(model.trim());

/**
 * The model for a worker on `cli`: their own if it suits that agent, else the office default when `cli` is the
 * default agent, else `claudeDefault` for Claude Code, or '' to let any other agent use its own default.
 */
export function effectiveModel(own: string, cli: AgentCli, office: { defaultCli: AgentCli; defaultModel: string }, claudeDefault: string): string {
  const suits = (m: string) => m.trim() !== '' && (cli === 'claude') === isClaudeModel(m);
  if (suits(own)) return own.trim();
  if (cli === office.defaultCli && suits(office.defaultModel)) return office.defaultModel.trim();
  return cli === 'claude' ? claudeDefault : '';
}

/** Claude Code models offered as suggestions in the office's model fields. */
export const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5', 'claude-haiku-4-5'];

/** Model suggestions for a coding agent; any other name can still be typed. OpenCode names are `provider/model`. */
export function modelSuggestions(cli: AgentCli): string[] {
  if (cli === 'claude') return CLAUDE_MODELS;
  if (cli === 'codex') return ['gpt-5.5-codex', 'gpt-5.5', 'ollama/gpt-oss:20b', 'lmstudio/openai/gpt-oss-20b'];
  return [...CLAUDE_MODELS.map((m) => `anthropic/${m}`), 'ollama/qwen3-coder', 'lmstudio/qwen/qwen3-coder-30b', 'llamacpp/default'];
}

// ---------- local models ----------

/**
 * Model servers on this computer an agent can use instead of a subscription: a model named `<id>/<model>` (e.g.
 * `ollama/qwen3-coder`) runs on that server. OpenCode reaches any of them through their OpenAI-compatible API; Codex
 * has Ollama and LM Studio built in (`--oss`) and talks to the others through their Responses API.
 */
export const LOCAL_PROVIDERS = [
  { id: 'ollama', label: 'Ollama', url: 'http://127.0.0.1:11434/v1', codexOss: true },
  { id: 'lmstudio', label: 'LM Studio', url: 'http://127.0.0.1:1234/v1', codexOss: true },
  { id: 'llamacpp', label: 'llama.cpp', url: 'http://127.0.0.1:8080/v1', codexOss: false },
  { id: 'omlx', label: 'oMLX', url: 'http://127.0.0.1:8000/v1', codexOss: false },
] as const;

export type LocalProvider = (typeof LOCAL_PROVIDERS)[number];

/** A model on a local server: its provider and the server's own name for it (which may hold more slashes), or null. */
export function localModel(model: string): { provider: LocalProvider; model: string } | null {
  const m = model.trim().match(/^([a-z.]+)\/(.+)$/i);
  const id = m?.[1].toLowerCase().replace('llama.cpp', 'llamacpp');
  const provider = LOCAL_PROVIDERS.find((p) => p.id === id);
  return provider && m ? { provider, model: m[2] } : null;
}
