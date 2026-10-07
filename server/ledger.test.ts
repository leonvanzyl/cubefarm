import { describe, expect, it } from 'vitest';
import { addTenure, apply, buy, dayKey, emptyLedger, grant, loadLedger, place, progressView, type LedgerEvent, type LedgerState } from './ledger.ts';
import { DECOR_SLOTS, priceOf } from '../shared/progress.ts';
import { DAY_MS } from '../shared/careers.ts';

const R = 'demo-co/pixel-todo';
const NAME = 'demo-co/pixel-todo';
// Local times, so the day and night rules read the same in every time zone.
const at = (h: number, m = 0, day = 4) => new Date(2026, 9, day, h, m).getTime();
const NOON = at(12);

function run(s: LedgerState, ...events: LedgerEvent[]) {
  return events.map((e) => apply(s, e)).at(-1)!;
}

const open = (pr: number, extra: Partial<Extract<LedgerEvent, { kind: 'opened' }>> = {}): LedgerEvent => ({ kind: 'opened', repoId: R, pr, title: `PR ${pr}`, author: 'ada', at: NOON, ...extra });
const qa = (pr: number, pass: boolean, round = 1, t = NOON): LedgerEvent => ({ kind: 'qa', repoId: R, pr, round, pass, tester: 'marple', author: null, at: t });
const merge = (pr: number, t = NOON, author: string | null = null): LedgerEvent => ({ kind: 'merged', repoId: R, repoName: NAME, pr, title: `PR ${pr}`, author, at: t });

describe('merges', () => {
  it('pay only for PRs the ledger watched while they were open, once', () => {
    const s = emptyLedger();
    expect(run(s, merge(1)).reward).toBeNull();
    expect(s.floors[R]).toBeUndefined();

    run(s, { kind: 'pr-open', repoId: R, pr: 2, title: 'Dark mode', author: null, checks: 'none', at: NOON });
    const fx = run(s, merge(2));
    expect(fx.reward).toEqual({ repoId: R, prNumber: 2, agentId: null, coins: 10, reasons: ['merge'] });
    expect(s.floors[R].coins).toBe(10);
    expect(run(s, merge(2)).changed).toBe(false);
    expect(s.floors[R].coins).toBe(10);
    expect(s.merges).toBe(1);
  });

  it('add bonuses for a first-time QA pass and green CI, never take anything away', () => {
    const s = emptyLedger();
    run(s, open(1), { kind: 'pr-open', repoId: R, pr: 1, title: 'PR 1', author: null, checks: 'passing', at: NOON }, qa(1, true));
    expect(run(s, merge(1)).reward?.coins).toBe(20);

    // failed QA once, red CI once, stuck with the manager: still the base
    run(s, open(2), { kind: 'pr-open', repoId: R, pr: 2, title: '', author: null, checks: 'pending', at: NOON }, qa(2, false), { kind: 'checks-failed', repoId: R, pr: 2 }, { kind: 'needs-human', repoId: R, pr: 2 }, qa(2, true, 2));
    const fx = run(s, merge(2, at(15)));
    expect(fx.reward).toMatchObject({ coins: 10, reasons: ['merge'], agentId: 'ada' });
    expect(fx.unlocked.map((a) => a.id)).toContain('comeback');
    expect(s.floors[R].coins).toBe(30);
  });

  it('give a streak bonus to the third merge on a floor within an hour (and the hat trick)', () => {
    const s = emptyLedger();
    for (const n of [1, 2, 3, 4]) run(s, open(n));
    expect(run(s, merge(1, at(10, 0))).reward?.reasons).not.toContain('streak');
    expect(run(s, merge(2, at(10, 30))).reward?.reasons).not.toContain('streak');
    const third = run(s, merge(3, at(10, 50)));
    expect(third.reward?.reasons).toContain('streak');
    expect(third.unlocked.map((a) => a.id)).toContain('hat-trick');
    // an hour after the first two, the fourth is only the second in its hour
    expect(run(s, merge(4, at(11, 45))).reward?.reasons).not.toContain('streak');
  });

  it('unlock the first merge, the night owl and the counts', () => {
    const s = emptyLedger();
    run(s, open(7));
    const fx = run(s, merge(7, at(2, 14)));
    expect(fx.unlocked.map((a) => a.id)).toEqual(['first-merge', 'night-owl']);
    expect(fx.unlocked[1].detail).toBe(`PR #7 on ${NAME} at 02:14`);
    for (let n = 8; n < 32; n++) run(s, open(n), merge(n, at(13)));
    expect(s.achievements.map((a) => a.id)).toContain('quarter-century');
    expect(s.achievements.map((a) => a.id)).toContain('ten-a-day');
    expect(s.achievements.map((a) => a.id)).not.toContain('century');
  });

  it('count a perfect five: five merges in a row with no failed QA round or check', () => {
    const s = emptyLedger();
    run(s, open(1), qa(1, false), qa(1, true, 2), merge(1));
    expect(s.clean).toBe(0);
    for (let n = 2; n <= 6; n++) run(s, open(n), qa(n, true), merge(n));
    expect(s.clean).toBe(5);
    expect(s.achievements.map((a) => a.id)).toContain('perfect-five');
  });
});

describe('days', () => {
  it('judge a spotless day when the next one starts', () => {
    const s = emptyLedger();
    for (let n = 1; n <= 5; n++) run(s, open(n), qa(n, true, 1, at(9 + n)), merge(n, at(9 + n)));
    expect(s.achievements.map((a) => a.id)).not.toContain('clean-day');
    const fx = run(s, { kind: 'tick', at: at(8, 0, 5) });
    expect(fx.unlocked.map((a) => a.id)).toEqual(['clean-day']);
    expect(s.day).toEqual({ date: dayKey(at(8, 0, 5)), merges: 0, qaFails: 0 });
  });

  it('a failed QA round spoils the day', () => {
    const s = emptyLedger();
    run(s, open(9), qa(9, false, 1, at(9)));
    for (let n = 1; n <= 5; n++) run(s, open(n), merge(n, at(10 + n)));
    expect(run(s, { kind: 'tick', at: at(8, 0, 5) }).unlocked).toEqual([]);
  });
});

describe('careers', () => {
  it('count opened, merged, QA rounds, first-time passes, streaks, reviews and fix rounds', () => {
    const s = emptyLedger();
    run(s, { kind: 'hired', agentId: 'ada', at: at(9) }, { kind: 'hired', agentId: 'marple', at: at(9) });
    run(s, open(1), qa(1, true), merge(1));
    run(s, open(2), qa(2, true), merge(2));
    run(s, open(3), qa(3, false), { kind: 'fix', repoId: R, pr: 3, key: '1:0', at: NOON }, { kind: 'fix', repoId: R, pr: 3, key: '1:0', at: NOON }, qa(3, true, 2), merge(3));
    run(s, open(4), qa(4, true));
    const ada = s.careers.ada;
    expect(ada).toMatchObject({ since: at(9), opened: 4, merged: 3, firstPass: 3, qaPass: 4, qaFail: 1, fixRounds: 1, run: 1, best: 2 });
    expect(ada.recent.map((r) => r.n)).toEqual([3, 2, 1]);
    expect(s.careers.marple.reviews).toBe(5);
  });

  it('count each verdict, opening and session once', () => {
    const s = emptyLedger();
    run(s, { kind: 'hired', agentId: 'ada', at: NOON }, open(1), open(1), qa(1, true), qa(1, true));
    run(s, { kind: 'session', agentId: 'ada', key: 'ada:1', costUsd: 0.5, turns: 12 }, { kind: 'session', agentId: 'ada', key: 'ada:1', costUsd: 0.5, turns: 12 });
    expect(s.careers.ada).toMatchObject({ opened: 1, qaPass: 1, firstPass: 1, costUsd: 0.5, turns: 12 });
  });

  it('keep the last eight merges and a week of merge times', () => {
    const s = emptyLedger();
    run(s, { kind: 'hired', agentId: 'ada', at: NOON - 20 * DAY_MS });
    for (let n = 1; n <= 10; n++) run(s, open(n), merge(n, NOON - (10 - n) * DAY_MS));
    expect(s.careers.ada.recent.map((r) => r.n)).toEqual([10, 9, 8, 7, 6, 5, 4, 3]);
    expect(s.careers.ada.week).toHaveLength(7);
  });

  it('credit the author the office named when the ledger never saw who opened it', () => {
    const s = emptyLedger();
    run(s, { kind: 'hired', agentId: 'grace', at: NOON }, { kind: 'pr-open', repoId: R, pr: 5, title: 'x', author: null, checks: 'none', at: NOON });
    expect(run(s, merge(5, NOON, 'grace')).reward?.agentId).toBe('grace');
    expect(s.careers.grace.merged).toBe(1);
  });

  it('forget a career when they are let go, and never restart one on a second hire event', () => {
    const s = emptyLedger();
    run(s, { kind: 'hired', agentId: 'ada', at: at(9) }, { kind: 'hired', agentId: 'ada', at: at(11) });
    expect(s.careers.ada.since).toBe(at(9));
    run(s, { kind: 'let-go', agentId: 'ada' });
    expect(s.careers.ada).toBeUndefined();
    // their PR merging later credits nobody, and starts no career for them
    run(s, open(1), merge(1));
    expect(s.careers.ada).toBeUndefined();
  });

  it('wind tenure back in the demo', () => {
    const s = emptyLedger();
    run(s, { kind: 'hired', agentId: 'ada', at: NOON }, { kind: 'hired', agentId: 'bob', at: NOON });
    addTenure(s, 3, 'ada');
    expect(s.careers.ada.since).toBe(NOON - 3 * DAY_MS);
    expect(s.careers.bob.since).toBe(NOON);
    expect(addTenure(s, 1, 'nobody')).toEqual({ error: 'No career for nobody' });
  });
});

describe('PR tracks', () => {
  it('drop PRs that left the lists (closed), but not ones too new to be listed yet', () => {
    const s = emptyLedger();
    run(s, open(1, { at: at(9) }), open(2, { at: at(11, 55) }));
    run(s, { kind: 'listed', repoId: R, numbers: [], at: at(12) });
    expect(Object.keys(s.prs)).toEqual([`${R}#2`]);
  });

  it('remember red CI and only ever upgrade none to green', () => {
    const s = emptyLedger();
    const seen = (checks: 'none' | 'pending' | 'passing' | 'failing') => run(s, { kind: 'pr-open', repoId: R, pr: 1, title: 't', author: null, checks, at: NOON });
    seen('none');
    expect(s.prs[`${R}#1`].ci).toBe('none');
    seen('pending');
    expect(s.prs[`${R}#1`].ci).toBe('green');
    seen('failing');
    seen('passing');
    expect(s.prs[`${R}#1`].ci).toBe('failed');
    expect(seen('passing').changed).toBe(false);
  });
});

describe('coffee and full house', () => {
  it('unlock the coffee addict on the tenth coffee, each coffee counted once', () => {
    const s = emptyLedger();
    for (let i = 0; i < 9; i++) run(s, { kind: 'coffee', id: `c${i}`, at: NOON }, { kind: 'coffee', id: `c${i}`, at: NOON });
    expect(s.coffees).toBe(9);
    expect(run(s, { kind: 'coffee', id: 'c9', at: NOON }).unlocked.map((a) => a.id)).toEqual(['coffee-addict']);
  });

  it('unlock the full house once', () => {
    const s = emptyLedger();
    expect(run(s, { kind: 'full-house', repoName: NAME, people: 6, at: NOON }).unlocked).toHaveLength(1);
    expect(run(s, { kind: 'full-house', repoName: NAME, people: 6, at: NOON }).changed).toBe(false);
  });
});

describe('the catalogue', () => {
  it('buys with the floor\'s coins at gently rising prices', () => {
    const s = emptyLedger();
    expect(buy(s, R, 'plant')).toEqual({ error: 'Potted plant costs 20 coins; this floor has 0' });
    grant(s, R, 100);
    expect(buy(s, R, 'plant')).toMatchObject({ price: 20 });
    expect(buy(s, R, 'plant')).toMatchObject({ price: priceOf('plant', 1) });
    expect(priceOf('plant', 1)).toBe(25);
    expect(s.floors[R]).toMatchObject({ coins: 55, owned: { plant: 2 } });
    expect(buy(s, R, 'gold-toilet')).toEqual({ error: 'There\'s no "gold-toilet" in the catalogue' });
  });

  it('refuses more of a kind than the floor has slots for', () => {
    const s = emptyLedger();
    grant(s, R, 10_000);
    const big = DECOR_SLOTS.filter((d) => d.kind === 'big').length;
    for (let i = 0; i < big; i++) expect(buy(s, R, 'arcade')).not.toHaveProperty('error');
    expect(buy(s, R, 'fishtank')).toEqual({ error: 'This floor has no room for another big decoration' });
  });

  it('places from the box, moves between slots of the right kind and puts things away', () => {
    const s = emptyLedger();
    grant(s, R, 1000);
    buy(s, R, 'neon');
    expect(place(s, R, NAME, { item: 'neon', slot: 'f-ne', from: null }, NOON)).toEqual({ error: "The neon sign doesn't go there" });
    const first = place(s, R, NAME, { item: 'neon', slot: 'w-west', from: null }, NOON);
    expect('effects' in first && first.effects.unlocked.map((a) => a.id)).toEqual(['interior-designer']);
    expect(place(s, R, NAME, { item: 'neon', slot: 'w-kitchen', from: null }, NOON)).toEqual({ error: "This floor's decor box has no neon sign" });
    expect(place(s, R, NAME, { item: 'neon', slot: 'w-kitchen', from: 'w-west' }, NOON)).not.toHaveProperty('error');
    expect(s.floors[R].placed).toEqual({ 'w-kitchen': 'neon' });
    buy(s, R, 'lights');
    expect(place(s, R, NAME, { item: 'lights', slot: 'w-kitchen', from: null }, NOON)).toEqual({ error: 'Something already stands there' });
    expect(place(s, R, NAME, { item: 'neon', slot: null, from: 'w-kitchen' }, NOON)).not.toHaveProperty('error');
    expect(s.floors[R].placed).toEqual({});
    expect(place(s, R, NAME, { item: 'neon', slot: null, from: 'w-kitchen' }, NOON)).toEqual({ error: "The neon sign isn't there any more" });
  });

  it('awards fully furnished when every slot is filled', () => {
    const s = emptyLedger();
    grant(s, R, 100_000);
    const pick = { wall: ['poster-ship', 'poster-repo', 'poster-pr', 'lights', 'neon'], floor: ['plant', 'fig', 'beanbag', 'plant'], big: ['fishtank', 'pingpong', 'arcade'], rug: ['rug', 'rug'] } as const;
    const used = { wall: 0, floor: 0, big: 0, rug: 0 };
    let last: ReturnType<typeof place> | null = null;
    for (const slot of DECOR_SLOTS) {
      const item = pick[slot.kind][used[slot.kind]++];
      expect(buy(s, R, item)).not.toHaveProperty('error');
      last = place(s, R, NAME, { item, slot: slot.id, from: null }, NOON);
    }
    expect(last && 'effects' in last && last.effects.unlocked.map((a) => a.id)).toEqual(['fully-furnished']);
  });
});

describe('the state file', () => {
  it('round-trips through JSON and drops what it does not know', () => {
    const s = emptyLedger();
    run(s, { kind: 'hired', agentId: 'ada', at: NOON }, open(1), qa(1, true), merge(1));
    grant(s, R, 100);
    buy(s, R, 'fig');
    place(s, R, NAME, { item: 'fig', slot: 'f-ne', from: null }, NOON);
    const back = loadLedger(JSON.parse(JSON.stringify(s)));
    expect(back).toEqual(s);

    const raw = JSON.parse(JSON.stringify(s));
    raw.floors[R].placed['nowhere'] = 'fig';
    raw.floors[R].placed['w-west'] = 'fig'; // a floor decoration on a wall
    raw.floors[R].owned.unicorn = 3;
    raw.achievements.push({ id: 'made-up', at: 1, detail: '' });
    const cleaned = loadLedger(raw);
    expect(cleaned.floors[R].placed).toEqual({ 'f-ne': 'fig' });
    expect(cleaned.floors[R].owned).toEqual({ fig: 1 });
    expect(cleaned.achievements.map((a) => a.id)).toEqual(s.achievements.map((a) => a.id));
    expect(loadLedger(undefined)).toEqual(emptyLedger());
    expect(loadLedger({ careers: 'nope', floors: 7 })).toEqual(emptyLedger());
  });

  it('loads a ledger saved before agents were interchangeable, dropping specialties', () => {
    const old = loadLedger({
      prs: { [`${R}#3`]: { author: 'ada', title: 'Sound', specialty: 'audio', qaPass: 1, since: NOON } },
      careers: { ada: { since: NOON, merged: 2, reviews: 1, bySpecialty: { audio: 2 } } },
    });
    expect(old.prs[`${R}#3`]).not.toHaveProperty('specialty');
    expect(old.prs[`${R}#3`]).toMatchObject({ author: 'ada', title: 'Sound', qaPass: 1 });
    expect(old.careers.ada).not.toHaveProperty('bySpecialty');
    expect(old.careers.ada).toMatchObject({ merged: 2, reviews: 1 });
  });

  it('shows connected floors only, with empty ones for floors that earned nothing yet', () => {
    const s = emptyLedger();
    grant(s, 'old/floor', 50);
    expect(progressView(s, [R]).floors).toEqual({ [R]: { coins: 0, earned: 0, merges: 0, owned: {}, placed: {}, firstPr: null } });
  });
});

describe('late news', () => {
  it('a merge from yesterday, seen today, pays but never rewinds the day', () => {
    const s = emptyLedger();
    run(s, open(1), open(2), merge(1, at(9, 0, 5)));
    expect(run(s, merge(2, at(23, 0, 4))).reward?.coins).toBe(10);
    expect(s.day).toEqual({ date: dayKey(at(9, 0, 5)), merges: 1, qaFails: 0 });
  });
});
