import { describe, expect, it } from 'vitest';
import { CEO_ROOM, ELEVATOR, HALF_D, HALF_W, JUKEBOX, MANAGER_DESK, QA_LAB, SIDE_OPENINGS, SPAWN } from '../world/layout';
import { DOOR, FADE, GLASS, ROOMS, ROOM_SENDS, ROOM_SOUND, SETTLE, WALL, fillImpulse, newRoomTracker, occlusion, roomAt, trackRoom, zoneAt, type Room } from './acoustics';
import { SOUND_GROUPS } from './audioPrefs';

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const shut = { west: 0, east: 0 };

describe('roomAt', () => {
  it('tells the spaces of an office floor apart', () => {
    expect(roomAt('office', SPAWN.x, SPAWN.z)).toBe('office');
    expect(roomAt('office', 0, 0)).toBe('office');
    expect(roomAt('office', QA_LAB.x - 1, QA_LAB.stations[1])).toBe('qa');
    expect(roomAt('office', HALF_W - 1.5, 7.4)).toBe('kitchen');
    expect(roomAt('office', 0, HALF_D + 1.3)).toBe('cabin');
    expect(roomAt('office', -HALF_W - 1.5, SIDE_OPENINGS.office.west.door)).toBe('outside');
    expect(roomAt('office', HALF_W + 1.5, 0)).toBe('outside');
    expect(roomAt('office', JUKEBOX.officeX, HALF_D - 1)).toBe('office');
  });

  it('tells the lobby from its glass offices, the cabin and the patio', () => {
    expect(roomAt('lobby', 0, 0)).toBe('lobby');
    expect(roomAt('lobby', MANAGER_DESK.x, MANAGER_DESK.z)).toBe('office');
    expect(roomAt('lobby', (CEO_ROOM.minX + CEO_ROOM.maxX) / 2, -8)).toBe('office');
    expect(roomAt('lobby', 0, HALF_D + 1.3)).toBe('cabin');
    expect(roomAt('lobby', -HALF_W - 1, 4)).toBe('outside');
  });

  it('counts the elevator doorway as the floor, the cabin as past it', () => {
    expect(roomAt('office', 0, HALF_D + 0.1)).toBe('office');
    expect(roomAt('office', ELEVATOR.cabinHalf - 0.3, HALF_D + 2)).toBe('cabin');
  });
});

describe('zoneAt', () => {
  it('puts an office floor\'s open plan in one zone and each enclosure in its own', () => {
    expect(zoneAt('office', 0, 0)).toBe('floor');
    expect(zoneAt('office', QA_LAB.x, 0)).toBe('floor');
    expect(zoneAt('office', HALF_W - 1.5, 7.4)).toBe('floor');
    expect(zoneAt('office', 0, HALF_D + 1.3)).toBe('cabin');
    expect(zoneAt('office', -HALF_W - 1.5, 0)).toBe('west');
    expect(zoneAt('office', HALF_W + 1.5, 0)).toBe('east');
    expect(zoneAt('lobby', MANAGER_DESK.x, MANAGER_DESK.z)).toBe('manager');
    expect(zoneAt('lobby', 12, -8)).toBe('ceo');
    expect(zoneAt('lobby', 0, 0)).toBe('floor');
  });
});

describe('fillImpulse', () => {
  const rate = 16000;
  const irs = Object.fromEntries(ROOMS.map((r) => [r, fillImpulse(ROOM_SOUND[r], rate, seeded(5))])) as Record<Room, Float32Array[]>;
  const energy = (d: Float32Array, from = 0, to = d.length) => d.slice(from, to).reduce((s, v) => s + v * v, 0);
  /** Seconds until 90% of the energy has arrived. */
  const t90 = (d: Float32Array) => {
    const total = energy(d);
    let sum = 0;
    for (let i = 0; i < d.length; i++) if ((sum += d[i] * d[i]) >= 0.9 * total) return i / rate;
    return d.length / rate;
  };
  /** How bright: the share of the energy in sample-to-sample differences (high frequencies). */
  const bright = (d: Float32Array) => {
    let diff = 0;
    for (let i = 1; i < d.length; i++) diff += (d[i] - d[i - 1]) ** 2;
    return diff / energy(d);
  };

  it.each(ROOMS)('%s: stereo, the right length, unit energy per channel', (room) => {
    const ir = irs[room];
    expect(ir).toHaveLength(2);
    for (const ch of ir) {
      expect(ch.length).toBe(Math.round(ROOM_SOUND[room].length * rate));
      expect(energy(ch)).toBeCloseTo(1, 5);
      expect(ch.every(Number.isFinite)).toBe(true);
    }
    // the two ears hear different noise: width, not a mono echo
    const [l, r] = ir;
    const dot = l.reduce((s, v, i) => s + v * r[i], 0);
    expect(Math.abs(dot)).toBeLessThan(0.5);
  });

  it.each(ROOMS)('%s: silent before the walls answer, then fading', (room) => {
    const spec = ROOM_SOUND[room];
    const [l] = irs[room];
    const first = Math.min(spec.predelay, ...spec.early.map(([t]) => t));
    expect(energy(l, 0, Math.floor(first * rate))).toBe(0);
    if (!spec.echo) {
      const fifth = Math.floor(l.length / 5);
      expect(energy(l, l.length - fifth)).toBeLessThan(energy(l, 0, fifth) / 100);
    }
  });

  it('makes the lobby ring longest and the cabin shortest, the kitchen brighter than the carpeted office', () => {
    const lasts = Object.fromEntries(ROOMS.map((r) => [r, t90(irs[r][0])]));
    expect(lasts.lobby).toBeGreaterThan(lasts.office);
    expect(lasts.lobby).toBeGreaterThan(lasts.kitchen);
    expect(lasts.office).toBeGreaterThan(lasts.cabin);
    expect(bright(irs.kitchen[0])).toBeGreaterThan(bright(irs.office[0]));
    expect(bright(irs.lobby[0])).toBeGreaterThan(bright(irs.office[0]));
  });

  it('gives the outside a far slap from across the street, and the lobby a little echo', () => {
    for (const [room, over] of [['outside', 3], ['lobby', 1.4]] as const) {
      const [at] = ROOM_SOUND[room].echo!;
      const [l] = irs[room];
      const i = Math.floor(at * rate);
      const w = Math.floor(0.02 * rate);
      expect(energy(l, i, i + w), room).toBeGreaterThan(over * energy(l, i - 2 * w, i - w));
    }
    expect(ROOM_SOUND.outside.rt60).toBeLessThan(0.2); // otherwise almost dry
  });

  it('keeps each room\'s mix modest: you hear the room, not a cathedral', () => {
    for (const room of ROOMS) expect(ROOM_SOUND[room].wet, room).toBeGreaterThan(0.05), expect(ROOM_SOUND[room].wet, room).toBeLessThanOrEqual(0.35);
    expect(ROOM_SOUND.lobby.wet).toBeGreaterThan(ROOM_SOUND.office.wet);
    expect(ROOM_SOUND.outside.wet).toBeLessThan(ROOM_SOUND.office.wet);
  });
});

describe('ROOM_SENDS', () => {
  it('sends the room footsteps, chatter, toys, the jukebox and the gong, but not your phone or the outside air', () => {
    expect(Object.keys(ROOM_SENDS).sort()).toEqual([...SOUND_GROUPS].sort());
    for (const g of ['steps', 'typing', 'toys', 'alerts', 'music'] as const) expect(ROOM_SENDS[g], g).toBeGreaterThan(0);
    expect(ROOM_SENDS.voice).toBe(0);
    expect(ROOM_SENDS.outside).toBe(0);
    for (const g of SOUND_GROUPS) expect(ROOM_SENDS[g]).toBeLessThanOrEqual(1);
  });
});

describe('trackRoom', () => {
  it('takes the first room at once', () => {
    const st = newRoomTracker();
    expect(trackRoom(st, 'lobby', 0)).toBe('lobby');
    expect(trackRoom(st, 'lobby', 1)).toBeNull();
  });

  it('moves once the listener has settled in a new room, not on a brief step over the line', () => {
    const st = newRoomTracker();
    trackRoom(st, 'office', 0);
    expect(trackRoom(st, 'kitchen', 10)).toBeNull();
    expect(trackRoom(st, 'office', 10.1)).toBeNull(); // stepped back
    expect(trackRoom(st, 'kitchen', 10.2)).toBeNull();
    expect(trackRoom(st, 'kitchen', 10.2 + SETTLE / 2)).toBeNull();
    expect(trackRoom(st, 'kitchen', 10.2 + SETTLE)).toBe('kitchen');
    expect(st.room).toBe('kitchen');
  });

  it('lets a cross-fade finish before starting the next', () => {
    const st = newRoomTracker();
    trackRoom(st, 'lobby', 0);
    trackRoom(st, 'cabin', 5);
    expect(trackRoom(st, 'cabin', 5 + SETTLE)).toBe('cabin');
    trackRoom(st, 'lobby', 5.3);
    expect(trackRoom(st, 'lobby', 5.3 + SETTLE)).toBeNull(); // still fading into the cabin
    expect(trackRoom(st, 'lobby', 5 + SETTLE + FADE)).toBe('lobby');
  });
});

describe('occlusion', () => {
  it('leaves sounds in your own space alone', () => {
    for (const z of ['floor', 'cabin', 'west', 'east', 'manager', 'ceo'] as const) expect(occlusion(z, z, 5, shut)).toBeNull();
  });

  it('muffles through a glass wall or the elevator doorway a little, through a shut side door a lot', () => {
    const glass = occlusion('floor', 'manager', 0, shut)!;
    const lift = occlusion('cabin', 'floor', 0, shut)!;
    const wall = occlusion('west', 'floor', 0, shut)!;
    expect(glass).toEqual(GLASS);
    expect(lift).toEqual(GLASS);
    expect(wall).toEqual(WALL);
    expect(wall.gain).toBeLessThan(glass.gain);
    expect(wall.cutoff).toBeLessThan(glass.cutoff);
  });

  it('lets more through an open side door', () => {
    const open = occlusion('floor', 'east', 0, { west: 0, east: 1 })!;
    const half = occlusion('floor', 'east', 0, { west: 0, east: 0.5 })!;
    expect(open.gain).toBeCloseTo(DOOR.gain), expect(open.cutoff).toBeCloseTo(DOOR.cutoff);
    expect(half.gain).toBeGreaterThan(WALL.gain), expect(half.gain).toBeLessThan(DOOR.gain);
    expect(half.cutoff).toBeGreaterThan(WALL.cutoff), expect(half.cutoff).toBeLessThan(DOOR.cutoff);
    expect(occlusion('floor', 'east', 0, { west: 1, east: 0 })).toEqual(WALL); // the other door doesn't help
  });

  it('muffles more across two walls, and more the further away', () => {
    const one = occlusion('floor', 'west', 4, shut)!;
    const two = occlusion('east', 'west', 4, shut)!;
    expect(two.gain).toBeLessThan(one.gain);
    expect(two.cutoff).toBeLessThan(one.cutoff);
    const near = occlusion('cabin', 'floor', 1, shut)!;
    const far = occlusion('cabin', 'floor', 15, shut)!;
    expect(far.cutoff).toBeLessThan(near.cutoff);
    expect(far.gain).toBe(near.gain);
    expect(occlusion('floor', 'west', 1, shut)).toEqual(occlusion('west', 'floor', 1, shut)); // both ways the same
  });
});
