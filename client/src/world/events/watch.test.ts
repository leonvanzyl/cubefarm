import { describe, expect, it, vi } from 'vitest';
import type { ErrandState } from '../errands';

// The store pulls in the sound module, which listens on window for the first click; tests run in node.
vi.stubGlobal('window', { addEventListener: () => undefined, location: { search: '' } });
const { HALF_W } = await import('../layout');
const { standable, walkways } = await import('../walkways');
const { errandNamed, wanted, errands } = await import('../errands');
const { setErrand } = await import('../people');
const { EVENT_IDS } = await import('./director');
const { endEvent, runningEvents, triggerEvent } = await import('./eventsState');
const { watchBeats, watchSpots } = await import('./watchPlan');
await import('./watch');

const state = (floor: 'office' | 'lobby' = 'office'): ErrandState => ({ floor, statusFor: 0, seatedFor: 0, restless: 1000, roll: 0.5, home: { id: 'desk-0', x: -10.5, z: 4.5, facing: 0 }, others: [] });

describe('where people watch from', () => {
  it('stands them along the windows and at the glass door on the event side, looking out', () => {
    for (const kind of ['office', 'lobby'] as const)
      for (const side of ['west', 'east'] as const) {
        const spots = watchSpots(kind, side);
        expect(spots.length).toBeGreaterThanOrEqual(4);
        expect(new Set(spots.map((s) => s.id)).size).toBe(spots.length);
        for (const s of spots) {
          expect(Math.sign(s.x)).toBe(side === 'west' ? -1 : 1);
          expect(Math.abs(s.x)).toBeGreaterThan(HALF_W - 1.5);
          expect(Math.cos(s.facing)).toBeCloseTo(side === 'west' ? -1 : 1);
        }
        // most are somewhere a person can stand (the rest are in the furniture and skipped)
        const w = walkways(kind);
        expect(spots.filter((s) => standable(w, s.x, s.z)).length).toBeGreaterThanOrEqual(3);
      }
  });

  it('reacts to every event in a dozen or so seconds of looking, pointing, gasping and cheering', () => {
    for (const id of EVENT_IDS)
      for (const roll of [0, 0.5, 0.99]) {
        const beats = watchBeats(id, roll);
        const total = beats.reduce((t, b) => t + b.seconds, 0);
        expect(total).toBeGreaterThan(6);
        expect(total).toBeLessThan(20);
      }
    expect(watchBeats('kaiju', 0).map((b) => b.gesture)).toContain('gasp');
    expect(watchBeats('fireworks', 0).map((b) => b.gesture)).toContain('cheer');
  });
});

describe('the watch errand', () => {
  const watch = errandNamed('watch')!;
  const idle = { id: 'ada', status: 'idle' as const, role: 'agent' };
  const busy = { id: 'linus', status: 'working' as const, role: 'agent' };

  it('is registered with the errand director', () => {
    expect(watch).toBeTruthy();
    expect(errands()).toContain(watch);
  });

  it('only calls idle people, and only while a big event is on', () => {
    expect(watch.when(idle, state())).toBe(false);
    const plane = triggerEvent('plane', 'west');
    plane.t = 10;
    expect(watch.when(idle, state())).toBe(false); // everyday events don't draw a crowd
    const kaiju = triggerEvent('kaiju', 'west');
    kaiju.t = 1;
    expect(watch.when(idle, state())).toBe(false); // a moment for it to get going
    kaiju.t = 10;
    expect(watch.when(idle, state())).toBe(true);
    expect(watch.when(busy, state())).toBe(false);
    expect(wanted(errands(), busy, state()).map((e) => e.name)).not.toContain('watch');
    kaiju.t = kaiju.seconds - 5;
    expect(watch.when(idle, state())).toBe(false); // too late to go
    for (const r of [...runningEvents()]) endEvent(r.key);
  });

  it('sends each watcher to their own spot on the event side', () => {
    const run = triggerEvent('ufo', 'east');
    run.t = 8;
    const a = watch.place!(idle, state());
    expect(a).toBeTruthy();
    setErrand('ada', { name: 'watch', phase: 'leaving', spot: a!.id }); // the director has her on her way
    const b = watch.place!({ ...idle, id: 'grace' }, state());
    expect(b).toBeTruthy();
    expect(b!.id).not.toBe(a!.id);
    expect(a!.x).toBeGreaterThan(0);
    expect(b!.x).toBeGreaterThan(0);
    setErrand('ada', null);
    endEvent(run.key);
  });
});
