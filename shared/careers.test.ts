import { describe, expect, it } from 'vitest';
import { avgFixRounds, DAY_MS, deskItems, deskToy, knownFor, mvpOfWeek, newCareer, passRate, plantGrowth, rank, stickerFor, type CareerView } from './careers.ts';
import { CATALOGUE, DECOR_SLOTS, priceOf, slotKind, stored } from './progress.ts';

const NOW = Date.UTC(2026, 9, 4, 12);
const career = (c: Partial<CareerView> = {}): CareerView => ({ ...newCareer(NOW), ...c });

describe('career stats', () => {
  it('pass rate and fix rounds wait for data', () => {
    expect(passRate(career())).toBeNull();
    expect(passRate(career({ qaPass: 3, qaFail: 1 }))).toBe(0.75);
    expect(avgFixRounds(career())).toBeNull();
    expect(avgFixRounds(career({ merged: 4, fixRounds: 2 }))).toBe(0.5);
  });

  it('ranks developers by merges and testers by reviews', () => {
    expect(rank(career(), 'dev')).toBe('Rookie');
    expect(rank(career({ merged: 15 }), 'dev')).toBe('Veteran');
    expect(rank(career({ merged: 15, reviews: 2 }), 'qa')).toBe('Rookie');
    expect(rank(career({ reviews: 40 }), 'qa')).toBe('Legend');
  });

  it('is known for its best line', () => {
    expect(knownFor(career(), 'dev')).toBe('Fresh on the team: first PR coming up');
    expect(knownFor(career({ opened: 1 }), 'dev')).toBe('First PR in review, fingers crossed');
    expect(knownFor(career({ merged: 9, best: 9, run: 9 }), 'dev')).toBe('First-time QA passes: 9 in a row');
    expect(knownFor(career({ merged: 2, qaPass: 3, best: 1 }), 'dev')).toBe('Never failed QA: 3 rounds passed');
    expect(knownFor(career({ merged: 3, qaPass: 3, qaFail: 2, bySpecialty: { audio: 3 } }), 'dev')).toBe('Go-to for audio: 3 issues merged');
    expect(knownFor(career({ merged: 1, qaPass: 1, qaFail: 1, fixRounds: 1 }), 'dev')).toBe('Shipped 1 PR so far');
    expect(knownFor(career({ merged: 2, qaPass: 2, qaFail: 1 }), 'dev')).toBe('Clean shipper: 2 PRs merged without a fix round');
    expect(knownFor(career({ reviews: 12 }), 'qa')).toBe('QA reviews: 12 and counting');
    expect(knownFor(career(), 'qa')).toBe('Fresh in the lab: first review coming up');
  });

  it('picks the MVP of the week from merges in the last 7 days', () => {
    const people = [
      { name: 'ada', career: career({ merged: 30, week: [NOW - 8 * DAY_MS, NOW - DAY_MS] }) },
      { name: 'linus', career: career({ merged: 3, week: [NOW - 2 * DAY_MS, NOW - DAY_MS] }) },
      { name: 'grace', career: career({ merged: 9, week: [NOW - 3 * DAY_MS, NOW - 60_000] }) },
      { name: 'ceo', career: null },
    ];
    expect(mvpOfWeek(people, NOW)).toEqual({ who: people[2], merges: 2 });
    expect(mvpOfWeek([people[3]], NOW)).toBeNull();
  });
});

describe('the desk', () => {
  it('shows a plaque per recent merge, a +N for the rest and the star at ten first-time passes', () => {
    const recent = Array.from({ length: 8 }, (_, i) => ({ n: 40 - i, title: '', at: NOW }));
    const items = deskItems(career({ merged: 11, firstPass: 10, recent }), { specialty: '', role: 'dev' }, NOW);
    expect(items.plaques).toEqual([40, 39, 38, 37, 36, 35, 34, 33]);
    expect(items.more).toBe(3);
    expect(items.star).toBe(true);
    expect(deskItems(career({ firstPass: 9 }), { specialty: '', role: 'dev' }, NOW).star).toBe(false);
  });

  it('grows personal items with tenure', () => {
    const fresh = deskItems(career(), { specialty: 'audio', role: 'dev' }, NOW);
    expect(fresh).toMatchObject({ photo: false, toy: null, plant: 0.7 });
    const old = deskItems(career({ since: NOW - 4 * DAY_MS }), { specialty: 'audio', role: 'dev' }, NOW);
    expect(old).toMatchObject({ photo: true, toy: 'speaker' });
    expect(old.plant).toBeCloseTo(1.22);
    expect(plantGrowth(30)).toBe(1.6);
  });

  it('puts their specialty first among the stickers, then what they merged most', () => {
    const items = deskItems(career({ bySpecialty: { backend: 1, frontend: 3, '': 4, a11y: 1 } }), { specialty: 'a11y', role: 'dev' }, NOW);
    expect(items.stickers).toEqual(['a11y', 'frontend', 'backend']);
  });

  it('matches the desk toy to the specialty', () => {
    expect(deskToy('devex', 'dev')).toBe('duck');
    expect(deskToy('audio', 'dev')).toBe('speaker');
    expect(deskToy('physics', 'dev')).toBe('cradle');
    expect(deskToy('', 'qa')).toBe('magnifier');
    expect(deskToy('frontend', 'dev')).toBe('duck');
  });

  it('draws stickers for known specialties as emoji and the rest as letters', () => {
    expect(stickerFor('audio').text).toBe('🔊');
    expect(stickerFor('payments').text).toBe('PA');
    expect(stickerFor('payments').color).toBe(stickerFor('payments').color);
  });
});

describe('the catalogue', () => {
  it('prices rise a quarter per one owned, in fives', () => {
    expect(priceOf('arcade')).toBe(200);
    expect(priceOf('arcade', 2)).toBe(300);
    expect(priceOf('poster-ship', 1)).toBe(30);
  });

  it('has a slot of every kind its items need', () => {
    for (const item of CATALOGUE) expect(DECOR_SLOTS.some((s) => s.kind === item.kind)).toBe(true);
    expect(new Set(DECOR_SLOTS.map((s) => s.id)).size).toBe(DECOR_SLOTS.length);
    expect(slotKind('b-lounge')).toBe('big');
  });

  it('counts what is still in the decor box', () => {
    expect(stored({ owned: { plant: 3 }, placed: { 'f-ne': 'plant', 'f-se': 'plant' } }, 'plant')).toBe(1);
    expect(stored({ owned: {}, placed: {} }, 'plant')).toBe(0);
  });
});
