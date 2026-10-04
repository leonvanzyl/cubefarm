import { describe, expect, it } from 'vitest';
import {
  BUSY_OFF,
  BUSY_ON,
  GONG_CLEAR,
  MOOD_BARS,
  NIGHT_OFF,
  NIGHT_ON,
  SCORE_MOODS,
  STREAK,
  STREAK_WINDOW,
  barSeconds,
  officeState,
  onStreak,
  parseMoodParam,
  recentMerges,
  scoreBar,
  scoreMood,
  stingBarAt,
  stingNotes,
} from './scoreMood';

const calm = { working: 0, red: false };

describe('scoreMood', () => {
  it('is calm with nothing going on, by day', () => {
    expect(scoreMood(calm, 0, null)).toBe('calm');
    expect(scoreMood({ working: BUSY_ON - 1, red: false }, 0.2, 'calm')).toBe('calm');
  });

  it('gets busy when many agents work, and stays busy until clearly fewer do', () => {
    expect(scoreMood({ working: BUSY_ON, red: false }, 0, 'calm')).toBe('busy');
    expect(scoreMood({ working: BUSY_OFF, red: false }, 0, 'busy')).toBe('busy');
    expect(scoreMood({ working: BUSY_OFF, red: false }, 0, 'calm')).toBe('calm');
    expect(scoreMood({ working: BUSY_OFF - 1, red: false }, 0, 'busy')).toBe('calm');
  });

  it('turns tense under a red CI or a PR that needs the manager, whatever else is going on', () => {
    expect(scoreMood({ working: 0, red: true }, 0, 'calm')).toBe('tension');
    expect(scoreMood({ working: 9, red: true }, 1, 'busy')).toBe('tension');
    expect(scoreMood({ working: 0, red: false }, 0, 'tension')).toBe('calm');
  });

  it('goes quiet at night, with a little slack either side of dusk', () => {
    expect(scoreMood(calm, NIGHT_ON, 'calm')).toBe('night');
    expect(scoreMood(calm, NIGHT_OFF, 'night')).toBe('night');
    expect(scoreMood(calm, NIGHT_OFF, 'calm')).toBe('calm');
    expect(scoreMood(calm, NIGHT_OFF - 0.01, 'night')).toBe('calm');
    expect(scoreMood({ working: BUSY_ON, red: false }, 1, 'night')).toBe('busy'); // a busy night is still busy
  });
});

describe('parseMoodParam', () => {
  it('reads ?mood= for QA and ignores anything else', () => {
    expect(parseMoodParam('?mood=tension')).toBe('tension');
    expect(parseMoodParam('?x=1&mood=night')).toBe('night');
    expect(parseMoodParam('?mood=triumph')).toBe('triumph');
    for (const s of ['', '?mood=', '?mood=angry', '?mood=CALM', '?daytime=0.2']) expect(parseMoodParam(s)).toBeNull();
  });
});

describe('officeState', () => {
  const agents = {
    a: { repoId: 'o/one', role: 'dev', status: 'working' },
    b: { repoId: 'o/one', role: 'dev', status: 'preparing' },
    c: { repoId: 'o/one', role: 'qa', status: 'idle' },
    d: { repoId: 'o/two', role: 'dev', status: 'working' },
    ceo: { repoId: '', role: 'ceo', status: 'working' },
  };
  const pull = (state: string, checks: string) => ({ state, checks });
  const repos = [
    { id: 'o/one', pulls: [pull('OPEN', 'passing'), pull('MERGED', 'failing'), pull('OPEN', 'pending')] },
    { id: 'o/two', pulls: [pull('OPEN', 'failing')] },
  ];

  it('counts the agents at work on this floor', () => {
    expect(officeState('o/one', agents, repos, {})).toEqual({ working: 2, red: false });
    expect(officeState('o/two', agents, repos, {}).working).toBe(1);
  });

  it('turns red for a failing open PR on this floor, not a merged one or another floor\'s', () => {
    expect(officeState('o/two', agents, repos, {}).red).toBe(true);
    expect(officeState('o/one', agents, repos, {}).red).toBe(false);
  });

  it('turns red for a PR that needs the manager', () => {
    const qa = { 'o/one#4': { repoId: 'o/one', status: 'needs-human' }, 'o/one#5': { repoId: 'o/one', status: 'failed' } };
    expect(officeState('o/one', agents, repos, qa).red).toBe(true);
    expect(officeState('o/one', agents, repos, { 'o/one#5': qa['o/one#5'] }).red).toBe(false);
  });

  it('hears every floor from the lobby, but not the CEO', () => {
    expect(officeState(null, agents, repos, {})).toEqual({ working: 3, red: true });
  });
});

describe('the merge sting', () => {
  it('waits for the gong, then lands on a bar line', () => {
    expect(stingBarAt(10, 11, 4)).toBe(15); // due 14.5, the next bar line after 11 is 15
    expect(stingBarAt(10, 14.5, 4)).toBe(14.5); // exactly due
    expect(stingBarAt(10, 20, 4)).toBe(20); // long past: the next bar line
    expect(stingBarAt(0, 0, 3.75) - 0).toBeGreaterThanOrEqual(GONG_CLEAR);
  });

  it('gets bigger on a streak of merges', () => {
    const now = 5000;
    expect(onStreak([now - 50, now], now)).toBe(false);
    expect(onStreak([now - 300, now - 50, now], now)).toBe(STREAK === 3);
    expect(onStreak([now - STREAK_WINDOW - 1, now - 50, now], now)).toBe(false);
    expect(recentMerges([1, now - 10, now], now)).toEqual([now - 10, now]);
  });

  it('rises: an arpeggio climbing to a held major chord, more of both on a streak', () => {
    const small = stingNotes(false);
    const big = stingNotes(true);
    const arp = (n: typeof small) => n.filter((x) => x.part === 'keys');
    for (const notes of [small, big]) {
      const up = arp(notes).map((n) => n.midi);
      expect(up).toEqual([...up].sort((a, b) => a - b));
      expect(notes.filter((n) => n.part === 'pad').every((n) => [2, 6, 9].includes(n.midi % 12))).toBe(true); // D F# A
      expect(Math.min(...notes.filter((n) => n.part === 'pad').map((n) => n.at))).toBeGreaterThanOrEqual(Math.max(...arp(notes).map((n) => n.at)));
    }
    expect(arp(big).length).toBeGreaterThan(arp(small).length);
    expect(Math.max(...arp(big).map((n) => n.midi))).toBeGreaterThan(Math.max(...arp(small).map((n) => n.midi)));
  });
});

describe('scoreBar', () => {
  const parts = (mood: Parameters<typeof scoreBar>[0], bar = 0) => scoreBar(mood, bar).map((n) => n.part);

  it('calm: soft pads over the bass', () => {
    const p = parts('calm');
    expect(p.filter((x) => x === 'pad')).toHaveLength(4);
    expect(p).toContain('bass');
    expect(p).not.toContain('ostinato');
    expect(p.filter((x) => x === 'keys').length).toBeLessThanOrEqual(1);
  });

  it('busy: a gentle pulse joins', () => {
    expect(parts('busy').filter((x) => x === 'keys').length).toBeGreaterThanOrEqual(8);
    expect(scoreBar('busy', 0).filter((n) => n.part === 'keys').every((n) => n.level <= 0.5)).toBe(true);
  });

  it('tension: a minor colour and a low ostinato', () => {
    const notes = scoreBar('tension', 0);
    const pads = notes.filter((n) => n.part === 'pad').map((n) => n.midi % 12);
    expect(pads).toContain(5); // F natural: D minor
    expect(pads).not.toContain(6);
    const low = notes.filter((n) => n.part === 'ostinato');
    expect(low.length).toBeGreaterThanOrEqual(8);
    expect(Math.max(...low.map((n) => n.midi))).toBeLessThan(55);
  });

  it('night: sparser and slower', () => {
    expect(MOOD_BARS.night.bpm).toBeLessThan(MOOD_BARS.calm.bpm);
    expect(barSeconds('night')).toBeGreaterThan(barSeconds('calm'));
    const count = (mood: Parameters<typeof scoreBar>[0]) => [0, 1, 2, 3].reduce((n, b) => n + scoreBar(mood, b).length, 0);
    expect(count('night')).toBeLessThan(count('calm'));
    expect(parts('night')).not.toContain('bass');
  });

  it('keeps one progression going round every four bars, whatever the mood', () => {
    for (const mood of SCORE_MOODS) {
      expect(scoreBar(mood, 4)).toEqual(scoreBar(mood, 0));
      expect(scoreBar(mood, -1)).toEqual(scoreBar(mood, 3));
      for (let b = 0; b < 4; b++) {
        for (const n of scoreBar(mood, b)) {
          expect(n.at).toBeGreaterThanOrEqual(0), expect(n.at).toBeLessThan(4);
          expect(n.len).toBeGreaterThan(0);
          expect(n.level).toBeGreaterThan(0), expect(n.level).toBeLessThanOrEqual(1);
          expect(n.midi).toBeGreaterThanOrEqual(30), expect(n.midi).toBeLessThanOrEqual(90);
        }
      }
    }
    // moving from calm to tension on a bar line keeps the same chord root in the bass's place
    expect(scoreBar('tension', 2).find((n) => n.part === 'ostinato')!.midi).toBe(scoreBar('calm', 2).find((n) => n.part === 'bass')!.midi);
  });
});
