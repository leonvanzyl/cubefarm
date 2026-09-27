import { describe, expect, it } from 'vitest';
import { canPostpone, canUpdateNow, drainDeadline, DRAIN_TIMEOUT_MS, officeUpdateChip, officeUpdateText, restartExpected, shouldReload } from './officeUpdate';
import type { OfficeUpdateView } from '../../shared/types';

const u = (over: Partial<OfficeUpdateView>): OfficeUpdateView => ({ state: 'none', behind: 0, launcher: true, drainingSince: null, running: 0, detail: null, ...over });

describe('officeUpdateText', () => {
  it('says each state in plain words', () => {
    expect(officeUpdateText(u({}))).toBe('Up to date');
    expect(officeUpdateText(u({ state: 'available', behind: 3 }))).toBe('3 updates ready');
    expect(officeUpdateText(u({ state: 'available', behind: 1 }))).toBe('1 update ready');
    expect(officeUpdateText(u({ state: 'draining', behind: 3, running: 2 }))).toBe('Waiting for 2 sessions to finish');
    expect(officeUpdateText(u({ state: 'waiting', behind: 3, running: 1 }))).toBe('Waiting for 1 session to finish');
    expect(officeUpdateText(u({ state: 'draining', behind: 3 }))).toBe('Updating shortly…');
    expect(officeUpdateText(u({ state: 'updating', behind: 3 }))).toBe('Updating…');
    expect(officeUpdateText(u({ state: 'failed', detail: 'npm ci failed' }))).toBe('Last update failed: npm ci failed');
  });
});

describe('officeUpdateChip', () => {
  it('only shows while an update is on its way', () => {
    expect(officeUpdateChip(undefined)).toBeNull();
    expect(officeUpdateChip(u({}))).toBeNull();
    expect(officeUpdateChip(u({ state: 'available', behind: 2 }))).toBeNull();
    expect(officeUpdateChip(u({ state: 'failed', detail: 'x' }))).toBeNull();
    expect(officeUpdateChip(u({ state: 'draining', running: 2 }))).toBe('⟳ Updating the office after 2 sessions finish');
    expect(officeUpdateChip(u({ state: 'waiting', running: 1 }))).toBe('⟳ Updating the office after 1 session finishes');
    expect(officeUpdateChip(u({ state: 'updating' }))).toBe('⟳ Updating the office…');
  });
});

describe('buttons', () => {
  it('need a launcher', () => {
    expect(canUpdateNow(u({ state: 'available', behind: 2, launcher: false }))).toBe(false);
    expect(canPostpone(u({ state: 'available', behind: 2, launcher: false }))).toBe(false);
    expect(canUpdateNow(u({ state: 'available', behind: 2 }))).toBe(true);
    expect(canPostpone(u({ state: 'available', behind: 2 }))).toBe(true);
  });
  it('match what the server accepts', () => {
    expect(canUpdateNow(u({}))).toBe(false);
    expect(canUpdateNow(u({ state: 'draining', behind: 2 }))).toBe(false);
    expect(canUpdateNow(u({ state: 'updating', behind: 2 }))).toBe(false);
    expect(canPostpone(u({ state: 'draining', behind: 2 }))).toBe(true);
    expect(canPostpone(u({ state: 'updating', behind: 2 }))).toBe(false);
  });
});

it('drainDeadline is 20 minutes after draining started', () => {
  expect(drainDeadline(u({ state: 'draining', drainingSince: 1000 }))).toBe(1000 + DRAIN_TIMEOUT_MS);
  expect(drainDeadline(u({ state: 'waiting', drainingSince: 1000 }))).toBeNull();
});

it('restartExpected only while draining or updating', () => {
  expect(restartExpected(undefined)).toBe(false);
  expect(restartExpected(u({ state: 'available' }))).toBe(false);
  expect(restartExpected(u({ state: 'draining' }))).toBe(true);
  expect(restartExpected(u({ state: 'updating' }))).toBe(true);
});

describe('shouldReload', () => {
  it('reloads when the office comes back on another commit', () => {
    expect(shouldReload('abc1234', 'def5678', null)).toBe(true);
  });
  it('never on the first snapshot, the same commit, or a server without commits', () => {
    expect(shouldReload(undefined, 'def5678', null)).toBe(false);
    expect(shouldReload('abc1234', 'abc1234', null)).toBe(false);
    expect(shouldReload(null, 'def5678', null)).toBe(false);
    expect(shouldReload('abc1234', null, null)).toBe(false);
  });
  it('at most once per commit', () => {
    expect(shouldReload('abc1234', 'def5678', 'def5678')).toBe(false);
    expect(shouldReload('def5678', 'fed9999', 'def5678')).toBe(true);
  });
});
