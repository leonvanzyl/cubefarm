import { describe, expect, it } from 'vitest';
import { floorElevation } from '../layout';
import { CAR_RANGE, carPose, carRoutes, CITY, cityLayout, CORRIDOR_HALF, HOME_FOOTPRINT, MAX_CARS, waterTowers, type CityBox } from './cityLayout';

const city = cityLayout();
const everything = (c = city): CityBox[] => [...c.buildings, ...c.boxes, ...c.cylinders, ...c.cones];
const overlaps = (aMin: number, aMax: number, bMin: number, bMax: number) => aMin < bMax && bMin < aMax;

describe('cityLayout', () => {
  it('builds the same city from the same seed, and another from another seed', () => {
    expect(cityLayout()).toEqual(city);
    expect(cityLayout(CITY.seed)).toEqual(cityLayout(CITY.seed));
    expect(cityLayout(CITY.seed + 1).buildings).not.toEqual(city.buildings);
  });

  it('is a city: hundreds of buildings, a park, landmarks and roofs, on a grid of streets', () => {
    expect(city.buildings.length).toBeGreaterThan(200);
    expect(city.buildings.length).toBeLessThan(1500);
    expect(city.parks.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...city.buildings.map((b) => b.y + b.h))).toBeGreaterThan(150);
    expect(city.cones.length).toBeGreaterThan(10);
    expect(city.streetsX.length).toBe(2 * (CITY.rings + 1));
    for (const b of city.buildings) {
      expect(b.lit).toBeGreaterThanOrEqual(0);
      expect(b.lit).toBeLessThanOrEqual(1);
      expect(Number.isInteger(b.pattern) && b.pattern >= 0 && b.pattern < 16).toBe(true);
    }
  });

  it('keeps a clear gap around our building', () => {
    const hx = HOME_FOOTPRINT.halfX + CITY.gap;
    const hz = HOME_FOOTPRINT.halfZ + CITY.gap;
    for (const b of everything()) {
      const inGap = overlaps(b.x - b.w / 2, b.x + b.w / 2, -hx, hx) && overlaps(b.z - b.d / 2, b.z + b.d / 2, -hz, hz);
      expect(inGap, `${JSON.stringify(b)} is inside the gap`).toBe(false);
    }
  });

  it('puts nothing on a street or its pavements', () => {
    for (const b of everything()) {
      for (const sx of city.streetsX) expect(overlaps(b.x - b.w / 2, b.x + b.w / 2, sx - CORRIDOR_HALF, sx + CORRIDOR_HALF), `x street ${sx}`).toBe(false);
      for (const sz of city.streetsZ) expect(overlaps(b.z - b.d / 2, b.z + b.d / 2, sz - CORRIDOR_HALF, sz + CORRIDOR_HALF), `z street ${sz}`).toBe(false);
    }
  });

  it('keeps the streets clear of our block', () => {
    expect(Math.min(...city.streetsX.map(Math.abs)) - CORRIDOR_HALF).toBeGreaterThanOrEqual(HOME_FOOTPRINT.halfX);
    expect(Math.min(...city.streetsZ.map(Math.abs)) - CORRIDOR_HALF).toBeGreaterThanOrEqual(HOME_FOOTPRINT.halfZ);
  });

  it('puts the lobby at street level and the floors above it', () => {
    expect(floorElevation(0)).toBe(0);
    expect(floorElevation(3)).toBeGreaterThan(floorElevation(1));
  });
});

describe('cars', () => {
  const cars = carRoutes();
  const pose = { x: 0, z: 0, yaw: 0 };

  it('has a dozen at most, the same every visit, one per lane', () => {
    expect(cars.length).toBeLessThanOrEqual(MAX_CARS);
    expect(carRoutes()).toEqual(cars);
    const lanes = cars.map((c) => `${c.axis}${c.line}${c.dir}`);
    expect(new Set(lanes).size).toBe(lanes.length);
  });

  it('drive on the road, on their own side, and wrap around within range', () => {
    for (const car of cars) {
      expect(car.axis === 'z' ? city.streetsX : city.streetsZ).toContain(car.line);
      for (let t = 0; t < 400; t += 3.7) {
        carPose(car, t, pose);
        const across = car.axis === 'z' ? pose.x - car.line : pose.z - car.line;
        const along = car.axis === 'z' ? pose.z : pose.x;
        expect(Math.abs(across) + car.w / 2).toBeLessThan(CITY.roadHalf);
        expect(Math.sign(across)).toBe(car.axis === 'z' ? -car.dir : car.dir);
        expect(Math.abs(along)).toBeLessThanOrEqual(CAR_RANGE);
        // yaw turns +z towards the way it drives
        const hx = Math.sin(pose.yaw);
        const hz = Math.cos(pose.yaw);
        expect(car.axis === 'z' ? hz : hx).toBeCloseTo(car.dir);
      }
    }
  });

  it('move forward over time', () => {
    const car = cars[0];
    const a = carPose(car, 0, { x: 0, z: 0, yaw: 0 });
    const b = carPose(car, 1, { x: 0, z: 0, yaw: 0 });
    const da = car.axis === 'z' ? b.z - a.z : b.x - a.x;
    expect(da * car.dir).toBeCloseTo(car.speed);
  });
});

describe('waterTowers', () => {
  it('finds every roof water tower, with its stand, tank and hat', () => {
    const layout = cityLayout();
    const towers = waterTowers(layout);
    expect(towers.length).toBeGreaterThan(5);
    for (const t of towers) {
      expect(layout.boxes[t.box]).toMatchObject({ x: t.x, z: t.z, y: t.y });
      expect(layout.cylinders[t.cylinder]).toMatchObject({ x: t.x, z: t.z, y: t.y + 1.6 });
      expect(layout.cones[t.cone]).toMatchObject({ x: t.x, z: t.z });
      expect(t.y).toBeGreaterThan(5); // on a roof
    }
  });
});
