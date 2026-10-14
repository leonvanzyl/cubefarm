// A snack break, as pure decisions: an idle person goes to the kitchenette, waits by the counter until the fridge is
// free (one at the door at a time, never while the player is at it), opens it, takes their favourite (or whatever's
// left, or shrugs at a bare fridge), shuts it, and has it by the counter in a couple of bites or sips, or takes it back
// to their desk. FridgeBreak is the errand's actor (errands.ts `act`); the fridge, hands and sounds come in through
// SnackWorld, so it's tested without a scene. fridgeErrand.ts wires it to fridgeState.ts and the people.

import type { Gesture } from './body';
import type { ActStep, ErrandActor } from './errands';
import type { SnackId } from './fridge';
import { leaveSeat, pickSeat } from './coffeeBreak';

/** The fridge's spots (walkways.ts): in front of its door (clear of the swing), and two by the counter to eat at. */
export const SNACK_SPOTS = {
  door: 'fridge',
  eat: ['fridge-eat-0', 'fridge-eat-1'],
} as const;

export const SNACK = {
  /** At most this many people on a snack break per floor at once (and only one at the door). */
  max: 2,
  /** The share of restless moments that become a snack break: like coffee's, on a roll of its own. */
  chance: 0.22,
  early: 0.8,
  /** Waiting for the fridge this long (s): give up and go back. */
  wait: 40,
  /** Seconds to open the door, pick something, shut the door; a shrug at a bare fridge. */
  open: 0.7,
  pick: 1.1,
  close: 0.6,
  shrug: 1.4,
  /** A bite or a sip, and the chat between them (s). */
  bite: 1.5,
  chat: [1.6, 3.2] as const,
  /** The share who take it back to their desk instead of eating it by the counter. */
  toDesk: 0.3,
};

/** Does this person fancy a snack now? A share of restless moments, on a different roll from coffee's. */
export function fanciesSnack(restless: number, chance = SNACK.chance) {
  return (restless * 61.73 + 0.5) % 1 < chance;
}

/** A snack in someone's hand: which, and the bites or sips left. */
export interface HandSnack {
  snack: SnackId;
  left: number;
}

/** What the snack break needs from the world. */
export interface SnackWorld {
  /** The fridge door is theirs to use: nobody else at it and the player isn't at the fridge. */
  doorFree(who: string): boolean;
  /** At the door (claim) and away from it again (release). Claim says whether it worked. */
  claim(who: string): boolean;
  release(who: string): void;
  open(who: string): void;
  close(who: string): void;
  /** Takes their pick out of the fridge: null when it's bare. */
  take(who: string): HandSnack | null;
  /** Who has which place by the counter (spot → who), shared with nobody else. */
  seats: Map<string, string>;
  /** The snack in their hand (null: empty-handed), and a bite's or sip's sound. */
  hold(who: string, snack: HandSnack | null): void;
  bite(who: string, snack: SnackId): void;
}

export type SnackStage = 'wait' | 'door' | 'eat' | 'done';

/**
 * One person's snack break, from the counter (the errand's spot) until they set off home. `step` is called every
 * frame with the director's clock (seconds) and whether they've reached the spot it last asked for.
 */
export class FridgeBreak implements ErrandActor {
  stage: SnackStage = 'wait';
  snack: HandSnack | null = null;
  private busy: { until: number; gesture: Gesture; then: () => void } | null = null;
  private waitAt: number | null = null;
  private atDoor = false;
  private opened = false;
  private bites = 0;
  private nextAt = 0;
  private chatting = false;
  private target = '';
  private there = false;

  constructor(
    readonly id: string,
    private world: SnackWorld,
    private rand: () => number = Math.random,
  ) {}

  /** What their hands do on the walk home. */
  get carry(): Gesture {
    return this.snack ? 'hold' : 'none';
  }

  /** Whether they're having it now (a snack in hand). */
  get eating() {
    return this.snack !== null;
  }

  private walk(spot: string): ActStep {
    if (spot !== this.target) this.there = false;
    this.target = spot;
    return { walk: spot, gesture: this.carry };
  }

  private at(spot: string) {
    return this.there && this.target === spot;
  }

  private act(now: number, seconds: number, gesture: Gesture, then: () => void): ActStep {
    this.busy = { until: now + seconds, gesture, then };
    return { stand: gesture };
  }

  private holding(s: HandSnack | null) {
    this.snack = s;
    this.world.hold(this.id, s);
  }

  /** Away from the door: shut it if they opened it, and let the next one have it. */
  private leaveDoor() {
    if (this.opened) this.world.close(this.id);
    this.opened = false;
    if (this.atDoor) this.world.release(this.id);
    this.atDoor = false;
  }

  private finish(): ActStep {
    this.leaveDoor();
    leaveSeat(this.world.seats, this.id);
    this.stage = 'done';
    return 'done';
  }

  step(now: number, arrived: boolean): ActStep {
    const w = this.world;
    this.there = arrived;
    if (this.busy) {
      if (now < this.busy.until) return { stand: this.busy.gesture };
      const then = this.busy.then;
      this.busy = null;
      then();
      if (this.stage === 'done') return 'done';
      if (this.busy) return { stand: (this.busy as { gesture: Gesture }).gesture }; // a shrug after an empty-handed look

    }
    switch (this.stage) {
      case 'wait': {
        const seat = pickSeat(w.seats, this.id, SNACK_SPOTS.eat);
        this.waitAt ??= now;
        if (w.doorFree(this.id) && w.claim(this.id)) {
          this.atDoor = true;
          this.stage = 'door';
          return this.walk(SNACK_SPOTS.door);
        }
        if (now - this.waitAt > SNACK.wait) return this.finish();
        if (!seat) return { stand: 'none' };
        return this.at(seat) ? { stand: 'none' } : this.walk(seat);
      }
      case 'door': {
        if (!this.at(SNACK_SPOTS.door)) return this.walk(SNACK_SPOTS.door);
        if (!this.opened) {
          return this.act(now, SNACK.open, 'reach', () => {
            w.open(this.id);
            this.opened = true;
          });
        }
        if (!this.snack) {
          return this.act(now, SNACK.pick, 'reach', () => {
            const got = w.take(this.id);
            if (got) this.holding(got);
            else {
              // a bare fridge: a shrug, shut it, and back to their desk
              this.busy = { until: now + SNACK.pick + SNACK.shrug, gesture: 'shrug', then: () => this.finish() };
            }
          });
        }
        return this.act(now, SNACK.close, 'tap', () => {
          this.leaveDoor();
          if (this.rand() < SNACK.toDesk) this.finish();
          else this.stage = 'eat';
        });
      }
      case 'eat': {
        if (!this.snack) return this.finish();
        const seat = pickSeat(w.seats, this.id, SNACK_SPOTS.eat);
        if (!seat) return this.finish(); // nowhere by the counter: have it at the desk
        if (!this.at(seat) && this.bites === 0 && !this.chatting) return this.walk(seat);
        // two or three bites (or sips), a little chat between them; the last one finishes it
        if (now < this.nextAt) return { stand: this.chatting ? 'chat' : 'none' };
        if (this.chatting || this.bites === 0) {
          this.chatting = false;
          return this.act(now, SNACK.bite, 'sip', () => {
            const s = this.snack;
            if (!s) return;
            w.bite(this.id, s.snack);
            this.bites++;
            const left = s.left - 1;
            if (left <= 0) {
              this.holding(null);
              this.finish();
              return;
            }
            this.holding({ ...s, left });
            this.chatting = true;
            this.nextAt = now + SNACK.bite + SNACK.chat[0] + (SNACK.chat[1] - SNACK.chat[0]) * this.rand();
          });
        }
        return { stand: 'none' };
      }
      case 'done':
        return 'done';
    }
  }

  /** Work came in: shut the fridge if they had it open and go. A snack in hand comes along. */
  abort() {
    this.busy = null;
    this.leaveDoor();
    leaveSeat(this.world.seats, this.id);
    this.stage = 'done';
  }

  /** Back in their chair (`seated`), or the floor was left: whatever they carried back is gone. */
  end() {
    this.leaveDoor();
    leaveSeat(this.world.seats, this.id);
    if (this.snack) this.holding(null);
    this.stage = 'done';
  }
}
