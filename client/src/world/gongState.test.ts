import { describe, expect, it, vi } from 'vitest';

// The gong's party event, which MergeConfetti.tsx bursts confetti over the gong from. The boom needs WebAudio: mocked.
vi.mock('../ui/sfx', () => ({ gong: vi.fn() }));

const { gongState, hitGong, onGongParty, setGongHere } = await import('./gongState');

describe('onGongParty', () => {
  it('fires for a merge strike on the floor on screen, even while the gong still rings, and never otherwise', () => {
    const parties: string[] = [];
    const off = onGongParty((repoId) => parties.push(repoId));
    setGongHere('acme/app');
    gongState.hitAt = -Infinity;

    expect(hitGong({ repoId: 'acme/other', celebrate: true })).toBe('absent');
    expect(hitGong()).toBe('boom'); // the player banging it for fun
    expect(parties).toEqual([]);
    expect(hitGong({ repoId: 'acme/app', celebrate: true })).toBe('ringing');
    expect(parties).toEqual(['acme/app']);

    off();
    gongState.hitAt = -Infinity;
    hitGong({ celebrate: true });
    expect(parties).toEqual(['acme/app']);
    setGongHere(null);
  });
});
