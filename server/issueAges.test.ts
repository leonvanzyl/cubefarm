import { describe, expect, it } from 'vitest';
import type { PullInfo } from '../shared/types.ts';
import { IssueAges, MERGE_WINDOW_MS } from './issueAges.ts';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const pull = (number: number, closes: number[], mergedAgo: number | null): PullInfo =>
  ({ number, state: mergedAgo === null ? 'OPEN' : 'MERGED', mergedAt: mergedAgo === null ? null : iso(mergedAgo), closesIssues: closes }) as PullInfo;

describe('IssueAges', () => {
  it('stamps a PR with when the issue it closes was filed, once the office has seen it open', () => {
    const ages = new IssueAges();
    ages.learn('o/r', [{ number: 3, createdAt: iso(5 * 3600_000) }]);
    const pulls = [pull(10, [3], 60_000), pull(11, [4], 60_000)];
    ages.stamp('o/r', pulls);
    expect(pulls[0].issueCreatedAt).toBe(iso(5 * 3600_000));
    expect(pulls[1].issueCreatedAt).toBeNull();
  });

  it('uses the earliest of several issues, and keeps repos apart', () => {
    const ages = new IssueAges();
    ages.learn('o/r', [
      { number: 3, createdAt: iso(2 * 3600_000) },
      { number: 4, createdAt: iso(9 * 3600_000) },
    ]);
    ages.learn('o/other', [{ number: 5, createdAt: iso(3600_000) }]);
    const pulls = [pull(10, [3, 4], 0), pull(11, [5], 0)];
    ages.stamp('o/r', pulls);
    expect(pulls[0].issueCreatedAt).toBe(iso(9 * 3600_000));
    expect(pulls[1].issueCreatedAt).toBeNull();
  });

  it('asks once for the issues of the last day’s merges it never saw open', () => {
    const ages = new IssueAges();
    ages.learn('o/r', [{ number: 3, createdAt: iso(3600_000) }]);
    const pulls = [pull(10, [3], 60_000), pull(11, [4, 5], 60_000), pull(12, [6], MERGE_WINDOW_MS + 60_000), pull(13, [7], null)];
    expect(ages.wanted('o/r', pulls, NOW)).toEqual([4, 5]);
    expect(ages.wanted('o/r', pulls, NOW)).toEqual([]);
    ages.know('o/r', 4, iso(7200_000));
    ages.know('o/r', 5, undefined); // the lookup failed: never asked again, never stamped
    ages.stamp('o/r', pulls);
    expect(pulls[1].issueCreatedAt).toBe(iso(7200_000));
  });

  it('ignores unreadable times', () => {
    const ages = new IssueAges();
    ages.learn('o/r', [{ number: 3, createdAt: 'yesterday' }]);
    const pulls = [pull(10, [3], 0)];
    ages.stamp('o/r', pulls);
    expect(pulls[0].issueCreatedAt).toBeNull();
  });
});
