import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentStatus } from '../../../shared/types';
import { errandNamed, type ErrandAgent, type ErrandScript, type ErrandState, type Me } from './errands';
import { lunchWait, meals, resetMeals } from './meals';
import { handFood, saying } from './people';
import { KITCHEN_SPOTS, TABLE_SPOTS, lunchOf } from './ritualSchedule';
import { spot, walkways } from './walkways';

const office = walkways('office');
const lunch = () => errandNamed('lunch')!;
const pizza = () => errandNamed('pizza')!;
const agent = (id: string, status: AgentStatus = 'idle'): ErrandAgent => ({ id, status, role: 'agent' });
const state = (over: Partial<ErrandState> = {}): ErrandState => ({ floor: 'office', statusFor: 100, seatedFor: 60, restless: 30, roll: 0.2, home: spot(office, 'desk-0')!, ...over });
const me = (dt: number): Me => ({ id: '', x: 0, z: 0, heading: 0, arrived: true, dt, player: { x: 0, z: 0 } });

/** Goes on errand `name` the way the director would; null when it won't have them. */
function go(name: 'lunch' | 'pizza', id: string, s = state()) {
  const e = name === 'lunch' ? lunch() : pizza();
  const at = e.place!(agent(id), s);
  if (!at || !e.claim!(id)) return null;
  return { at, script: e.script!(agent(id), 'office')! };
}

/** Ticks a script until it's done (or `max` seconds); the gestures it made. */
function run(script: ErrandScript, max = 60) {
  const gestures = new Set<string>();
  for (let t = 0; t < max; t += 0.1) {
    const act = script.tick(me(0.1));
    if (act.do === 'done') return { gestures, t };
    gestures.add(act.gesture);
  }
  return { gestures, t: Infinity };
}

beforeEach(() => resetMeals());

describe('lunch', () => {
  it('only at lunchtime, only for free people, once each, and in turns', () => {
    expect(lunch().when(agent('a'), state())).toBe(false);
    meals.lunch = true;
    expect(lunch().when(agent('a'), state())).toBe(true);
    expect(lunch().when(agent('a', 'working'), state())).toBe(false);
    expect(lunch().when(agent('a'), state({ seatedFor: lunchWait(0.2) - 1 }))).toBe(false);
    expect(lunch().when(agent('a'), state({ floor: 'lobby' }))).toBe(false);
    meals.ate.add('a');
    expect(lunch().when(agent('a'), state())).toBe(false);
  });

  it('takes a spot at the coffee table or the kitchenette, with their own lunch in hand, and chats with whoever is there', () => {
    meals.lunch = true;
    const a = go('lunch', 'a')!;
    expect([...TABLE_SPOTS, ...KITCHEN_SPOTS].map((s) => s.id)).toContain(a.at.id);
    expect(handFood('a')).toBe(lunchOf('a'));
    expect(meals.ate.has('a')).toBe(true);
    // the next one joins them where they are
    const b = go('lunch', 'b')!;
    const venue = (id: string) => (TABLE_SPOTS.some((s) => s.id === id) ? 'table' : 'kitchen');
    expect(b.at.id).not.toBe(a.at.id);
    expect(venue(b.at.id)).toBe(venue(a.at.id));
    const { gestures, t } = run(a.script);
    expect(gestures).toEqual(new Set(['none', 'sip', 'talk']));
    expect(t).toBeGreaterThan(10);
    expect(t).toBeLessThan(25);
    a.script.end();
    expect(handFood('a')).toBeNull();
    expect(saying('a')).toBeUndefined();
    expect([...meals.spots.keys()]).toEqual(['b']);
  });

  it('no spot left: nobody else goes until one frees up', () => {
    meals.lunch = true;
    const all = [...TABLE_SPOTS, ...KITCHEN_SPOTS];
    all.forEach((_, i) => expect(go('lunch', `p${i}`)).not.toBeNull());
    expect(go('lunch', 'late')).toBeNull();
  });
});

describe('Friday pizza', () => {
  it('a slice each while there are any, at the coffee table', () => {
    expect(pizza().when(agent('a'), state())).toBe(false);
    Object.assign(meals, { pizza: true, slices: 2 });
    expect(pizza().when(agent('a'), state())).toBe(true);
    const a = go('pizza', 'a')!;
    expect(TABLE_SPOTS.map((s) => s.id)).toContain(a.at.id);
    expect(handFood('a')).toBeNull(); // not until they take it off the table
    a.script.tick(me(0.1));
    expect(meals.slices).toBe(1);
    expect(handFood('a')).toBe('pizza');
    expect(pizza().when(agent('a'), state())).toBe(false); // one each
    const { gestures } = run(a.script);
    expect(gestures).toEqual(new Set(['stoop', 'none', 'sip', 'talk']));
    a.script.end();
    expect(handFood('a')).toBeNull();
  });

  it('the last slice taken meanwhile: a shrug, and back to their desk', () => {
    Object.assign(meals, { pizza: true, slices: 1 });
    const a = go('pizza', 'a')!;
    meals.slices = 0;
    const { gestures, t } = run(a.script);
    expect(gestures).toEqual(new Set(['shrug']));
    expect(t).toBeLessThan(2);
    expect(handFood('a')).toBeNull();
  });
});
