import { describe, expect, it } from 'vitest';
import { clampTrimIdleMin, desksToTrim, formatBytes, freedMessage, idleSince, type DeskIdle } from './deskTrim.ts';

const MIN = 60_000;
const NOW = 1_800_000_000_000;
const desk = (over: Partial<DeskIdle> = {}): DeskIdle => ({ key: 'ada', busy: false, idleSince: NOW - 3 * 60 * MIN, trimmedAt: null, ...over });

describe('desksToTrim', () => {
  it('trims a desk idle for longer than the threshold', () => {
    expect(desksToTrim([desk()], 120, NOW)).toEqual(['ada']);
  });

  it('leaves a desk idle for less than the threshold, or exactly the threshold', () => {
    expect(desksToTrim([desk({ idleSince: NOW - 119 * MIN })], 120, NOW)).toEqual([]);
    expect(desksToTrim([desk({ idleSince: NOW - 120 * MIN })], 120, NOW)).toEqual([]);
  });

  it('never trims a busy desk, however long its idle timer says', () => {
    expect(desksToTrim([desk({ busy: true, idleSince: NOW - 24 * 60 * MIN })], 120, NOW)).toEqual([]);
  });

  it('trims once per idle stretch', () => {
    const trimmed = desk({ trimmedAt: NOW - 30 * MIN });
    expect(desksToTrim([trimmed], 120, NOW)).toEqual([]);
    // A task since then started a new stretch, now idle long enough again.
    expect(desksToTrim([{ ...trimmed, idleSince: NOW - 20 * MIN }], 10, NOW)).toEqual(['ada']);
  });

  it('trims nothing with the setting at 0', () => {
    expect(desksToTrim([desk(), desk({ key: 'bob', idleSince: 0 })], 0, NOW)).toEqual([]);
  });

  it('picks only the due desks from a floor', () => {
    const desks = [desk({ key: 'a' }), desk({ key: 'b', busy: true }), desk({ key: 'c', idleSince: NOW - MIN }), desk({ key: 'd', idleSince: NOW - 200 * MIN })];
    expect(desksToTrim(desks, 120, NOW)).toEqual(['a', 'd']);
  });
});

describe('idleSince', () => {
  it("is the later of the last session's end and the last time it was seen busy", () => {
    expect(idleSince(NOW - 60 * MIN, NOW - 20 * MIN, NOW - 600 * MIN)).toBe(NOW - 20 * MIN);
    expect(idleSince(NOW - 10 * MIN, NOW - 20 * MIN, NOW - 600 * MIN)).toBe(NOW - 10 * MIN);
  });

  it("starts at the office's start for a desk that hasn't worked since", () => {
    expect(idleSince(null, null, NOW - 600 * MIN)).toBe(NOW - 600 * MIN);
  });
});

describe('the setting and the message', () => {
  it('clamps the idle time to whole minutes between 0 and a week', () => {
    expect(clampTrimIdleMin(90.4)).toBe(90);
    expect(clampTrimIdleMin(0)).toBe(0);
    expect(clampTrimIdleMin(-5)).toBe(0);
    expect(clampTrimIdleMin(1e9)).toBe(7 * 24 * 60);
    expect(clampTrimIdleMin('abc')).toBe(120);
  });

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 bytes');
    expect(formatBytes(850 * 2 ** 20)).toBe('850 MB');
    expect(formatBytes(4.2 * 2 ** 30)).toBe('4.2 GB');
  });

  it('says how much was freed from how many desks', () => {
    expect(freedMessage(4.2 * 2 ** 30, 9)).toBe('🧹 Freed 4.2 GB from 9 idle desks');
    expect(freedMessage(300 * 2 ** 20, 1)).toBe('🧹 Freed 300 MB from 1 idle desk');
  });
});
