import { describe, expect, it } from 'vitest';
import { closesMic, isTalkKey, type KeyLike } from './micKeys';

const key = (code: string, key: string, mods: Partial<KeyLike> = {}): KeyLike => ({ code, key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
const V = key('KeyV', 'v');
const M = key('KeyM', 'm');
const Esc = key('Escape', 'Escape');

describe('isTalkKey', () => {
  it("talks with a plain V in the 🎙's box or outside any field", () => {
    expect(isTalkKey(V, 'mic-box')).toBe(true);
    expect(isTalkKey(V, 'none')).toBe(true);
  });

  it('never fires while typing in other fields', () => {
    expect(isTalkKey(V, 'field')).toBe(false);
  });

  it('leaves Ctrl+V (paste), Shift+V, Alt+V and IME input alone', () => {
    for (const mods of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { isComposing: true }]) expect(isTalkKey(key('KeyV', 'v', mods), 'mic-box')).toBe(false);
    expect(isTalkKey(key('KeyB', 'b'), 'none')).toBe(false);
  });

  it('goes by the key, so it is V on any keyboard layout', () => {
    expect(isTalkKey(key('KeyV', 'k'), 'none')).toBe(true); // Dvorak's V position
  });
  it("follows the player's own talk key (Help → Controls)", () => {
    expect(isTalkKey(key('KeyT', 't'), 'mic-box', ['KeyT'])).toBe(true);
    expect(isTalkKey(V, 'mic-box', ['KeyT'])).toBe(false);
  });
});

describe('closesMic', () => {
  it("follows the player's own mute key", () => {
    expect(closesMic(key('KeyK', 'k'), true, 'none', ['KeyK'])).toBe(true);
    expect(closesMic(M, true, 'none', ['KeyK'])).toBe(false);
  });

  it('Esc always closes it', () => {
    for (const place of ['mic-box', 'field', 'none'] as const) {
      expect(closesMic(Esc, false, place)).toBe(true);
      expect(closesMic(Esc, true, place)).toBe(true);
    }
  });

  it('M closes it hands-free, or outside a text field, but types an "m" in a box', () => {
    expect(closesMic(M, true, 'mic-box')).toBe(true);
    expect(closesMic(M, false, 'none')).toBe(true);
    expect(closesMic(M, false, 'mic-box')).toBe(false);
    expect(closesMic(M, false, 'field')).toBe(false);
    expect(closesMic(key('KeyM', 'M', { shiftKey: true }), true, 'mic-box')).toBe(false);
  });

  it('other keys leave it listening', () => {
    expect(closesMic(key('KeyA', 'a'), true, 'none')).toBe(false);
    expect(closesMic(V, true, 'none')).toBe(false);
  });
});
