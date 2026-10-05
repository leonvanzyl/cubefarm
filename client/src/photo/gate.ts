// Photo mode's doorway, the only part in the main bundle: whether it's on and whether the office is frozen, its keys
// (K for photo mode and I to save an instant replay, rebindable in Help → Controls), the instant replay setting and
// window.__swarmPhoto. The camera,
// filters, panel, recorder and gallery load the first time they're used.
import { create } from 'zustand';
import { useStore } from '../store';
import { isConfirmOpen } from '../ui/Confirm';
import { bindings } from '../ui/controls';
import { isBound } from '../ui/keymap';

const REPLAY_KEY = 'cubefarm:replay';

function replayPref(): boolean {
  try {
    return localStorage.getItem(REPLAY_KEY) === 'on';
  } catch {
    return false;
  }
}

interface Gate {
  /** Photo mode is on: the HUD hides and its own camera draws the office. */
  active: boolean;
  /** The office stands still: no frame loop, no people, toys or sky moving (the server carries on). */
  frozen: boolean;
  /** Instant replay keeps the last 15 s (off by default: it costs memory and some encoding). */
  replay: boolean;
}

export const usePhotoGate = create<Gate>(() => ({ active: false, frozen: false, replay: replayPref() }));

export const photoActive = () => usePhotoGate.getState().active;

let leftAt = -Infinity;
/**
 * Whether photo mode has the mouse: while it's on, and for a moment after (the pointer lock change that leaving
 * causes arrives later), so the player doesn't drop what they're holding.
 */
export const photoOwnsLock = () => photoActive() || performance.now() - leftAt < 1000;
/** photoMode.ts, on leaving. */
export const markLeft = () => void (leftAt = performance.now());

let canvas: HTMLCanvasElement | null = null;
/** Game.tsx hands over the 3D view's canvas (for recording, and for shots' pointer lock). */
export const setOfficeCanvas = (el: HTMLCanvasElement) => void (canvas = el);
export const officeCanvas = () => canvas;

type PhotoModule = typeof import('./photoMode');
type ReplayModule = typeof import('./instantReplay');
let photo: PhotoModule | null = null;
let replay: ReplayModule | null = null;
const loadPhoto = async () => (photo ??= await import('./photoMode'));
const loadReplay = async () => (replay ??= await import('./instantReplay'));

/** Whether photo mode can start now: in the office, nothing open, not between floors. */
export function canEnterPhoto() {
  const s = useStore.getState();
  return s.started && !s.overlay && !s.travel && !isConfirmOpen();
}

/** K: in or out of photo mode. The pointer lock is read here, while the key press still counts as a gesture. */
export function togglePhoto() {
  if (photo) {
    if (photoActive()) photo.leave();
    else photo.enter(!!document.pointerLockElement);
    return;
  }
  if (!canEnterPhoto()) return;
  const locked = !!document.pointerLockElement;
  void loadPhoto().then((m) => m.enter(locked));
}

export function setReplay(on: boolean) {
  usePhotoGate.setState({ replay: on });
  try {
    localStorage.setItem(REPLAY_KEY, on ? 'on' : 'off');
  } catch {
    // storage may be unavailable (private mode); the setting just won't be remembered
  }
}

/** I: saves the last 15 s, when instant replay is on. */
export function saveReplay() {
  if (!usePhotoGate.getState().replay) return Promise.resolve(null);
  return loadReplay().then((m) => m.saveReplay());
}

const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable || (el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((el as HTMLInputElement).type)));
};

/** Mounted with the office (Office.tsx): the keys, and instant replay running while it's on, you're in and the tab shows. */
export function installPhoto(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
    const b = bindings();
    if (isBound(b, 'photo', e.code) && (photoActive() || canEnterPhoto())) {
      e.preventDefault();
      togglePhoto();
    } else if (isBound(b, 'saveReplay', e.code) && usePhotoGate.getState().replay && useStore.getState().started && !useStore.getState().overlay) {
      e.preventDefault();
      void saveReplay();
    }
  };
  window.addEventListener('keydown', onKey);
  const wanted = () => usePhotoGate.getState().replay && useStore.getState().started && !document.hidden;
  const sync = () => {
    if (wanted()) void loadReplay().then((m) => wanted() && m.startReplay());
    else replay?.stopReplay();
  };
  sync();
  const offGate = usePhotoGate.subscribe((s, prev) => s.replay !== prev.replay && sync());
  const offStore = useStore.subscribe((s, prev) => s.started !== prev.started && sync());
  document.addEventListener('visibilitychange', sync);
  return () => {
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', sync);
    offGate();
    offStore();
    replay?.stopReplay();
  };
}

// ---------- window.__swarmPhoto, for QA and Playwright ----------

if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmPhoto')) {
  const call =
    <K extends keyof PhotoModule['probe']>(k: K) =>
    (...args: unknown[]) =>
      loadPhoto().then((m) => (m.probe[k] as (...a: unknown[]) => unknown)(...args));
  Object.defineProperty(window, '__swarmPhoto', {
    enumerable: false,
    configurable: false,
    value: {
      get mode() {
        return photoActive() ? 'photo' : 'off';
      },
      get frozen() {
        return usePhotoGate.getState().frozen;
      },
      /** Camera, filter, overlays, depth of field, time of day, recording and gallery (null until photo mode has loaded). */
      get state() {
        return photo?.probe.state() ?? null;
      },
      get replay() {
        return { enabled: usePhotoGate.getState().replay, ...(replay?.replayState() ?? { running: false, seconds: 0, bytes: 0, error: null }) };
      },
      enter: () => loadPhoto().then((m) => m.enter(!!document.pointerLockElement)),
      leave: () => photo?.leave(),
      set: call('set'),
      fly: call('fly'),
      shot: call('shot'),
      record: call('record'),
      setReplay,
      saveReplay,
    },
  });
}
