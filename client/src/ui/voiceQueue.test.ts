import { describe, expect, it } from 'vitest';
import type { PhoneMessage, VoiceSettings } from '../../../shared/types';
import { claimWinner, enqueue, nextUp, replayKind, speakable, VOICE_MAX_AGE_MS, type Queued } from './voiceQueue';

const NOW = 1_000_000_000;
const msg = (id: number, from: PhoneMessage['from'] = 'ceo', at = NOW): PhoneMessage => ({ id, from, text: `message ${id}`, at });
const voice = (patch: Partial<VoiceSettings> = {}): VoiceSettings => ({ provider: 'elevenlabs', voiceId: 'v', voiceName: 'V', model: 'm', speakOffice: false, keepDays: 7, ...patch });
const q = (id: number, arrived = NOW, at = arrived): Queued => ({ message: msg(id, 'ceo', at), arrived });

describe('speakable', () => {
  it("speaks the CEO's messages with either voice, and nothing while it's off", () => {
    expect(speakable(msg(1), voice(), NOW)).toBe(true);
    expect(speakable(msg(1), voice({ provider: 'browser' }), NOW)).toBe(true);
    expect(speakable(msg(1), voice({ provider: 'off' }), NOW)).toBe(false);
  });

  it("speaks the office's notes only when asked to, and never the manager's own", () => {
    expect(speakable(msg(1, 'office'), voice(), NOW)).toBe(false);
    expect(speakable(msg(1, 'office'), voice({ speakOffice: true }), NOW)).toBe(true);
    expect(speakable(msg(1, 'manager'), voice({ speakOffice: true }), NOW)).toBe(false);
  });

  it('skips a message older than two minutes', () => {
    expect(speakable(msg(1, 'ceo', NOW - VOICE_MAX_AGE_MS), voice(), NOW)).toBe(true);
    expect(speakable(msg(1, 'ceo', NOW - VOICE_MAX_AGE_MS - 1), voice(), NOW)).toBe(false);
  });
});

describe('enqueue', () => {
  it('keeps arrival order and at most three, dropping the oldest', () => {
    let queue: Queued[] = [];
    for (const id of [1, 2, 3, 4]) queue = enqueue(queue, q(id));
    expect(queue.map((x) => x.message.id)).toEqual([2, 3, 4]);
  });

  it('adds a message once', () => {
    expect(enqueue([q(1)], q(1)).map((x) => x.message.id)).toEqual([1]);
  });

  it("doesn't change the queue it was given", () => {
    const queue = [q(1)];
    enqueue(queue, q(2));
    expect(queue).toHaveLength(1);
  });
});

describe('nextUp', () => {
  it('takes the oldest first', () => {
    const { next, rest } = nextUp([q(1), q(2)], NOW);
    expect(next?.message.id).toBe(1);
    expect(rest.map((x) => x.message.id)).toEqual([2]);
  });

  it('skips messages that waited more than two minutes', () => {
    const stale = q(1, NOW - VOICE_MAX_AGE_MS - 1);
    const { next, rest } = nextUp([stale, q(2), q(3)], NOW);
    expect(next?.message.id).toBe(2);
    expect(rest.map((x) => x.message.id)).toEqual([3]);
  });

  it("skips a message the server sent long ago even if it just arrived", () => {
    expect(nextUp([q(1, NOW, NOW - VOICE_MAX_AGE_MS - 1)], NOW).next).toBeNull();
  });

  it('is empty for an empty queue', () => {
    expect(nextUp([], NOW)).toEqual({ next: null, rest: [] });
  });
});

describe('claimWinner', () => {
  const W = 250;
  const claim = (tab: string, visible = true, at = NOW) => ({ tab, visible, at });

  it('picks the smallest tab id among equals, whatever order the claims came in', () => {
    const claims = [claim('k'), claim('b', true, NOW + 100), claim('x', true, NOW + 50)];
    expect(claimWinner(claims, W)).toBe('b');
    expect(claimWinner([...claims].reverse(), W)).toBe('b');
  });

  it('prefers a tab the manager is looking at', () => {
    expect(claimWinner([claim('a', false), claim('z')], W)).toBe('z');
    expect(claimWinner([claim('z'), claim('a', false)], W)).toBe('z');
  });

  it('leaves out a tab that claimed after the first one had already decided', () => {
    // 'k' claimed alone and spoke; 'a' got the message late (a busy tab) and must not speak it too.
    expect(claimWinner([claim('k'), claim('a', true, NOW + W)], W)).toBe('k');
    expect(claimWinner([claim('a', true, NOW + W), claim('k')], W)).toBe('k');
    expect(claimWinner([claim('k'), claim('a', true, NOW + W - 1)], W)).toBe('a');
  });

  it('a lone tab reads its own messages, background or not', () => {
    expect(claimWinner([claim('a', false)], W)).toBe('a');
    expect(claimWinner([], W)).toBeNull();
  });
});

describe('replayKind', () => {
  const m = (voice?: PhoneMessage['voice'], from: PhoneMessage['from'] = 'ceo'): PhoneMessage => ({ ...msg(1, from), ...(voice ? { voice } : {}) });

  it("plays a saved clip, whoever read it and whatever the voice is now", () => {
    expect(replayKind(m('elevenlabs'), true, true)).toBe('clip');
    expect(replayKind(m(), true, false)).toBe('clip');
  });

  it("says a browser-voice message again, and disables an ElevenLabs one whose clip is gone", () => {
    expect(replayKind(m('browser'), false, true)).toBe('browser');
    expect(replayKind(m('browser'), false, false)).toBeNull();
    expect(replayKind(m('elevenlabs'), false, true)).toBe('gone');
  });

  it('has no button for a message nobody read aloud, or for anyone but the CEO', () => {
    expect(replayKind(m(), false, true)).toBeNull();
    expect(replayKind(m('elevenlabs', 'office'), true, true)).toBeNull();
    expect(replayKind(m(undefined, 'manager'), true, true)).toBeNull();
  });
});
