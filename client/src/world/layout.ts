// Every floor of the building shares one footprint. Units are metres; -Z is "north".

export const FLOOR_W = 32; // x from -16 to 16
export const FLOOR_D = 24; // z from -12 to 12
export const WALL_H = 3.6;
export const HALF_W = FLOOR_W / 2;
export const HALF_D = FLOOR_D / 2;

export const EYE_HEIGHT = 1.65;
export const PLAYER_RADIUS = 0.3;

// Elevator sits behind a doorway in the middle of the south wall.
export const ELEVATOR = { doorHalf: 1.2, cabinHalf: 1.5, depth: 2.6, doorHeight: 2.5 };
export const SPAWN = { x: 0, z: HALF_D - 1.6, yaw: 0 };

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Height of the solid for the toy physics (collide() ignores it). Missing means full wall height. */
  h?: number;
}

export const rect = (cx: number, cz: number, w: number, d: number, h?: number): Rect => ({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h });

// How tall the furniture is, so toys can bounce off it (and land on it).
const SOLID_H = { desk: 0.78, seated: 1.3, board: 3.45, couch: 0.95, coffeeTable: 0.5, kitchen: 2, cooler: 1.5, bookshelf: 2.2, cabinet: 2.1, reception: 1.13, glass: 2.8, coffeeCorner: 1.55 };

// ---------- outside: windows, side doors and balconies ----------

type FloorKind = 'office' | 'lobby';
export type Side = 'west' | 'east';
export const SIDES: readonly Side[] = ['west', 'east'];
/** -1 for the west wall, 1 for the east one. */
export const sideSign = (side: Side) => (side === 'west' ? -1 : 1);

/** Storey height, floor to floor: a room (WALL_H) and the slab between floors. The lobby's floor is the ground. */
export const FLOOR_HEIGHT = 4.2;
/** How far floor `floor`'s floor is above the ground. */
export const floorElevation = (floor: number) => Math.max(0, floor) * FLOOR_HEIGHT;

/** The outer walls as drawn (Shell.tsx). Their colliders are SHELL_T thick. */
export const WALL_T = 0.3;
const SHELL_T = 0.4;

/** The side walls' windows: w wide along the wall, h tall, centred y up. */
export const WINDOW = { w: 4.4, h: 1.8, y: 1.95 };
/** A side wall's glass door: half its width and its height. */
export const SIDE_DOOR = { half: 0.9, h: 2.5 };
// Each side wall's door and windows, as z of their middles. Offices: west, between the desks' aisle and the couch;
// east, between the QA lab and the kitchenette. Lobby: west, south of the manager's office; east, between the CEO's
// office and the waiting room, past the sofa. Windows keep about where the old painted ones were, clear of the doors.
export const SIDE_OPENINGS: Record<FloorKind, Record<Side, { door: number; windows: number[] }>> = {
  office: { west: { door: -4.2, windows: [-8.5, 0, 8] }, east: { door: 3.55, windows: [-8, -2] } },
  lobby: { west: { door: 4.5, windows: [0, 8.5] }, east: { door: 2.6, windows: [-1] } },
};
/** A side door opens while the player is within `across` of its wall's middle and `along` of the doorway's middle. */
export const DOOR_SENSOR = { across: 2, along: 1.5 };

/**
 * A balcony runs along each side wall (the lobby's is a patio on the ground): `depth` out from the wall's outer face,
 * from minZ to maxZ, with a railing `rail` high and `railT` thick on the slab.
 */
export const BALCONY = { depth: 2.5, minZ: -11.2, maxZ: 11.2, rail: 1.05, railT: 0.1, slab: 0.25 };
const BALCONY_IN = HALF_W + WALL_T;
/** |x| of the balconies' outer edge. */
export const BALCONY_OUT = BALCONY_IN + BALCONY.depth;
/** The underside of the balcony above: how high toys can fly over a balcony, and where its lamps hang. */
export const BALCONY_TOP = FLOOR_HEIGHT - BALCONY.slab;
/** Lamps under the balcony above, along the middle of each balcony (y from the floor you're on), for the night lights. */
export const BALCONY_LIGHTS: { side: Side; x: number; y: number; z: number }[] = SIDES.flatMap((side) =>
  [-8, -2.7, 2.7, 8].map((z) => ({ side, x: sideSign(side) * (BALCONY_IN + BALCONY.depth / 2), y: BALCONY_TOP - 0.08, z })),
);

/** Spans [a, b] on side `side`, measured out from x = 0 (a < b), as minX/maxX. */
const across = (side: Side, a: number, b: number) => (side === 'west' ? { minX: -b, maxX: -a } : { minX: a, maxX: b });

/** A side wall's doorway, through the wall's collider: what the shut door fills. */
export function sideDoorway(kind: FloorKind, side: Side): Rect {
  const z = SIDE_OPENINGS[kind][side].door;
  return { ...across(side, HALF_W, HALF_W + SHELL_T), minZ: z - SIDE_DOOR.half, maxZ: z + SIDE_DOOR.half };
}

/** The balcony floor beyond side wall `side`, from under the doorway to the railing's outside. */
export const balconyFloor = (side: Side): Rect => ({ ...across(side, HALF_W, BALCONY_OUT), minZ: BALCONY.minZ, maxZ: BALCONY.maxZ });

/** A balcony's railing: along its outer edge and across both ends. Toys meet it right up to the balcony above. */
export function balconyRailing(side: Side): Rect[] {
  const { minZ, maxZ, railT } = BALCONY;
  return [
    { ...across(side, BALCONY_OUT - railT, BALCONY_OUT), minZ, maxZ, h: BALCONY_TOP },
    { ...across(side, BALCONY_IN - 0.1, BALCONY_OUT), minZ, maxZ: minZ + railT, h: BALCONY_TOP },
    { ...across(side, BALCONY_IN - 0.1, BALCONY_OUT), minZ: maxZ - railT, maxZ, h: BALCONY_TOP },
  ];
}

export const PLANTER = { w: 0.55, l: 1.8, h: 0.55 };
export const BENCH = { w: 0.6, l: 1.8, h: 0.85 };

/** On each balcony: a planter against the railing near each end, and a bench against the wall looking out, 3.6 m from the door. */
export function balconyFurniture(kind: FloorKind, side: Side): { planters: Rect[]; bench: Rect } {
  const door = SIDE_OPENINGS[kind][side].door;
  const x = across(side, BALCONY_OUT - BALCONY.railT - PLANTER.w, BALCONY_OUT - BALCONY.railT);
  const pz = BALCONY.maxZ - 1.3;
  const bz = door - 3.6 * Math.sign(door || 1);
  return {
    planters: [-pz, pz].map((z) => ({ ...x, minZ: z - PLANTER.l / 2, maxZ: z + PLANTER.l / 2, h: PLANTER.h })),
    bench: { ...across(side, BALCONY_IN, BALCONY_IN + BENCH.w), minZ: bz - BENCH.l / 2, maxZ: bz + BENCH.l / 2, h: BENCH.h },
  };
}

/** Both balconies' railings, planters and benches. */
export function outsideColliders(kind: FloorKind): Rect[] {
  return SIDES.flatMap((side) => {
    const { planters, bench } = balconyFurniture(kind, side);
    return [...balconyRailing(side), ...planters, bench];
  });
}

/** Which side the player at (x, z) is out on, past the middle of a side wall; null when inside. */
export const outsideAt = (x: number): Side | null => (Math.abs(x) <= HALF_W + WALL_T / 2 ? null : x < 0 ? 'west' : 'east');

/** Inside the walls, in a side doorway or on a balcony: everywhere a toy may be. */
export const inBuilding = (x: number, z: number) =>
  (Math.abs(x) <= HALF_W && Math.abs(z) <= HALF_D) || (Math.abs(x) <= BALCONY_OUT && z >= BALCONY.minZ && z <= BALCONY.maxZ);

/**
 * Whether (x, y, z) is on a surface only toys meet, where a dart doesn't stick: the elevator doorway, a side doorway
 * (its door slides away) or the screen above a balcony's railing.
 */
export function toyOnlyAt(kind: FloorKind, x: number, y: number, z: number) {
  const e = elevatorDoorway();
  if (x > e.minX && x < e.maxX && z > e.minZ - 0.05) return true;
  const ax = Math.abs(x);
  const door = SIDE_OPENINGS[kind][x < 0 ? 'west' : 'east'].door;
  if (ax > HALF_W - 0.05 && ax < HALF_W + SHELL_T + 0.05 && Math.abs(z - door) < SIDE_DOOR.half + 0.05) return true;
  return ax > HALF_W + SHELL_T + 0.05 && y > BALCONY.rail + 0.05;
}

/** The shell every floor shares: outer walls (with the elevator doorway and a side door each way) and the elevator cabin. */
export function shellColliders(kind: FloorKind = 'office'): Rect[] {
  const t = SHELL_T;
  const { doorHalf, cabinHalf, depth } = ELEVATOR;
  const side = (s: Side) => {
    const d = sideDoorway(kind, s);
    return [
      { minX: d.minX, maxX: d.maxX, minZ: -HALF_D, maxZ: d.minZ },
      { minX: d.minX, maxX: d.maxX, minZ: d.maxZ, maxZ: HALF_D },
    ];
  };
  return [
    { minX: -HALF_W - t, maxX: HALF_W + t, minZ: -HALF_D - t, maxZ: -HALF_D }, // north
    ...side('west'),
    ...side('east'),
    { minX: -HALF_W, maxX: -doorHalf, minZ: HALF_D, maxZ: HALF_D + t }, // south, left of door
    { minX: doorHalf, maxX: HALF_W, minZ: HALF_D, maxZ: HALF_D + t }, // south, right of door
    { minX: -cabinHalf - t, maxX: -cabinHalf, minZ: HALF_D, maxZ: HALF_D + depth }, // cabin sides
    { minX: cabinHalf, maxX: cabinHalf + t, minZ: HALF_D, maxZ: HALF_D + depth },
    { minX: -cabinHalf, maxX: cabinHalf, minZ: HALF_D + depth, maxZ: HALF_D + depth + t }, // cabin back
  ];
}

/** Fills the elevator doorway for toys only, so nothing rolls into the cabin. The player walks straight through. */
export const elevatorDoorway = (): Rect => ({ minX: -ELEVATOR.doorHalf, maxX: ELEVATOR.doorHalf, minZ: HALF_D, maxZ: HALF_D + 0.4 });

// ---------- office floors ----------

export const DESK_COLS = [-10.5, -3.5, 3.5, 10.5];
export const DESK_ROWS = [-6.2, -1.6, 3.0];
export const MAX_DESKS = DESK_COLS.length * DESK_ROWS.length;

export const DESK = { w: 1.9, d: 0.95, h: 0.74 };

/** One long rug under each row of desks (and their chairs). */
export const DESK_RUGS: Rect[] = DESK_ROWS.map((z) => rect(0, z + 0.35, 24.4, 2.9));

/** Desks fill from the row nearest the elevator, so a new team is visible as soon as you arrive. */
export function deskPosition(slot: number) {
  const row = DESK_ROWS.length - 1 - (Math.floor(slot / DESK_COLS.length) % DESK_ROWS.length);
  const col = slot % DESK_COLS.length;
  return { x: DESK_COLS[col], z: DESK_ROWS[row] };
}

export const BOARD = { w: 12, h: 3.0, y: 0.45, z: -HALF_D + 0.06 };

// The floor's app monitor: a wall-mounted screen on the north wall, west of the whiteboard. x and y are picked
// for the clearest line of sight from the elevator past the desks' monitors and name tags (lined up with the
// west desk column, the front row's desk hides it). y is the centre of the picture; depth is how far the bezel
// sticks out from the wall.
export const APP_SCREEN = { x: -13.7, y: 2.25, w: 3.2, h: 1.8, bezel: 0.09, depth: 0.12 };

// The foam blaster rack stands against the south wall: on office floors west of the floor sign near the couch,
// in the lobby in the south-west corner (clear of the basketball hoop further east). d is how far it sticks out.
export const BLASTER_RACK = { officeX: -10, lobbyX: -12.9, w: 1.3, d: 0.3, h: 1.85 };
export const blasterRack = (x: number): Rect => rect(x, HALF_D - BLASTER_RACK.d / 2, BLASTER_RACK.w, BLASTER_RACK.d, BLASTER_RACK.h);

// Every floor's jukebox stands against the south wall, facing into the room: on office floors in the lounge corner
// between the couch's plant and the blaster rack, in the lobby between the floor directory and the coffee corner
// (with room to walk round the counter).
export const JUKEBOX = { officeX: -12.6, lobbyX: 7, w: 1, d: 0.6, h: 1.62 };
export const jukeboxRect = (x: number): Rect => rect(x, HALF_D - JUKEBOX.d / 2, JUKEBOX.w, JUKEBOX.d, JUKEBOX.h);

// The merge gong stands against the north wall between the whiteboard's plant and the wall clock's, its disc facing
// the room: a frame w wide and h tall on feet d deep (centred on x, z), with a disc of radius r hanging centred at
// y. It stays below the clock. Its solid reaches back to the wall, so nothing gets trapped behind it.
export const GONG = { x: -8.85, z: -11.3, w: 2.3, d: 0.9, h: 2.35, r: 0.72, y: 1.3 };
export const gongRect = (): Rect => ({ minX: GONG.x - GONG.w / 2, maxX: GONG.x + GONG.w / 2, minZ: -HALF_D, maxZ: GONG.z + GONG.d / 2, h: GONG.h });
/** Where you stand to hit the gong (facing north): part 2 walks a merged PR's author here. */
export const GONG_SPOT = { x: GONG.x, z: GONG.z + GONG.d / 2 + 0.9 };

// The QA lab: test stations along the east wall. Testers face the wall, with their backs to the room.
export const QA_LAB = { x: HALF_W - 2.0, stations: [-5.2, -2.0, 1.2] };
export const QA_ROTATION = -Math.PI / 2;
export const qaDeskPosition = (slot: number) => ({ x: QA_LAB.x, z: QA_LAB.stations[slot % QA_LAB.stations.length] });
export const QA_RUG = rect(QA_LAB.x - 0.4, -2, 3.4, 10.4);

// ---------- decorations (#210) ----------

/**
 * Where each of a floor's decoration slots (shared/progress.ts) is, and the most room an item there may take. x, z:
 * the slot's anchor: its middle, or with `back` the middle of its back edge against the wall. rotY turns an item's
 * front (local +z) to face the room. w x d: the biggest footprint allowed (local x by local z), kept clear of desks,
 * walkways, the whiteboard and the elevator (layout.test.ts checks); wall slots hang at y and are w wide.
 */
export interface DecorSpot {
  x: number;
  z: number;
  rotY: number;
  w: number;
  d: number;
  y?: number;
  back?: boolean;
}

const FACE = { south: 0, east: Math.PI / 2, north: Math.PI, west: -Math.PI / 2 };
export const DECOR_SLOT_AT: Record<string, DecorSpot> = {
  // walls: above the big west slot, either side of the elevator above the blaster rack and the arcade's slot, past
  // the "ship it" sign, and over the kitchenette counter
  'w-west': { x: -HALF_W + 0.02, z: 3.6, rotY: FACE.east, y: 2.5, w: 2.6, d: 0.1 },
  'w-south-w': { x: -8, z: HALF_D - 0.02, rotY: FACE.north, y: 2.45, w: 2.5, d: 0.1 },
  'w-south-e': { x: 8.4, z: HALF_D - 0.02, rotY: FACE.north, y: 2.45, w: 2.6, d: 0.1 },
  'w-north-e': { x: 13.6, z: -HALF_D + 0.02, rotY: FACE.south, y: 2.2, w: 2.8, d: 0.1 },
  'w-kitchen': { x: HALF_W - 0.02, z: 6.9, rotY: FACE.west, y: 2.45, w: 2.6, d: 0.1 },
  // corners and quiet stretches of wall
  'f-ne': { x: 15.2, z: -11.2, rotY: FACE.south, w: 0.9, d: 0.9 },
  'f-se': { x: 13.3, z: 11.25, rotY: FACE.north, w: 0.9, d: 0.9 },
  'f-sw': { x: -14.8, z: 9.8, rotY: FACE.east, w: 0.9, d: 0.9 },
  'f-west': { x: -15.25, z: -6, rotY: FACE.east, w: 0.9, d: 0.9 },
  // the west wall south of its window, the lounge west of the elevator, and the south wall east of it
  'b-west': { x: -HALF_W, z: 3.6, rotY: FACE.east, back: true, w: 2.4, d: 1.3 },
  'b-lounge': { x: -7, z: 8.4, rotY: FACE.east, w: 2.4, d: 1.4 },
  'b-south': { x: 7.4, z: HALF_D, rotY: FACE.north, back: true, w: 2.4, d: 1.3 },
  // under the lounge, and in front of the elevator
  'r-lounge': { x: -7, z: 8.4, rotY: FACE.east, w: 3.6, d: 2.6 },
  'r-entry': { x: 0, z: 8.7, rotY: FACE.south, w: 3.2, d: 2 },
};

/** The floor's decor box, against the south wall east of the elevator: bought decorations wait in it. */
export const DECOR_BOX = { x: 3.4, z: HALF_D - 0.3, w: 0.8, d: 0.55, h: 0.6 };
export const decorBoxRect = (): Rect => rect(DECOR_BOX.x, DECOR_BOX.z, DECOR_BOX.w, DECOR_BOX.d, DECOR_BOX.h);

export function officeColliders(): Rect[] {
  const out = [...shellColliders('office'), ...outsideColliders('office')];
  for (let s = 0; s < MAX_DESKS; s++) {
    const { x, z } = deskPosition(s);
    out.push(rect(x, z, DESK.w + 0.1, DESK.d + 0.1, SOLID_H.desk));
    out.push(rect(x, z + 0.8, 0.7, 0.6, SOLID_H.seated)); // chair + occupant
  }
  for (const z of QA_LAB.stations) {
    out.push(rect(QA_LAB.x, z, DESK.d + 0.1, DESK.w + 0.1, SOLID_H.desk)); // rotated desk
    out.push(rect(QA_LAB.x - 0.8, z, 0.6, 0.7, SOLID_H.seated)); // chair + tester
  }
  out.push(rect(0, -HALF_D + 0.25, BOARD.w + 0.4, 0.5, SOLID_H.board)); // whiteboard + marker tray
  const a = APP_SCREEN;
  out.push(rect(a.x, -HALF_D + a.depth / 2, a.w + a.bezel * 2, a.depth, a.y + a.h / 2 + a.bezel)); // app monitor, up to its top bezel
  out.push(rect(-HALF_W + 0.9, 6.5, 1.1, 3.2, SOLID_H.couch)); // couch
  out.push(rect(-HALF_W + 2.6, 6.5, 0.9, 1.4, SOLID_H.coffeeTable)); // coffee table
  out.push(blasterRack(BLASTER_RACK.officeX));
  out.push(jukeboxRect(JUKEBOX.officeX));
  out.push(gongRect());
  out.push(rect(HALF_W - 0.45, 7.4, 0.9, 5, SOLID_H.kitchen)); // kitchenette counter + fridge
  out.push(rect(HALF_W - 0.5, -9.5, 0.7, 0.7, SOLID_H.cooler)); // water cooler
  out.push(decorBoxRect());
  return out;
}

// ---------- lobby / HQ (floor 0) ----------

export const MANAGER_ROOM = { minX: -HALF_W, maxX: -6.5, minZ: -HALF_D, maxZ: -3.5, doorMinX: -11, doorMaxX: -9.2 };
export const MANAGER_DESK = { x: -11.2, z: -8.6, w: 2.6, d: 1.1 };
export const RECEPTION = { x: 3, z: -3.5, w: 5, d: 1.2 };
// The CEO's corner office mirrors the manager's across the lobby; the trophy cabinet ends up behind their desk.
export const CEO_ROOM = { minX: 6.5, maxX: HALF_W, minZ: -HALF_D, maxZ: -3.5, doorMinX: 8.2, doorMaxX: 10 };
export const CEO_DESK = { x: 12, z: -7.4 };
// Candidates the CEO wants to hire wait on six chairs along the east wall, facing into the lobby, three either side of
// a little coffee table, between the sofa and the corner plant. Declined, they leave by the glass door just north.
export const WAITING = { x: HALF_W - 1.4, seats: [4.7, 5.65, 6.6, 8.5, 9.45, 10.4] };
export const WAITING_ROTATION = Math.PI / 2;
export const WAITING_TABLE = { x: HALF_W - 1.4, z: 7.55, w: 0.62, d: 0.9 };
// The big rug in front of reception; the manager's and CEO's offices are carpeted wall to wall.
export const LOBBY_RUG = rect(3, 3, 14, 9);
// The lobby's coffee corner: a short counter against the south wall, east of the elevator and the directory, in
// view of the waiting sofa. w runs along the wall, d sticks out into the room; the machine and mugs face north.
export const COFFEE_CORNER = { x: 9.8, w: 1.5, d: 0.9 };
export const coffeeCorner = (): Rect => rect(COFFEE_CORNER.x, HALF_D - COFFEE_CORNER.d / 2, COFFEE_CORNER.w, COFFEE_CORNER.d, SOLID_H.coffeeCorner);
// The rewards corner (#210): the catalogue kiosk out in the lobby west of reception, facing the elevator, and the
// trophy shelf against the south wall west of the elevator (facing north, clear of the hoop), seen as you step out.
export const KIOSK = { x: -4.8, z: -2.2, w: 0.9, d: 0.7, h: 1.75 };
export const TROPHY_SHELF = { x: -6, z: HALF_D - 0.25, w: 2.2, d: 0.5, h: 2.1 };

/**
 * Mission control: a curved bank of screens on the lobby's north wall between the two glass offices, behind reception
 * and over the roomba's dock. Three columns, a top and a bottom screen each (y: their middles), stand on an arc of
 * radius r whose middle touches the wall `off` out; colW wide with `gap` between. A header strip with the alarm
 * beacon hangs above them, flat on the wall.
 */
export const MISSION = {
  x: -3.5,
  r: 6.5,
  off: 0.14,
  colW: 1.7,
  gap: 0.09,
  top: { y: 2.5, h: 1.0 },
  bottom: { y: 1.53, h: 0.82 },
  strip: { y: 3.2, w: 3.6, h: 0.3 },
};

/** Where mission control's column i (-1 west, 0 middle, 1 east) stands, and its turn (about y) to face the arc's centre. */
export function missionColumn(i: number) {
  const t = (i * (MISSION.colW + MISSION.gap)) / MISSION.r;
  return { x: MISSION.x + MISSION.r * Math.sin(t), z: -HALF_D + MISSION.off + MISSION.r * (1 - Math.cos(t)), rotY: -t };
}

/** The outer columns curve out into the room, so they're solid; the middle one hangs flat on the wall, over the dock. */
export function missionRects(): Rect[] {
  return [-1, 1].map((i) => {
    const c = missionColumn(i);
    const dx = (MISSION.colW / 2) * Math.cos(c.rotY);
    const dz = (MISSION.colW / 2) * Math.abs(Math.sin(c.rotY));
    return { minX: c.x - dx, maxX: c.x + dx, minZ: -HALF_D, maxZ: c.z + dz + 0.08, h: MISSION.strip.y + MISSION.strip.h / 2 };
  });
}

export function lobbyColliders(): Rect[] {
  const out = [...shellColliders('lobby'), ...outsideColliders('lobby')];
  const m = MANAGER_ROOM;
  const t = 0.12;
  out.push({ minX: m.maxX - t, maxX: m.maxX + t, minZ: m.minZ, maxZ: m.maxZ, h: SOLID_H.glass }); // glass east wall
  out.push({ minX: m.minX, maxX: m.doorMinX, minZ: m.maxZ - t, maxZ: m.maxZ + t, h: SOLID_H.glass }); // glass south wall, west of door
  out.push({ minX: m.doorMaxX, maxX: m.maxX, minZ: m.maxZ - t, maxZ: m.maxZ + t, h: SOLID_H.glass }); // east of door
  const c = CEO_ROOM;
  out.push({ minX: c.minX - t, maxX: c.minX + t, minZ: c.minZ, maxZ: c.maxZ, h: SOLID_H.glass }); // CEO glass west wall
  out.push({ minX: c.minX, maxX: c.doorMinX, minZ: c.maxZ - t, maxZ: c.maxZ + t, h: SOLID_H.glass }); // south wall, west of door
  out.push({ minX: c.doorMaxX, maxX: c.maxX, minZ: c.maxZ - t, maxZ: c.maxZ + t, h: SOLID_H.glass }); // east of door
  out.push(rect(CEO_DESK.x, CEO_DESK.z, DESK.w + 0.1, DESK.d + 0.1, SOLID_H.desk));
  out.push(rect(CEO_DESK.x, CEO_DESK.z + 0.8, 0.7, 0.6, SOLID_H.seated)); // CEO chair
  for (const z of WAITING.seats) out.push(rect(WAITING.x, z, 0.7, 0.7, SOLID_H.seated));
  out.push(rect(WAITING_TABLE.x, WAITING_TABLE.z, WAITING_TABLE.w, WAITING_TABLE.d, SOLID_H.coffeeTable));
  out.push(rect(MANAGER_DESK.x, MANAGER_DESK.z, MANAGER_DESK.w, MANAGER_DESK.d, SOLID_H.desk));
  out.push(rect(MANAGER_DESK.x, MANAGER_DESK.z - 1.1, 0.8, 0.8, SOLID_H.seated)); // manager chair
  out.push(rect(-HALF_W + 0.4, -8, 0.8, 5, SOLID_H.bookshelf)); // bookshelf
  out.push(blasterRack(BLASTER_RACK.lobbyX));
  out.push(jukeboxRect(JUKEBOX.lobbyX));
  out.push(rect(RECEPTION.x, RECEPTION.z, RECEPTION.w, RECEPTION.d, SOLID_H.reception));
  out.push(rect(11.5, 4, 3.2, 1, SOLID_H.couch)); // sofa
  out.push(rect(11.5, 6.2, 1.6, 0.9, SOLID_H.coffeeTable)); // table
  out.push(rect(12, -HALF_D + 0.55, 4.4, 1.1, SOLID_H.cabinet)); // trophy cabinet
  out.push(coffeeCorner()); // counter, coffee machine and mug dispenser
  out.push(...missionRects());
  out.push(rect(KIOSK.x, KIOSK.z, KIOSK.w, KIOSK.d, KIOSK.h));
  out.push(rect(TROPHY_SHELF.x, TROPHY_SHELF.z, TROPHY_SHELF.w, TROPHY_SHELF.d, TROPHY_SHELF.h));
  return out;
}

// ---------- the roof terrace (roof/Roof.tsx) ----------

/** The roof's stop on the elevator (store.floor): always above the top floor, however many floors there are. */
export const ROOF = -1;
/** How far the roof deck is above the ground, for a building whose top floor is `top`. */
export const roofElevation = (top: number) => (Math.max(0, top) + 1) * FLOOR_HEIGHT;
/** How far the floor you're on (a floor number, or ROOF) is above the ground. */
export const viewElevation = (floor: number, top: number) => (floor === ROOF ? roofElevation(top) : floorElevation(floor));

/** The deck runs out to the walls' outer faces; a parapet `t` thick with a rail `h` high goes all round its edge. */
export const ROOF_EDGE = { x: HALF_W + WALL_T, z: HALF_D + WALL_T, t: 0.3, parapet: 0.5, h: 1.1 };
// The hut over the elevator shaft (and the stairs, west of it) stands on the south edge with its back out over the
// street, like the cabin on every floor: its front wall holds the elevator's doorway (the same as every floor's).
export const ROOF_HUT = { minX: -4.6, maxX: 2.2, minZ: HALF_D, maxZ: HALF_D + ELEVATOR.depth + 0.4, h: 3.9, front: 0.3, stairX: -3.4 };
/** The lounge's wooden decking on the east half, under the string lights. */
export const DECKING: Rect = { minX: 2, maxX: HALF_W - 0.3, minZ: -6.2, maxZ: 8.6 };
/** Deck chairs in a row on the decking, facing north over the garden to downtown: x of each, z of their middles. */
export const DECK_CHAIRS = { xs: [4.4, 6.9, 9.4, 11.9], z: -2.4, w: 0.72, l: 1.3, h: 0.95 };
/** Where a deck chair's sitter sits (its seat, which faces north), and where they stand to sit down or get up. */
export const deckChairSeat = (i: number) => ({ x: DECK_CHAIRS.xs[i], z: DECK_CHAIRS.z + 0.05 });
export const deckChairFront = (i: number) => ({ x: DECK_CHAIRS.xs[i], z: DECK_CHAIRS.z - DECK_CHAIRS.l / 2 - 0.55 });
/** Little round tables between the chairs. */
export const SIDE_TABLES = [5.65, 10.65].map((x) => ({ x, z: DECK_CHAIRS.z - 0.1, r: 0.3 }));
/** The string lights' poles round the decking; the lights zigzag between the north and south rows. */
export const LIGHT_POLES = [2.3, 8.8, 15.3].flatMap((x) => [{ x, z: -5.9 }, { x, z: 8.3 }]);
export const POLE = { r: 0.07, h: 2.9 };
/** The barbecue grill (a kettle on legs, its side shelf `shelf` east of it) and the picnic table, at the decking's south end. */
export const GRILL = { x: 13.6, z: 6.4, r: 0.42, h: 0.95, shelf: 0.72 };
export const PICNIC = { x: 7.4, z: 5.4, w: 2.2, d: 1.9, h: 0.75 };
/** The telescope on its tripod in the north-east corner, towards downtown; the eyepiece is `eye` up. */
export const TELESCOPE = { x: 12.8, z: -8.8, r: 0.45, eye: 1.5 };
/** The water tank on its stand in the north-west corner. */
export const WATER_TANK = { x: -13.2, z: -9.2, r: 1.35, legs: 2.2, h: 2.4 };
/** Raised garden beds along the north parapet, and two planters with little trees by the decking. */
export const GARDEN_BEDS: Rect[] = [rect(-7.4, -11.4, 6, 1.1, 0.6), rect(-0.6, -11.4, 5.4, 1.1, 0.6), rect(5.6, -11.4, 4.6, 1.1, 0.6)];
export const TREE_PLANTERS = [{ x: 1.3, z: -6.8 }, { x: 15.1, z: 9.8 }].map((p) => ({ ...p, w: 1.1, h: 0.6 }));
/** The helipad painted on the west half, kept clear (world events can land a helicopter here). */
export const HELIPAD = { x: -8.4, z: 1.2, r: 4.6 };
/** The windsock's pole by the west parapet, beside the helipad. */
export const WINDSOCK = { x: -15.2, z: 7.8, h: 3.4 };

/** The roof's colliders: the parapet all round, the hut and the cabin, and everything standing on the deck. */
export function roofColliders(): Rect[] {
  const { x: X, z: Z, t, h } = ROOF_EDGE;
  const { doorHalf, cabinHalf, depth } = ELEVATOR;
  const hut = ROOF_HUT;
  const out: Rect[] = [
    { minX: -X, maxX: X, minZ: -Z, maxZ: -Z + t, h }, // north parapet
    { minX: -X, maxX: -X + t, minZ: -Z, maxZ: Z, h }, // west
    { minX: X - t, maxX: X, minZ: -Z, maxZ: Z, h }, // east
    { minX: -X, maxX: hut.minX, minZ: Z - t, maxZ: Z, h }, // south, either side of the hut
    { minX: hut.maxX, maxX: X, minZ: Z - t, maxZ: Z, h },
    { minX: hut.minX, maxX: -doorHalf, minZ: HALF_D, maxZ: HALF_D + hut.front, h: hut.h }, // the hut's front, beside the doorway
    { minX: doorHalf, maxX: hut.maxX, minZ: HALF_D, maxZ: HALF_D + hut.front, h: hut.h },
    { minX: -cabinHalf - SHELL_T, maxX: -cabinHalf, minZ: HALF_D, maxZ: HALF_D + depth }, // the cabin, as on every floor
    { minX: cabinHalf, maxX: cabinHalf + SHELL_T, minZ: HALF_D, maxZ: HALF_D + depth },
    { minX: -cabinHalf, maxX: cabinHalf, minZ: HALF_D + depth, maxZ: HALF_D + depth + SHELL_T },
    rect(WATER_TANK.x, WATER_TANK.z, 2.7, 2.7, WATER_TANK.legs + WATER_TANK.h),
    ...GARDEN_BEDS,
    ...TREE_PLANTERS.map((p) => rect(p.x, p.z, p.w, p.w, p.h)),
    ...DECK_CHAIRS.xs.map((x) => rect(x, DECK_CHAIRS.z, DECK_CHAIRS.w, DECK_CHAIRS.l, DECK_CHAIRS.h)),
    ...SIDE_TABLES.map((s) => rect(s.x, s.z, s.r * 2, s.r * 2, 0.55)),
    ...LIGHT_POLES.map((p) => rect(p.x, p.z, POLE.r * 4, POLE.r * 4, POLE.h)),
    { minX: GRILL.x - GRILL.r - 0.05, maxX: GRILL.x + GRILL.shelf + 0.32, minZ: GRILL.z - GRILL.r - 0.05, maxZ: GRILL.z + GRILL.r + 0.4, h: GRILL.h }, // with its shelf, and its lid propped open behind
    rect(PICNIC.x, PICNIC.z, PICNIC.w, PICNIC.d, PICNIC.h),
    rect(TELESCOPE.x, TELESCOPE.z, TELESCOPE.r * 2, TELESCOPE.r * 2, TELESCOPE.eye),
    rect(WINDSOCK.x, WINDSOCK.z, 0.2, 0.2, WINDSOCK.h),
  ];
  return out;
}

// ---------- what's underfoot ----------

export type Surface = 'wood' | 'rug' | 'lobby' | 'cabin';

const OFFICE_RUGS: Rect[] = [...DESK_RUGS, QA_RUG];
const LOBBY_RUGS: Rect[] = [LOBBY_RUG, MANAGER_ROOM, CEO_ROOM];

/** The floor under (x, z), for footsteps. A rug's edge counts as rug; past the doorway is the elevator cabin, and
 * outside, a balcony's (or the patio's) paving sounds like the lobby's tiles. On the roof, the decking is wood and
 * the rest is paving. */
export function surfaceAt(floor: 'office' | 'lobby' | 'roof', x: number, z: number): Surface {
  if (z > HALF_D && Math.abs(x) <= ELEVATOR.cabinHalf) return 'cabin';
  if (floor === 'roof') return x >= DECKING.minX && x <= DECKING.maxX && z >= DECKING.minZ && z <= DECKING.maxZ ? 'wood' : 'lobby';
  if (Math.abs(x) > HALF_W) return 'lobby';
  for (const r of floor === 'lobby' ? LOBBY_RUGS : OFFICE_RUGS) {
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return 'rug';
  }
  return floor === 'lobby' ? 'lobby' : 'wood';
}

/** Push a circle out of any rects it overlaps (cheap, axis-separated). */
export function collide(x: number, z: number, rects: Rect[], r = PLAYER_RADIUS): { x: number; z: number } {
  for (let pass = 0; pass < 2; pass++) {
    for (const b of rects) {
      const minX = b.minX - r;
      const maxX = b.maxX + r;
      const minZ = b.minZ - r;
      const maxZ = b.maxZ + r;
      if (x <= minX || x >= maxX || z <= minZ || z >= maxZ) continue;
      const pushes = [minX - x, maxX - x, minZ - z, maxZ - z];
      const abs = pushes.map(Math.abs);
      const i = abs.indexOf(Math.min(...abs));
      if (i < 2) x += pushes[i];
      else z += pushes[i];
    }
  }
  return { x, z };
}
