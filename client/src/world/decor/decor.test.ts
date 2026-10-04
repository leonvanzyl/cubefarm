import { describe, expect, it } from 'vitest';
import { CATALOGUE, DECOR_SLOTS, type DecorItem } from '../../../../shared/progress';
import { DECOR_BOX, DECOR_SLOT_AT, HALF_D, HALF_W, KIOSK, SIDE_DOOR, SIDE_OPENINGS, TROPHY_SHELF, WINDOW, lobbyColliders, officeColliders, type Rect } from '../layout';
import { findPath, spot, walkways, WALK_R } from '../walkways';
import { decorRect, decorRects, decorSize, footprint, openSlots, placement, reservedDecorRects } from './decor';

const overlaps = (a: Rect, b: Rect, pad = 0) => a.minX < b.maxX + pad && a.maxX > b.minX - pad && a.minZ < b.maxZ + pad && a.maxZ > b.minZ - pad;
const contains = (outer: Rect, inner: Rect) => inner.minX >= outer.minX - 1e-6 && inner.maxX <= outer.maxX + 1e-6 && inner.minZ >= outer.minZ - 1e-6 && inner.maxZ <= outer.maxZ + 1e-6;
const slotKind = (id: string) => DECOR_SLOTS.find((d) => d.id === id)!.kind;

describe('decoration slots', () => {
  it('has a place in the layout for every slot the server knows, and nothing else', () => {
    expect(Object.keys(DECOR_SLOT_AT).sort()).toEqual(DECOR_SLOTS.map((d) => d.id).sort());
  });

  it('fits every item in every slot of its kind, its collider inside the room the slot keeps', () => {
    const reserved = new Map(DECOR_SLOTS.filter((d) => d.kind === 'floor' || d.kind === 'big').map((d, i) => [d.id, reservedDecorRects()[i]]));
    for (const item of CATALOGUE) {
      for (const d of DECOR_SLOTS.filter((x) => x.kind === item.kind)) {
        const s = DECOR_SLOT_AT[d.id];
        const size = decorSize(item.id, d.id);
        expect(size.w, `${item.id} in ${d.id}`).toBeLessThanOrEqual(s.w);
        if (d.kind !== 'wall') expect(size.d, `${item.id} in ${d.id}`).toBeLessThanOrEqual(s.d);
        const r = decorRect(d.id, item.id);
        if (d.kind === 'floor' || d.kind === 'big') {
          expect(r).not.toBeNull();
          expect(contains(reserved.get(d.id)!, r!), `${item.id} in ${d.id}`).toBe(true);
          expect(contains(reserved.get(d.id)!, footprint(placement(d.id, item.id)!.x, placement(d.id, item.id)!.z, size.w, size.d, s.rotY))).toBe(true);
        } else expect(r).toBeNull();
      }
    }
  });

  it('keeps floor and big slots off the furniture, the walkway spots, the desks and the elevator', () => {
    const solids = officeColliders();
    const w = walkways('office');
    const elevator: Rect = { minX: -1.6, maxX: 1.6, minZ: 9.6, maxZ: HALF_D };
    for (const r of reservedDecorRects()) {
      for (const c of solids) expect(overlaps(r, c), JSON.stringify({ r, c })).toBe(false);
      for (const s of [...w.spots, ...w.homes]) expect(overlaps(r, { minX: s.x, maxX: s.x, minZ: s.z, maxZ: s.z }, WALK_R + 0.2), `${s.id} ${JSON.stringify(r)}`).toBe(false);
      expect(overlaps(r, elevator)).toBe(false);
      expect(r.minX >= -HALF_W - 1e-6 && r.maxX <= HALF_W + 1e-6 && r.minZ >= -HALF_D - 1e-6 && r.maxZ <= HALF_D + 1e-6).toBe(true);
    }
  });

  it('hangs wall decorations clear of the side walls\' windows and doors', () => {
    for (const d of DECOR_SLOTS.filter((x) => x.kind === 'wall')) {
      const s = DECOR_SLOT_AT[d.id];
      if (Math.abs(Math.abs(s.x) - HALF_W) > 0.1) continue; // north and south walls have no windows
      const side = s.x < 0 ? 'west' : 'east';
      const { door, windows } = SIDE_OPENINGS.office[side];
      const [a, b] = [s.z - s.w / 2, s.z + s.w / 2];
      for (const z of windows) expect(b <= z - WINDOW.w / 2 || a >= z + WINDOW.w / 2, `${d.id} and the window at ${z}`).toBe(true);
      expect(b <= door - SIDE_DOOR.half || a >= door + SIDE_DOOR.half, `${d.id} and the door`).toBe(true);
    }
  });

  it('leaves every spot on an office floor reachable from the elevator, from every desk, with every slot filled', () => {
    const w = walkways('office');
    for (const r of reservedDecorRects()) expect(w.nav.rects).toContainEqual(r);
    const lift = spot(w, 'elevator')!;
    for (const s of [...w.spots, ...w.homes]) expect(findPath(w, lift, s), s.id).not.toBeNull();
    for (const h of w.homes) expect(findPath(w, h, spot(w, 'coffee')!), h.id).not.toBeNull();
  });

  it('puts the decor box, kiosk and trophy shelf where they block nothing', () => {
    expect(officeColliders()).toContainEqual(expect.objectContaining({ minX: DECOR_BOX.x - DECOR_BOX.w / 2 }));
    expect(lobbyColliders()).toContainEqual(expect.objectContaining({ minX: KIOSK.x - KIOSK.w / 2 }));
    expect(lobbyColliders()).toContainEqual(expect.objectContaining({ minX: TROPHY_SHELF.x - TROPHY_SHELF.w / 2 }));
    const lobby = walkways('lobby');
    const lift = spot(lobby, 'elevator')!;
    for (const s of lobby.spots) expect(findPath(lobby, lift, s), s.id).not.toBeNull();
    // and they stand clear of everything else in the lobby (mission control, the hoop's wall, reception)
    const mine = [KIOSK, TROPHY_SHELF].map((k) => ({ minX: k.x - k.w / 2, maxX: k.x + k.w / 2, minZ: k.z - k.d / 2, maxZ: k.z + k.d / 2 }));
    const others = lobbyColliders().filter((r) => !mine.some((m) => Math.abs(m.minX - r.minX) < 1e-9 && Math.abs(m.minZ - r.minZ) < 1e-9));
    for (const m of mine) expect(others.filter((r) => overlaps(m, r)), JSON.stringify(m)).toEqual([]);
  });
});

describe('placing', () => {
  it('stands back-anchored items against their wall and the rest in the middle of their slot', () => {
    const tank = placement('b-west', 'fishtank')!;
    expect(tank.x).toBeCloseTo(-HALF_W + decorSize('fishtank').d / 2 + 0.02);
    expect(tank.z).toBeCloseTo(3.6);
    const table = placement('b-lounge', 'pingpong')!;
    expect([table.x, table.z]).toEqual([-7, 8.4]);
    // the table's long side runs north-south there
    const r = decorRect('b-lounge', 'pingpong')!;
    expect(r.maxZ - r.minZ).toBeCloseTo(2.2);
    expect(placement('nowhere', 'plant')).toBeNull();
  });

  it('collides with what stands on the floor and walks over rugs and past wall decorations', () => {
    const placed: Record<string, DecorItem> = { 'f-ne': 'plant', 'w-west': 'neon', 'r-entry': 'rug', 'b-south': 'arcade' };
    const rects = decorRects(placed);
    expect(rects).toHaveLength(2);
    expect(rects[0].maxX - rects[0].minX).toBeCloseTo(0.45);
    expect(rects[1].h).toBeCloseTo(1.85);
  });

  it('offers the empty slots of the item\'s kind, and the one it came from', () => {
    const placed: Record<string, DecorItem> = { 'w-west': 'neon', 'w-south-w': 'lights' };
    expect(openSlots('poster-ship', placed, null)).toEqual(['w-south-e', 'w-north-e', 'w-kitchen']);
    expect(openSlots('neon', placed, 'w-west')).toEqual(['w-west', 'w-south-e', 'w-north-e', 'w-kitchen']);
    expect(openSlots('rug', placed, null).every((id) => slotKind(id) === 'rug')).toBe(true);
  });
});
