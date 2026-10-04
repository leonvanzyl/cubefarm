// Gamepads through the Gamepad API's standard mapping. Player.tsx polls once a frame (browsers only refresh a pad's
// state when asked): sticks get a radial deadzone, buttons become bits with press and release edges. Plugging a pad in
// or out toasts. window.__swarmPad drives a virtual pad for QA and Playwright, which have no real controller.

/** Standard-mapping button indices. */
export const BUTTON = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;
export type ButtonName = keyof typeof BUTTON;
const BUTTONS = 16;

/** A stick inside this (0 to 1) reads as centred: worn sticks never quite return to zero. */
export const DEADZONE = 0.18;
/** A trigger (or any analog button) counts as pressed past this. */
export const TRIGGER_DOWN = 0.5;

/**
 * Radial deadzone: writes (x, y) into `out` as a vector the same way, 0 inside `dz` and rescaled from 0 to 1 past it,
 * so walking starts slowly at the deadzone's edge. Never longer than 1.
 */
export function deadzone(x: number, y: number, dz: number, out: { x: number; y: number }) {
  const m = Math.hypot(x, y);
  if (!(m > dz)) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  out.x = x * k;
  out.y = y * k;
  return out;
}

/** Looking: squared, so small pushes aim finely and a full push turns fast. Keeps the sign. */
export const lookCurve = (v: number) => v * Math.abs(v);

interface PadLike {
  buttons: readonly { pressed: boolean; value: number }[];
}

/** The pad's buttons as bits (1 << BUTTON.x); an analog trigger counts once it's past TRIGGER_DOWN. */
export function buttonBits(p: PadLike) {
  let bits = 0;
  const n = Math.min(BUTTONS, p.buttons.length);
  for (let i = 0; i < n; i++) {
    const b = p.buttons[i];
    if (b && (b.pressed || b.value > TRIGGER_DOWN)) bits |= 1 << i;
  }
  return bits;
}

export interface PadState {
  /** A pad (real or virtual) is plugged in. */
  connected: boolean;
  id: string;
  /** Sticks after the deadzone, -1 to 1; y is down-positive, as the Gamepad API reports it. */
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  /** Buttons held now, and those that went down or came up since the last poll. */
  down: number;
  pressed: number;
  released: number;
  /** performance.now() of the last stick or button input: whether someone is using the pad. */
  usedAt: number;
}

export const pad: PadState = { connected: false, id: '', lx: 0, ly: 0, rx: 0, ry: 0, down: 0, pressed: 0, released: 0, usedAt: -Infinity };

export const bit = (name: ButtonName) => 1 << BUTTON[name];
export const wasPressed = (name: ButtonName) => (pad.pressed & bit(name)) !== 0;
export const wasReleased = (name: ButtonName) => (pad.released & bit(name)) !== 0;
export const isDown = (name: ButtonName) => (pad.down & bit(name)) !== 0;

// ---------- the virtual pad (window.__swarmPad) ----------

interface VirtualButton {
  down: boolean;
  /** For a press: let go at this time, but only once a poll has seen it down. */
  until: number;
  seen: boolean;
  /** Taps asked for while it was still down: each comes after a frame with it up, so each is its own press. */
  queued: number;
  ms: number;
}

const virtual = {
  on: false,
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: BUTTONS }, (): VirtualButton => ({ down: false, until: Infinity, seen: false, queued: 0, ms: 0 })),
};

const listeners = new Set<(connected: boolean, id: string) => void>();
const VIRTUAL_ID = 'Virtual pad (__swarmPad)';

// ---------- polling ----------

const stick = { x: 0, y: 0 };

function realPad(): Gamepad | null {
  let found: Gamepad | null = null;
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    if (!p || !p.connected) continue;
    if (p.mapping === 'standard') return p;
    found ??= p;
  }
  return found;
}

/** Reads the pad into `pad` (call once a frame). The first standard-mapped pad wins; the virtual one stands in. */
export function pollPad(now: number): PadState {
  const p = realPad();
  let bits = 0;
  let lx = 0;
  let ly = 0;
  let rx = 0;
  let ry = 0;
  if (p) {
    bits = buttonBits(p);
    lx = p.axes[0] ?? 0;
    ly = p.axes[1] ?? 0;
    rx = p.axes[2] ?? 0;
    ry = p.axes[3] ?? 0;
  } else if (virtual.on) {
    for (let i = 0; i < BUTTONS; i++) {
      const b = virtual.buttons[i];
      if (b.down && b.seen && now >= b.until) {
        b.down = false;
        b.until = Infinity;
      } else if (!b.down && b.queued > 0 && !(pad.down & (1 << i))) {
        b.queued--;
        b.down = true;
        b.seen = false;
        b.until = now + b.ms;
      }
      if (b.down) {
        bits |= 1 << i;
        b.seen = true;
      }
    }
    lx = virtual.axes[0];
    ly = virtual.axes[1];
    rx = virtual.axes[2];
    ry = virtual.axes[3];
  }
  pad.connected = !!p || virtual.on;
  pad.id = p ? p.id : virtual.on ? VIRTUAL_ID : '';
  deadzone(lx, ly, DEADZONE, stick);
  pad.lx = stick.x;
  pad.ly = stick.y;
  deadzone(rx, ry, DEADZONE, stick);
  pad.rx = stick.x;
  pad.ry = stick.y;
  pad.pressed = bits & ~pad.down;
  pad.released = pad.down & ~bits;
  pad.down = bits;
  if (bits || pad.lx || pad.ly || pad.rx || pad.ry) pad.usedAt = now;
  return pad;
}

/** Calls `fn` when a pad is plugged in or out (and when the virtual one is). Returns the unsubscribe function. */
export function watchPads(fn: (connected: boolean, id: string) => void) {
  const on = (e: GamepadEvent) => fn(true, e.gamepad.id);
  const off = (e: GamepadEvent) => fn(false, e.gamepad.id);
  window.addEventListener('gamepadconnected', on);
  window.addEventListener('gamepaddisconnected', off);
  listeners.add(fn);
  return () => {
    window.removeEventListener('gamepadconnected', on);
    window.removeEventListener('gamepaddisconnected', off);
    listeners.delete(fn);
  };
}

/** A short name for a pad's id ("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e …)" → "Xbox Wireless Controller"). */
export const padName = (id: string) => id.replace(/\s*\(.*$/, '').trim() || 'Controller';

const probe = {
  /** Plugs the virtual pad in (it's used while no real pad is). */
  connect() {
    if (virtual.on) return;
    virtual.on = true;
    for (const fn of listeners) fn(true, VIRTUAL_ID);
  },
  disconnect() {
    if (!virtual.on) return;
    virtual.on = false;
    virtual.axes.fill(0);
    for (const b of virtual.buttons) {
      b.down = false;
      b.queued = 0;
    }
    for (const fn of listeners) fn(false, VIRTUAL_ID);
  },
  /** Pushes a stick: x right, y down, -1 to 1 (0, 0 lets go). */
  stick(which: 'left' | 'right', x: number, y: number) {
    const i = which === 'left' ? 0 : 2;
    virtual.axes[i] = x;
    virtual.axes[i + 1] = y;
  },
  /** Taps a button: down for at least `ms` and at least one frame. */
  press(name: ButtonName, ms = 80) {
    const b = virtual.buttons[BUTTON[name]];
    b.ms = ms;
    if (b.down) return void b.queued++;
    b.down = true;
    b.seen = false;
    b.until = performance.now() + ms;
  },
  hold(name: ButtonName) {
    const b = virtual.buttons[BUTTON[name]];
    b.down = true;
    b.seen = false;
    b.until = Infinity;
  },
  release(name: ButtonName) {
    const b = virtual.buttons[BUTTON[name]];
    if (b.seen) b.down = false;
    else b.until = 0; // let go as soon as a frame has seen it
  },
  state: () => ({ ...pad }),
};

if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__swarmPad = probe;
