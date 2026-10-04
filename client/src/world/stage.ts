// Moving people about outside the errand director, for the rituals (Rituals.tsx): the CEO and the pizza courier
// visiting a floor, the CEO leaving the lobby, and the team going home for the night and coming back in the morning.
// A performer works through a list of cues (appear somewhere, walk along the walkways, stand doing something for a
// while or until something happens, wait, or just do something) a frame at a time on the ritual clock, moving the
// body through people.ts as the gong run does, so it stops with the render.

import type { Gesture } from './body';
import { headingFor } from './errands';
import { bodyState, placeBody, setBody } from './people';
import type { Pt } from './toys/roombaBrain';
import { findPath, type Walkways } from './walkways';

type Facing = number | (() => number);

/** One thing a performer does. Facings are walkways.ts's (0 east, π/2 south). */
export type Cue =
  | { place: Pt; face?: number }
  | { walk: Pt; speed?: number; face?: number; gesture?: Gesture; straight?: boolean }
  | { hold: number; face?: Facing; gesture?: Gesture }
  | { until: () => boolean; max?: number; face?: Facing; gesture?: Gesture }
  /** Waits without touching the body (someone else moves them meanwhile: sitting down, a stand-up's presenter). */
  | { wait: () => boolean; max?: number }
  | { run: () => void };

/** How close to a corner (m) counts as round it, and to the end of a walk as there. */
const CORNER = 0.4;
const THERE = 0.12;
const STROLL = 1.1;

const faceOf = (f: Facing | undefined, fallback: number) => (f === undefined ? fallback : headingFor(typeof f === 'function' ? f() : f));

export class Performer {
  private cues: Cue[];
  private i = -1;
  private t = 0;
  private legs: Pt[] = [];
  private leg = 0;
  /** Where they stand still: where they appeared or last walked to. */
  private pin: Pt | null = null;

  constructor(
    readonly id: string,
    private w: Walkways,
    cues: Cue[],
  ) {
    this.cues = [...cues];
  }

  /** Out of cues. */
  get done() {
    return this.i >= this.cues.length;
  }

  /** Which cue it's on, for the probe. */
  get at() {
    return this.i;
  }

  /** Drops what's left and does `cues` instead (called back to their desk, say). */
  redirect(cues: Cue[]) {
    this.cues = [...cues];
    this.i = -1;
  }

  /** One frame: false once every cue is done. */
  tick(dt: number): boolean {
    if (this.i < 0) this.next();
    while (!this.done) {
      const c = this.cues[this.i];
      if ('run' in c) {
        c.run();
        this.next();
        continue;
      }
      if ('place' in c) {
        placeBody(this.id, c.place.x, c.place.z, headingFor(c.face ?? -Math.PI / 2));
        this.pin = { ...c.place };
        this.next();
        continue;
      }
      if ('wait' in c) {
        this.t += dt;
        if (!c.wait() && this.t < (c.max ?? Infinity)) return true;
        this.pin = null;
        this.next();
        continue;
      }
      const s = bodyState(this.id);
      if (!s) return true; // not drawn yet
      if ('walk' in c) {
        if (!this.walk(c, s)) return true;
        this.next();
        continue;
      }
      this.t += dt;
      this.pin ??= { x: s.x, z: s.z };
      setBody(this.id, { mode: 'standing', x: this.pin.x, z: this.pin.z, heading: faceOf(c.face, s.heading), gesture: c.gesture ?? 'none' });
      if (!('hold' in c ? this.t >= c.hold : c.until() || this.t >= (c.max ?? Infinity))) return true;
      this.next();
    }
    return false;
  }

  private next() {
    this.i++;
    this.t = 0;
    this.legs = [];
    this.leg = 0;
  }

  /** A frame of the cue's walk; true once there and stopped. */
  private walk(c: Extract<Cue, { walk: Pt }>, s: NonNullable<ReturnType<typeof bodyState>>): boolean {
    const up = s.stage === 'up';
    if (!this.legs.length) {
      // seated (or getting up), they set off from beside their chair
      const from = up ? { x: s.x, z: s.z } : { x: s.standX, z: s.standZ };
      this.legs = (!c.straight && findPath(this.w, from, c.walk)) || [c.walk];
      this.aim(c, from);
    }
    if (!up) return false;
    const p = this.legs[this.leg];
    const d = Math.hypot(p.x - s.x, p.z - s.z);
    if (this.leg < this.legs.length - 1) {
      if (d < CORNER) {
        this.leg++;
        this.aim(c, p);
      }
      return false;
    }
    if (d >= THERE || s.speed >= 0.05) return false;
    this.pin = { x: p.x, z: p.z };
    return true;
  }

  private aim(c: Extract<Cue, { walk: Pt }>, from: Pt) {
    const p = this.legs[this.leg];
    const last = this.leg === this.legs.length - 1;
    const heading = last && c.face !== undefined ? headingFor(c.face) : Math.atan2(-(p.x - from.x), -(p.z - from.z));
    setBody(this.id, { mode: 'walking', x: p.x, z: p.z, heading, speed: c.speed ?? STROLL, gesture: c.gesture ?? 'none' });
  }
}
