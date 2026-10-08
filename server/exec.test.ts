import { describe, expect, it } from 'vitest';
import { failureDetail, run } from './exec.ts';

describe('failureDetail', () => {
  const failed = { message: 'Command failed: gh pr list -R a/b --json number' };

  it('is the stderr when the command printed one', () => {
    expect(failureDetail({ ...failed, code: 1 }, '  HTTP 502: Bad Gateway\n', 120_000)).toBe('HTTP 502: Bad Gateway');
  });

  it('says why when the command printed nothing, instead of repeating it', () => {
    expect(failureDetail({ ...failed, code: null, killed: true, signal: 'SIGTERM' }, '', 120_000)).toBe('timed out after 120 s');
    expect(failureDetail({ ...failed, code: null, signal: 'SIGKILL' }, '', 120_000)).toBe('stopped by SIGKILL');
    expect(failureDetail({ ...failed, code: 3 }, '', 120_000)).toBe('exited with code 3 and no error output');
  });

  it("keeps Node's own message for spawn and buffer errors", () => {
    expect(failureDetail({ message: 'spawn gh ENOENT', code: 'ENOENT' }, '', 120_000)).toBe('spawn gh ENOENT');
    expect(failureDetail({ message: 'stdout maxBuffer length exceeded', code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true }, '', 120_000)).toBe(
      'stdout maxBuffer length exceeded',
    );
  });
});

describe('run', () => {
  it('names a silent exit code and a timeout in its error', async () => {
    await expect(run(process.execPath, ['-e', 'process.exit(3)'])).rejects.toThrow(/failed: exited with code 3 and no error output$/);
    await expect(run(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 1000 })).rejects.toThrow(/failed: timed out after 1 s$/);
  });
});
