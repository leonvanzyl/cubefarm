import { beforeEach, describe, expect, it, vi } from 'vitest';

// The store pulls in the sound module, which listens on window for the first click; tests run in node.
vi.stubGlobal('window', { addEventListener: () => undefined });
const { useStore } = await import('../../store');
const { DISPENSER_ID, MUG, clampSips, dropMug, fillLevel, isMugId, mugsToEvict, resetMugs, steamStrength, stowMug, takeDrop, takeNewMug } = await import('./mugs');

describe('sips', () => {
  it('keeps sips a whole number from empty to full', () => {
    expect(clampSips(0)).toBe(0);
    expect(clampSips(2)).toBe(2);
    expect(clampSips(MUG.maxSips + 4)).toBe(MUG.maxSips);
    expect(clampSips(-1)).toBe(0);
    expect(clampSips(1.6)).toBe(2);
  });

  it('treats anything that is not a number as empty', () => {
    expect(clampSips(NaN)).toBe(0);
    expect(clampSips(Infinity)).toBe(0);
    expect(clampSips('3')).toBe(0);
    expect(clampSips(undefined)).toBe(0);
  });

  it('turns sips into a fill level', () => {
    expect(fillLevel(0)).toBe(0);
    expect(fillLevel(MUG.maxSips)).toBe(1);
    expect(fillLevel(99)).toBe(1);
  });

  it('thins the steam with each sip and stops it when empty', () => {
    expect(steamStrength(MUG.maxSips)).toBe(1);
    for (let s = MUG.maxSips; s > 1; s--) expect(steamStrength(s - 1)).toBeLessThan(steamStrength(s));
    expect(steamStrength(1)).toBeGreaterThan(0);
    expect(steamStrength(0)).toBe(0);
    expect(steamStrength(NaN)).toBe(0);
  });
});

describe('loose mug cap', () => {
  const mugs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `mug-${i}`, born: 100 - i }));

  it('removes nothing while there is room', () => {
    expect(mugsToEvict(mugs(MUG.cap - 1))).toEqual([]);
  });

  it('removes the oldest mugs first once the floor is full', () => {
    const list = mugs(MUG.cap);
    expect(mugsToEvict(list).map((m) => m.id)).toEqual([`mug-${MUG.cap - 1}`]);
    expect(mugsToEvict(list, MUG.cap, 3)).toHaveLength(3);
  });
});

describe('hands', () => {
  beforeEach(() => {
    useStore.getState().setHeld(null);
    resetMugs();
  });

  it('tells mug pickups from other toys', () => {
    expect(isMugId(DISPENSER_ID)).toBe(true);
    expect(isMugId('mug-3')).toBe(true);
    expect(isMugId('beach-ball')).toBe(false);
    expect(isMugId('blaster-blue')).toBe(false);
  });

  it('hands out a fresh mug with clamped sips', () => {
    const mug = takeNewMug(7);
    expect(mug.sips).toBe(MUG.maxSips);
    expect(useStore.getState().held).toEqual(mug);
    expect(takeNewMug().id).not.toBe(mug.id);
  });

  it('queues every mug that leaves your hands to fall, with its sips', () => {
    const a = takeNewMug(2);
    dropMug();
    expect(useStore.getState().held).toBeNull();
    const b = takeNewMug(1);
    useStore.getState().setHeld({ kind: 'ball', id: 'beach-ball' }); // swapped for a ball
    expect(takeDrop()).toEqual({ id: a.id, sips: 2 });
    expect(takeDrop()).toEqual({ id: b.id, sips: 1 });
    expect(takeDrop()).toBeNull();
  });

  it('does not queue a drop when the mug in hand only changes its sips', () => {
    const a = takeNewMug(1);
    useStore.getState().setHeld({ ...a, sips: 2 });
    expect(takeDrop()).toBeNull();
  });

  it('hands a mug to the coffee machine without it falling', () => {
    const a = takeNewMug(1);
    expect(stowMug()).toEqual(a);
    expect(useStore.getState().held).toBeNull();
    expect(takeDrop()).toBeNull();
    expect(stowMug()).toBeNull();
  });

  it('forgets waiting drops on a fresh floor', () => {
    takeNewMug();
    dropMug();
    resetMugs();
    expect(takeDrop()).toBeNull();
  });
});
