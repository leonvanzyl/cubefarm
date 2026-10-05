import type { ComponentType } from 'react';
import type { Object3D } from 'three';
import { create } from 'zustand';
import { useStore, type Agent } from '../../store';
import { DEFAULT_THEME_SETTINGS, dayKey, parseDateParam, parseThemeParam, resolveTheme, type ThemeId, type ThemeMode, type ThemeSource } from '../../../../shared/themes';
import type { Appearance } from '../appearance';
import { placeDecor, THEMES } from './themes';

// The holiday theme on screen, live: shared/themes.ts picks it from the date and Settings → Themes, re-checked every
// few seconds so it turns on and off at midnight. QA: ?theme=halloween (or auto / off) and ?date=2026-12-31T23:59:50
// override them, and window.__swarmTheme reads and moves both. The theme's lazy chunk (ThemeLayer.tsx) plugs its
// costumes, its E actions and its own probe calls in here while it's mounted.

const search = typeof window !== 'undefined' ? window.location.search : '';
let override: ThemeMode | null = parseThemeParam(search);
let offset = (() => {
  const t = parseDateParam(search);
  return t === null ? 0 : t - Date.now();
})();

/** Now, for the themes: the real time, or ?date= (QA) running on from when it was set. */
export const themeNow = () => Date.now() + offset;

export interface ThemeState {
  id: ThemeId | null;
  source: ThemeSource;
  /** Today's local date (YYYY-MM-DD): daily things (the egg hunt, presents) reset when it changes. */
  day: string;
}

function compute(): ThemeState {
  const now = new Date(themeNow());
  const settings = useStore.getState().settings.themes ?? DEFAULT_THEME_SETTINGS;
  return { ...resolveTheme(now, settings, override), day: dayKey(now) };
}

export const useTheme = create<ThemeState>(() => compute());

/** Picks the theme again (the settings, the date or an override changed). */
export function refreshTheme() {
  const next = compute();
  const cur = useTheme.getState();
  if (next.id !== cur.id || next.source !== cur.source || next.day !== cur.day) useTheme.setState(next);
}

useStore.subscribe((s, prev) => {
  if (s.settings.themes !== prev.settings.themes) refreshTheme();
});
if (typeof window !== 'undefined') setInterval(refreshTheme, 5000);

/** The active theme's song ids, played first by the jukebox (jukeboxSongs.ts playlist()). */
export const themeSongs = (): readonly string[] => {
  const id = useTheme.getState().id;
  return id ? THEMES[id].playlist : [];
};

/** The active theme's merge confetti, or undefined for the usual. */
export const useThemeConfetti = () => useTheme((s) => (s.id ? THEMES[s.id].confetti : undefined));

// ---------- what the mounted chunk plugs in ----------

export interface CostumeProps {
  agent: Agent;
  look: Appearance;
  /** head: drawn in the head's frame (origin at its centre, face to -Z); body: in the torso's (origin on the seat). */
  part: 'head' | 'body';
}

export interface ThemeRuntime {
  costume: ComponentType<CostumeProps> | null;
  /** E on one of the theme's things ({ kind: 'theme', id } focus actions). */
  act: ((id: string) => void) | null;
  /** A line for the phone while it's on (the egg hunt's count, presents opened). */
  status: string | null;
}

export const useThemeRuntime = create<ThemeRuntime>(() => ({ costume: null, act: null, status: null }));

/** Player.tsx: E (or a click) on a theme's interactable. */
export function themeAction(id: string) {
  useThemeRuntime.getState().act?.(id);
}

// ---------- probe ----------

const extras = new Map<string, (...args: unknown[]) => unknown>();

/** The mounted chunk adds its own calls to window.__swarmTheme (eggs, presents, the countdown…); returns a remover. */
export function addProbe(calls: Record<string, (...args: never[]) => unknown>) {
  const names = Object.keys(calls);
  for (const n of names) extras.set(n, calls[n] as (...args: unknown[]) => unknown);
  return () => names.forEach((n) => extras.get(n) === calls[n] && extras.delete(n));
}

let placedHere: { kind: 'office' | 'lobby' | 'roof'; floor: number } | null = null;
let root: Object3D | null = null;

/** ThemeLayer's group, so the probe can count what the theme draws. */
export const setThemeRoot = (o: Object3D | null) => void (root = o);

/** What the mounted theme draws now: meshes (instances counted), and its draw calls. */
function drawn() {
  const out = { calls: 0, meshes: 0, instances: 0, lines: 0, points: 0 };
  root?.traverseVisible((o) => {
    const m = o as Object3D & { isInstancedMesh?: boolean; isMesh?: boolean; isLine?: boolean; isPoints?: boolean; count?: number };
    if (m.isInstancedMesh) out.instances += m.count ?? 0;
    if (m.isMesh) out.meshes++;
    if (m.isLine) out.lines++;
    if (m.isPoints) out.points++;
    if (m.isMesh || m.isLine || m.isPoints) out.calls++;
  });
  return out;
}

/** ThemeLayer says which floor it dresses, for the probe's `placed`. */
export function setPlacedFloor(at: { kind: 'office' | 'lobby' | 'roof'; floor: number } | null) {
  placedHere = at;
}

// window.__swarmTheme: the theme on screen, where it came from and what it put where on this floor; set('christmas' |
// 'auto' | 'off') and setDate('2026-12-24' or a time) move them, call('eggs') and friends reach the theme's own calls.
if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmTheme')) {
  Object.defineProperty(window, '__swarmTheme', {
    value: {
      get id() {
        return useTheme.getState().id;
      },
      get source() {
        return useTheme.getState().source;
      },
      get day() {
        return useTheme.getState().day;
      },
      get now() {
        return new Date(themeNow()).toString();
      },
      get override() {
        return override;
      },
      /** The decorations on the floor you're on, as { slot, item, x, y, z }. */
      get placed() {
        const id = useTheme.getState().id;
        if (!placedHere || !id || placedHere.kind === 'roof') return [];
        return placeDecor(id, placedHere.kind).map(({ slot, item }) => ({ slot: slot.id, item, x: slot.x, y: slot.y, z: slot.z }));
      },
      get floor() {
        return placedHere;
      },
      /** What the theme's chunk has drawn on this floor (0 calls until it has loaded). */
      get drawn() {
        return drawn();
      },
      get confetti() {
        const id = useTheme.getState().id;
        return id ? (THEMES[id].confetti ?? null) : null;
      },
      /** What the theme's chunk offers through call(). */
      get calls() {
        return [...extras.keys()];
      },
      set(mode: ThemeMode | null) {
        override = mode;
        refreshTheme();
      },
      setDate(when: string | null) {
        const t = when ? parseDateParam(`?date=${encodeURIComponent(when)}`) : null;
        offset = t === null ? 0 : t - Date.now();
        refreshTheme();
        return new Date(themeNow()).toString();
      },
      call(name: string, ...args: unknown[]) {
        const fn = extras.get(name);
        if (!fn) throw new Error(`no theme call "${name}" (have: ${[...extras.keys()].join(', ') || 'none'})`);
        return fn(...args);
      },
    },
    enumerable: false,
  });
}
