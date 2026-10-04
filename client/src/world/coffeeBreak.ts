// A coffee break, as pure decisions: an idle person takes a mug from the dispenser, waits their turn at the machine,
// brews, takes the coffee to the counter for a sip or two and a chat, then carries it back to their desk or puts the
// empty mug back. CoffeeBreak is the errand's actor (errands.ts `act`); the machine, hands and sounds come in through
// BreakWorld, so it's tested without a scene. coffeeErrand.ts wires it to CoffeeMachine.tsx and the people.

import type { BrewState } from './coffee';
import type { Gesture } from './body';
import type { ActStep, ErrandActor } from './errands';

/** The kitchenette's spots (walkways.ts): the dispenser, the machine, two to wait at behind it, and two by the counter. */
export const SPOTS = {
  mugs: 'mugs',
  machine: 'coffee',
  line: ['coffee-line', 'coffee-line-1'],
  sip: ['coffee-sip-0', 'coffee-sip-1'],
} as const;

export const BREAK = {
  /** At most this many people on a coffee break per floor at once. */
  max: 2,
  /** The share of restless moments (errands.ts) that become a coffee break rather than a stretch. */
  chance: 0.25,
  /** They fancy a coffee a little before they'd get up to stretch, so coffee gets the first go. */
  early: 0.8,
  /** Waiting in line this long (s): give up and go back. */
  line: 45,
  /** Seconds for a hand on the counter: taking or putting back a mug, placing it, taking the coffee; and the button. */
  reach: 0.8,
  press: 0.5,
  /** A sip, and the chat between sips (s). */
  sip: 1.5,
  chat: [2.2, 4.2] as const,
  /** How long a coffee they carried back stays on their desk, steaming (ms). */
  desk: 90_000,
};

/** A mug someone holds or put in the machine. */
export interface Mug {
  id: string;
  sips: number;
}

/** The machine's slot: the brew state of the mug in it and whose it is ('player', an agent's id, or null: anyone's). */
export interface Slot {
  kind: Exclude<BrewState['kind'], 'empty'>;
  owner: string | null;
}

export const PLAYER = 'player';

// ---------- the machine ----------

/** Does this person fancy a coffee now? One restless moment in four, decided by the moment's own (random) length. */
export function fanciesCoffee(restless: number, chance = BREAK.chance) {
  const f = (restless * 97.31) % 1;
  return f < chance;
}

/** What someone at the machine does next, from what's in the slot and whether they hold a mug. */
export type MachineMove = 'place' | 'press' | 'wait' | 'take' | 'getMug' | 'returnMug' | 'blocked';

export function machineMove(slot: Slot | null, me: string, holding: boolean): MachineMove {
  if (!slot) return holding ? 'place' : 'getMug';
  // Never the player's mug, nor another agent's.
  if (slot.owner !== me && slot.owner !== null) return 'blocked';
  // A coffee left behind is anyone's: put your own empty mug back first, then have that one.
  if (slot.owner === null && holding) return 'returnMug';
  return slot.kind === 'mugPlaced' ? 'press' : slot.kind === 'brewing' ? 'wait' : 'take';
}

/** Joins the line for the machine (once). */
export function joinLine(line: string[], id: string) {
  if (!line.includes(id)) line.push(id);
}

export function leaveLine(line: string[], id: string) {
  const i = line.indexOf(id);
  if (i >= 0) line.splice(i, 1);
}

/** First in line: the machine is theirs once nobody else's mug is in it and the player isn't about to use it. */
export const myTurn = (line: readonly string[], id: string) => line[0] === id;

/** A free spot by the counter (or null), keeping the one they already have. */
export function pickSeat(seats: Map<string, string>, id: string, ids: readonly string[] = SPOTS.sip): string | null {
  for (const [spot, who] of seats) if (who === id) return spot;
  const free = ids.find((s) => !seats.has(s));
  if (free) seats.set(free, id);
  return free ?? null;
}

/** Where to wait for the machine: the front spot when it's free, else the one behind; moving up once the front frees. */
export function pickLineSpot(seats: Map<string, string>, id: string, ids: readonly string[] = SPOTS.line): string {
  const mine = ids.find((s) => seats.get(s) === id);
  const best = ids.find((s) => s === mine || !seats.has(s));
  if (!best) return ids[ids.length - 1];
  if (mine && mine !== best) seats.delete(mine);
  seats.set(best, id);
  return best;
}

export function leaveLineSpot(seats: Map<string, string>, id: string) {
  for (const s of SPOTS.line) if (seats.get(s) === id) seats.delete(s);
}

export function leaveSeat(seats: Map<string, string>, id: string) {
  for (const [spot, who] of seats) if (who === id) seats.delete(spot);
}

// ---------- drinking ----------

export interface DrinkStep {
  gesture: Gesture;
  seconds: number;
  /** A sip comes off the mug halfway through. */
  sip?: boolean;
}

/** Sips and chat by the counter: one or two sips, or the whole mug (then the empty one goes back). `rand` in [0, 1). */
export function drinkPlan(sips: number, rand: number): DrinkStep[] {
  const n = Math.min(sips, rand < 0.4 ? sips : rand < 0.75 ? 2 : 1);
  const chat = (k: number) => BREAK.chat[0] + (BREAK.chat[1] - BREAK.chat[0]) * ((rand * 7.3 + k * 0.37) % 1);
  const out: DrinkStep[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ gesture: 'sip', seconds: BREAK.sip, sip: true });
    out.push({ gesture: 'chat', seconds: chat(i) });
  }
  return out;
}

// ---------- the actor ----------

/** What the coffee break needs from the world. */
export interface BreakWorld {
  slot(): Slot | null;
  /** The player goes first: their mug is in the machine, or they're beside it with a mug to put in. */
  playerFirst(): boolean;
  /** The machine's line (shared by everyone on the floor) and who has which spot to wait at or sip by (spot → who). */
  line: string[];
  seats: Map<string, string>;
  /** Each returns whether it happened. */
  place(who: string, mug: Mug): boolean;
  press(who: string): boolean;
  take(who: string): Mug | null;
  /** Leaves their mug in the machine for anyone. */
  abandon(who: string): void;
  /** A fresh mug from the dispenser, and one put back. */
  newMug(who: string): Mug;
  putBack(who: string, mug: Mug): void;
  /** The mug in their hand (null: empty-handed), a sip's sound, and a coffee left on their desk. */
  hold(who: string, mug: Mug | null): void;
  sip(who: string): void;
  toDesk(who: string, mug: Mug): void;
}

export type BreakStage = 'mug' | 'line' | 'machine' | 'sip' | 'putBack' | 'done';

/**
 * One person's coffee break, from the dispenser (the errand's spot) until they set off home. `step` is called every
 * frame with the director's clock (seconds) and whether they've reached the spot it last asked for.
 */
export class CoffeeBreak implements ErrandActor {
  stage: BreakStage = 'mug';
  mug: Mug | null = null;
  private placed = false;
  private busy: { until: number; gesture: Gesture; then: () => void } | null = null;
  private lineAt: number | null = null;
  private plan: DrinkStep[] | null = null;
  private planAt = 0;
  private planStep = -1;
  private afterPutBack: BreakStage = 'done';
  // The spot last walked to (the errand starts at the dispenser) and whether they're there.
  private target: string = SPOTS.mugs;
  private there = false;

  constructor(
    readonly id: string,
    private world: BreakWorld,
    private rand: () => number = Math.random,
  ) {}

  /** What their hands do on the walk home. */
  get carry(): Gesture {
    return this.mug ? 'mug' : 'none';
  }

  private hands(): Gesture {
    return this.mug ? 'mug' : 'none';
  }

  private walk(spot: string): ActStep {
    // off to anywhere but the line: their place in it is free for the one behind
    if (!(SPOTS.line as readonly string[]).includes(spot)) leaveLineSpot(this.world.seats, this.id);
    if (spot !== this.target) this.there = false;
    this.target = spot;
    return { walk: spot, gesture: this.hands() };
  }

  /** Standing at this spot: `arrived` only counts for the last spot they were sent to. */
  private at(spot: string) {
    return this.there && this.target === spot;
  }

  /** Do something with a hand on the counter for `seconds`, then `then`. */
  private act(now: number, seconds: number, gesture: Gesture, then: () => void): ActStep {
    this.busy = { until: now + seconds, gesture, then };
    return { stand: gesture };
  }

  private holding(mug: Mug | null) {
    this.mug = mug;
    this.world.hold(this.id, mug);
  }

  private quit(): ActStep {
    leaveLine(this.world.line, this.id);
    leaveSeat(this.world.seats, this.id);
    if (this.mug && this.mug.sips === 0) {
      this.afterPutBack = 'done';
      this.stage = 'putBack';
      return this.walk(SPOTS.mugs);
    }
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
    }
    switch (this.stage) {
      case 'mug': {
        // A coffee left in the machine is anyone's: no need for a fresh mug.
        const mv = machineMove(w.slot(), this.id, !!this.mug);
        if (this.mug || (mv !== 'getMug' && mv !== 'blocked' && mv !== 'place')) {
          this.stage = 'line';
          return this.step(now, false);
        }
        if (!this.at(SPOTS.mugs)) return this.walk(SPOTS.mugs);
        return this.act(now, BREAK.reach, 'tap', () => {
          this.holding(w.newMug(this.id));
          this.stage = 'line';
        });
      }
      case 'line': {
        joinLine(w.line, this.id);
        this.lineAt ??= now;
        const mv = machineMove(w.slot(), this.id, !!this.mug);
        if (mv === 'getMug') {
          this.stage = 'mug';
          return this.walk(SPOTS.mugs);
        }
        if (mv === 'returnMug') {
          this.afterPutBack = 'line';
          this.stage = 'putBack';
          return this.walk(SPOTS.mugs);
        }
        const free = mv !== 'blocked' && (mv !== 'place' || !w.playerFirst());
        if (free && myTurn(w.line, this.id)) {
          this.stage = 'machine';
          return this.walk(SPOTS.machine);
        }
        if (now - this.lineAt > BREAK.line) return this.quit();
        return this.walk(pickLineSpot(w.seats, this.id));
      }
      case 'machine': {
        if (!this.at(SPOTS.machine)) return this.walk(SPOTS.machine);
        const mv = machineMove(w.slot(), this.id, !!this.mug);
        // Their mug went (the player took it): never mind.
        if (this.placed && (mv === 'getMug' || mv === 'blocked')) return this.quit();
        switch (mv) {
          case 'place':
            if (w.playerFirst()) {
              this.stage = 'line';
              return this.walk(pickLineSpot(w.seats, this.id));
            }
            return this.act(now, BREAK.reach, 'tap', () => {
              const mug = this.mug;
              if (mug && w.place(this.id, mug)) {
                this.placed = true;
                this.holding(null);
              }
            });
          case 'press':
            return this.act(now, BREAK.press, 'tap', () => {
              if (w.press(this.id)) this.placed = true;
            });
          case 'wait':
            this.placed = true;
            return { stand: 'none' };
          case 'take':
            return this.act(now, BREAK.reach, 'tap', () => {
              const mug = w.take(this.id);
              if (!mug) return;
              this.holding(mug);
              leaveLine(w.line, this.id);
              this.stage = 'sip';
            });
          case 'getMug':
            this.stage = 'mug';
            return this.walk(SPOTS.mugs);
          case 'returnMug':
            this.afterPutBack = 'line';
            this.stage = 'putBack';
            return this.walk(SPOTS.mugs);
          case 'blocked':
            this.stage = 'line';
            return this.walk(pickLineSpot(w.seats, this.id));
        }
        return this.walk(pickLineSpot(w.seats, this.id));
      }
      case 'sip': {
        const seat = pickSeat(w.seats, this.id);
        if (!this.mug) return this.quit();
        if (!seat) {
          // nowhere by the counter: drink it at the desk
          this.stage = 'done';
          return 'done';
        }
        if (!this.plan && !this.at(seat)) return this.walk(seat);
        if (!this.plan) {
          this.plan = drinkPlan(this.mug.sips, this.rand());
          this.planStep = -1;
          this.planAt = now;
        }
        const cur = this.plan[this.planStep];
        if (!cur || now >= this.planAt) {
          this.planStep++;
          const next = this.plan[this.planStep];
          if (!next) return this.quit();
          this.planAt = now + next.seconds;
          if (next.sip) {
            // the sip comes off halfway, when the mug is at the mouth
            return this.act(now, next.seconds / 2, 'sip', () => {
              if (!this.mug) return;
              this.holding({ ...this.mug, sips: Math.max(0, this.mug.sips - 1) });
              w.sip(this.id);
            });
          }
          return { stand: next.gesture };
        }
        return { stand: cur.gesture };
      }
      case 'putBack': {
        if (!this.at(SPOTS.mugs)) return this.walk(SPOTS.mugs);
        return this.act(now, BREAK.reach, 'tap', () => {
          if (this.mug) w.putBack(this.id, this.mug);
          this.holding(null);
          this.stage = this.afterPutBack;
        });
      }
      case 'done':
        return 'done';
    }
  }

  /** Work came in: leave the coffee where it is (a brew carries on, for anyone) and go. A mug in hand comes along. */
  abort() {
    const s = this.world.slot();
    if (s && s.owner === this.id) this.world.abandon(this.id);
    leaveLine(this.world.line, this.id);
    leaveSeat(this.world.seats, this.id);
    this.busy = null;
    this.stage = 'done';
  }

  /** Back in their chair (`seated`), or the floor was left: a coffee they carried back goes on their desk. */
  end(seated: boolean) {
    leaveLine(this.world.line, this.id);
    leaveSeat(this.world.seats, this.id);
    if (this.mug && seated && this.mug.sips > 0) this.world.toDesk(this.id, this.mug);
    if (this.mug) this.holding(null);
    this.stage = 'done';
  }
}
