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

/** The shell every floor shares: outer walls (with the elevator doorway) and the elevator cabin. */
export function shellColliders(): Rect[] {
  const t = 0.4;
  const { doorHalf, cabinHalf, depth } = ELEVATOR;
  return [
    { minX: -HALF_W - t, maxX: HALF_W + t, minZ: -HALF_D - t, maxZ: -HALF_D }, // north
    { minX: -HALF_W - t, maxX: -HALF_W, minZ: -HALF_D, maxZ: HALF_D }, // west
    { minX: HALF_W, maxX: HALF_W + t, minZ: -HALF_D, maxZ: HALF_D }, // east
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

export function officeColliders(): Rect[] {
  const out = shellColliders();
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
  out.push(gongRect());
  out.push(rect(HALF_W - 0.45, 7.4, 0.9, 5, SOLID_H.kitchen)); // kitchenette counter + fridge
  out.push(rect(HALF_W - 0.5, -9.5, 0.7, 0.7, SOLID_H.cooler)); // water cooler
  return out;
}

// ---------- lobby / HQ (floor 0) ----------

export const MANAGER_ROOM = { minX: -HALF_W, maxX: -6.5, minZ: -HALF_D, maxZ: -3.5, doorMinX: -11, doorMaxX: -9.2 };
export const MANAGER_DESK = { x: -11.2, z: -8.6, w: 2.6, d: 1.1 };
export const RECEPTION = { x: 3, z: -3.5, w: 5, d: 1.2 };
// The CEO's corner office mirrors the manager's across the lobby; the trophy cabinet ends up behind their desk.
export const CEO_ROOM = { minX: 6.5, maxX: HALF_W, minZ: -HALF_D, maxZ: -3.5, doorMinX: 8.2, doorMaxX: 10 };
export const CEO_DESK = { x: 12, z: -7.4 };
// Candidates the CEO wants to hire wait on a row of chairs along the east wall, facing into the lobby.
export const WAITING = { x: HALF_W - 1.4, seats: [6.6, 7.9, 9.2, 10.4] };
export const WAITING_ROTATION = Math.PI / 2;
// The big rug in front of reception; the manager's and CEO's offices are carpeted wall to wall.
export const LOBBY_RUG = rect(3, 3, 14, 9);
// The lobby's coffee corner: a short counter against the south wall, east of the elevator and the directory, in
// view of the waiting sofa. w runs along the wall, d sticks out into the room; the machine and mugs face north.
export const COFFEE_CORNER = { x: 9.8, w: 1.5, d: 0.9 };
export const coffeeCorner = (): Rect => rect(COFFEE_CORNER.x, HALF_D - COFFEE_CORNER.d / 2, COFFEE_CORNER.w, COFFEE_CORNER.d, SOLID_H.coffeeCorner);

export function lobbyColliders(): Rect[] {
  const out = shellColliders();
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
  out.push(rect(MANAGER_DESK.x, MANAGER_DESK.z, MANAGER_DESK.w, MANAGER_DESK.d, SOLID_H.desk));
  out.push(rect(MANAGER_DESK.x, MANAGER_DESK.z - 1.1, 0.8, 0.8, SOLID_H.seated)); // manager chair
  out.push(rect(-HALF_W + 0.4, -8, 0.8, 5, SOLID_H.bookshelf)); // bookshelf
  out.push(blasterRack(BLASTER_RACK.lobbyX));
  out.push(rect(RECEPTION.x, RECEPTION.z, RECEPTION.w, RECEPTION.d, SOLID_H.reception));
  out.push(rect(11.5, 4, 3.2, 1, SOLID_H.couch)); // sofa
  out.push(rect(11.5, 6.2, 1.6, 0.9, SOLID_H.coffeeTable)); // table
  out.push(rect(12, -HALF_D + 0.55, 4.4, 1.1, SOLID_H.cabinet)); // trophy cabinet
  out.push(coffeeCorner()); // counter, coffee machine and mug dispenser
  return out;
}

// ---------- what's underfoot ----------

export type Surface = 'wood' | 'rug' | 'lobby' | 'cabin';

const OFFICE_RUGS: Rect[] = [...DESK_RUGS, QA_RUG];
const LOBBY_RUGS: Rect[] = [LOBBY_RUG, MANAGER_ROOM, CEO_ROOM];

/** The floor under (x, z), for footsteps. A rug's edge counts as rug; past the doorway is the elevator cabin. */
export function surfaceAt(floor: 'office' | 'lobby', x: number, z: number): Surface {
  if (z > HALF_D && Math.abs(x) <= ELEVATOR.cabinHalf) return 'cabin';
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
