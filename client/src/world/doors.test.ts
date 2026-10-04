import { describe, expect, it } from 'vitest';
import { DOOR_PASSABLE, DOOR_SLIDE_S, doorOpen, doorPhase, nearDoor, resetDoors, shutDoorways, stepDoor, tickDoors } from './doors';
import { BALCONY, BALCONY_OUT, HALF_W, PLAYER_RADIUS, SIDE_OPENINGS, collide, sideDoorway, type Side } from './layout';

const DT = 1 / 60;
const westDoor = SIDE_OPENINGS.office.west.door;

describe('side door rules', () => {
  it('opens for the player just inside or just outside the door, and not from across the room or along the wall', () => {
    expect(nearDoor('office', 'west', -HALF_W + 1, westDoor)).toBe(true);
    expect(nearDoor('office', 'west', -HALF_W - 1, westDoor + 1)).toBe(true);
    expect(nearDoor('office', 'west', -HALF_W + 4, westDoor)).toBe(false);
    expect(nearDoor('office', 'west', -HALF_W + 1, westDoor + 3)).toBe(false);
    expect(nearDoor('office', 'east', -HALF_W + 1, westDoor)).toBe(false);
    // at the railing, the door behind you has shut
    expect(nearDoor('office', 'west', -(BALCONY_OUT - BALCONY.railT - PLAYER_RADIUS), westDoor)).toBe(false);
    const lobby = SIDE_OPENINGS.lobby.east.door;
    expect(nearDoor('lobby', 'east', HALF_W - 0.5, lobby)).toBe(true);
  });

  it('slides from shut to open in DOOR_SLIDE_S and back, and stays put at either end', () => {
    let open = 0;
    for (let t = 0; t < DOOR_SLIDE_S - 1e-9; t += DT) open = stepDoor(open, true, DT);
    expect(open).toBeCloseTo(1, 1);
    expect(stepDoor(1, true, DT)).toBe(1);
    expect(stepDoor(0.5, false, DOOR_SLIDE_S / 2)).toBeCloseTo(0);
    expect(stepDoor(0, false, DT)).toBe(0);
  });

  it('names the phases', () => {
    expect(doorPhase(0, false)).toBe('closed');
    expect(doorPhase(0.3, true)).toBe('opening');
    expect(doorPhase(1, true)).toBe('open');
    expect(doorPhase(0.3, false)).toBe('closing');
  });
});

describe('the doors on your floor', () => {
  it('open as you walk up, let you through once open enough, and shut behind you with one sound each way', () => {
    resetDoors('office', 1);
    const sounds: [Side, boolean][] = [];
    const moved = (side: Side, opening: boolean) => void sounds.push([side, opening]);

    // standing in the room, far from both doors: shut, and the doorways block
    tickDoors(0, 0, DT, moved);
    expect(doorOpen('west')).toBe(0);
    expect(shutDoorways()).toEqual([sideDoorway('office', 'west'), sideDoorway('office', 'east')]);

    // walk up to the west door: it starts to open (one whoosh) and stops blocking once it's open enough
    let t = 0;
    while (shutDoorways().some((r) => r.minX < 0)) {
      tickDoors(-HALF_W + 1, westDoor, DT, moved);
      t += DT;
    }
    expect(doorOpen('west')).toBeGreaterThanOrEqual(DOOR_PASSABLE);
    expect(t).toBeLessThan(DOOR_SLIDE_S);
    for (let i = 0; i < 60; i++) tickDoors(-HALF_W - 1, westDoor, DT, moved);
    expect(doorOpen('west')).toBe(1);
    expect(sounds).toEqual([['west', true]]);
    // the open doorway lets you through
    const p = collide(-HALF_W - 0.2, westDoor, shutDoorways());
    expect(p).toEqual({ x: -HALF_W - 0.2, z: westDoor });

    // out at the railing it shuts behind you
    for (let i = 0; i < 60; i++) tickDoors(-(BALCONY_OUT - 0.5), westDoor, DT, moved);
    expect(doorOpen('west')).toBe(0);
    expect(sounds).toEqual([
      ['west', true],
      ['west', false],
    ]);
    expect(doorOpen('east')).toBe(0);
  });

  it("blocks nothing once the floor's gone", () => {
    resetDoors('lobby', 0);
    expect(shutDoorways()).toHaveLength(2);
    resetDoors('lobby', 0, false);
    expect(shutDoorways()).toEqual([]);
  });
});
