import { describe, expect, it } from 'vitest';
import {
  bouncesOf,
  forecast,
  fromOwn,
  halfAt,
  isSmash,
  onHalf,
  otherEnd,
  ownFrame,
  PONG,
  serveShot,
  sidespinOf,
  solveShot,
  spinFor,
  swingShot,
  TABLE,
  tableBounce,
  topspinOf,
  type BallState,
  type End,
  type V3,
} from './pongPhysics';

const TOP = TABLE.top;
const near = (a: number, b: number, by: number) => Math.abs(a - b) <= by;
/** Where a ball from `b` comes down first. */
const firstBounce = (b: BallState) => bouncesOf(b, 1).bounces[0] ?? null;

describe('the two halves', () => {
  it("measures from each player's end line, to their right", () => {
    for (const end of ['west', 'east'] as End[]) {
      const p = fromOwn(end, 0.4, 0.3);
      const o = ownFrame(end, p.x, p.z);
      expect(o.back).toBeCloseTo(0.4);
      expect(o.lat).toBeCloseTo(0.3);
      expect(halfAt(fromOwn(end, -0.2, 0).x)).toBe(end); // just over their own end of the table
    }
    // the west player looks east (+x), so their right is +z; the east player's is -z
    expect(fromOwn('west', 0, 1).z).toBeGreaterThan(TABLE.z);
    expect(fromOwn('east', 0, 1).z).toBeLessThan(TABLE.z);
    expect(onHalf('east', 0.5, 0.2)).toEqual({ x: TABLE.x + 0.5, z: TABLE.z + 0.2 }); // the west player aiming right
    expect(otherEnd('west')).toBe('east');
  });
});

describe('spin', () => {
  it('reads back the topspin and sidespin it was given', () => {
    const d = { x: -0.8, z: 0.6 };
    const w = spinFor(d, 240, -90);
    const b = { v: { x: d.x * 5, y: 0.5, z: d.z * 5 }, w };
    expect(topspinOf(b)).toBeCloseTo(240);
    expect(sidespinOf(b)).toBeCloseTo(-90);
  });

  it('dips a topspin ball, floats a backspun one and curves a sidespun one, with gravity as it should be', () => {
    const at: V3 = { x: TABLE.x - 3, y: 3, z: TABLE.z };
    const after = (w: V3) => {
      let p: V3 = at;
      forecast({ p: at, v: { x: 6, y: 0, z: 0 }, w }, (s, t) => ((p = { ...s.p }), t >= 0.3 - 1e-9), 1);
      return p;
    };
    const flat = after({ x: 0, y: 0, z: 0 });
    // no spin: dropped about g t² / 2 (a little less: drag also slows the fall, a little)
    expect(near(at.y - flat.y, 0.5 * PONG.gravity * 0.09, 0.03)).toBe(true);
    expect(after(spinFor({ x: 1, z: 0 }, 300, 0)).y).toBeLessThan(flat.y - 0.08);
    expect(after(spinFor({ x: 1, z: 0 }, -300, 0)).y).toBeGreaterThan(flat.y + 0.08);
    expect(after(spinFor({ x: 1, z: 0 }, 0, 200)).z).toBeGreaterThan(flat.z + 0.08); // right of +x is +z
    expect(after(spinFor({ x: 1, z: 0 }, 0, -200)).z).toBeLessThan(flat.z - 0.08);
  });
});

describe('the bounce off the table', () => {
  const bounce = (v: V3, w: V3) => {
    const nv = { ...v };
    const nw = { ...w };
    tableBounce(nv, nw);
    return { v: nv, w: nw };
  };

  it('sends the ball back up with most of its speed into the table', () => {
    const { v } = bounce({ x: 0, y: -3, z: 0 }, { x: 0, y: 0, z: 0 });
    expect(v.y).toBeCloseTo(3 * PONG.ball.bounce);
    expect(v.x).toBeCloseTo(0);
  });

  it('kicks a topspin ball on, checks a backspun one, and takes some spin off', () => {
    const v = { x: 5, y: -3, z: 0 };
    const plain = bounce(v, { x: 0, y: 0, z: 0 }).v.x;
    const top = bounce(v, spinFor({ x: 1, z: 0 }, 300, 0));
    const back = bounce(v, spinFor({ x: 1, z: 0 }, -300, 0));
    expect(plain).toBeLessThan(5); // the table's grip slows a ball with no spin a little
    expect(top.v.x).toBeGreaterThan(plain + 0.3);
    expect(back.v.x).toBeLessThan(plain - 0.15);
    expect(Math.abs(topspinOf({ v: back.v, w: back.w }))).toBeLessThan(300);
  });

  it('leaves a ball that is already rolling alone', () => {
    const r = PONG.ball.r;
    const w = spinFor({ x: 1, z: 0 }, 4 / r, 0); // the bottom of the ball isn't moving over the table
    const { v } = bounce({ x: 4, y: -2, z: 0 }, w);
    expect(v.x).toBeCloseTo(4);
  });

  it('a sidespun ball kicks sideways off the table', () => {
    const { v } = bounce({ x: 5, y: -3, z: 0 }, { x: 200, y: 0, z: 0 });
    expect(Math.abs(v.z)).toBeGreaterThan(0.2);
  });
});

describe('solving a shot', () => {
  const ends: End[] = ['west', 'east'];

  it('lands where it says, on the far half, and on the target whenever the pace allows', () => {
    let tries = 0;
    let onTarget = 0;
    for (const by of ends) {
      for (const back of [-0.2, 0.15, 0.5]) {
        for (const h of [0.1, 0.3, 0.6]) {
          for (const speed of [5, 7, 9]) {
            for (const [top, side] of [[0, 0], [250, 0], [-200, 0], [100, 180], [0, -180]]) {
              const from = { ...fromOwn(by, back, 0.3), y: TOP + h };
              const target = onHalf(otherEnd(by), 0.9, -0.3);
              const sol = solveShot(from, by, { target, speed, top, side });
              if (!sol.land) continue; // too quick for this one: it goes long, as it would
              tries++;
              const hit = firstBounce({ p: from, v: sol.v, w: sol.w });
              const what = JSON.stringify({ by, back, h, speed, top, side });
              expect(hit?.end, what).toBe(otherEnd(by));
              expect(Math.hypot(hit!.p.x - sol.land.x, hit!.p.z - sol.land.z), what).toBeLessThan(0.01);
              if (Math.hypot(hit!.p.x - target.x, hit!.p.z - target.z) < 0.08) onTarget++;
            }
          }
        }
      }
    }
    expect(tries).toBeGreaterThan(200);
    expect(onTarget / tries).toBeGreaterThan(0.7); // the rest can't drop in there at their pace: they land elsewhere on the half
  });

  it('every shot at an ordinary pace lands somewhere on the far half', () => {
    for (const by of ends) {
      for (const back of [-0.3, 0, 0.3]) {
        for (const lat of [-0.6, 0, 0.6]) {
          const from = { ...fromOwn(by, back, lat), y: TOP + 0.2 };
          const sol = solveShot(from, by, { target: onHalf(otherEnd(by), 0.8, -lat), speed: 5.5, top: 120, side: 0 });
          expect(sol.land, JSON.stringify({ by, back, lat })).not.toBeNull();
          expect(firstBounce({ p: from, v: sol.v, w: sol.w })?.end).toBe(otherEnd(by));
        }
      }
    }
  });

  it('can’t get a flat, very fast ball down from a low contact: it sails long', () => {
    const from = { ...fromOwn('west', 0.2, 0), y: TOP + 0.1 };
    const sol = solveShot(from, 'west', { target: onHalf('east', 1, 0), speed: 13.5, top: 0, side: 0 });
    expect(sol.land).toBeNull();
    const { bounces, end } = bouncesOf({ p: from, v: sol.v, w: sol.w }, 1);
    expect(bounces).toHaveLength(0);
    expect(end?.kind).toBe('dead');
  });

  it('serves bounce on the server’s half, then the receiver’s', () => {
    for (const by of ends) {
      for (const lat of [-0.5, 0, 0.5]) {
        for (const forward of [-1.5, 0, 2]) {
          const from = { ...fromOwn(by, 0.25, lat * 0.5), y: TOP + 0.28 };
          const shot = serveShot(by, lat, { forward, right: 0.5 });
          const sol = solveShot(from, by, shot);
          const { bounces } = bouncesOf({ p: from, v: sol.v, w: sol.w }, 2);
          expect(bounces.map((b) => b.end), JSON.stringify({ by, lat, forward })).toEqual([by, otherEnd(by)]);
        }
      }
    }
  });
});

describe('a swing', () => {
  const at = { ...fromOwn('west', 0.15, 0), y: TOP + 0.2 };
  const incoming = { v: { x: -5, y: -1, z: 0 }, w: { x: 0, y: 0, z: 0 } };

  it('a forward swing hits harder with topspin, a chop slower with backspin', () => {
    const still = swingShot('west', at, incoming, { forward: 0, right: 0 });
    const drive = swingShot('west', at, incoming, { forward: 3, right: 0 });
    const chop = swingShot('west', at, incoming, { forward: -2, right: 0 });
    expect(drive.speed).toBeGreaterThan(still.speed + 2);
    expect(drive.top).toBeGreaterThan(150);
    expect(chop.top).toBeLessThan(-100);
    expect(chop.speed).toBeLessThan(still.speed);
    // faster lands deeper
    expect(Math.abs(drive.target.x - TABLE.x)).toBeGreaterThan(Math.abs(still.target.x - TABLE.x));
  });

  it('a sideways swing aims that way and curves it', () => {
    const right = swingShot('west', at, incoming, { forward: 0, right: 1.5 });
    expect(right.side).toBeGreaterThan(100);
    expect(right.target.z).toBeGreaterThan(TABLE.z + 0.2); // the west player's right is +z
    const left = swingShot('east', { ...fromOwn('east', 0.15, 0), y: TOP + 0.2 }, incoming, { forward: 0, right: -1.5 });
    expect(left.target.z).toBeGreaterThan(TABLE.z + 0.2); // the east player's left is +z
    // it stays on the table
    expect(Math.abs(swingShot('west', at, incoming, { forward: 0, right: 9 }).target.z - TABLE.z)).toBeLessThan(TABLE.wid / 2);
  });

  it('a fast forward swing at a high ball is a smash', () => {
    const high = { ...at, y: TOP + 0.6 };
    expect(isSmash(high.y, { forward: 3, right: 0 })).toBe(true);
    expect(isSmash(at.y, { forward: 3, right: 0 })).toBe(false);
    expect(isSmash(high.y, { forward: 1, right: 0 })).toBe(false);
    expect(swingShot('west', high, incoming, { forward: 3, right: 0 }).speed).toBeGreaterThan(swingShot('west', at, incoming, { forward: 3, right: 0 }).speed);
  });
});
