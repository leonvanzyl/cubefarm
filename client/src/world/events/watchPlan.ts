// Where people watch a world event from and how they react (watch.ts sends them): the spots along the windows and at
// the glass door on the event's side, and a few beats of looking, pointing, gasping and cheering that fit the event.
// Pure, so it's tested without a browser.

import type { Gesture } from '../body';
import { HALF_W, SIDE_OPENINGS, WINDOW, sideSign, type Side } from '../layout';
import type { FloorKind, Spot } from '../walkways';
import type { EventId } from './director';

const EAST = 0;
const WEST = Math.PI;
/** How far in from the wall they stand: close enough to see up out of the window. */
const IN = 0.85;
/** People spread along a window this far apart. */
const APART = 1.1;
/** The places to watch from on `side`: along each window and in front of the glass door, looking out. */
export function watchSpots(kind: FloorKind, side: Side): Spot[] {
  const s = sideSign(side);
  const { door, windows } = SIDE_OPENINGS[kind][side];
  const x = s * (HALF_W - IN);
  const facing = side === 'west' ? WEST : EAST;
  const along = [...windows.flatMap((z) => [-1, 0, 1].map((k) => z + k * Math.min(APART, WINDOW.w / 3))), door];
  return along.map((z, i) => ({ id: `watch-${side}-${i}`, x, z, facing }));
}

/** One beat of watching: a gesture for a few seconds, maybe with an emoji bubble. */
export interface Beat {
  gesture: Gesture;
  seconds: number;
  say?: string;
}

/** How someone reacts to an event (`roll` in [0, 1) picks among the reactions that fit). About 12-18 s in all. */
export function watchBeats(id: EventId, roll: number): Beat[] {
  const look: Beat = { gesture: 'none', seconds: 1.6 };
  const r = Math.min(0.999, Math.max(0, roll));
  const pick = <T>(options: T[]) => options[Math.floor(r * options.length)];
  switch (id) {
    case 'kaiju':
      return [look, { gesture: 'gasp', seconds: 2.4, say: pick(['😱', '🦖', '😮']) }, { gesture: 'point', seconds: 3, say: '👉' }, { gesture: 'cheer', seconds: 2.6, say: pick(['🦖', '🙌', '😂']) }, { gesture: 'point', seconds: 3 }];
    case 'ufo':
      return [look, { gesture: 'gasp', seconds: 2.5, say: '👽' }, { gesture: 'point', seconds: 3.5, say: pick(['🛸', '😮', '🚗']) }, { gesture: 'gasp', seconds: 2 }, { gesture: 'none', seconds: 2 }];
    case 'fireworks':
      return [look, { gesture: 'cheer', seconds: 3, say: '🎆' }, { gesture: 'point', seconds: 2.5 }, { gesture: 'cheer', seconds: 3, say: pick(['🎇', '😍', '🙌']) }, { gesture: 'none', seconds: 2 }];
    case 'duck':
    case 'whale':
      return [look, { gesture: 'point', seconds: 3, say: id === 'duck' ? '🦆' : '🐋' }, { gesture: pick<Gesture>(['gasp', 'cheer', 'wave']), seconds: 2.6, say: pick(['😂', '😮', '🤩']) }, { gesture: 'wave', seconds: 2.5 }, { gesture: 'none', seconds: 1.5 }];
    case 'rainbow':
      return [look, { gesture: 'point', seconds: 3, say: '🌈' }, { gesture: 'none', seconds: 3 }, { gesture: 'cheer', seconds: 2, say: '😍' }];
    case 'meteors':
      return [look, { gesture: 'point', seconds: 2.5, say: '🌠' }, { gesture: 'none', seconds: 2.5 }, { gesture: 'point', seconds: 2.5, say: pick(['✨', '🤩']) }, { gesture: 'none', seconds: 2 }];
    case 'hurricane':
      return [look, { gesture: 'gasp', seconds: 2.5, say: '🌀' }, { gesture: 'point', seconds: 3 }, { gesture: 'none', seconds: 3, say: '😬' }];
    case 'blimp':
    case 'skywriting':
      return [look, { gesture: 'point', seconds: 3.5, say: pick(['👀', '📣', '😄']) }, { gesture: 'none', seconds: 2.5 }, { gesture: 'cheer', seconds: 2.4, say: '🎉' }, { gesture: 'none', seconds: 1.5 }];
    default:
      return [look, { gesture: 'point', seconds: 3, say: '👀' }, { gesture: 'none', seconds: 3 }];
  }
}
