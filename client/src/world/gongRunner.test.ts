import { afterEach, describe, expect, it, vi } from 'vitest';

// Photo mode's freeze holds a gong run where it is (gongRunner.ts holdGongRuns). The boom needs WebAudio: mocked.
vi.mock('../ui/sfx', () => ({ gong: vi.fn() }));

const { REACH_MS } = await import('./gongRun');
const { gongForMerge, holdGongRuns, pumpGongRuns, resetGongRuns } = await import('./gongRunner');
const { gongState, setGongHere } = await import('./gongState');
const { bodyTarget, trackBody } = await import('./people');
const { newBodyState } = await import('./body');

afterEach(() => {
  resetGongRuns();
  setGongHere(null);
  vi.useRealTimers();
});

/** Someone seated at a desk on the floor on screen, who never actually moves (there's no frame loop here). */
function seated(id: string) {
  const s = newBodyState();
  Object.assign(s, { x: -10.5, z: -5.6, seatX: -10.5, seatZ: -5.6, standX: -10.5, standZ: -4.9 });
  trackBody(id, s);
}

describe('holding gong runs (photo mode)', () => {
  it('neither strikes nor gives up while held, and carries on as if no time had passed', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
    setGongHere('acme/app');
    gongState.hitAt = -Infinity;
    const hits = gongState.hits;
    seated('dev-1');

    expect(gongForMerge({ repoId: 'acme/app', prNumber: 1, agentId: 'dev-1' }, false)).toBe('run');
    expect(bodyTarget('dev-1')?.mode).toBe('walking'); // off to the gong

    holdGongRuns(true);
    vi.advanceTimersByTime(REACH_MS * 3); // a long photo session
    pumpGongRuns(performance.now()); // Gong.tsx would pump it, if frames ran
    expect(gongState.hits).toBe(hits); // no boom while frozen

    holdGongRuns(false);
    vi.advanceTimersByTime(REACH_MS - 1000);
    expect(gongState.hits).toBe(hits); // the pause doesn't count towards giving up

    vi.advanceTimersByTime(2000); // now they really are late: it strikes by itself
    expect(gongState.hits).toBe(hits + 1);
  });

  it('keeps a merge that arrives while frozen until the office thaws', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
    setGongHere('acme/app');
    gongState.hitAt = -Infinity;
    const hits = gongState.hits;

    holdGongRuns(true);
    expect(gongForMerge({ repoId: 'acme/app', prNumber: 2, agentId: null }, false)).toBe('solo');
    vi.advanceTimersByTime(5000);
    expect(gongState.hits).toBe(hits);

    holdGongRuns(false);
    vi.advanceTimersByTime(300);
    expect(gongState.hits).toBe(hits + 1);
  });
});
