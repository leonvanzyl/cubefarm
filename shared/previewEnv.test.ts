import { describe, expect, it } from 'vitest';
import { PREVIEW_ENV_MAX_CHARS, previewEnvChars, previewEnvTooBig } from './previewEnv.ts';

/** n variables whose KEY=value lines come to `chars` characters in all. */
function envOf(n: number, chars: number): Record<string, string> {
  const env: Record<string, string> = {};
  let left = chars;
  for (let i = 0; i < n; i++) {
    const key = `VAR_${String(i).padStart(4, '0')}`;
    const len = i === n - 1 ? left - key.length - 2 : Math.floor(chars / n) - key.length - 2;
    env[key] = 'x'.repeat(len);
    left -= key.length + len + 2;
  }
  return env;
}

describe('previewEnvChars', () => {
  it('counts KEY=value and a terminator per variable', () => {
    expect(previewEnvChars({})).toBe(0);
    expect(previewEnvChars({ A: '1' })).toBe(4);
    expect(previewEnvChars({ API_URL: 'http://localhost:{port}/api', E: '' })).toBe(7 + 27 + 2 + 1 + 2);
  });
});

describe('previewEnvTooBig', () => {
  it("takes a real project's .env of a hundred variables", () => {
    const env = envOf(100, 6_000);
    expect(previewEnvChars(env)).toBe(6_000);
    expect(previewEnvTooBig(env)).toBeNull();
  });

  it('takes an env right at the ceiling, however many variables it has', () => {
    expect(previewEnvTooBig(envOf(400, PREVIEW_ENV_MAX_CHARS))).toBeNull();
    expect(previewEnvTooBig(envOf(1, PREVIEW_ENV_MAX_CHARS))).toBeNull();
  });

  it('refuses one character over, saying how big it got and what the ceiling is', () => {
    const msg = previewEnvTooBig(envOf(80, PREVIEW_ENV_MAX_CHARS + 1));
    expect(msg).toContain('16,001 characters');
    expect(msg).toContain('80 variables');
    expect(msg).toContain('16,000');
  });
});
