import { describe, expect, it } from 'vitest';
import { backoff, EventLines, exitCode, finishedTurn, readFrom, type BoxCliRecord } from './boxCli.ts';

const line = (ev: Record<string, unknown>) => `${JSON.stringify(ev)}\n`;

describe('EventLines', () => {
  it('hands on whole lines only, counting the bytes handled', () => {
    const r = new EventLines(0);
    const a = line({ hook_event_name: 'PreToolUse', tool_name: 'Bash' });
    const b = line({ hook_event_name: 'Stop', last_assistant_message: 'done' });
    expect(r.push(a + b.slice(0, 10))).toEqual([{ hook_event_name: 'PreToolUse', tool_name: 'Bash' }]);
    expect(r.offset).toBe(a.length);
    expect(r.push(b.slice(10))).toEqual([{ hook_event_name: 'Stop', last_assistant_message: 'done' }]);
    expect(r.offset).toBe(a.length + b.length);
  });

  it('starts counting where the office left off, and skips lines that are not events', () => {
    const r = new EventLines(500);
    expect(r.push('not json\n\n[1,2]\n')).toEqual([]);
    expect(r.offset).toBe(500 + 'not json\n\n[1,2]\n'.length);
  });

  it("remembers where the last turn's end starts, to read again from after a restart", () => {
    const start = line({ hook_event_name: 'UserPromptSubmit', prompt: 'go' });
    const stop = line({ hook_event_name: 'Stop' });
    const tool = line({ hook_event_name: 'PreToolUse' });
    const r = new EventLines(100);
    r.push(start + stop + tool);
    expect(r.turnAt).toBe(100 + start.length);
    expect(readFrom({ offset: r.offset, turnAt: r.turnAt } as BoxCliRecord)).toBe(100 + start.length);
    expect(readFrom({ offset: 40 } as BoxCliRecord)).toBe(40);
  });
});

describe('finishedTurn', () => {
  const ev = (hook_event_name: string, extra: Record<string, unknown> = {}) => ({ hook_event_name, ...extra });

  it('counts a turn that ended after the last prompt it was given', () => {
    expect(finishedTurn([ev('UserPromptSubmit'), ev('PreToolUse'), ev('Stop')])).toBe(true);
    expect(finishedTurn([ev('TurnComplete')])).toBe(true);
    expect(finishedTurn([ev('CubefarmExit', { code: 1 })])).toBe(true);
  });

  it("doesn't count an earlier turn when a new one started after it", () => {
    expect(finishedTurn([ev('Stop'), ev('UserPromptSubmit'), ev('PreToolUse')])).toBe(false);
    expect(finishedTurn([])).toBe(false);
  });

  it('reads the exit code the launcher wrote', () => {
    expect(exitCode([ev('Stop'), ev('CubefarmExit', { code: 0 })])).toBe(0);
    expect(exitCode([ev('CubefarmExit', { code: 137 })])).toBe(137);
    expect(exitCode([ev('Stop')])).toBeNull();
  });
});

describe('backoff', () => {
  it('waits longer after each failed try, up to half a minute', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(backoff)).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
  });
});
