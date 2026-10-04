import { beforeAll, describe, expect, it } from 'vitest';
import { walkways, spot } from '../walkways';
import { HOOP } from './hoopScore';
import { aimHoop, aimToss, facingHoop, npcHoldPoint, npcView, WOBBLE, type Stance } from './npcAim';
import { GRAVITY, THROW, throwVelocity } from './throwing';
import { fly, loadPhysics } from './throwSim';

/** A small seeded generator (mulberry32), so the shots are the same every run. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const at = { x: 0, y: 0, z: 0 };
const hoopSpot = (): Stance => facingHoop(spot(walkways('office'), 'hoop')!, 'office');

/** Throws from `s` with `aim`, from where the ball is held overhead, in the Rapier throw simulation. */
const shootFrom = (s: Stance, aim: ReturnType<typeof aimHoop>) =>
  fly(npcView(s, aim), npcHoldPoint(s, 'shoot', HOOP.ball.r, 0, { x: 0, y: 0, z: 0 }), aim.power);

beforeAll(() => loadPhysics());

describe('hoop shots', () => {
  it('without the wobble, a shot from the hoop spot goes in', () => {
    const s = hoopSpot();
    // normal(u, 0.25) is 0: no wobble at all
    expect(shootFrom(s, aimHoop(s, 'office', () => 0.25)).scored).toBe(true);
  });

  it('a casual shooter at the hoop spot makes roughly a third', () => {
    const s = hoopSpot();
    const r = rng(88);
    const tries = 240;
    let baskets = 0;
    for (let i = 0; i < tries; i++) if (shootFrom(s, aimHoop(s, 'office', r)).scored) baskets++;
    const rate = baskets / tries;
    expect(rate, `${baskets} of ${tries}`).toBeGreaterThan(0.2);
    expect(rate, `${baskets} of ${tries}`).toBeLessThan(0.5);
  });

  it('wobbles, but not so much that the shot misses the hoop altogether', () => {
    expect(WOBBLE.aim * 3).toBeLessThan(0.1); // the arcade shot's cone (throwing.ts ASSIST.cone)
  });
});

describe('tossing to a friend', () => {
  it.each([2.5, 4, 5])('a lob over %s m reaches the catcher’s hands, gently and under the ceiling', (d) => {
    const from = { x: 3.8, z: 8 };
    const hands = npcHoldPoint({ x: from.x + d, z: 8, heading: Math.PI / 2 }, 'carry', 0.4, 0, { x: 0, y: 0, z: 0 });
    const aim = aimToss(from.x, from.z, hands, 0.4)!;
    expect(aim).not.toBeNull();
    expect(aim.power).toBeLessThan(0.4);
    // fly it (with the flight's little drag) and see where it passes the catcher
    const s = { x: from.x, z: from.z, heading: aim.yaw };
    const p = npcHoldPoint(s, 'toss', 0.4, 0, { x: 0, y: 0, z: 0 });
    const v = throwVelocity(npcView(s, aim), p, aim.power, THROW.hard, { x: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    let best = Infinity;
    for (let t = 0; t < 2.5; t += 1 / 240) {
      const k = (1 - Math.exp(-THROW.flightDamping * t)) / THROW.flightDamping;
      at.x = p.x + v.x * k;
      at.y = p.y + v.y * k - (GRAVITY * t * t) / 2;
      at.z = p.z + v.z * k;
      best = Math.min(best, Math.hypot(at.x - hands.x, at.y - hands.y, at.z - hands.z));
    }
    expect(best).toBeLessThan(0.15);
  });

  it('has no throw for someone out of reach', () => {
    expect(aimToss(0, 0, { x: 30, y: 1, z: 0 }, 0.4)).toBeNull();
  });
});
