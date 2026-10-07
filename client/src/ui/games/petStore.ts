import { useStore, type Agent } from '../../store';
import { cheer, parsePet, type PetState } from './pet';
import { readJson, writeJson } from './storage';

// Where the desk pet lives between visits to the phone: kept in this browser and shared with Pet.tsx. It watches
// the office too, even while the phone is put away: whenever someone finishes a job, the pet cheers up.

const KEY = 'cubefarm:games:pet';

let pet: PetState | null = parsePet(readJson(KEY));
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export const getPet = () => pet;

export function setPet(next: PetState) {
  pet = next;
  writeJson(KEY, next);
  notify();
}

export function subscribePet(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** What the pet says when someone finishes a job. */
export function finishedLine(a: Pick<Agent, 'name' | 'task' | 'issueNumber' | 'prNumber'>): string {
  if (a.task === 'qa') return `Yay! ${a.name} finished testing${a.prNumber ? ` PR #${a.prNumber}` : ' a PR'}! 🧪`;
  if (a.task === 'fix') return `Yay! ${a.name} fixed${a.prNumber ? ` PR #${a.prNumber}` : ' a PR'}! 🔧`;
  if (a.issueNumber) return `Yay! ${a.name} finished issue #${a.issueNumber}! 🎉`;
  return `Yay! ${a.name} finished a job! 🎉`;
}

// Agents going to 'done' (not on the first snapshot, which isn't news).
const stopWatching = useStore.subscribe((s, prev) => {
  if (!pet || !prev.loaded || s.agents === prev.agents) return;
  for (const a of Object.values(s.agents)) {
    const was = prev.agents[a.id];
    if (a.role !== 'ceo' && a.status === 'done' && was && was.status !== 'done') setPet(cheer(pet, finishedLine(a), Date.now()));
  }
});

// Another tab of the office looked after it.
const onStorage = (e: StorageEvent) => {
  if (e.key !== KEY) return;
  pet = parsePet(readJson(KEY));
  notify();
};
window.addEventListener('storage', onStorage);

import.meta.hot?.dispose(() => {
  stopWatching();
  window.removeEventListener('storage', onStorage);
});
