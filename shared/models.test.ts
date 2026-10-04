import { describe, expect, it } from 'vitest';
import { effectiveModel, isClaudeModel, modelSuggestions } from './models.ts';

const claudeOffice = { defaultCli: 'claude' as const, defaultModel: 'claude-sonnet-5' };
const codexOffice = { defaultCli: 'codex' as const, defaultModel: 'gpt-5.5-codex' };

describe('effectiveModel', () => {
  it("uses the worker's own model when it suits their agent", () => {
    expect(effectiveModel('opus', 'claude', claudeOffice, 'claude-opus-5-5')).toBe('opus');
    expect(effectiveModel('gpt-5.5', 'codex', claudeOffice, 'claude-opus-5-5')).toBe('gpt-5.5');
  });

  it("falls back to the office default only for the office's default agent", () => {
    expect(effectiveModel('', 'claude', claudeOffice, 'claude-opus-5-5')).toBe('claude-sonnet-5');
    expect(effectiveModel('', 'codex', codexOffice, 'claude-opus-5-5')).toBe('gpt-5.5-codex');
    expect(effectiveModel('', 'claude', codexOffice, 'claude-opus-5-5')).toBe('claude-opus-5-5');
    expect(effectiveModel('', 'opencode', claudeOffice, 'claude-opus-5-5')).toBe('');
  });

  it('never hands a model to an agent that would not understand it', () => {
    expect(effectiveModel('claude-opus-5-5', 'codex', claudeOffice, 'claude-opus-5-5')).toBe('');
    expect(effectiveModel('gpt-5.5', 'claude', claudeOffice, 'claude-opus-5-5')).toBe('claude-sonnet-5');
    expect(effectiveModel('', 'codex', { defaultCli: 'codex', defaultModel: 'claude-opus-5-5' }, 'claude-opus-5-5')).toBe('');
  });

  it("knows Claude Code's names and aliases", () => {
    expect(['claude-fable-5-1', 'Opus', 'sonnet', 'haiku', 'opusplan'].every(isClaudeModel)).toBe(true);
    expect(['gpt-5.5', 'opencode/big-pickle', 'o3', 'opencode/claude-sonnet-5'].some(isClaudeModel)).toBe(false);
  });
});

describe('modelSuggestions', () => {
  it('only suggests models the chosen coding agent understands', () => {
    expect(modelSuggestions('claude').every(isClaudeModel)).toBe(true);
    for (const cli of ['codex', 'opencode'] as const) {
      expect(modelSuggestions(cli).length).toBeGreaterThan(0);
      expect(modelSuggestions(cli).some(isClaudeModel)).toBe(false);
    }
  });
});
