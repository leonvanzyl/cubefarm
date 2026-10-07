import { describe, expect, it } from 'vitest';
import { THEME_IDS, type ThemeId } from '../../../../shared/themes';
import { DECOR_SLOT_AT, DESK, ELEVATOR, HALF_D, HALF_W, BALCONY, BALCONY_OUT, decorRuns, decorSlots, deskPosition, isEastDesk, lobbyColliders, officeColliders, SEATS, type Rect } from '../layout';
import { segmentClear } from '../toys/roombaBrain';
import { findPath, walkways, WALK_R, type FloorKind } from '../walkways';
import { costumeFor, decorColliders, FOOTPRINT, placeDecor, THEMES } from './themes';

const KINDS: FloorKind[] = ['office', 'lobby'];
const overlaps = (a: Rect, b: Rect) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const within = (r: Rect, x: number, z: number, pad = 0) => x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad;

describe('decoration slots', () => {
  it.each(KINDS)('%s slots have unique ids and sit inside the building or on its balconies', (kind) => {
    const slots = decorSlots(kind);
    expect(new Set(slots.map((s) => s.id)).size).toBe(slots.length);
    for (const s of slots) {
      expect(Math.abs(s.x), s.id).toBeLessThanOrEqual(BALCONY_OUT);
      expect(Math.abs(s.z), s.id).toBeLessThanOrEqual(HALF_D);
      if (Math.abs(s.x) > HALF_W) expect(s.z >= BALCONY.minZ && s.z <= BALCONY.maxZ, s.id).toBe(true);
    }
  });

  it('puts a slot on every desk, on its top', () => {
    const slots = decorSlots('office');
    for (let i = 0; i < SEATS; i++) {
      const s = slots.find((x) => x.id === `desk-${i}`)!;
      const d = deskPosition(i);
      // the east wall's desks are turned: their long side runs along z
      const [w, d2] = isEastDesk(i) ? [DESK.d, DESK.w] : [DESK.w, DESK.d];
      expect(Math.abs(s.x - d.x), s.id).toBeLessThan(w / 2);
      expect(Math.abs(s.z - d.z), s.id).toBeLessThan(d2 / 2);
    }
  });

  it.each(KINDS)('%s runs hang under the ceiling along the walls', (kind) => {
    for (const r of decorRuns(kind)) {
      expect(r.y).toBeLessThan(3.6);
      for (const [x, z] of [r.from, r.to]) expect(Math.abs(x) > HALF_W - 0.2 || Math.abs(z) > HALF_D - 0.2 || kind === 'lobby').toBe(true);
    }
  });
});

describe('placeDecor', () => {
  it('Halloween puts pumpkins on every desk, cobwebs in the corners and its showpieces in the lobby', () => {
    const office = placeDecor('halloween', 'office');
    const items = (id: string) => office.filter((p) => p.slot.id.startsWith(id)).map((p) => p.item);
    expect(items('desk-')).toEqual(Array(SEATS).fill('jackOLantern'));
    expect(items('corner-')).toEqual(Array(4).fill('cobweb'));
    expect(items('balcony-')).toEqual(Array(4).fill('bigPumpkin'));
    expect(items('elevator-e')).toEqual(['broom']);
    const lobby = Object.fromEntries(placeDecor('halloween', 'lobby').map((p) => [p.slot.id, p.item]));
    expect(lobby).toMatchObject({ 'reception-w': 'jackOLantern', 'reception-e': 'candyBowl', 'lobby-feature': 'gravestone', patio: 'inflatablePumpkin', 'elevator-e': 'broom' });
  });

  it('fills each slot once, and nothing without a theme', () => {
    for (const id of THEME_IDS) {
      for (const kind of KINDS) {
        const placed = placeDecor(id, kind);
        expect(new Set(placed.map((p) => p.slot.id)).size, `${id} ${kind}`).toBe(placed.length);
      }
    }
    expect(placeDecor(null, 'office')).toEqual([]);
    expect(decorColliders(null, 'lobby')).toEqual([]);
  });

  it("every theme's rules name slots that exist", () => {
    const ids = KINDS.flatMap((k) => decorSlots(k).map((s) => s.id));
    for (const id of THEME_IDS) {
      for (const rule of THEMES[id].decor) {
        const hit = rule.slots.endsWith('*') ? ids.some((s) => s.startsWith(rule.slots.slice(0, -1))) : ids.includes(rule.slots);
        expect(hit, `${id}: ${rule.slots}`).toBe(true);
      }
    }
  });
});

describe('decorations stay out of the way', () => {
  const cases = THEME_IDS.flatMap((id) => KINDS.map((kind) => [id, kind] as [ThemeId, FloorKind]));

  it.each(cases)('%s on the %s: solids only for things on the floor, clear of the furniture and the elevator', (id, kind) => {
    const solids = decorColliders(id, kind);
    const floorItems = placeDecor(id, kind).filter((p) => p.slot.floor && FOOTPRINT[p.item]);
    expect(solids.length).toBe(floorItems.length);
    const base = (kind === 'office' ? officeColliders() : lobbyColliders()).filter((r) => (r.h ?? 3.6) < 3); // furniture, not walls
    const doorway: Rect = { minX: -ELEVATOR.doorHalf - 0.3, maxX: ELEVATOR.doorHalf + 0.3, minZ: HALF_D - 2, maxZ: HALF_D + 3 };
    for (const r of solids) {
      expect(overlaps(r, doorway), JSON.stringify(r)).toBe(false);
      for (const b of base) expect(overlaps(r, b), `${JSON.stringify(r)} hits ${JSON.stringify(b)}`).toBe(false);
    }
  });

  it.each(THEME_IDS)("%s keeps clear of the office's own decoration slots (the catalogue's plants, posters and arcade)", (id) => {
    for (const r of decorColliders(id, 'office')) {
      for (const [name, s] of Object.entries(DECOR_SLOT_AT)) {
        if (s.y !== undefined) continue; // on a wall
        const across = Math.abs(Math.sin(s.rotY)) > 0.7;
        const half = { x: (across ? s.d : s.w) / 2, z: (across ? s.w : s.d) / 2 };
        const spot: Rect = { minX: s.x - half.x, maxX: s.x + half.x, minZ: s.z - half.z, maxZ: s.z + half.z };
        expect(overlaps(r, spot), `${JSON.stringify(r)} in ${name}`).toBe(false);
      }
    }
  });

  it.each(cases)("%s on the %s: nobody's spot is covered, and every walk from the elevator still goes the same way", (id, kind) => {
    const solids = decorColliders(id, kind).filter((r) => Math.abs((r.minX + r.maxX) / 2) < HALF_W);
    if (!solids.length) return;
    const w = walkways(kind);
    const elevator = w.spots.find((s) => s.id === 'elevator')!;
    for (const s of [...w.spots, ...w.homes]) {
      for (const r of solids) expect(within(r, s.x, s.z, WALK_R), `${s.id} under ${JSON.stringify(r)}`).toBe(false);
      const path = findPath(w, elevator, s);
      expect(path, s.id).not.toBeNull();
      let at = { x: elevator.x, z: elevator.z };
      for (const p of path!) {
        expect(segmentClear(solids, at, p, WALK_R), `walk to ${s.id}`).toBe(true);
        at = p;
      }
    }
  });
});

describe('costumeFor', () => {
  const people = Array.from({ length: 60 }, (_, i) => ({ id: `agent-${i}`, role: 'agent' as const }));

  it('dresses agents from the theme and the CEO in a crown for Halloween', () => {
    const worn = new Set(people.map((p) => costumeFor('halloween', p)));
    expect([...worn].sort()).toEqual([...THEMES.halloween.costumes.agent].sort());
    expect(costumeFor('halloween', { id: 'ceo', role: 'ceo' })).toBe('crown');
  });

  it('is the same for the same person every time, and nothing without a theme', () => {
    for (const p of people.slice(0, 10)) expect(costumeFor('christmas', p)).toBe(costumeFor('christmas', { ...p }));
    expect(costumeFor(null, people[0])).toBe(null);
    for (const id of THEME_IDS) for (const role of ['agent', 'ceo'] as const) expect(costumeFor(id, { id: 'x', role }), `${id} ${role}`).not.toBe(null);
  });
});
