// What E does with decorations (#210) and trophies: put a held decoration in a slot, pick a placed one up, the
// floor's decor box, the arcade cabinet and a trophy's story. Also the little sounds they make, and the report of
// every coffee the player finishes (the coffee addict trophy).
import { achievementDef, catalogueItem, type DecorItem } from '../../../../shared/progress';
import { api } from '../../api';
import { repoOnFloor, useStore, type Focus } from '../../store';
import { noise, tone, type Vec3 } from '../../ui/sfx';
import { placement } from './decor';

type DecorationAction = Extract<Focus['action'], { kind: 'decoration' } | { kind: 'trophy' }>;

export const decorName = (item: DecorItem) => catalogueItem(item)?.name ?? item;

// ---------- sounds ----------

/** Coins landing: a bright two-step "pling" with a little shimmer. */
export function pling(pos?: Vec3, loud = 1) {
  const o = { name: 'coins', group: 'alerts', pos } as const;
  tone({ ...o, freq: 1318.5, type: 'square', dur: 0.07, peak: 0.03 * loud, attack: 0.002 });
  tone({ ...o, freq: 1975.5, type: 'triangle', at: 0.065, dur: 0.5, peak: 0.1 * loud, attack: 0.003 });
  tone({ ...o, freq: 3951, type: 'sine', at: 0.065, dur: 0.25, peak: 0.02 * loud, attack: 0.003 });
}

/** Something set down: a soft wooden thump. */
export function thunk(pos?: Vec3) {
  const o = { name: 'decor:place', group: 'toys', pos } as const;
  tone({ ...o, freq: 150, to: 85, dur: 0.14, peak: 0.12, attack: 0.003 });
  noise({ ...o, dur: 0.08, peak: 0.06, filter: 'lowpass', freq: 700, attack: 0.002 });
}

/** The kiosk's till. */
export function kaching() {
  noise({ name: 'kiosk:buy', group: 'alerts', dur: 0.05, peak: 0.07, filter: 'bandpass', freq: 2600, q: 2, attack: 0.002 });
  pling(undefined, 0.8);
}

// ---------- E ----------

let busy = false; // a placement on its way to the server: E again waits for it

/** Carry `item` from the floor's decor box (from null) or from its slot. Panels drop what you hold, so close them first. */
export function carry(item: DecorItem, from: string | null) {
  const s = useStore.getState();
  s.openOverlay(null);
  s.setHeld({ kind: 'decor', id: `decor:${from ?? 'box'}:${item}`, item, from });
}

async function send(repoId: string, body: { item: DecorItem; slot: string | null; from: string | null }) {
  if (busy) return false;
  busy = true;
  try {
    await api.placeDecor(repoId, body);
    return true;
  } catch {
    return false; // api toasted it
  } finally {
    busy = false;
  }
}

/** Put whatever decoration you hold back in the box, or (with `to`) in that slot. */
async function putDown(to: string | null) {
  const s = useStore.getState();
  const held = s.held?.kind === 'decor' ? s.held : null;
  const repo = repoOnFloor(s.repos, s.floor);
  if (!held || !repo) return;
  const done = () => {
    if (useStore.getState().held === held) useStore.getState().setHeld(null);
  };
  // Back where it came from: nothing changed on the server.
  if (to === held.from) {
    done();
    return;
  }
  if (await send(repo.id, { item: held.item, slot: to, from: held.from })) {
    done();
    const p = to ? placement(to, held.item) : null;
    thunk(p ? { x: p.x, y: 0.4, z: p.z } : undefined);
  }
}

export function decorationAction(a: DecorationAction) {
  const s = useStore.getState();
  if (a.kind === 'trophy') return showTrophy(a.id);
  if (a.op === 'arcade') return s.openOverlay({ kind: 'phone', tab: 'games' });
  const repo = repoOnFloor(s.repos, s.floor);
  if (!repo) return;
  const held = s.held?.kind === 'decor' ? s.held : null;
  if (a.op === 'box') {
    if (!held) return s.openOverlay({ kind: 'decor-box', repoId: repo.id });
    void putDown(null);
    return;
  }
  if (a.op === 'take' && a.slot) {
    const item = s.progress.floors[repo.id]?.placed[a.slot];
    if (item) carry(item, a.slot);
    return;
  }
  if (a.op === 'place' && a.slot && held) void putDown(a.slot);
}

/** E on a trophy: what it was for, and when. */
export function showTrophy(id: string) {
  const s = useStore.getState();
  const def = achievementDef(id);
  const got = s.progress.achievements.find((a) => a.id === id);
  if (!def || !got) return;
  const when = new Date(got.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  s.pushToast('success', `${def.icon} ${def.name}: ${def.blurb}. Won ${when}${got.detail ? ` · ${got.detail}` : ''}`);
}

// ---------- coffees ----------

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

let watching = false;

/** Report every mug the player drinks dry (a mug in hand going from coffee to none). Started once. */
export function watchCoffees() {
  if (watching) return;
  watching = true;
  useStore.subscribe((s, prev) => {
    const now = s.held;
    const was = prev.held;
    if (now?.kind !== 'mug' || was?.kind !== 'mug' || now.id !== was.id) return;
    if (was.sips > 0 && now.sips === 0) void api.drankCoffee(uid()).catch(() => undefined);
  });
}
