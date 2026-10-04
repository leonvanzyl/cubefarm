import { describe, expect, it } from 'vitest';
import { roofElevation, TELESCOPE } from '../layout.ts';
import { cityLayout, type CityBuilding } from '../outside/cityLayout.ts';
import { BOARD, BOARD_RANGE, billboardSpots, blocks, boardTexts, type OfficeNumbers } from './billboardLayout.ts';

const box: CityBuilding = { x: 0, z: 0, y: 0, w: 10, h: 20, d: 10, color: 0, lit: 0, pattern: 0 };

describe('line of sight', () => {
  it('is blocked by a building in the way, not by one beside it or below', () => {
    expect(blocks(box, { x: -20, y: 5, z: 0 }, { x: 20, y: 5, z: 0 })).toBe(true);
    expect(blocks(box, { x: -20, y: 5, z: 8 }, { x: 20, y: 5, z: 8 })).toBe(false);
    expect(blocks(box, { x: -20, y: 25, z: 0 }, { x: 20, y: 25, z: 0 })).toBe(false);
    expect(blocks(box, { x: -20, y: 5, z: 0 }, { x: -8, y: 5, z: 0 })).toBe(false); // stops short of it
  });
});

describe('the billboards', () => {
  const layout = cityLayout();
  for (const top of [0, 2, 6]) {
    const eye = { x: TELESCOPE.x, y: roofElevation(top) + TELESCOPE.eye, z: TELESCOPE.z };
    const spots = billboardSpots(layout, eye);

    it(`stand round the office in clear sight of the telescope (${top + 1} storeys up)`, () => {
      // only just above the lobby, the nearer rooftops hide one
      expect(spots.length).toBeGreaterThanOrEqual(top === 0 ? 3 : 4);
      expect(spots.length).toBeLessThanOrEqual(4);
      for (const s of spots) {
        expect(s.dist).toBeGreaterThanOrEqual(BOARD_RANGE.min);
        expect(s.dist).toBeLessThanOrEqual(BOARD_RANGE.max);
        // on its building's roof, on legs
        expect(s.y - BOARD.h / 2 - BOARD.legs).toBeCloseTo(s.top);
        // facing the office: the face's normal (sin yaw, cos yaw) points back towards the middle
        expect(Math.sin(s.yaw) * -s.x + Math.cos(s.yaw) * -s.z).toBeCloseTo(Math.hypot(s.x, s.z));
        const to = { x: eye.x + (s.x - eye.x) * 0.97, y: eye.y + (s.y - eye.y) * 0.97, z: eye.z + (s.z - eye.z) * 0.97 };
        expect([...layout.buildings, ...layout.boxes, ...layout.cylinders, ...layout.cones].some((b) => blocks(b, eye, to))).toBe(false);
        // nothing else up on its roof (a water tower in front of it, say)
        const bits = [...layout.boxes, ...layout.cylinders, ...layout.cones].filter((k) => k.y >= s.top - 0.5 && Math.hypot(k.x - s.x, k.z - s.z) < 6);
        expect(bits).toEqual([]);
      }
      // spread round, not bunched on one block
      for (const a of spots) for (const b of spots) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(40);
    });
  }
});

describe('what the billboards say', () => {
  const n: OfficeNumbers = { company: 'Acme Robots', floors: 2, agents: 7, working: 3, issues: 12, openPrs: 4, inQa: 2, merged: 41 };

  it("puts the office's numbers up in big letters", () => {
    const boards = boardTexts(n);
    expect(boards).toHaveLength(4);
    expect(boards[0]).toMatchObject({ big: '3 / 7', under: 'on 2 floors' });
    expect(boards[1]).toMatchObject({ big: '41', under: '4 open · 2 in QA' });
    expect(boards[2]).toMatchObject({ big: '12' });
    expect(boards[3].top).toBe('ACME ROBOTS');
    for (const b of boards) expect(b.bg).not.toBe(b.fg);
  });

  it('cheers an empty backlog and copes without a company name', () => {
    const boards = boardTexts({ ...n, company: '', issues: 0, floors: 1 });
    expect(boards[2].under).toBe('inbox zero!');
    expect(boards[0].under).toBe('on 1 floor');
    expect(boards[3].top).toBe('CUBEFARM');
  });
});
