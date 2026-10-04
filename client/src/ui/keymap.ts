// The office's key bindings: every action the player can rebind (Help → Controls), its default keys, and pure helpers
// around them: which actions a key triggers, labels for <kbd>, conflicts, rebinding and reading saved controls back.
// Keys are KeyboardEvent.code values, so a binding is a physical key whatever the keyboard layout.

export type ActionId =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'run'
  | 'interact'
  | 'throw'
  | 'drop'
  | 'reload'
  | 'volumeDown'
  | 'volumeUp'
  | 'phone'
  | 'help'
  | 'mute'
  | 'workers'
  | 'overview'
  | 'rotateLeft'
  | 'rotateRight'
  | 'talk';

/**
 * Where an action works: `global` everywhere; `move` on foot and in the overview (where the movement keys pan);
 * `walk` on foot only; `overview` in the overview only; `panel` in an open panel or the phone. Two actions on one key
 * clash when their scopes overlap.
 */
export type Scope = 'global' | 'move' | 'walk' | 'overview' | 'panel';

export interface ActionDef {
  id: ActionId;
  label: string;
  group: 'Moving' | 'Hands' | 'Office' | 'Overview';
  scope: Scope;
  /** Default keys, the main one first. */
  keys: readonly string[];
}

export const ACTIONS: readonly ActionDef[] = [
  { id: 'forward', label: 'Walk forward', group: 'Moving', scope: 'move', keys: ['KeyW', 'ArrowUp'] },
  { id: 'back', label: 'Walk back', group: 'Moving', scope: 'move', keys: ['KeyS', 'ArrowDown'] },
  { id: 'left', label: 'Step left', group: 'Moving', scope: 'move', keys: ['KeyA', 'ArrowLeft'] },
  { id: 'right', label: 'Step right', group: 'Moving', scope: 'move', keys: ['KeyD', 'ArrowRight'] },
  { id: 'run', label: 'Run (hold)', group: 'Moving', scope: 'move', keys: ['ShiftLeft', 'ShiftRight'] },
  { id: 'interact', label: 'Use, pick up, sip', group: 'Hands', scope: 'walk', keys: ['KeyE'] },
  { id: 'throw', label: 'Throw or fire (hold to charge)', group: 'Hands', scope: 'walk', keys: ['KeyF'] },
  { id: 'drop', label: 'Drop', group: 'Hands', scope: 'walk', keys: ['KeyG'] },
  { id: 'reload', label: 'Reload a blaster', group: 'Hands', scope: 'walk', keys: ['KeyR'] },
  { id: 'volumeDown', label: 'Jukebox softer', group: 'Hands', scope: 'walk', keys: ['Minus', 'NumpadSubtract'] },
  { id: 'volumeUp', label: 'Jukebox louder', group: 'Hands', scope: 'walk', keys: ['Equal', 'NumpadAdd'] },
  { id: 'phone', label: 'Phone', group: 'Office', scope: 'global', keys: ['KeyP'] },
  { id: 'help', label: 'Help', group: 'Office', scope: 'global', keys: ['KeyH'] },
  { id: 'mute', label: 'Mute', group: 'Office', scope: 'global', keys: ['KeyM'] },
  { id: 'workers', label: "Who's working list", group: 'Office', scope: 'global', keys: ['KeyL'] },
  { id: 'overview', label: 'Overview (twice: the building)', group: 'Overview', scope: 'global', keys: ['Tab'] },
  { id: 'rotateLeft', label: 'Turn the overview left', group: 'Overview', scope: 'overview', keys: ['KeyQ'] },
  { id: 'rotateRight', label: 'Turn the overview right', group: 'Overview', scope: 'overview', keys: ['KeyE'] },
  { id: 'talk', label: 'Hold to talk (in a message box)', group: 'Office', scope: 'panel', keys: ['KeyV'] },
];

export const ACTION_IDS = ACTIONS.map((a) => a.id);
const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));
export const actionDef = (id: ActionId) => BY_ID.get(id)!;

/** Keys per action: at most this many (a main key and one alternative). */
export const SLOTS = 2;

export type Bindings = Record<ActionId, string[]>;

export const defaultBindings = (): Bindings => Object.fromEntries(ACTIONS.map((a) => [a.id, [...a.keys]])) as Bindings;

/** Keys that can't be bound: Esc lets go of the mouse and backs out of things, and the rest belong to the browser or OS. */
export const RESERVED = new Set(['Escape', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight', 'ContextMenu', 'F5', 'F11', 'F12', 'PrintScreen']);

/** A key that can be bound: a KeyboardEvent.code that isn't reserved. */
export const bindable = (code: unknown): code is string => typeof code === 'string' && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(code) && !RESERVED.has(code);

export function scopesOverlap(a: Scope, b: Scope) {
  if (a === b || a === 'global' || b === 'global') return true;
  if (a === 'panel' || b === 'panel') return false; // the office's own keys rest while a panel is open
  return a === 'move' || b === 'move'; // walk and overview never run at the same time
}

/** The actions `code` triggers among those whose scope is in `scopes`. */
export function actionsForKey(b: Bindings, code: string, scopes: readonly Scope[]): ActionId[] {
  return ACTIONS.filter((a) => scopes.includes(a.scope) && b[a.id].includes(code)).map((a) => a.id);
}

/** Whether `code` is one of `action`'s keys. */
export const isBound = (b: Bindings, action: ActionId, code: string) => b[action].includes(code);

/** Whether any of `action`'s keys is in `down` (codes held right now). Allocates nothing: it runs every frame. */
export function anyHeld(b: Bindings, action: ActionId, down: ReadonlySet<string>) {
  const keys = b[action];
  for (let i = 0; i < keys.length; i++) if (down.has(keys[i])) return true;
  return false;
}

const NAMED: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl',
  AltLeft: 'Alt',
  AltRight: 'Alt',
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  NumpadEnter: 'Num Enter',
  Backspace: 'Backspace',
  CapsLock: 'Caps Lock',
  Minus: '−',
  Equal: '+',
  NumpadSubtract: 'Num −',
  NumpadAdd: 'Num +',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Backquote: '`',
  IntlBackslash: '\\',
  Insert: 'Ins',
  Delete: 'Del',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
};

/** How a key reads on a <kbd>: 'KeyE' → 'E', 'ArrowUp' → '↑', 'ShiftLeft' → 'Shift'. */
export function keyLabel(code: string): string {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];
  const pad = /^Numpad(\d)$/.exec(code);
  if (pad) return `Num ${pad[1]}`;
  return NAMED[code] ?? code;
}

/** Like keyLabel, but telling the left and right Shift, Ctrl and Alt apart (for the settings, where both show). */
export function exactKeyLabel(code: string): string {
  const side = /^(Shift|Control|Alt)(Left|Right)$/.exec(code);
  return side ? `${side[2]} ${keyLabel(code)}` : keyLabel(code);
}

export interface Conflict {
  code: string;
  actions: [ActionId, ActionId];
}

/** Keys bound to two actions that can run at the same time. */
export function findConflicts(b: Bindings): Conflict[] {
  const out: Conflict[] = [];
  for (let i = 0; i < ACTIONS.length; i++) {
    for (let j = i + 1; j < ACTIONS.length; j++) {
      const a = ACTIONS[i];
      const c = ACTIONS[j];
      if (!scopesOverlap(a.scope, c.scope)) continue;
      for (const code of b[a.id]) if (b[c.id].includes(code)) out.push({ code, actions: [a.id, c.id] });
    }
  }
  return out;
}

export interface Rebound {
  bindings: Bindings;
  /** An action that had the key, and what it was given instead (the key `action` had before, or null: none). */
  displaced: { action: ActionId; key: string | null } | null;
}

/**
 * Binds `code` to `action` in `slot` (0 the main key, 1 the alternative). An action that clashes with it gives the key
 * up and takes `action`'s old key instead when that doesn't clash in turn (so E and F swap); otherwise it's just unbound.
 * Returns null for a key that can't be bound.
 */
export function rebind(b: Bindings, action: ActionId, slot: number, code: string): Rebound | null {
  if (!bindable(code) || slot < 0 || slot >= SLOTS) return null;
  const next = Object.fromEntries(ACTION_IDS.map((id) => [id, [...b[id]]])) as Bindings;
  const own = next[action];
  const old = own[slot] ?? null;
  if (old === code) return { bindings: next, displaced: null };
  if (own.includes(code)) own.splice(own.indexOf(code), 1); // moving it between this action's own slots
  if (slot >= own.length) own.push(code);
  else own[slot] = code;
  let displaced: Rebound['displaced'] = null;
  const scope = actionDef(action).scope;
  for (const def of ACTIONS) {
    if (def.id === action || !scopesOverlap(scope, def.scope)) continue;
    const keys = next[def.id];
    const at = keys.indexOf(code);
    if (at < 0) continue;
    const swap = old && !keys.includes(old) && !clashes(next, def.id, old) ? old : null;
    if (swap) keys[at] = swap;
    else keys.splice(at, 1);
    displaced ??= { action: def.id, key: swap };
  }
  return { bindings: next, displaced };
}

/** Whether giving `action` the key `code` would clash with another action's keys. */
function clashes(b: Bindings, action: ActionId, code: string) {
  const scope = actionDef(action).scope;
  return ACTIONS.some((d) => d.id !== action && scopesOverlap(scope, d.scope) && b[d.id].includes(code));
}

/** Takes the key in `slot` off `action`. */
export function unbind(b: Bindings, action: ActionId, slot: number): Bindings {
  const next = Object.fromEntries(ACTION_IDS.map((id) => [id, [...b[id]]])) as Bindings;
  next[action].splice(slot, 1);
  return next;
}

// ---------- saved controls (per browser, in localStorage) ----------

export const PAD_SENSITIVITY_MIN = 0.25;
export const PAD_SENSITIVITY_MAX = 3;

export interface Controls {
  bindings: Bindings;
  /** How fast the right stick turns the view, 1 = normal. */
  padSensitivity: number;
}

export const defaultControls = (): Controls => ({ bindings: defaultBindings(), padSensitivity: 1 });

/**
 * Saved controls as they came out of storage (anything at all) to valid ones: an action whose keys aren't a list of
 * bindable codes gets its defaults back, duplicates and extra keys are dropped, and a missing or broken sensitivity is 1.
 */
export function normaliseControls(raw: unknown): Controls {
  const out = defaultControls();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as { bindings?: unknown; padSensitivity?: unknown };
  if (r.bindings && typeof r.bindings === 'object') {
    const saved = r.bindings as Record<string, unknown>;
    for (const id of ACTION_IDS) {
      const keys = saved[id];
      if (!Array.isArray(keys) || !keys.every(bindable)) continue;
      out.bindings[id] = [...new Set(keys as string[])].slice(0, SLOTS);
    }
  }
  const sens = r.padSensitivity;
  if (typeof sens === 'number' && Number.isFinite(sens)) out.padSensitivity = Math.min(PAD_SENSITIVITY_MAX, Math.max(PAD_SENSITIVITY_MIN, sens));
  return out;
}
