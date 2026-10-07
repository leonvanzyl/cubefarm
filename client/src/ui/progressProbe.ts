// Probes for QA and Playwright (#210, #226). window.__swarmProgress: coins, purchases, placements and achievements as
// the ledger has them, the slots and colliders the office draws, and (in the demo) coins to spend. window.__swarmCareers:
// everyone's career, what their desk shows, the MVP of the week, and (in the demo) more time on the team.
// Floors are numbers (1 is the first office floor) or repo ids; without one, the floor you're on (or the first).
import { ACHIEVEMENTS, DECOR_SLOTS, type DecorItem } from '../../../shared/progress';
import { deskItems, mvpOfWeek, newCareer } from '../../../shared/careers';
import { api } from '../api';
import { repoOnFloor, useStore, type Agent } from '../store';
import { carry } from '../world/decor/actions';
import { decorRects } from '../world/decor/decor';
import { DECOR_SLOT_AT } from '../world/layout';

function repoOf(floor?: number | string) {
  const s = useStore.getState();
  if (floor === undefined) return repoOnFloor(s.repos, s.floor) ?? s.repos[0] ?? null;
  if (typeof floor === 'number') return repoOnFloor(s.repos, floor);
  return s.repos.find((r) => r.id === floor || r.fullName === floor) ?? null;
}

function floorOf(floor?: number | string) {
  const repo = repoOf(floor);
  if (!repo) throw new Error(`No floor ${String(floor)}`);
  return { repo, progress: useStore.getState().progress.floors[repo.id] ?? { coins: 0, earned: 0, merges: 0, owned: {}, placed: {}, firstPr: null } };
}

function agentOf(ref: string): Agent {
  const agents = Object.values(useStore.getState().agents);
  const a = agents.find((x) => x.id === ref) ?? agents.find((x) => x.name.toLowerCase() === ref.toLowerCase());
  if (!a) throw new Error(`No agent ${ref}`);
  return a;
}

const progress = {
  state: () => useStore.getState().progress,
  coins: (floor?: number | string) => floorOf(floor).progress.coins,
  purchases: (floor?: number | string) => floorOf(floor).progress.owned,
  placements: (floor?: number | string) => floorOf(floor).progress.placed,
  achievements: () => useStore.getState().progress.achievements.map((a) => ({ ...a, name: ACHIEVEMENTS.find((d) => d.id === a.id)?.name })),
  slots: () => DECOR_SLOTS.map((d) => ({ ...d, ...DECOR_SLOT_AT[d.id] })),
  colliders: (floor?: number | string) => decorRects(floorOf(floor).progress.placed),
  held: () => useStore.getState().held,
  /** Demo only: coins for a floor to spend. */
  grant: (floor: number | string | undefined, coins: number) => api.demoProgress({ action: 'coins', repoId: floorOf(floor).repo.id, coins }),
  buy: (floor: number | string | undefined, item: DecorItem) => api.buyDecor(floorOf(floor).repo.id, item),
  place: (floor: number | string | undefined, slot: string, item: DecorItem, from: string | null = null) => api.placeDecor(floorOf(floor).repo.id, { item, slot, from }),
  store: (floor: number | string | undefined, slot: string) => {
    const f = floorOf(floor);
    return api.placeDecor(f.repo.id, { item: f.progress.placed[slot], slot: null, from: slot });
  },
  /** Pick up a decoration as the player would (from the box, or from its slot). */
  carry: (item: DecorItem, from: string | null = null) => carry(item, from),
};

const careers = {
  all: () =>
    Object.values(useStore.getState().agents)
      .filter((a) => a.role !== 'ceo')
      .map((a) => ({ id: a.id, name: a.name, role: a.role, floor: repoOf(a.repoId)?.floor ?? null, desk: a.desk, career: a.career })),
  get: (ref: string) => agentOf(ref).career,
  /** What their desk shows right now: plaques, the star, the plant's size, the photo and the toy. */
  desk: (ref: string) => {
    const a = agentOf(ref);
    return deskItems(a.career ?? newCareer(Date.now()), a.id, Date.now());
  },
  mvp: (floor?: number | string) => {
    const repo = repoOf(floor);
    const m = mvpOfWeek(
      Object.values(useStore.getState().agents).filter((a) => a.repoId === repo?.id),
      Date.now(),
    );
    return m ? { name: m.who.name, merges: m.merges } : null;
  },
  /** Demo only: `days` more on the team, for one agent (by id or name) or everyone. */
  tenure: (days: number, ref?: string) => api.demoProgress({ action: 'tenure', days, agentId: ref ? agentOf(ref).id : undefined }),
};

if (typeof window !== 'undefined') {
  for (const [name, value] of [
    ['__swarmProgress', progress],
    ['__swarmCareers', careers],
  ] as const) {
    if (!Object.getOwnPropertyDescriptor(window, name)) Object.defineProperty(window, name, { value, enumerable: false });
  }
}
