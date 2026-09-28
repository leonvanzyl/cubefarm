// Run with `npm test` (Vitest).
import { describe, expect, it } from 'vitest';
import { shouldGrabLook, viewUncovered, type Covering } from './lookLockRules';

const c = (overlay: boolean, confirm = false): Covering => ({ overlay, confirm });
const on = { started: true, enabled: true };

describe('viewUncovered', () => {
  it('is true when the last panel closes (✕, backdrop, Esc, or goToFloor from the elevator/console/phone)', () => {
    expect(viewUncovered(c(true), c(false))).toBe(true);
  });

  it('is true when the hire question is answered with nothing else open', () => {
    expect(viewUncovered(c(false, true), c(false, false))).toBe(true);
  });

  it('is false when a panel opens or swaps for another', () => {
    expect(viewUncovered(c(false), c(true))).toBe(false);
    expect(viewUncovered(c(true), c(true))).toBe(false);
  });

  it('is false when a question inside a panel is answered and the panel stays open', () => {
    expect(viewUncovered(c(true, true), c(true, false))).toBe(false);
  });

  it('is false when a panel closes behind a question still on screen', () => {
    expect(viewUncovered(c(true, true), c(false, true))).toBe(false);
  });

  it('is false when nothing changes or a question appears', () => {
    expect(viewUncovered(c(false), c(false))).toBe(false);
    expect(viewUncovered(c(false, false), c(false, true))).toBe(false);
  });
});

describe('shouldGrabLook', () => {
  it('grabs the mouse after a close when the setting is on', () => {
    expect(shouldGrabLook(c(true), c(false), on)).toBe(true);
    expect(shouldGrabLook(c(false, true), c(false), on)).toBe(true);
  });

  it('leaves the mouse free with the setting off (the old behaviour)', () => {
    expect(shouldGrabLook(c(true), c(false), { ...on, enabled: false })).toBe(false);
  });

  it('never grabs before the office has started', () => {
    expect(shouldGrabLook(c(true), c(false), { ...on, started: false })).toBe(false);
  });

  it('never grabs when nothing closed', () => {
    expect(shouldGrabLook(c(false), c(true), on)).toBe(false);
    expect(shouldGrabLook(c(true, true), c(true), on)).toBe(false);
  });
});
