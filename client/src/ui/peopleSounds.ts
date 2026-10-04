// The sounds of the people around you (peopleSoundRules.ts decides when): their footsteps (footsteps.ts's voices at
// their feet), the chair rolling and creaking as they get up and sit down, a sticky peeled off the board and slapped
// back on, a sigh as they stretch, a yawn as they nod off and a soft "blah blah" while two of them chat. All of it is
// positional and quiet. Character.tsx calls hearBody() every frame, so nothing plays (or piles up) while the 3D view
// is paused, and nothing plays while you're in the elevator or have a panel open.

import { useStore } from '../store';
import type { BodyState } from '../world/body';
import { surfaceAt } from '../world/layout';
import { footstepAt, scuffAt } from './footsteps';
import { HURRYING, hearPerson, newHearing, type Crowd, type Hearing } from './peopleSoundRules';
import { listenerAt, noise, recordSfx, tone, type Vec3 } from './sfx';

// ---------- the voices ----------

const r = () => Math.random();

/** The chair's casters: a short low rumble with a couple of ticks. */
export function chairRoll(pos: Vec3) {
  const into = recordSfx('chair:roll', { group: 'steps', pos, peak: 0.022 });
  const o = { group: 'steps', pos, into } as const;
  noise({ ...o, dur: 0.38, peak: 0.022, freq: 320 + r() * 60, to: 170, q: 0.7, attack: 0.08 });
  [0.06, 0.19].forEach((at) => noise({ ...o, at: at + r() * 0.04, dur: 0.025, peak: 0.006, filter: 'bandpass', freq: 2200 + r() * 600, q: 3, attack: 0.002 }));
}

/** The seat's creak as the weight comes on or off: a thin rising squeak over a little body. */
export function chairCreak(pos: Vec3) {
  const into = recordSfx('chair:creak', { group: 'steps', pos, peak: 0.012 });
  const o = { group: 'steps', pos, into } as const;
  const f = 200 + r() * 70;
  tone({ ...o, freq: f, to: f * 1.35, type: 'sawtooth', dur: 0.2, peak: 0.006, attack: 0.04 });
  noise({ ...o, dur: 0.18, peak: 0.012, filter: 'bandpass', freq: 1300 + r() * 300, q: 6, attack: 0.05 });
}

/** A sticky coming off the board: a short papery rip. */
export function stickyPeel(pos: Vec3) {
  noise({ name: 'sticky:peel', group: 'typing', pos, dur: 0.16, peak: 0.024, filter: 'bandpass', freq: 2600 + r() * 500, to: 5200, q: 1.4, attack: 0.1 });
}

/** A sticky pressed back onto the board: a soft papery slap. */
export function stickySlap(pos: Vec3) {
  const into = recordSfx('sticky:slap', { group: 'typing', pos, peak: 0.035 });
  noise({ group: 'typing', pos, into, dur: 0.06, peak: 0.035, freq: 1100 + r() * 300, q: 0.7, attack: 0.001 });
  tone({ group: 'typing', pos, into, freq: 240, to: 150, dur: 0.05, peak: 0.01, attack: 0.002 });
}

/** A breathy sigh of relief: air falling in pitch, with a hint of voice under it. */
export function sigh(pos: Vec3) {
  const into = recordSfx('sigh', { group: 'typing', pos, peak: 0.02 });
  const o = { group: 'typing', pos, into } as const;
  noise({ ...o, dur: 0.9, peak: 0.02, filter: 'bandpass', freq: 950, to: 480, q: 1.4, attack: 0.25 });
  tone({ ...o, freq: 250 + r() * 40, to: 175, dur: 0.75, peak: 0.006, attack: 0.2 });
}

/** A tiny yawn: a voice opening up and sliding down, with a breath. */
export function yawn(pos: Vec3) {
  const into = recordSfx('yawn', { group: 'typing', pos, peak: 0.012 });
  const o = { group: 'typing', pos, into } as const;
  const f = 240 + r() * 50;
  tone({ ...o, freq: f, to: f * 1.45, type: 'triangle', dur: 0.45, peak: 0.01, attack: 0.15 });
  tone({ ...o, freq: f * 1.45, to: f * 0.8, type: 'triangle', at: 0.42, dur: 0.6, peak: 0.012, attack: 0.05 });
  noise({ ...o, dur: 1.0, peak: 0.007, filter: 'bandpass', freq: 750, to: 450, q: 1.2, attack: 0.3 });
}

/** Two to four soft cartoon "blah" syllables (no words): one murmur of a chat. */
export function murmur(pos: Vec3) {
  const into = recordSfx('chat:blah', { group: 'typing', pos, peak: 0.012 });
  const o = { group: 'typing', pos, into } as const;
  const base = 170 + r() * 110; // everyone has their own voice, more or less
  const n = 2 + Math.floor(r() * 3);
  for (let i = 0, at = 0; i < n; i++, at += 0.16 + r() * 0.08) {
    const f = base * (0.9 + r() * 0.25);
    const dur = 0.1 + r() * 0.07;
    tone({ ...o, at, freq: f, to: f * (i === n - 1 ? 0.82 : 1.04), type: 'triangle', dur, peak: 0.011, attack: 0.02 });
    tone({ ...o, at, freq: f * 3.1, to: f * 2.6, dur: dur * 0.8, peak: 0.003, attack: 0.02 }); // the open "ah"
  }
}

/** What a gesture sounds like as it starts and ends (body.ts's gestures; ones not listed are silent). */
const GESTURES: Record<string, { start?: (pos: Vec3) => void; end?: (pos: Vec3) => void }> = {
  reach: { start: stickyPeel, end: stickySlap }, // at the board: a sticky comes off, then goes up where it belongs
  stretch: { start: sigh },
  doze: { start: yawn },
};

// ---------- everyone on the floor ----------

const people = new Map<string, Hearing>();
const crowd: Crowd = { people: [], lastMurmur: -Infinity };

/** Character.tsx registers each person it draws; the returned function forgets them (a floor change). */
export function hearing(id: string) {
  const h = newHearing();
  people.set(id, h);
  crowd.people = [...people.values()];
  return () => {
    if (people.get(id) === h) people.delete(id);
    crowd.people = [...people.values()];
  };
}

const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const frame = { stage: 'seated' as BodyState['stage'], x: 0, z: 0, speed: 0, phase: 0, gesture: 'none', d: 0 };

/**
 * Called by Character.tsx every frame with their body (after stepBody), the gesture they're making and the floor's
 * height. Plays what peopleSoundRules.ts asks for.
 */
export function hearBody(id: string, s: BodyState, gesture: string, dt: number, floorY = 0) {
  const h = people.get(id);
  if (!h) return;
  const ear = listenerAt();
  frame.stage = s.stage;
  frame.x = s.x;
  frame.z = s.z;
  frame.speed = s.speed;
  frame.phase = s.phase;
  frame.gesture = gesture;
  frame.d = Math.hypot(ear.x - s.x, ear.y - floorY - 1, ear.z - s.z);
  const events = hearPerson(h, frame, crowd, dt, performance.now() / 1000, Math.random());
  if (!events.length) return;
  const st = useStore.getState();
  if (st.travel !== null || st.overlay !== null) return; // you're busy elsewhere, not listening to the floor
  for (const e of events) {
    switch (e) {
      case 'step':
      case 'scuff': {
        const feet = at(s.x, floorY + 0.05, s.z);
        const surface = surfaceAt(st.floor === 0 ? 'lobby' : 'office', s.x, s.z);
        if (e === 'step') footstepAt(surface, feet, s.speed >= HURRYING, h.steps.foot);
        else scuffAt(surface, feet);
        break;
      }
      case 'rise':
        chairCreak(at(s.seatX, floorY + 0.45, s.seatZ));
        chairRoll(at(s.seatX, floorY + 0.2, s.seatZ));
        break;
      case 'sit':
        chairRoll(at(s.seatX, floorY + 0.2, s.seatZ));
        break;
      case 'seated':
        chairCreak(at(s.seatX, floorY + 0.45, s.seatZ));
        break;
      case 'murmur':
        murmur(at(s.x, floorY + 1.5, s.z));
        break;
      default: {
        const [edge, name] = e.split(':') as ['start' | 'end', string];
        const play = GESTURES[name]?.[edge];
        // in front of their face: where their hands (and the board) are
        if (play) play(at(s.x - Math.sin(s.heading) * 0.4, floorY + 1.5, s.z - Math.cos(s.heading) * 0.4));
      }
    }
  }
}
