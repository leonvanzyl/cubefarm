import { afterEach, describe, expect, it } from 'vitest';
import { newBodyState, stepBody, type BodyState } from './body';
import { headingFor } from './errands';
import { bodyTarget, seatBody, trackBody } from './people';
import { CABIN } from './socials';
import { Performer, type Cue } from './stage';
import { spot, walkways } from './walkways';

const office = walkways('office');
const DT = 1 / 30;

/** A body on the floor, stepped as Character.tsx steps it, seated at desk 0 to start with. */
function person(id: string) {
  const s: BodyState = newBodyState();
  const desk = spot(office, 'desk-0')!;
  Object.assign(s, { seatX: desk.x, seatZ: desk.z - 0.7, seatHeading: 0, standX: desk.x + 0.6, standZ: desk.z - 0.8, x: desk.x, z: desk.z - 0.7 });
  const untrack = trackBody(id, s);
  return { s, untrack, step: () => stepBody(s, bodyTarget(id) ?? null, DT) };
}

/** Runs a performer with its person until it's done (or `max` seconds); how long it took. */
function perform(p: Performer, step: () => void, max = 120) {
  for (let t = 0; t < max; t += DT) {
    if (!p.tick(DT)) return t;
    step();
  }
  return Infinity;
}

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));

describe('a performer', () => {
  it('appears, waits, walks somewhere along the walkways and does something there, in order', () => {
    const { s, untrack, step } = person('p1');
    cleanup.push(untrack, () => seatBody('p1'));
    const lift = spot(office, 'elevator')!;
    const done: string[] = [];
    const gong = spot(office, 'gong')!;
    const cues: Cue[] = [
      { place: CABIN, face: -Math.PI / 2 },
      { hold: 1, gesture: 'wave' },
      { run: () => done.push('in') },
      { walk: lift, straight: true },
      { walk: gong, face: gong.facing },
      { hold: 0.5, gesture: 'cheer' },
      { run: () => done.push('cheered') },
    ];
    const p = new Performer('p1', office, cues);
    const t = perform(p, step);
    expect(t).toBeLessThan(60);
    expect(done).toEqual(['in', 'cheered']);
    expect(Math.hypot(s.x - gong.x, s.z - gong.z)).toBeLessThan(0.15);
    expect(bodyTarget('p1')?.gesture).toBe('cheer');
    expect(Math.abs(s.heading - headingFor(gong.facing))).toBeLessThan(0.1);
    expect(p.done).toBe(true);
  });

  it('gets someone up from their desk first, and a wait leaves their body alone', () => {
    const { s, untrack, step } = person('p2');
    cleanup.push(untrack, () => seatBody('p2'));
    const window = spot(office, 'window-w0')!;
    let open = false;
    const p = new Performer('p2', office, [{ walk: window }, { run: () => seatBody('p2') }, { wait: () => open, max: 30 }]);
    let t = 0;
    for (; t < 60 && !bodyTarget('p2'); t += DT) {
      p.tick(DT);
      step();
    }
    expect(s.stage).not.toBe('seated'); // up out of the chair and on their way
    for (; t < 60 && p.at < 2; t += DT) {
      p.tick(DT);
      step();
    }
    expect(p.at).toBe(2);
    expect(bodyTarget('p2')).toBeUndefined(); // sat back down: the wait doesn't stand them up again
    open = true;
    expect(p.tick(DT)).toBe(false);
  });

  it('can be sent somewhere else halfway', () => {
    const { s, untrack, step } = person('p3');
    cleanup.push(untrack, () => seatBody('p3'));
    const p = new Performer('p3', office, [{ place: CABIN }, { hold: 100 }]);
    for (let i = 0; i < 10; i++) p.tick(DT), step();
    const lift = spot(office, 'elevator')!;
    p.redirect([{ walk: lift, straight: true }]);
    expect(perform(p, step)).toBeLessThan(20);
    expect(Math.hypot(s.x - lift.x, s.z - lift.z)).toBeLessThan(0.15);
  });
});
