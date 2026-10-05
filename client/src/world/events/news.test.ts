import { describe, expect, it } from 'vitest';
import { bannerLines, bannerText, skyText } from './news';

const now = new Date(2026, 9, 4, 15, 0).getTime();
const at = (h: number, m = 0) => new Date(2026, 9, 4, h, m).toISOString();
const pr = (number: number, mergedAt: string | null, state: 'OPEN' | 'MERGED' | 'CLOSED' = mergedAt ? 'MERGED' : 'OPEN') => ({ number, state, mergedAt });

describe('the blimp banner', () => {
  it('leads with the latest merge, then the busiest floor today, then the PRs in flight', () => {
    const floors = [
      { floor: 1, fullName: 'a/one', pulls: [pr(10, at(9)), pr(12, at(14, 30)), pr(13, null)] },
      { floor: 2, fullName: 'a/two', pulls: [pr(3, at(10)), pr(4, at(11)), pr(5, at(12)), pr(6, null), pr(7, null)] },
    ];
    expect(bannerLines(floors, now, 'Acme')).toEqual(['PR #12 merged! 🎉', 'Floor 2: 3 merges today', '3 PRs in flight 🚀', 'Acme ♥ its team']);
    expect(bannerText(floors, now, 'Acme', 0)).toBe('PR #12 merged! 🎉');
    expect(bannerText(floors, now, 'Acme', 0.99)).toBe('Floor 2: 3 merges today');
  });

  it("doesn't count yesterday's merges as today's, and has a friendly line when there's no news", () => {
    const yesterday = (h: number) => new Date(2026, 9, 3, h).toISOString();
    const floors = [{ floor: 1, fullName: 'a/one', pulls: [pr(1, yesterday(18)), pr(2, yesterday(20))] }];
    expect(bannerLines(floors, now)).toEqual(['PR #2 merged! 🎉', 'cubefarm ♥ its team']);
    expect(bannerLines([{ floor: 1, fullName: 'a/one', pulls: [pr(3, yesterday(9))] }], now)).toEqual(['cubefarm ♥ its team']); // over a day ago
    expect(bannerText([], now, '', 0.5)).toBe('cubefarm ♥ its team');
  });
});

describe('skywriting', () => {
  it("spells the floor's name, short and plain", () => {
    expect(skyText('demo-co/pixel-todo', 'Demo Co.')).toBe('PIXEL TODO');
    expect(skyText(null, 'Demo Co.')).toBe('DEMO CO.');
    expect(skyText('a/a-very-long-repository-name', '')).toHaveLength(14);
    expect(skyText(null, '')).toBe('CUBEFARM');
  });
});
