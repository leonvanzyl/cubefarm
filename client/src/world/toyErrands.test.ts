import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Act, ErrandScript, Me } from './errands';

// The store pulls in the sound module, which listens on window for the first click; tests run in node.
vi.stubGlobal('window', { addEventListener: () => undefined });
const { useStore } = await import('../store');
const { errandNamed, errands } = await import('./errands');
const { SHARE, clearOfPlayer, headingTo, onFloor, toyPlays } = await import('./toyErrands');
const npc = await import('./toys/npc');
const { npcHoldPoint } = await import('./toys/npcAim');
const { hoopRim } = await import('./toys/hoopScore');

const DT = 1 / 30;

/** The office's balls (as in toys/balls.tsx) as the toy world would publish them, lying where they start. */
function freshBalls(): import('./toys/npc').NpcBall[] {
  const rim = hoopRim('office');
  const ball = (id: string, kind: import('./toys/balls').BallKind, r: number, x: number, z: number) => {
    const home = { x, y: r + 0.02, z };
    return { id, kind, r, home, ...home, vx: 0, vy: 0, vz: 0, sleeping: true };
  };
  return [ball('beach-ball', 'beach', 0.4, 6.6, 6.8), ball('yarn-ball', 'yarn', 0.33, 12.2, 6.2), ball('basketball', 'basketball', 0.12, rim.x, rim.z - 0.35)];
}

/**
 * A stand-in for the director and the toy world: walks happen at once, held balls sit in the hands, and throws land
 * at `land` (a basket when `basket` says so).
 */
function play(script: ErrandScript, me: Me, balls: import('./toys/npc').NpcBall[], opts: { basket?: () => boolean; frames?: number; each?: (f: number) => void } = {}) {
  const acts: Act['do'][] = [];
  const gestures = new Set<string>();
  for (let f = 0; f < (opts.frames ?? 3000); f++) {
    opts.each?.(f);
    const act = script.tick(me);
    acts.push(act.do);
    gestures.add(act.gesture);
    if (act.do === 'done') break;
    if (act.do === 'walk') {
      me.arrived = Math.hypot(me.x - act.x, me.z - act.z) < 0.01;
      me.x = act.x;
      me.z = act.z;
    }
    me.heading = act.heading;
    for (const [who, g] of npc.npcGrips()) {
      const b = balls.find((x) => x.id === g.ball)!;
      const rel = npc.takeRelease(who);
      if (rel) {
        npc.released(who, rel.kind === 'throw' ? 'thrown' : 'dropped');
        if (rel.kind === 'throw' && opts.basket?.()) npc.basketBy(b.id);
        // it comes down under the hoop either way
        if (rel.kind === 'throw') Object.assign(b, { x: b.home.x, y: b.r, z: b.home.z - 0.6 });
        else Object.assign(b, { y: b.r });
        continue;
      }
      npcHoldPoint({ x: me.x, z: me.z, heading: me.heading }, g.pose, b.r, g.pull, b);
    }
  }
  script.end();
  return { acts, gestures };
}

const newMe = (x: number, z: number): Me => ({ id: 'ada', x, z, heading: 0, arrived: true, dt: DT, player: { x: -10, z: -8 } });

beforeEach(() => {
  useStore.setState({ held: null });
  npc.setNpcBalls(null);
});

describe('throwing manners', () => {
  it('only throws with the player well off the line', () => {
    expect(clearOfPlayer({ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 2, z: 0.5 })).toBe(false);
    expect(clearOfPlayer({ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 2, z: 2 })).toBe(true);
    // behind the catcher counts from the catcher, behind the thrower from the thrower
    expect(clearOfPlayer({ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4.8, z: 0 })).toBe(false);
    expect(clearOfPlayer({ x: 0, z: 0 }, { x: 4, z: 0 }, { x: -2, z: 0 })).toBe(true);
  });

  it('faces what it heads for, as body.ts headings do (0 faces -z)', () => {
    expect(headingTo({ x: 0, z: 0 }, { x: 0, z: -1 })).toBeCloseTo(0);
    expect(Math.abs(headingTo({ x: 0, z: 0 }, { x: 0, z: 1 }))).toBeCloseTo(Math.PI);
  });

  it('picks up only balls lying on the floor', () => {
    expect(onFloor({ y: 0.4, r: 0.4, vx: 0, vy: 0, vz: 0 })).toBe(true);
    expect(onFloor({ y: 1.2, r: 0.4, vx: 0, vy: 0, vz: 0 })).toBe(false);
    expect(onFloor({ y: 0.4, r: 0.4, vx: 4, vy: 0, vz: 0 })).toBe(false);
  });
});

describe('the toy errands', () => {
  it('come before stretching, and share out restless people without overlapping', () => {
    const names = errands().map((e) => e.name);
    for (const n of ['hoops', 'toss', 'catch']) expect(names.indexOf(n)).toBeLessThan(names.indexOf('stretch'));
    expect(SHARE.hoops[1]).toBeLessThanOrEqual(SHARE.toss[0]);
    expect(SHARE.toss[1]).toBeLessThan(1); // the rest stretch
  });

  it('go only when restless, rolled for, free, and the toy is there for the taking', () => {
    const state = { floor: 'office' as const, statusFor: 99, seatedFor: 40, restless: 30, roll: 0.1 };
    const dev = { id: 'ada', status: 'idle' as const, role: 'dev' };
    const hoops = errandNamed('hoops')!;
    expect(hoops.when(dev, state)).toBe(false); // no toy world
    npc.setNpcBalls(freshBalls());
    expect(hoops.when(dev, state)).toBe(true);
    expect(hoops.when(dev, { ...state, roll: 0.6 })).toBe(false);
    expect(hoops.when(dev, { ...state, seatedFor: 10 })).toBe(false);
    expect(hoops.when({ ...dev, status: 'working' }, state)).toBe(false);
    useStore.setState({ held: { kind: 'ball', id: 'basketball' } });
    expect(hoops.when(dev, state)).toBe(false);
    expect(errandNamed('toss')!.when(dev, { ...state, roll: 0.4, floor: 'lobby' })).toBe(false); // nobody to play with there
  });
});

describe('shooting hoops', () => {
  it('fetches the ball, shoots a few, cheers a basket, puts the ball back and goes', () => {
    const balls = freshBalls();
    npc.setNpcBalls(balls);
    const script = errandNamed('hoops')!.script!({ id: 'ada', status: 'idle', role: 'dev' }, 'office')!;
    expect(script).not.toBeNull();
    // only one person at the hoop at a time
    expect(errandNamed('hoops')!.script!({ id: 'bob', status: 'idle', role: 'dev' }, 'office')).toBeNull();
    let n = 0;
    const before = npc.npcSnapshot();
    const { acts, gestures } = play(script, newMe(10.5, 7.25), balls, { basket: () => n++ % 2 === 0 });
    expect(acts.at(-1)).toBe('done');
    const after = npc.npcSnapshot();
    expect(after.shots - before.shots).toBeGreaterThanOrEqual(3);
    expect(after.baskets - before.baskets).toBeGreaterThanOrEqual(1);
    for (const g of ['stoop', 'hold', 'shoot', 'cheer', 'shrug']) expect(gestures, g).toContain(g);
    // the ball is back where it lives, on the floor, and nobody holds it
    const ball = balls.find((b) => b.id === 'basketball')!;
    expect(Math.hypot(ball.x - ball.home.x, ball.z - ball.home.z)).toBeLessThan(0.3);
    expect(npc.ballHolder('basketball')).toBeNull();
    expect(toyPlays().hoops).toBeNull();
  });

  it('shrugs and goes back when the player takes the ball', () => {
    const balls = freshBalls();
    npc.setNpcBalls(balls);
    const script = errandNamed('hoops')!.script!({ id: 'ada', status: 'idle', role: 'dev' }, 'office')!;
    const shots = npc.npcSnapshot().shots;
    const { acts, gestures } = play(script, newMe(10.5, 7.25), balls, {
      each: () => {
        if (npc.npcHolding('ada') && !useStore.getState().held) {
          useStore.setState({ held: { kind: 'ball', id: 'basketball' } });
          npc.released('ada', 'taken');
        }
      },
    });
    expect(acts.at(-1)).toBe('done');
    expect(gestures).toContain('shrug');
    expect(npc.npcSnapshot().shots).toBe(shots); // taken before the first shot, so none
    expect(npc.ballHolder('basketball')).toBe('player');
  });

  it('never picks up a ball the player is holding', () => {
    npc.setNpcBalls(freshBalls());
    useStore.setState({ held: { kind: 'ball', id: 'beach-ball' } });
    expect(npc.npcPickUp('ada', 'beach-ball')).toBe(false);
    expect(npc.npcPickUp('ada', 'yarn-ball')).toBe(true);
    expect(npc.npcPickUp('bob', 'yarn-ball')).toBe(false); // someone has it
  });

  it('a ball they hold, just threw or are about to catch is not a hit on them', () => {
    npc.setNpcBalls(freshBalls());
    npc.npcPickUp('ada', 'beach-ball');
    expect(npc.npcIgnores('ada', 'beach-ball')).toBe(true);
    expect(npc.npcIgnores('bob', 'beach-ball')).toBe(false);
    npc.npcExpect('bob', 'beach-ball');
    expect(npc.npcIgnores('bob', 'beach-ball')).toBe(true);
    npc.npcThrow('ada', { yaw: 0, pitch: 0, power: 0.2 });
    npc.takeRelease('ada');
    npc.released('ada', 'thrown');
    expect(npc.npcIgnores('ada', 'beach-ball')).toBe(true);
  });

  it("an agent's basket isn't the player's", () => {
    npc.setNpcBalls(freshBalls());
    expect(npc.basketBy('basketball')).toBeNull(); // nobody threw it: the player's
    npc.npcPickUp('ada', 'basketball');
    npc.released('ada', 'thrown');
    expect(npc.basketBy('basketball')).toBe('ada');
    npc.playerTook('basketball');
    expect(npc.basketBy('basketball')).toBeNull();
  });
});

describe('catch with the beach ball', () => {
  it('two people throw it to each other a few times, then leave it in the play area', async () => {
    const { trackBody } = await import('./people');
    const { newBodyState } = await import('./body');
    const balls = freshBalls();
    npc.setNpcBalls(balls);
    const dev = (id: string) => ({ id, status: 'idle' as const, role: 'dev' });
    const a = errandNamed('toss')!.script!(dev('ada'), 'office')!;
    expect(errandNamed('catch')!.when(dev('bob'), { floor: 'office', statusFor: 9, seatedFor: 5, restless: 30 })).toBe(true);
    const b = errandNamed('catch')!.script!(dev('bob'), 'office')!;
    expect(b).not.toBeNull();
    const me = { ada: { ...newMe(3.8, 8.2), id: 'ada' }, bob: { ...newMe(8.3, 8.2), id: 'bob' } };
    const bodies = { ada: newBodyState(), bob: newBodyState() };
    const untrack = (['ada', 'bob'] as const).map((id) => trackBody(id, bodies[id]));
    const tosses = npc.npcSnapshot().tosses;
    const catches = npc.npcSnapshot().catches;
    const ended = new Set<string>();
    const gestures = new Set<string>();
    const beach = balls.find((x) => x.id === 'beach-ball')!;
    for (let f = 0; f < 6000 && ended.size < 2; f++) {
      for (const [id, script] of [['ada', a], ['bob', b]] as const) {
        if (ended.has(id)) continue;
        const m = me[id];
        const act = script.tick(m);
        gestures.add(act.gesture);
        if (act.do === 'done') {
          ended.add(id);
          script.end();
          continue;
        }
        if (act.do === 'walk') {
          m.arrived = Math.hypot(m.x - act.x, m.z - act.z) < 0.01;
          m.x = act.x;
          m.z = act.z;
        }
        m.heading = act.heading;
        Object.assign(bodies[id], { stage: 'up', x: m.x, z: m.z, heading: m.heading });
      }
      for (const [who, g] of npc.npcGrips()) {
        const m = me[who as 'ada' | 'bob'];
        const rel = npc.takeRelease(who);
        if (!rel) {
          npcHoldPoint({ x: m.x, z: m.z, heading: m.heading }, g.pose, beach.r, g.pull, beach);
          continue;
        }
        npc.released(who, rel.kind === 'throw' ? 'thrown' : 'dropped');
        if (rel.kind === 'drop') beach.y = beach.r;
        else {
          // a good throw: it arrives in the other one's hands
          const o = me[who === 'ada' ? 'bob' : 'ada'];
          npcHoldPoint({ x: o.x, z: o.z, heading: headingTo(o, m) }, 'carry', beach.r, 0, beach);
        }
      }
    }
    untrack.forEach((u) => u());
    expect(ended.size).toBe(2);
    expect(npc.npcSnapshot().tosses - tosses).toBeGreaterThanOrEqual(4);
    expect(npc.npcSnapshot().catches - catches).toBeGreaterThanOrEqual(4);
    expect(gestures).not.toContain('shrug');
    expect(npc.ballHolder('beach-ball')).toBeNull();
    expect(beach.y).toBeCloseTo(beach.r);
    // left between the two spots
    expect(beach.x).toBeGreaterThan(3);
    expect(beach.x).toBeLessThan(9);
    expect(toyPlays().toss).toBeNull();
  });
});
