// A snack break, as pure decisions: a free, restless agent waits their turn for the fridge (one at its door at a
// time, never while the player is at it), opens it, takes their favourite (fridge.ts; something else when that's
// sold out, a shrug when the fridge is bare), shuts it, then eats or drinks it by the counter in a couple of bites
// or sips, or takes it back to their desk. SnackBreak is the errand's actor (errands.ts `act`); the fridge, hands and
// sounds come in through FridgeWorld, so it's tested without a scene. fridgeErrand.ts wires it to fridgeState.ts.

import type { Gesture } from './body';
import { BREAK, pickSeat, leaveSeat } from './coffeeBreak';
import type { ActStep, ErrandActor } from './errands';
import { SNACKS, pickFor, type SnackCue, type SnackId, type Stock } from './fridge';

/** The fridge's spots (walkways.ts): its door (clear of the door's swing), two to wait at, and two to eat at. */
export const SNACK_SPOTS = {
  door: 'fridge',
  line: ['fridge-line', 'fridge-line-1'],
  eat: ['snack-0', 'snack-1'],
} as const;

export const SNACK = {
  /** At most this many on a snack break per floor at once (and one of them at the door). */
  max: 2,
  /** The share of restless moments that become a snack break: the next slice after coffee's, so never both. */
  chance: 0.22,
  /** Waiting for the door this long (s): give up and go back. */
  wait: 30,
  /** Seconds to open or shut the door, to look in and take something, and to shrug at a bare fridge. */
  reach: 0.7,
  pick: 1.2,
  shrug: 1.4,
  /** A sip or a bite, and the chat after it (s). */
  bite: 1.5,
  chat: [1.6, 3.2] as const,
  /** The share who have it by the counter; the rest take it back to their desk. */
  stay: 0.6,
};

/** Does this person fancy a snack now? About one restless moment in five, never the ones that fancy a coffee. */
export function fanciesSnack(restless: number, chance = SNACK.chance) {
  const f = (restless * 97.31) % 1;
  return f >= BREAK.chance && f < BREAK.chance + chance;
}

/** A snack in someone's hand, and the sips or bites left. */
export interface HeldSnack {
  snack: SnackId;
  left: number;
}

export interface EatStep {
  gesture: Gesture;
  seconds: number;
  /** A sip or a bite comes off halfway through. */
  bite?: boolean;
}

/** All of it, by the counter: a sip or bite, a chat, and so on; a moment's pause after the last. `rand` in [0, 1). */
export function eatPlan(left: number, rand: number): EatStep[] {
  const out: EatStep[] = [];
  for (let i = 0; i < left; i++) {
    out.push({ gesture: 'sip', seconds: SNACK.bite, bite: true });
    const k = (rand * 7.3 + i * 0.37) % 1;
    out.push(i < left - 1 ? { gesture: 'chat', seconds: SNACK.chat[0] + (SNACK.chat[1] - SNACK.chat[0]) * k } : { gesture: 'none', seconds: 1 });
  }
  return out;
}

/** What the snack break needs from the world. */
export interface FridgeWorld {
  /** The player is at the fridge: they go first. */
  playerBusy(): boolean;
  /** Takes the door (one at a time; true when it's theirs), and lets go of it. */
  claim(who: string): boolean;
  release(who: string): void;
  isOpen(): boolean;
  open(who: string): void;
  close(who: string): void;
  stock(): Readonly<Stock> | null;
  /** Takes one off the shelf; false when it's gone. */
  take(who: string, snack: SnackId): boolean;
  /** The snack in their hand (null: empty-handed), one of its sounds from there, and an emoji over their head. */
  hold(who: string, snack: HeldSnack | null): void;
  sound(who: string, cue: SnackCue): void;
  say(who: string, text: string): void;
  /** Who waits where for the door, and who eats where (spot → who). */
  line: Map<string, string>;
  seats: Map<string, string>;
}

export type SnackStage = 'wait' | 'door' | 'pick' | 'shrug' | 'close' | 'eat' | 'done';

/**
 * One person's snack break, from the line by the fridge (the errand's spot) until they set off home. `step` is called
 * every frame with the director's clock (seconds) and whether they've reached the spot it last asked for.
 */
export class SnackBreak implements ErrandActor {
  stage: SnackStage = 'wait';
  held: HeldSnack | null = null;
  private busy: { until: number; gesture: Gesture; then: () => void } | null = null;
  private waitAt: number | null = null;
  private eats: EatStep[] | null = null;
  private eatAt = 0;
  private eatStep = -1;
  // The spot last walked to (the errand starts at the line) and whether they're there.
  private target: string = SNACK_SPOTS.line[0];
  private there = false;

  constructor(
    readonly id: string,
    private world: FridgeWorld,
    private rand: () => number = Math.random,
  ) {}

  /** What their hands do on the walk home: carrying their snack. */
  get carry(): Gesture {
    return this.held ? 'hold' : 'none';
  }

  private walk(spot: string): ActStep {
    if (!(SNACK_SPOTS.line as readonly string[]).includes(spot)) leaveSeat(this.world.line, this.id);
    if (spot !== this.target) this.there = false;
    this.target = spot;
    return { walk: spot, gesture: this.held ? 'hold' : 'none' };
  }

  private at(spot: string) {
    return this.there && this.target === spot;
  }

  /** Do something at the fridge for `seconds`, then `then`. */
  private act(now: number, seconds: number, gesture: Gesture, then: () => void): ActStep {
    this.busy = { until: now + seconds, gesture, then };
    return { stand: gesture };
  }

  private holding(s: HeldSnack | null) {
    this.held = s;
    this.world.hold(this.id, s);
  }

  /** Off home: the door is someone else's, and so are their spots. */
  private quit(): ActStep {
    const w = this.world;
    w.release(this.id);
    leaveSeat(w.line, this.id);
    leaveSeat(w.seats, this.id);
    this.stage = 'done';
    return 'done';
  }

  /** Back in line, letting go of the door. */
  private backInLine(): ActStep {
    this.world.release(this.id);
    this.stage = 'wait';
    return this.walk(pickSeat(this.world.line, this.id, SNACK_SPOTS.line) ?? SNACK_SPOTS.line[0]);
  }

  /** A sip or bite off the snack, with its sound: the last one finishes it. */
  private bite() {
    const h = this.held;
    if (!h) return;
    const def = SNACKS[h.snack];
    const last = h.left <= 1;
    this.world.sound(this.id, last ? def.last : def.bite);
    if (!last) return this.holding({ ...h, left: h.left - 1 });
    if (def.done) this.world.sound(this.id, def.done);
    this.holding(null);
  }

  step(now: number, arrived: boolean): ActStep {
    const w = this.world;
    this.there = arrived;
    if (this.busy) {
      if (now < this.busy.until) return { stand: this.busy.gesture };
      const then = this.busy.then;
      this.busy = null;
      then();
    }
    switch (this.stage) {
      case 'wait': {
        this.waitAt ??= now;
        if (!w.playerBusy() && w.claim(this.id)) {
          this.stage = 'door';
          return this.walk(SNACK_SPOTS.door);
        }
        if (now - this.waitAt > SNACK.wait) return this.quit();
        const spot = pickSeat(w.line, this.id, SNACK_SPOTS.line) ?? SNACK_SPOTS.line[0];
        if (!this.at(spot)) return this.walk(spot);
        return { stand: 'none' };
      }
      case 'door': {
        if (!this.at(SNACK_SPOTS.door)) return this.walk(SNACK_SPOTS.door);
        // the player came up meanwhile: they go first
        if (w.playerBusy()) return this.backInLine();
        if (w.isOpen()) {
          this.stage = 'pick';
          return this.step(now, true);
        }
        return this.act(now, SNACK.reach, 'reach', () => {
          w.open(this.id);
          this.stage = 'pick';
        });
      }
      case 'pick':
        return this.act(now, SNACK.pick, 'reach', () => {
          const stock = w.stock();
          const snack = stock ? pickFor(this.id, stock) : null;
          if (snack && w.take(this.id, snack)) {
            this.holding({ snack, left: SNACKS[snack].portions });
            w.say(this.id, SNACKS[snack].emoji);
            this.stage = 'close';
          } else this.stage = 'shrug';
        });
      case 'shrug':
        return this.act(now, SNACK.shrug, 'shrug', () => {
          this.stage = 'close';
        });
      case 'close':
        return this.act(now, SNACK.reach, 'tap', () => {
          // not in the player's face: they'll shut it themselves (or it shuts by itself)
          if (w.isOpen() && !w.playerBusy()) w.close(this.id);
          w.release(this.id);
          this.stage = this.held && this.rand() < SNACK.stay ? 'eat' : 'done';
        });
      case 'eat': {
        if (!this.held && !this.eats) return this.quit();
        const seat = pickSeat(w.seats, this.id, SNACK_SPOTS.eat);
        // nowhere by the counter: have it at the desk
        if (!seat) return this.quit();
        if (!this.eats && !this.at(seat)) return this.walk(seat);
        if (!this.eats) {
          this.eats = eatPlan(this.held!.left, this.rand());
          this.eatStep = -1;
          this.eatAt = now;
        }
        const cur = this.eats[this.eatStep];
        if (!cur || now >= this.eatAt) {
          this.eatStep++;
          const next = this.eats[this.eatStep];
          if (!next) return this.quit();
          this.eatAt = now + next.seconds;
          const h = this.held;
          if (next.bite && h) {
            const def = SNACKS[h.snack];
            if (h.left >= def.portions && def.open) w.sound(this.id, def.open); // opening it on the way up
            return this.act(now, next.seconds / 2, 'sip', () => this.bite());
          }
          if (cur?.bite && h) w.sound(this.id, SNACKS[h.snack].after);
          return { stand: next.gesture };
        }
        return { stand: cur.gesture };
      }
      case 'done':
        return 'done';
    }
  }

  /** Work came in: let go of the door (left open, it shuts by itself) and go. A snack in hand comes along. */
  abort() {
    this.world.release(this.id);
    leaveSeat(this.world.line, this.id);
    leaveSeat(this.world.seats, this.id);
    this.busy = null;
    this.stage = 'done';
  }

  /** Back in their chair (`seated`), or the floor was left: whatever's left of the snack is gone. */
  end() {
    this.abort();
    if (this.held) this.holding(null);
  }
}
