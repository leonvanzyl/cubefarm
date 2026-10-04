import { create } from 'zustand';
import { defaultControls, keyLabel, normaliseControls, PAD_SENSITIVITY_MAX, PAD_SENSITIVITY_MIN, rebind, unbind, type ActionId, type Controls, type Rebound } from './keymap';

// The player's controls (Help → Controls): key bindings and the gamepad's sensitivity, saved in this browser and read
// back through normaliseControls (keymap.ts), so a corrupt value falls back to the defaults. The mouse settings live in
// world/look.ts. Every keyboard shortcut in the office asks here which keys are its.

const STORAGE_KEY = 'cubefarm:controls';

function load(): Controls {
  try {
    return normaliseControls(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return defaultControls();
  }
}

export const useControls = create<Controls>(() => load());

function update(patch: Partial<Controls>) {
  useControls.setState(patch);
  const { bindings, padSensitivity } = useControls.getState();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ bindings, padSensitivity }));
  } catch {
    // storage may be unavailable (private mode); the controls just won't survive a reload
  }
}

/** The bindings right now (read in key handlers and every frame; never stale). */
export const bindings = () => useControls.getState().bindings;

/** Whether `code` (a KeyboardEvent.code) is one of `action`'s keys. */
export const isKey = (action: ActionId, code: string) => useControls.getState().bindings[action].includes(code);

/** Binds a key (see keymap.ts rebind); null when that key can't be bound. */
export function setBinding(action: ActionId, slot: number, code: string): Rebound | null {
  const r = rebind(bindings(), action, slot, code);
  if (r) update({ bindings: r.bindings });
  return r;
}

export const clearBinding = (action: ActionId, slot: number) => update({ bindings: unbind(bindings(), action, slot) });

export const setPadSensitivity = (v: number) => update({ padSensitivity: Math.min(PAD_SENSITIVITY_MAX, Math.max(PAD_SENSITIVITY_MIN, v)) });

export const resetControls = () => update(defaultControls());

const nameOf = (keys: string[]) => (keys[0] ? keyLabel(keys[0]) : '—');

/** The label of `action`'s main key ('—' with none), for text outside React. */
export const keyName = (action: ActionId) => nameOf(bindings()[action]);

/** The label of `action`'s main key, kept up to date. */
export const useKeyName = (action: ActionId) => useControls((s) => nameOf(s.bindings[action]));
