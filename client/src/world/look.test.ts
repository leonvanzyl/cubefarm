// Run with `npm test` (node:test through tsx).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SKIP_AFTER_LOCK, createLookFilter, filterLookDelta, type LookFilter } from './look';

/** A filter that's past the post-lock skip, with some ordinary motion behind it. */
function warmFilter(): { f: LookFilter; t: number } {
  const f = createLookFilter();
  let t = 0;
  for (let i = 0; i < SKIP_AFTER_LOCK; i++) filterLookDelta(f, 5, 0, (t += 8));
  for (let i = 0; i < 20; i++) filterLookDelta(f, 4, -2, (t += 8));
  return { f, t };
}

/** Feeds events 8 ms apart and returns the total applied motion. */
function feed(f: LookFilter, t: number, moves: [number, number][]) {
  let x = 0;
  let y = 0;
  for (const [dx, dy] of moves) {
    const d = filterLookDelta(f, dx, dy, (t += 8));
    if (d) {
      x += d[0];
      y += d[1];
    }
  }
  return { x, y, t };
}

test('drops the first events after the pointer lock is taken', () => {
  const f = createLookFilter();
  for (let i = 0; i < SKIP_AFTER_LOCK; i++) assert.equal(filterLookDelta(f, 3, 3, i * 8), null);
  assert.deepEqual(filterLookDelta(f, 3, 3, 100), [3, 3]);
  assert.equal(f.skipped, SKIP_AFTER_LOCK);
});

test('passes normal motion through untouched', () => {
  const { f, t } = warmFilter();
  const moves: [number, number][] = [[1, 0], [6, -3], [12, 4], [20, 9], [-15, 2], [0, -30], [3, 1]];
  let at = t;
  for (const [dx, dy] of moves) assert.deepEqual(filterLookDelta(f, dx, dy, (at += 8)), [dx, dy]);
  assert.equal(f.dropped, 0);
});

test('drops a single 2000 px jump', () => {
  const { f, t } = warmFilter();
  const r = feed(f, t, [[4, 0], [0, 2000], [4, 0], [4, 0]]);
  assert.deepEqual([r.x, r.y], [12, 0]);
  assert.equal(f.dropped, 1);
});

test('drops single spikes of a few hundred px on either axis', () => {
  const { f, t } = warmFilter();
  const r = feed(f, t, [[3, 1], [-640, 0], [3, 1], [3, 1], [0, 580], [2, 1], [5, 1], [300, -300], [2, 0]]);
  assert.deepEqual([r.x, r.y], [18, 5]);
  assert.equal(f.dropped, 3);
});

test('drops a spike far above slow recent motion', () => {
  const f = createLookFilter();
  let t = 0;
  for (let i = 0; i < SKIP_AFTER_LOCK + 20; i++) filterLookDelta(f, 1, 0, (t += 8));
  const r = feed(f, t, [[1, 0], [0, -120], [1, 0], [1, 0]]);
  assert.deepEqual([r.x, r.y], [3, 0]);
  assert.equal(f.dropped, 1);
});

test('keeps a fast flick spread over several events', () => {
  const { f, t } = warmFilter();
  const flick: [number, number][] = [[80, -10], [260, -30], [340, -40], [280, -20], [150, -5], [60, 0], [10, 0]];
  const r = feed(f, t, flick);
  const total = flick.reduce((a, [dx, dy]) => [a[0] + dx, a[1] + dy], [0, 0]);
  assert.deepEqual([r.x, r.y], total);
  assert.equal(f.dropped, 0);
});

test('keeps a flick that starts from rest', () => {
  const f = createLookFilter();
  let t = 0;
  for (let i = 0; i < SKIP_AFTER_LOCK; i++) filterLookDelta(f, 0, 0, (t += 8));
  const r = feed(f, t, [[90, 5], [120, 8], [70, 2], [20, 0]]);
  assert.deepEqual([r.x, r.y], [300, 15]);
  assert.equal(f.dropped, 0);
});

test('a held event is not confirmed by motion long after it', () => {
  const { f, t } = warmFilter();
  assert.equal(filterLookDelta(f, 400, 0, t + 8), null);
  assert.equal(f.dropped, 0);
  assert.deepEqual(filterLookDelta(f, 120, 0, t + 500), null); // big again, so held in turn
  assert.equal(f.dropped, 1);
});

test('ignores non-finite deltas', () => {
  const { f, t } = warmFilter();
  assert.equal(filterLookDelta(f, Number.NaN, 0, t + 8), null);
  assert.equal(filterLookDelta(f, 0, Infinity, t + 16), null);
});
