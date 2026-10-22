// How big a floor's preview env may be: the settings box and the server measure it the same way and say the same words.
// It's counted in characters, not variables, because that is what runs out: the env lands in the app's process
// environment beside the office's own variables, and Windows caps that at 32,767 characters (a variable, and on older
// versions the whole block). The floor gets about half, leaving the rest to what the app inherits.

/** The most a floor's preview env may take, measured by previewEnvChars. */
export const PREVIEW_ENV_MAX_CHARS = 16_000;

/** The env's size as the process environment holds it: `KEY=value` and a terminator per variable, values as written. */
export const previewEnvChars = (env: Record<string, string>): number => Object.entries(env).reduce((n, [k, v]) => n + k.length + v.length + 2, 0);

/** Why the env is too big (its size and the ceiling, in words for the manager or the CEO), or null when it fits. */
export function previewEnvTooBig(env: Record<string, string>): string | null {
  const chars = previewEnvChars(env);
  if (chars <= PREVIEW_ENV_MAX_CHARS) return null;
  const n = (x: number) => x.toLocaleString('en-US');
  return `The preview env is ${n(chars)} characters (${n(Object.keys(env).length)} variables, each counted as KEY=value), over the ${n(PREVIEW_ENV_MAX_CHARS)} a floor's preview may take. Keep only the variables the app needs to run.`;
}
