import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { createStepTracker } from '../../ui/footstepRules';
import { listenerAt, noise, tone, type Vec3 } from '../../ui/sfx';
import { surfaceAt } from '../layout';
import type { ToyFloor } from './balls';
import { DOG_EVENT, type Dog } from './dogBrain';
import { GALLOP } from './dogRig';
import { clawLevel, mayVoice, pantDue, pawDown, tapDue } from './dogSound';

// The dog's sounds, synthesized and from where it is, in the toys group and quiet: a soft woof (a pet, a ball back at
// your feet), one bark at the passing roomba, a delighted yip, little sniffs, panting while it runs and for a while
// after, and claws tapping on hard floors (dogSound.ts decides when).

const o = (name: string, pos: Vec3) => ({ name: `dog:${name}`, group: 'toys', pos }) as const;

/** A soft, round "wuf": a falling tone with a breathy bark of noise round it. */
function woof(pos: Vec3) {
  tone({ ...o('woof', pos), freq: 290, to: 165, type: 'triangle', dur: 0.17, peak: 0.06, attack: 0.012 });
  tone({ ...o('woof', pos), freq: 580, to: 330, type: 'triangle', dur: 0.1, peak: 0.016, attack: 0.01 });
  noise({ ...o('woof', pos), dur: 0.15, peak: 0.045, filter: 'bandpass', freq: 700, to: 380, q: 1.3, attack: 0.01 });
}

/** A sharper, louder "ruff!" at the roomba. */
function bark(pos: Vec3) {
  tone({ ...o('bark', pos), freq: 430, to: 250, type: 'triangle', dur: 0.12, peak: 0.08, attack: 0.006 });
  noise({ ...o('bark', pos), dur: 0.11, peak: 0.07, filter: 'bandpass', freq: 1150, to: 600, q: 1.4, attack: 0.005 });
}

/** Two quick happy yips. */
function yip(pos: Vec3) {
  [0, 0.13].forEach((at, i) => tone({ ...o('yip', pos), at, freq: 720 + i * 120, to: 980 + i * 120, type: 'triangle', dur: 0.08, peak: 0.045, attack: 0.006 }));
}

/** Snf-snf-snf. */
function sniff(pos: Vec3) {
  for (let i = 0; i < 3; i++) noise({ ...o('sniff', pos), at: i * 0.12, dur: 0.06, peak: 0.012, filter: 'bandpass', freq: 2600, q: 1.6, attack: 0.01 });
}

/** One breath of a pant: in a touch brighter than out. */
function pant(pos: Vec3, out: boolean) {
  noise({ ...o('pant', pos), dur: 0.11, peak: out ? 0.009 : 0.011, filter: 'bandpass', freq: out ? 1200 : 1700, q: 0.9, attack: 0.02 });
}

/** A claw on a hard floor: a tiny bright tick. */
function claw(pos: Vec3, level: number) {
  noise({ ...o('claw', pos), dur: 0.018, peak: 0.006 * level * (0.85 + Math.random() * 0.3), filter: 'bandpass', freq: 3600 * (0.9 + Math.random() * 0.2), q: 2.2, attack: 0.001 });
}

/** `pending` collects the brain's events from each physics step (Dog.tsx); `gait.phase` is the walk cycle DogLook keeps. */
export function DogSounds({ brain, pending, gait, floor }: { brain: Dog; pending: { bits: number }; gait: { phase: number }; floor: ToyFloor }) {
  const t = useMemo(() => ({ voice: -Infinity, pant: -Infinity, tap: -Infinity, breath: 0, steps: createStepTracker(), pos: { x: 0, y: 0, z: 0 } }), []);
  useFrame(() => {
    const now = performance.now() / 1000;
    const pos = t.pos;
    pos.x = brain.x;
    pos.y = brain.y + 0.5;
    pos.z = brain.z;
    const ev = pending.bits;
    pending.bits = 0;
    if (ev & (DOG_EVENT.woof | DOG_EVENT.bark | DOG_EVENT.yip) && mayVoice(t.voice, now)) {
      t.voice = now;
      if (ev & DOG_EVENT.bark) bark(pos);
      else if (ev & DOG_EVENT.yip) yip(pos);
      else woof(pos);
    }
    if (ev & DOG_EVENT.sniff) sniff(pos);
    const ear = listenerAt();
    const dist = Math.hypot(ear.x - pos.x, ear.y - pos.y, ear.z - pos.z);
    if (pantDue(brain.pant > 0 || brain.speed > GALLOP, dist, t.pant, now)) {
      t.pant = now;
      pant(pos, t.breath++ % 2 === 1);
    }
    const paw = pawDown(t.steps, gait.phase, brain.speed > 0.15 && brain.y < 0.05);
    const surface = surfaceAt(floor, brain.x, brain.z);
    if (tapDue(paw, surface, dist, t.tap, now)) {
      t.tap = now;
      pos.y = 0.02;
      claw(pos, clawLevel(surface));
    }
  });
  return null;
}
