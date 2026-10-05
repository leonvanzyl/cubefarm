import { create } from 'zustand';
import { DEFAULT_NAME, VISITOR_COLORS, cleanColor, cleanName } from '../../../../shared/presence';

// How this browser appears to the others in the office (Settings → Profile): a name, a colour and whether to appear
// at all. Kept in localStorage, so each browser (and device) is its own visitor; a new one gets a random colour.

export interface Profile {
  name: string;
  color: string;
  /** "Appear to others": off, you still see everyone, but nobody sees you. */
  appear: boolean;
}

const KEY = 'cubefarm:profile';

function load(): Profile {
  let saved: Partial<Profile> = {};
  try {
    saved = (JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Profile> | null) ?? {};
  } catch {
    // unreadable or no storage: start afresh
  }
  const color = cleanColor(saved.color, VISITOR_COLORS[Math.floor(Math.random() * VISITOR_COLORS.length)]);
  const p = { name: cleanName(saved.name), color, appear: saved.appear !== false };
  if (saved.color !== color) save(p); // keep the colour it was given
  return p;
}

function save(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // private window: the profile lasts until the tab closes
  }
}

export const useProfile = create<Profile & { set: (p: Partial<Profile>) => void }>((set, get) => ({
  ...load(),
  set: (patch) => {
    const next = { ...patch };
    if (patch.name !== undefined) next.name = cleanName(patch.name, DEFAULT_NAME);
    if (patch.color !== undefined) next.color = cleanColor(patch.color, get().color);
    set(next);
    const { name, color, appear } = get();
    save({ name, color, appear });
  },
}));
