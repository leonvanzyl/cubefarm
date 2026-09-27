import { describe, expect, it } from 'vitest';
import { jobLabel, specialtyLabel, specialtySlug, type CeoJob } from './ceo.ts';

describe('specialtySlug', () => {
  it('turns a specialty into a lowercase slug', () => {
    expect(specialtySlug('Three.js graphics')).toBe('three-js-graphics');
    expect(specialtySlug('Testing')).toBe('testing');
    expect(specialtySlug('front_end / UI')).toBe('front-end-ui');
  });

  it('trims separators from both ends', () => {
    expect(specialtySlug('  --Backend!!  ')).toBe('backend');
  });

  it('keeps at most 24 characters', () => {
    expect(specialtySlug('a'.repeat(40))).toBe('a'.repeat(24));
    expect(specialtySlug('infrastructure and devops tooling')).toHaveLength(24);
  });

  // Known bug: the cut happens after the trim, so 'abcdefghijklmnopqrstuvw xyz' becomes 'abcdefghijklmnopqrstuvw-'.
  it.todo('does not end in "-" when the 24-character cut lands on a separator');

  it('is empty for no specialty', () => {
    expect(specialtySlug(undefined)).toBe('');
    expect(specialtySlug('')).toBe('');
    expect(specialtySlug('!!!')).toBe('');
  });

  it('never returns "skip", which means "leave this issue alone"', () => {
    expect(specialtySlug('skip')).toBe('');
    expect(specialtySlug('SKIP')).toBe('');
    expect(specialtySlug(' -skip- ')).toBe('');
    expect(specialtySlug('skipping')).toBe('skipping');
  });

  it('round-trips through specialtyLabel', () => {
    expect(specialtyLabel(specialtySlug('Three.js graphics'))).toBe('swarm:three-js-graphics');
  });
});

describe('jobLabel', () => {
  const job = (kind: CeoJob['kind']): CeoJob => ({ kind, repoId: 'r1', at: 0 });
  const floor = { floor: 3, fullName: 'leonvanzyl/office-swarm' };

  it('names the floor and repo for floor jobs', () => {
    expect(jobLabel(job('onboard'), floor)).toBe('Onboarding floor 3 · office-swarm');
    expect(jobLabel(job('plan'), floor)).toBe('Planning floor 3 · office-swarm');
  });

  it('falls back to the full name when it has no owner', () => {
    expect(jobLabel(job('plan'), { floor: 1, fullName: 'solo' })).toBe('Planning floor 1 · solo');
  });

  it('says so when the floor is gone', () => {
    expect(jobLabel(job('onboard'), null)).toBe('Onboarding a removed floor');
    expect(jobLabel(job('plan'), null)).toBe('Planning a removed floor');
  });

  it('labels company-wide jobs without a floor', () => {
    expect(jobLabel(job('review'), floor)).toBe('Reviewing the company');
    expect(jobLabel(job('review'), null)).toBe('Reviewing the company');
    expect(jobLabel({ kind: 'chat', text: 'hi', at: 0 }, null)).toBe('Replying to you');
  });
});
