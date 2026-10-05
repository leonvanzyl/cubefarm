// The phone's hands-free conversation (docs/voice.md): when the CEO's spoken reply ends, a soft chime plays and the
// mic opens; what you say is sent, and the CEO's next spoken reply opens it again. How long the open mic waits and
// when it sends are micSilence.ts's rules for 'handsfree'. Pure, so it's tested without a phone or a microphone.

/** The chime plays out before the mic opens, so the mic doesn't hear it as speech. */
export const CHIME_MS = 450;

/** Waiting for the CEO's next spoken reply, chiming before the mic opens, or listening. */
export type HandsFree = { kind: 'waiting' } | { kind: 'chime'; until: number } | { kind: 'listening' };

/** What the office looks like at that moment. */
export interface Room {
  /** Hands-free is on, the CEO's voice is on, and the 🎙 can listen here (a provider that works, the mic allowed). */
  enabled: boolean;
  /** The phone is open on the CEO chat, in a tab the manager is looking at, with no question on screen. */
  phoneChat: boolean;
  /** Nothing else is listening. */
  micFree: boolean;
  /** The message box holds something the manager typed: the mic won't send it for them. */
  draft: boolean;
  muted: boolean;
}

/** Whether the phone may listen on its own now. */
export const canListen = (r: Room) => r.enabled && r.phoneChat && r.micFree && !r.draft && !r.muted;

export type HandsFreeEvent =
  /** A CEO message finished being read aloud in this tab, with nothing else waiting to be read. */
  | { type: 'reply-ended'; now: number; room: Room }
  | { type: 'tick'; now: number; room: Room }
  /** The mic closed (sent, heard nothing, Esc or M), or the chime was called off. */
  | { type: 'closed' };

/** What to do: play the listening chime, open the mic for a hands-free session, or nothing. */
export type HandsFreeEffect = 'chime' | 'open' | null;

export const HANDS_FREE_IDLE: HandsFree = { kind: 'waiting' };

export function handsFree(s: HandsFree, ev: HandsFreeEvent): { state: HandsFree; effect: HandsFreeEffect } {
  const stay = { state: s, effect: null };
  switch (ev.type) {
    case 'reply-ended':
      return s.kind === 'waiting' && canListen(ev.room) ? { state: { kind: 'chime', until: ev.now + CHIME_MS }, effect: 'chime' } : stay;
    case 'tick':
      if (s.kind !== 'chime') return stay;
      // Anything that changed during the chime (the phone put away, a key pressed, typing) calls it off.
      if (!canListen(ev.room)) return { state: HANDS_FREE_IDLE, effect: null };
      return ev.now >= s.until ? { state: { kind: 'listening' }, effect: 'open' } : stay;
    case 'closed':
      return { state: HANDS_FREE_IDLE, effect: null };
  }
}
