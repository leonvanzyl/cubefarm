import { describe, expect, it } from 'vitest';
import { blockers, holdUps, issueSpecialty, setDependsOn, waitsMessage } from './issues.ts';

const open = (...n: number[]) => new Set(n);

describe('blockers', () => {
  it('reads a single "Depends on #N"', () => {
    expect(blockers('Depends on #3', open(3))).toEqual([3]);
  });

  it('reads "Blocked by" too', () => {
    expect(blockers('Blocked by #4', open(4))).toEqual([4]);
  });

  it('reads several dependencies separated by commas, "and" and "&"', () => {
    expect(blockers('Depends on #1, #2 and #3 & #4', open(1, 2, 3, 4)).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it('reads dependencies spread over several lines', () => {
    const body = 'Some context.\n\nDepends on #10\nBlocked by #11, #12';
    expect(blockers(body, open(10, 11, 12)).sort((a, b) => a - b)).toEqual([10, 11, 12]);
  });

  it('ignores casing and an optional colon', () => {
    expect(blockers('DEPENDS ON #5', open(5))).toEqual([5]);
    expect(blockers('depends on: #6', open(6))).toEqual([6]);
    expect(blockers('BLOCKED   by:#7', open(7))).toEqual([7]);
    expect(blockers('Depends On #8', open(8))).toEqual([8]);
  });

  it('leaves out issues that are already closed', () => {
    expect(blockers('Depends on #1, #2, #3', open(2))).toEqual([2]);
    expect(blockers('Depends on #1', open())).toEqual([]);
  });

  it('matches whole issue numbers, not prefixes', () => {
    expect(blockers('Depends on #12', open(1, 2))).toEqual([]);
    expect(blockers('Depends on #12', open(12))).toEqual([12]);
  });

  it('lists each blocker once', () => {
    expect(blockers('Depends on #3. Also blocked by #3 and #3', open(3))).toEqual([3]);
  });

  it('ignores issue references that are not dependencies', () => {
    expect(blockers('Related to #3, see #4. Follow-up of #5', open(3, 4, 5))).toEqual([]);
  });

  it('handles an empty or missing body', () => {
    expect(blockers('', open(1))).toEqual([]);
    expect(blockers(undefined as unknown as string, open(1))).toEqual([]);
    expect(blockers(null as unknown as string, open(1))).toEqual([]);
  });
});

describe('issueSpecialty', () => {
  it('reads the swarm:<specialty> label, lowercased', () => {
    expect(issueSpecialty(['bug', 'swarm:Testing'])).toBe('testing');
    expect(issueSpecialty(['SWARM:frontend'])).toBe('frontend');
  });

  it('is empty without a specialty label', () => {
    expect(issueSpecialty([])).toBe('');
    expect(issueSpecialty(['bug', 'enhancement'])).toBe('');
  });

  it('does not treat swarm:skip as a specialty', () => {
    expect(issueSpecialty(['swarm:skip'])).toBe('');
    expect(issueSpecialty(['Swarm:Skip', 'swarm:backend'])).toBe('backend');
  });
});

describe('holdUps', () => {
  it('counts the chain and everything waiting behind each issue', () => {
    // 1 <- 2 <- 3, and 1 <- 4
    const h = holdUps([
      { number: 1, body: '' },
      { number: 2, body: 'Depends on #1' },
      { number: 3, body: 'Depends on #2' },
      { number: 4, body: 'Blocked by #1' },
    ]);
    expect(h.get(1)).toEqual({ chain: 2, waiting: 3 });
    expect(h.get(2)).toEqual({ chain: 1, waiting: 1 });
    expect(h.get(3)).toEqual({ chain: 0, waiting: 0 });
    expect(h.get(4)).toEqual({ chain: 0, waiting: 0 });
  });

  it('ignores dependencies on issues that are not open', () => {
    const h = holdUps([{ number: 2, body: 'Depends on #1' }]);
    expect(h.get(2)).toEqual({ chain: 0, waiting: 0 });
    expect(h.has(1)).toBe(false);
  });

  it('survives a dependency cycle', () => {
    const h = holdUps([
      { number: 1, body: 'Depends on #2' },
      { number: 2, body: 'Depends on #1' },
    ]);
    expect(h.get(1)?.waiting).toBe(1);
    expect(h.get(2)?.waiting).toBe(1);
    expect(Number.isFinite(h.get(1)?.chain)).toBe(true);
  });
});

describe('setDependsOn', () => {
  it('puts one Depends on line at the top', () => {
    expect(setDependsOn('Build it.', [3, 4])).toBe('Depends on #3, #4\n\nBuild it.');
    expect(setDependsOn('', [3])).toBe('Depends on #3');
  });

  it('replaces the old statements, wherever they were', () => {
    expect(setDependsOn('Depends on #1\n\nBuild it.', [2])).toBe('Depends on #2\n\nBuild it.');
    expect(setDependsOn('Intro\n\nBlocked by #1, #2\n\nMore\n- **Depends on: #5**', [])).toBe('Intro\n\nMore');
    expect(setDependsOn('Do this. Depends on #1 and #2.', [])).toBe('Do this.');
  });

  it('leaves the rest of the body alone', () => {
    const body = 'Context\r\n\r\n- [ ] one\r\n- [ ] two\r\n\r\n---\r\n_Filed by Morgan_';
    expect(setDependsOn(body, [])).toBe(body.replace(/\r\n/g, '\n'));
    expect(blockers(setDependsOn(body, [7]), open(7))).toEqual([7]);
  });
});

describe('waitsMessage', () => {
  it('names what the issue waits for', () => {
    expect(waitsMessage(12, [10])).toBe('#12 waits for #10: it can start once that is closed');
    expect(waitsMessage(12, [10, 11])).toBe('#12 waits for #10, #11: it can start once those are closed');
  });
});
