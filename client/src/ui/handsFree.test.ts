import { describe, expect, it } from 'vitest';
import { canListen, CHIME_MS, HANDS_FREE_IDLE, handsFree, type HandsFree, type Room } from './handsFree';
import { freshEars, heardWords, listenRules, NO_SPEECH_MS, sendsWhenDone, SILENCE_MS, verdict } from './micSilence';

const room = (patch: Partial<Room> = {}): Room => ({ enabled: true, phoneChat: true, micFree: true, draft: false, muted: false, ...patch });

describe('canListen', () => {
  it('needs hands-free on, the phone open on the chat, a free mic, an empty box and sound', () => {
    expect(canListen(room())).toBe(true);
    expect(canListen(room({ enabled: false }))).toBe(false);
    expect(canListen(room({ phoneChat: false }))).toBe(false);
    expect(canListen(room({ micFree: false }))).toBe(false);
    expect(canListen(room({ draft: true }))).toBe(false);
    expect(canListen(room({ muted: true }))).toBe(false);
  });
});

describe('the hands-free state machine', () => {
  it('chimes when a spoken reply ends, then opens the mic once the chime is over', () => {
    let r = handsFree(HANDS_FREE_IDLE, { type: 'reply-ended', now: 1000, room: room() });
    expect(r).toEqual({ state: { kind: 'chime', until: 1000 + CHIME_MS }, effect: 'chime' });
    r = handsFree(r.state, { type: 'tick', now: 1000 + CHIME_MS - 1, room: room() });
    expect(r.effect).toBeNull();
    r = handsFree(r.state, { type: 'tick', now: 1000 + CHIME_MS, room: room() });
    expect(r).toEqual({ state: { kind: 'listening' }, effect: 'open' });
  });

  it('stays quiet when it may not listen', () => {
    for (const patch of [{ enabled: false }, { phoneChat: false }, { draft: true }, { muted: true }, { micFree: false }]) {
      expect(handsFree(HANDS_FREE_IDLE, { type: 'reply-ended', now: 0, room: room(patch) })).toEqual({ state: HANDS_FREE_IDLE, effect: null });
    }
  });

  it('calls the chime off when the phone goes away or someone types meanwhile', () => {
    const chime = handsFree(HANDS_FREE_IDLE, { type: 'reply-ended', now: 0, room: room() }).state;
    expect(handsFree(chime, { type: 'tick', now: 100, room: room({ phoneChat: false }) })).toEqual({ state: HANDS_FREE_IDLE, effect: null });
    expect(handsFree(chime, { type: 'tick', now: CHIME_MS, room: room({ draft: true }) })).toEqual({ state: HANDS_FREE_IDLE, effect: null });
    expect(handsFree(chime, { type: 'closed' })).toEqual({ state: HANDS_FREE_IDLE, effect: null }); // Esc during the chime
  });

  it("ignores another reply while it's chiming or listening", () => {
    const chime: HandsFree = { kind: 'chime', until: 500 };
    expect(handsFree(chime, { type: 'reply-ended', now: 100, room: room() })).toEqual({ state: chime, effect: null });
    const listening: HandsFree = { kind: 'listening' };
    expect(handsFree(listening, { type: 'reply-ended', now: 100, room: room() })).toEqual({ state: listening, effect: null });
    expect(handsFree(listening, { type: 'tick', now: 100, room: room() })).toEqual({ state: listening, effect: null });
  });

  it('a whole conversation: silence closes the mic after 8 s, speech is sent, and the next reply opens it again', () => {
    const rules = listenRules('handsfree', false);
    let s: HandsFree = HANDS_FREE_IDLE;
    const step = (ev: Parameters<typeof handsFree>[1]) => {
      const r = handsFree(s, ev);
      s = r.state;
      return r.effect;
    };

    // The first reply: the manager says nothing.
    expect(step({ type: 'reply-ended', now: 0, room: room() })).toBe('chime');
    expect(step({ type: 'tick', now: CHIME_MS, room: room({ micFree: true }) })).toBe('open');
    const quiet = freshEars(CHIME_MS);
    expect(verdict(quiet, CHIME_MS + NO_SPEECH_MS - 1, rules)).toBe('listening');
    expect(verdict(quiet, CHIME_MS + NO_SPEECH_MS, rules)).toBe('no-speech');
    step({ type: 'closed' });
    expect(s).toEqual(HANDS_FREE_IDLE);

    // The next reply: the manager answers, stops, and it goes.
    const t0 = 60_000;
    expect(step({ type: 'reply-ended', now: t0, room: room() })).toBe('chime');
    expect(step({ type: 'tick', now: t0 + CHIME_MS, room: room() })).toBe('open');
    let ears = freshEars(t0 + CHIME_MS);
    ears = heardWords(ears, t0 + 3000);
    ears = heardWords(ears, t0 + 4500);
    expect(verdict(ears, t0 + 4500 + SILENCE_MS - 50, rules)).toBe('listening');
    expect(verdict(ears, t0 + 4500 + SILENCE_MS, rules)).toBe('done');
    expect(sendsWhenDone('handsfree', false)).toBe(true);
    step({ type: 'closed' });
    expect(step({ type: 'reply-ended', now: t0 + 20_000, room: room() })).toBe('chime');
  });
});
