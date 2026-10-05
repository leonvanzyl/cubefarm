import { describe, expect, it } from 'vitest';
import { HALF_D, HALF_W, deskPosition } from '../layout';
import { walkways, type FloorKind } from '../walkways';
import { DOG, DOG_EVENT, ballReleased, callDog, createDog, delightDog, dogAsleep, dogStatus, leaveDogNow, napDogNow, partyDog, petDog, stepDog, type Dog, type DogBall, type DogEnv, type DogFriend, type DogPlayer, type DogWalker } from './dogBrain';
import { DOG_R, byDoors, dogPlaces, lapSpot } from './dogPlaces';
import { clear } from './roombaBrain';

const DT = 1 / 60;

function env(floor: FloorKind = 'office', over: Partial<DogEnv> = {}): DogEnv {
  return {
    nav: walkways(floor).nav,
    places: dogPlaces(floor),
    player: { x: 0, z: 9, fx: 0, fz: -1, holding: null },
    walkers: [],
    roomba: null,
    balls: [],
    holding: null,
    friends: [],
    party: null,
    canLeave: false,
    ...over,
  };
}

/** A dog standing at (x, z) on the floor, wandering. */
const at = (x: number, z: number, floor: FloorKind = 'office', seed = 3) => createDog(dogPlaces(floor), 'here', { x, z, heading: 0 }, seed);

/** Steps for `seconds`, calling `each` after every step (its events still in d.events); collects the events. */
function run(d: Dog, e: DogEnv, seconds: number, each?: (t: number) => void) {
  let events = 0;
  for (let t = 0; t < seconds; t += DT) {
    stepDog(d, DT, e);
    each?.(t);
    events |= d.events;
    d.events = 0;
  }
  return events;
}

/**
 * The toy world's part for a ball, simply: it rolls to a stop, the dog's mouth picks it up (npc.ts carries it in front
 * of the dog) and lets it go.
 */
function ballWorld(e: DogEnv, d: Dog, ball: DogBall) {
  return () => {
    if (ball.holder === null && d.mouth === ball.id && Math.hypot(ball.x - d.x, ball.z - d.z) < 2) ball.holder = 'dog';
    if (ball.holder === 'dog' && d.mouth !== ball.id) ball.holder = null;
    e.holding = ball.holder === 'dog' ? ball.id : null;
    if (ball.holder === 'dog') {
      const ahead = DOG.mouth + ball.r;
      ball.x = d.x + Math.cos(d.heading) * ahead;
      ball.z = d.z + Math.sin(d.heading) * ahead;
      ball.vx = ball.vz = 0;
      return;
    }
    // rolling: slows to a stop, and stops at walls and furniture
    const v = Math.hypot(ball.vx, ball.vz);
    if (v < 0.05) {
      ball.vx = ball.vz = 0;
      return;
    }
    const nx = ball.x + ball.vx * DT;
    const nz = ball.z + ball.vz * DT;
    if (!clear(e.nav.rects, nx, nz, ball.r)) {
      ball.vx = ball.vz = 0;
      return;
    }
    ball.x = nx;
    ball.z = nz;
    const k = Math.max(0, v - 2.2 * DT) / v;
    ball.vx *= k;
    ball.vz *= k;
  };
}

/** Throws `ball` from the player's feet along angle `a` (rolling at `speed`), the way the dog sees a throw. */
function toss(d: Dog, p: DogPlayer, ball: DogBall, a: number, speed = 5.5) {
  ball.holder = null;
  ball.x = p.x + Math.cos(a) * 0.6;
  ball.z = p.z + Math.sin(a) * 0.6;
  ball.vx = Math.cos(a) * speed;
  ball.vz = Math.sin(a) * speed;
  ballReleased(d, ball.id);
}

describe('the dog gets about', () => {
  it('steps out of the elevator, walks in past the doors and wanders off', () => {
    const p = dogPlaces('office');
    const d = createDog(p, 'cabin', { x: 0, z: 0, heading: 0 }, 5);
    expect(d.state).toBe('arrive');
    expect(d.z).toBeGreaterThan(HALF_D);
    const e = env('office', { player: { x: 6, z: 2, fx: 0, fz: -1, holding: null } });
    run(d, e, 0.5);
    expect(d.state).toBe('arrive'); // waiting for the doors
    run(d, e, 6);
    expect(d.z).toBeLessThan(HALF_D);
    expect(['wander', 'sniff', 'rest']).toContain(d.state);
  });

  it.each(['office', 'lobby'] as FloorKind[])('on the %s floor it stays inside, never in furniture, and never idles by the elevator doors', (floor) => {
    const d = at(2, 6, floor, 11);
    const e = env(floor, { player: { x: -10, z: -8, fx: 0, fz: 1, holding: null } });
    const p = dogPlaces(floor);
    let idleByDoors = 0;
    run(d, e, 15 * 60, () => {
      expect(Math.abs(d.x)).toBeLessThan(HALF_W - DOG_R + 0.05);
      expect(Math.abs(d.z)).toBeLessThan(HALF_D - DOG_R + 0.05);
      // on the floor it keeps off the furniture (the couch's seat is only reached with a hop)
      if (d.y === 0 && !d.hop.active && d.state !== 'visit') expect(clear(p.rects, d.x, d.z, DOG_R * 0.5), `${d.state} at ${d.x.toFixed(2)}, ${d.z.toFixed(2)}`).toBe(true);
      if ((d.state === 'rest' || d.state === 'sniff' || d.state === 'nap') && byDoors(d.x, d.z)) idleByDoors++;
    });
    expect(idleByDoors).toBe(0);
  }, 60_000);

  it('sniffs things and rests while wandering', () => {
    const d = at(0, 0);
    const seen = new Set<string>();
    const events = run(d, env(), 120, () => seen.add(d.state));
    expect(seen.has('sniff')).toBe(true);
    expect(events & DOG_EVENT.sniff).toBeTruthy();
    expect(dogStatus(d)).toBeTruthy();
  });
});

describe('napping', () => {
  it('naps when the floor has been quiet a while, at a nap spot, asleep', () => {
    const d = at(0, 0, 'office', 2);
    const e = env();
    let asleep: { x: number; z: number; y: number } | null = null;
    run(d, e, DOG.sleepyMax + DOG.quietAfter + 60, () => {
      if (dogAsleep(d) && !asleep) asleep = { x: d.x, z: d.z, y: d.y };
    });
    expect(asleep).not.toBeNull();
    const { x, z, y } = asleep!;
    const spot = dogPlaces('office').naps.find((n) => Math.hypot(n.x - x, n.z - z) < 0.2);
    expect(spot).toBeDefined();
    expect(y).toBeCloseTo(spot!.y);
  }, 60_000);

  it("doesn't nap while people are about", () => {
    const d = at(0, 0, 'office', 2);
    const walkers: DogWalker[] = [
      { x: -12, z: -9, fx: 1, fz: 0, speed: 0 },
      { x: 12, z: -9, fx: -1, fz: 0, speed: 0 },
      { x: 0, z: -10, fx: 1, fz: 0, speed: 0 },
    ];
    let napped = false;
    run(d, env('office', { walkers }), DOG.sleepyMax + 60, () => {
      if (d.state === 'nap') napped = true;
    });
    expect(napped).toBe(false);
  }, 60_000);

  it('gets up on the couch with a hop and down again for a pet', () => {
    const e = env();
    const couch = dogPlaces('office').naps.find((n) => n.id === 'couch')!;
    const d = at(couch.from!.x + 1, couch.from!.z + 1);
    napDogNow(d);
    // only the couch is free: everyone's standing on the rugs
    e.walkers = dogPlaces('office').naps.filter((n) => n.id !== 'couch').map((n) => ({ x: n.x, z: n.z, fx: 1, fz: 0, speed: 0 }));
    run(d, e, 20);
    expect(d.state).toBe('nap');
    expect(d.y).toBeCloseTo(couch.y);
    e.walkers = [];
    petDog(d);
    run(d, e, 3);
    expect(d.y).toBe(0);
    expect(d.state).toBe('follow');
  });
});

describe('following you', () => {
  it('follows after a pet, keeping a little way off, and stops after a while', () => {
    const d = at(0, 2);
    const p: DogPlayer = { x: 0, z: 4, fx: 0, fz: -1, holding: null };
    const e = env('office', { player: p });
    const events = (petDog(d), d.events);
    expect(events & DOG_EVENT.pet).toBeTruthy();
    expect(d.wiggle).toBeGreaterThan(0);
    // the player walks east along the aisle and stops
    run(d, e, 8, (t) => {
      if (t < 4) p.x = t * 2;
    });
    expect(d.state).toBe('follow');
    const dist = Math.hypot(d.x - p.x, d.z - p.z);
    expect(dist).toBeGreaterThan(DOG.keepPlayer);
    expect(dist).toBeLessThan(DOG.far + 0.3);
    run(d, e, 3);
    expect(d.pose).toBe('sit');
    run(d, e, DOG.follow);
    expect(d.state).not.toBe('follow');
  });

  it('moves away when the player walks into it', () => {
    const d = at(0, 4);
    const p: DogPlayer = { x: -3, z: 4, fx: 1, fz: 0, holding: null };
    let closest = Infinity;
    run(d, env('office', { player: p }), 4, (t) => {
      p.x = -3 + Math.min(t, 2) * 1.6;
      if (t > 1) closest = Math.min(closest, Math.hypot(d.x - p.x, d.z - p.z));
    });
    expect(closest).toBeGreaterThan(DOG.keepPlayer - 0.25);
  });

  it('comes when called', () => {
    const d = at(10, -8);
    callDog(d);
    const p: DogPlayer = { x: -6, z: 4, fx: 0, fz: -1, holding: null };
    run(d, env('office', { player: p }), 15);
    expect(Math.hypot(d.x - p.x, d.z - p.z)).toBeLessThan(DOG.far);
  });
});

describe('fetch', () => {
  it('watches a ball in your hands, then fetches every throw back to your feet', () => {
    const p: DogPlayer = { x: 0, z: 7, fx: 0, fz: -1, holding: 'beach-ball' };
    const e = env('office', { player: p });
    const ball: DogBall = { id: 'beach-ball', x: 0, y: 0.4, z: 6, r: 0.4, vx: 0, vy: 0, vz: 0, holder: 'player' };
    e.balls = [ball];
    const d = at(3, 6);
    run(d, e, 3);
    expect(d.state).toBe('eager');
    expect(d.target.kind).toBe('ball');
    const sim = ballWorld(e, d, ball);
    let returned = 0;
    // five throws in different directions along the open floor south of the desks
    for (const a of [-Math.PI / 2 + 0.3, 0, Math.PI, -0.4, Math.PI + 0.4]) {
      p.holding = null;
      toss(d, p, ball, a);
      let events = 0;
      run(d, e, 25, () => {
        sim();
        events |= d.events;
      });
      if (events & DOG_EVENT.returned) {
        returned++;
        expect(Math.hypot(ball.x - p.x, ball.z - p.z)).toBeLessThan(1.4);
      }
      // you pick it up again for the next throw
      ball.holder = 'player';
      p.holding = ball.id;
      run(d, e, 1, sim);
    }
    expect(returned).toBeGreaterThanOrEqual(4);
  });

  it('gets round you to fetch a ball thrown away from it', () => {
    const p: DogPlayer = { x: 0, z: 8.4, fx: -1, fz: 0, holding: null };
    const ball: DogBall = { id: 'yarn-ball', x: 0, y: 0.33, z: 8.4, r: 0.33, vx: 0, vy: 0, vz: 0, holder: 'player' };
    const e = env('office', { player: p, balls: [ball] });
    const d = at(0.8, 8.4); // right behind you
    const sim = ballWorld(e, d, ball);
    toss(d, p, ball, Math.PI, 7);
    const events = run(d, e, 25, sim);
    expect(events & DOG_EVENT.returned).toBeTruthy();
    expect(events & DOG_EVENT.lost).toBe(0);
  });

  it('keeps after a ball that rolls on while it comes round the furniture for it', () => {
    // called from the lobby's manager's office (its path goes out through the door), the ball rolling a long way east
    const p: DogPlayer = { x: -6, z: 7, fx: 1, fz: 0, holding: null };
    const ball: DogBall = { id: 'yarn-ball', x: -6, y: 0.33, z: 7, r: 0.33, vx: 0, vy: 0, vz: 0, holder: 'player' };
    const e = env('lobby', { player: p, balls: [ball] });
    const d = at(-7.4, -9.4, 'lobby');
    callDog(d);
    run(d, e, 0.6);
    const sim = ballWorld(e, d, ball);
    toss(d, p, ball, 0, 6);
    const events = run(d, e, 25, sim);
    expect(events & DOG_EVENT.lost).toBe(0);
    expect(events & DOG_EVENT.returned).toBeTruthy();
    expect(Math.hypot(ball.x - p.x, ball.z - p.z)).toBeLessThan(1.6);
  });

  it("doesn't fetch a ball you just put down at your feet", () => {
    const p: DogPlayer = { x: 0, z: 7, fx: 0, fz: -1, holding: null };
    const ball: DogBall = { id: 'yarn-ball', x: 0, y: 0.33, z: 6.2, r: 0.33, vx: 0, vy: 0, vz: 0, holder: null };
    const e = env('office', { player: p, balls: [ball] });
    const d = at(3, 6);
    ballReleased(d, ball.id);
    const events = run(d, e, 6);
    expect(events & DOG_EVENT.fetch).toBe(0);
  });

  it('gives a ball up to the player who takes it from its mouth, and gets delighted when one bounces off it', () => {
    const p: DogPlayer = { x: 0, z: 7, fx: 0, fz: -1, holding: null };
    const ball: DogBall = { id: 'yarn-ball', x: 0, y: 0.33, z: 6.2, r: 0.33, vx: 0, vy: 0, vz: 0, holder: null };
    const e = env('office', { player: p, balls: [ball] });
    const d = at(-4, 5);
    const sim = ballWorld(e, d, ball);
    toss(d, p, ball, 0.2);
    run(d, e, 6, sim);
    expect(['fetch', 'bring']).toContain(d.state);
    // taken out of its mouth (or off the floor) by the player
    ball.holder = 'player';
    p.holding = ball.id;
    e.holding = null;
    run(d, e, 0.5);
    expect(d.state).toBe('eager');
    delightDog(d);
    expect(d.events & DOG_EVENT.yip).toBeTruthy();
  });
});

describe('looking after people', () => {
  const seat = { x: deskPosition(4).x, z: deskPosition(4).z + 0.8 };
  const friend = (): DogFriend => ({ ...lapSpot(seat.x, seat.z, 0), id: 'ada' });

  it('sits with someone having a hard time, head on their lap, until it gets better', () => {
    const d = at(0, 9);
    const e = env('office', { friends: [friend()] });
    const events = run(d, e, 20);
    expect(d.state).toBe('visit');
    expect(events & DOG_EVENT.visit).toBeTruthy();
    expect(d.pose).toBe('lap');
    expect(Math.hypot(d.x - e.friends[0].x, d.z - e.friends[0].z)).toBeLessThan(0.15);
    e.friends = [];
    run(d, e, 1);
    expect(d.state).not.toBe('visit');
  });

  it('waits by the chair while they get up for a moment, and gives up if they go off', () => {
    const d = at(0, 9);
    const e = env('office', { friends: [friend()] });
    run(d, e, 20);
    expect(d.pose).toBe('lap');
    e.friends = [{ ...friend(), away: true }]; // up for a moment
    run(d, e, DOG.visitWait - 2);
    expect(d.state).toBe('visit');
    e.friends = [friend()];
    run(d, e, 2);
    expect(d.pose).toBe('lap');
    e.friends = [{ ...friend(), away: true }]; // off for a coffee
    run(d, e, DOG.visitWait + 1);
    expect(d.state).not.toBe('visit');
    // and nobody away gets a visit started
    run(d, e, 30);
    expect(d.state).not.toBe('visit');
  });

  it('leaves after two minutes and comes back only after a while', () => {
    const d = at(0, 9);
    const e = env('office', { friends: [friend()] });
    run(d, e, DOG.visitFor + 2);
    expect(d.state).not.toBe('visit');
    let back = false;
    run(d, e, DOG.visitAgain - 30, () => {
      if (d.state === 'visit') back = true;
    });
    expect(back).toBe(false);
    run(d, e, 60);
    expect(d.state).toBe('visit');
  }, 60_000);

  it("runs to a merged PR's author and hops about", () => {
    const d = at(10, -8);
    const author = { x: -6, z: 4.5 };
    const e = env('office', { party: author });
    partyDog(d, 'ada');
    let fastest = 0;
    let hops = 0;
    run(d, e, 10, () => {
      fastest = Math.max(fastest, d.speed);
      if (d.events & DOG_EVENT.hop) hops++;
    });
    expect(d.state).toBe('party');
    expect(fastest).toBeGreaterThan(DOG.trot);
    expect(Math.hypot(d.x - author.x, d.z - author.z)).toBeLessThan(1.8);
    expect(hops).toBeGreaterThanOrEqual(3);
    expect(d.target.id).toBe('ada');
    run(d, e, DOG.partyFor);
    expect(d.state).not.toBe('party');
  });
});

describe('manners', () => {
  it('steps aside for someone walking its way', () => {
    const d = at(0, 4.5);
    const w: DogWalker = { x: -4, z: 4.5, fx: 1, fz: 0, speed: 1.2 };
    let closest = Infinity;
    run(d, env('office', { walkers: [w], player: { x: -10, z: -8, fx: 0, fz: 1, holding: null } }), 7, () => {
      w.x += w.speed * DT;
      closest = Math.min(closest, Math.hypot(d.x - w.x, d.z - w.z));
    });
    expect(closest).toBeGreaterThan(0.45);
  });

  it('keeps its distance from the roomba, with one bark as it passes', () => {
    const d = at(0, 4.5);
    Object.assign(d, { state: 'rest', dwell: 60 }); // sitting about when it comes by
    const roomba = { x: -2, z: 4.5, moving: true };
    let barks = 0;
    let closest = Infinity;
    // it drives straight at the dog, wherever the dog goes
    run(d, env('office', { roomba, player: { x: -10, z: -8, fx: 0, fz: 1, holding: null } }), 12, (t) => {
      const dx = d.x - roomba.x;
      const dz = d.z - roomba.z;
      const dist = Math.hypot(dx, dz);
      roomba.x += (dx / dist) * 0.3 * DT;
      roomba.z += (dz / dist) * 0.3 * DT;
      if (d.events & DOG_EVENT.bark) barks++;
      if (t > 2) closest = Math.min(closest, Math.hypot(d.x - roomba.x, d.z - roomba.z));
    });
    expect(barks).toBe(1);
    expect(closest).toBeGreaterThan(0.6);
  });
});

describe('the elevator', () => {
  it('takes it to another floor after a while, when there is one', () => {
    const d = at(5, 0);
    const e = env('office', { canLeave: true, player: { x: -10, z: -8, fx: 0, fz: 1, holding: null }, walkers: [{ x: 14, z: -11, fx: 0, fz: 1, speed: 0 }, { x: -14, z: -11, fx: 0, fz: 1, speed: 0 }, { x: 0, z: -11, fx: 0, fz: 1, speed: 0 }] }); // busy: no naps
    let events = 0;
    let t = 0;
    for (; t < DOG.stayMax + 60 && d.state !== 'gone'; t += DT) {
      stepDog(d, DT, e);
      events |= d.events;
      d.events = 0;
    }
    expect(d.state).toBe('gone');
    expect(events & DOG_EVENT.gone).toBeTruthy();
    expect(t).toBeGreaterThan(DOG.stayMin);
    expect(d.z).toBeGreaterThan(HALF_D); // in the cabin
  }, 60_000);

  it('stays put when there is nowhere else to go, and a pet turns it back', () => {
    const d = at(5, 0);
    run(d, env('office', { canLeave: false }), DOG.stayMax + 30);
    expect(d.state).not.toBe('leave');
    const e = env('office', { canLeave: true });
    leaveDogNow(d);
    run(d, e, 1);
    expect(d.state).toBe('leave');
    petDog(d);
    run(d, e, 0.1);
    expect(d.state).toBe('follow');
  }, 60_000);
});
