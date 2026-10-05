import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  actionsForKey,
  anyHeld,
  bindable,
  defaultBindings,
  exactKeyLabel,
  defaultControls,
  findConflicts,
  keyLabel,
  normaliseControls,
  rebind,
  unbind,
} from './keymap';

describe('default bindings', () => {
  it("keep the office's keys", () => {
    const b = defaultBindings();
    expect(b.forward).toEqual(['KeyW', 'ArrowUp']);
    expect(b.run).toEqual(['ShiftLeft', 'ShiftRight']);
    expect(b.interact).toEqual(['KeyE']);
    expect(b.throw).toEqual(['KeyF']);
    expect(b.drop).toEqual(['KeyG']);
    expect(b.reload).toEqual(['KeyR']);
    expect(b.phone).toEqual(['KeyP']);
    expect(b.help).toEqual(['KeyH']);
    expect(b.mute).toEqual(['KeyM']);
    expect(b.volumeDown).toEqual(['Minus', 'NumpadSubtract']);
    expect(b.volumeUp).toEqual(['Equal', 'NumpadAdd']);
    expect(b.overview).toEqual(['Tab']);
    expect(b.talk).toEqual(['KeyV']);
    expect(b.photo).toEqual(['KeyK']);
    expect(b.saveReplay).toEqual(['KeyI']);
  });

  it('have no conflicts (E interacts on foot and turns the overview, which never run together)', () => {
    expect(findConflicts(defaultBindings())).toEqual([]);
    expect(defaultBindings().rotateRight).toEqual(['KeyE']);
  });

  it('give every action a key', () => {
    const b = defaultBindings();
    for (const a of ACTIONS) expect(b[a.id].length).toBeGreaterThan(0);
  });
});

describe('actionsForKey', () => {
  it('finds the actions a key triggers in the scopes that are live', () => {
    const b = defaultBindings();
    expect(actionsForKey(b, 'KeyE', ['global', 'move', 'walk'])).toEqual(['interact']);
    expect(actionsForKey(b, 'KeyE', ['global', 'move', 'overview'])).toEqual(['rotateRight']);
    expect(actionsForKey(b, 'ArrowUp', ['global', 'move', 'walk'])).toEqual(['forward']);
    expect(actionsForKey(b, 'Tab', ['global'])).toEqual(['overview']);
    expect(actionsForKey(b, 'KeyZ', ['global', 'move', 'walk'])).toEqual([]);
  });

  it('anyHeld checks every key of an action', () => {
    const b = defaultBindings();
    expect(anyHeld(b, 'forward', new Set(['ArrowUp']))).toBe(true);
    expect(anyHeld(b, 'run', new Set(['ShiftRight']))).toBe(true);
    expect(anyHeld(b, 'back', new Set(['KeyW']))).toBe(false);
  });
});

describe('keyLabel', () => {
  it('reads like the key cap', () => {
    expect(keyLabel('KeyE')).toBe('E');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('Numpad7')).toBe('Num 7');
    expect(keyLabel('ArrowLeft')).toBe('←');
    expect(keyLabel('ShiftRight')).toBe('Shift');
    expect(keyLabel('Minus')).toBe('−');
    expect(keyLabel('Equal')).toBe('+');
    expect(keyLabel('Tab')).toBe('Tab');
    expect(keyLabel('F7')).toBe('F7');
  });

  it('can tell left from right where both are bound', () => {
    expect(exactKeyLabel('ShiftLeft')).toBe('Left Shift');
    expect(exactKeyLabel('ControlRight')).toBe('Right Ctrl');
    expect(exactKeyLabel('KeyE')).toBe('E');
  });
});

describe('rebind', () => {
  it('swaps keys with the action that had it: interact on F gives throw the E', () => {
    const r = rebind(defaultBindings(), 'interact', 0, 'KeyF')!;
    expect(r.bindings.interact).toEqual(['KeyF']);
    expect(r.bindings.throw).toEqual(['KeyE']);
    expect(r.displaced).toEqual({ action: 'throw', key: 'KeyE' });
    expect(findConflicts(r.bindings)).toEqual([]);
  });

  it("doesn't take a key from an action that never runs at the same time", () => {
    const r = rebind(defaultBindings(), 'interact', 0, 'KeyQ')!;
    expect(r.bindings.interact).toEqual(['KeyQ']);
    expect(r.bindings.rotateLeft).toEqual(['KeyQ']); // the overview's turn keeps Q
    expect(r.displaced).toBeNull();
  });

  it('unbinds rather than swapping into a new clash', () => {
    // Turning the overview right on W: walking forward would get E back, but E already interacts on foot.
    const r = rebind(defaultBindings(), 'rotateRight', 0, 'KeyW')!;
    expect(r.bindings.rotateRight).toEqual(['KeyW']);
    expect(r.bindings.forward).toEqual(['ArrowUp']);
    expect(r.displaced).toEqual({ action: 'forward', key: null });
    expect(findConflicts(r.bindings)).toEqual([]);
  });

  it('has nothing to swap from an empty alternative slot', () => {
    const r = rebind(defaultBindings(), 'interact', 1, 'KeyG')!;
    expect(r.bindings.interact).toEqual(['KeyE', 'KeyG']);
    expect(r.bindings.drop).toEqual([]);
    expect(r.displaced).toEqual({ action: 'drop', key: null });
  });

  it('moves a key between an action’s own slots without duplicating it', () => {
    const r = rebind(defaultBindings(), 'forward', 0, 'ArrowUp')!;
    expect(r.bindings.forward).toEqual(['ArrowUp']);
  });

  it('refuses reserved keys and bad slots', () => {
    expect(rebind(defaultBindings(), 'interact', 0, 'Escape')).toBeNull();
    expect(rebind(defaultBindings(), 'interact', 2, 'KeyK')).toBeNull();
    expect(bindable('Escape')).toBe(false);
    expect(bindable('KeyK')).toBe(true);
  });

  it('never changes the bindings it was given', () => {
    const b = defaultBindings();
    rebind(b, 'interact', 0, 'KeyF');
    unbind(b, 'forward', 1);
    expect(b).toEqual(defaultBindings());
    expect(unbind(b, 'forward', 1).forward).toEqual(['KeyW']);
  });
});

describe('findConflicts', () => {
  it('reports a key shared by actions that run together', () => {
    const b = defaultBindings();
    b.drop = ['KeyE'];
    expect(findConflicts(b)).toEqual([{ code: 'KeyE', actions: ['interact', 'drop'] }]);
  });

  it('keeps a panel key apart from the office keys, but not from the global ones', () => {
    const b = defaultBindings();
    b.interact = ['KeyV'];
    expect(findConflicts(b)).toEqual([]);
    b.phone = ['KeyV'];
    expect(findConflicts(b)).toEqual([
      { code: 'KeyV', actions: ['interact', 'phone'] },
      { code: 'KeyV', actions: ['phone', 'talk'] },
    ]);
  });

  it('counts a global key against everything', () => {
    const b = defaultBindings();
    b.phone = ['KeyQ'];
    expect(findConflicts(b)).toEqual([{ code: 'KeyQ', actions: ['phone', 'rotateLeft'] }]);
  });
});

describe('normaliseControls', () => {
  it('falls back to the defaults for anything that is not saved controls', () => {
    for (const raw of [null, undefined, 42, 'KeyE', [], true]) expect(normaliseControls(raw)).toEqual(defaultControls());
  });

  it('keeps good bindings and resets broken ones action by action', () => {
    const c = normaliseControls({
      bindings: { interact: ['KeyF'], throw: ['KeyE'], forward: 'KeyW', drop: [7], help: ['Escape'], phone: ['KeyP', 'KeyP', 'KeyO', 'KeyI'], made_up: ['KeyZ'] },
    });
    expect(c.bindings.interact).toEqual(['KeyF']);
    expect(c.bindings.throw).toEqual(['KeyE']);
    expect(c.bindings.forward).toEqual(['KeyW', 'ArrowUp']); // a string, not a list
    expect(c.bindings.drop).toEqual(['KeyG']); // not a key code
    expect(c.bindings.help).toEqual(['KeyH']); // reserved
    expect(c.bindings.phone).toEqual(['KeyP', 'KeyO']); // deduped, at most two
    expect('made_up' in c.bindings).toBe(false);
  });

  it('keeps an action the player left without a key', () => {
    expect(normaliseControls({ bindings: { reload: [] } }).bindings.reload).toEqual([]);
  });

  it('clamps the gamepad sensitivity and ignores junk', () => {
    expect(normaliseControls({ padSensitivity: 2 }).padSensitivity).toBe(2);
    expect(normaliseControls({ padSensitivity: 99 }).padSensitivity).toBe(3);
    expect(normaliseControls({ padSensitivity: 0 }).padSensitivity).toBe(0.25);
    expect(normaliseControls({ padSensitivity: 'fast' }).padSensitivity).toBe(1);
    expect(normaliseControls({ padSensitivity: Number.NaN }).padSensitivity).toBe(1);
  });

  it('round-trips through JSON', () => {
    const r = rebind(defaultBindings(), 'interact', 0, 'KeyF')!;
    const saved = JSON.parse(JSON.stringify({ bindings: r.bindings, padSensitivity: 1.5 }));
    expect(normaliseControls(saved)).toEqual({ bindings: r.bindings, padSensitivity: 1.5 });
  });
});
