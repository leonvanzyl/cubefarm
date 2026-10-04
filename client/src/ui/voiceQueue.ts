// Which phone messages are read aloud, in what order, and which office tab reads them. Pure, so it's tested without a
// browser; voiceMessages.ts does the playing.
import type { PhoneMessage, VoiceSettings } from '../../../shared/types';

/** A message older than this isn't worth hearing any more. */
export const VOICE_MAX_AGE_MS = 2 * 60_000;
/** At most this many wait their turn; the oldest give way. */
export const VOICE_QUEUE_MAX = 3;

/** Whether a message that just arrived is read aloud: the CEO's (or the office's, when asked for), with a voice on. */
export function speakable(m: PhoneMessage, v: VoiceSettings, now: number): boolean {
  if (v.provider === 'off') return false;
  if (m.from !== 'ceo' && !(m.from === 'office' && v.speakOffice)) return false;
  return now - m.at <= VOICE_MAX_AGE_MS;
}

/** A message waiting its turn, with when this tab received it (the server's clock may differ). */
export interface Queued {
  message: PhoneMessage;
  arrived: number;
}

/** The queue with `q` at the end, each message once, the oldest dropped beyond `max`. */
export function enqueue(queue: readonly Queued[], q: Queued, max = VOICE_QUEUE_MAX): Queued[] {
  if (queue.some((x) => x.message.id === q.message.id)) return [...queue];
  const next = [...queue, q];
  return next.slice(Math.max(0, next.length - max));
}

/** The next message to read and what's left, skipping any that waited too long. */
export function nextUp(queue: readonly Queued[], now: number): { next: Queued | null; rest: Queued[] } {
  const fresh = queue.filter((q) => now - q.arrived <= VOICE_MAX_AGE_MS && now - q.message.at <= VOICE_MAX_AGE_MS);
  return { next: fresh[0] ?? null, rest: fresh.slice(1) };
}

/** An office tab offering to read a message. */
export interface VoiceClaim {
  tab: string;
  visible: boolean;
}

/** Which tab reads a message: one the manager is looking at before a background one, then the smallest id. */
export function claimWinner(claims: readonly VoiceClaim[]): string | null {
  let best: VoiceClaim | null = null;
  for (const c of claims) if (!best || (c.visible && !best.visible) || (c.visible === best.visible && c.tab < best.tab)) best = c;
  return best?.tab ?? null;
}
