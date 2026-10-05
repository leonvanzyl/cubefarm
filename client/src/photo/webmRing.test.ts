import { describe, expect, it } from 'vitest';
import { createRing, heldMs, pushChunk, replayParts, type WebmRing } from './webmRing';

// A tiny EBML writer, independent of the module's, to build streams shaped like a MediaRecorder's.
const idBytes = (id: number) => {
  const out: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff);
  return out;
};
const sizeBytes = (n: number) => {
  if (n < 127) return [0x80 | n];
  if (n < 16383) return [0x40 | (n >> 8), n & 0xff];
  return [0x20 | (n >> 16), (n >> 8) & 0xff, n & 0xff];
};
const uint = (n: number) => {
  const out: number[] = [];
  do {
    out.unshift(n & 0xff);
    n = Math.floor(n / 256);
  } while (n > 0);
  return out;
};
const el = (id: number, body: number[]) => [...idBytes(id), ...sizeBytes(body.length), ...body];
const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

const header = () => [
  ...el(0x1a45dfa3, [...el(0x4282, [...'webm'].map((c) => c.charCodeAt(0)))]),
  ...idBytes(0x18538067),
  ...UNKNOWN,
  ...el(0x1549a966, [...el(0x2ad7b1, uint(1000000)), ...el(0x4489, [0x40, 0x8f, 0x40, 0, 0, 0, 0, 0])]),
  ...el(0x1654ae6b, [...el(0xae, [...el(0xd7, [1]), ...el(0x83, [1])]), ...el(0xae, [...el(0xd7, [2]), ...el(0x83, [2])])]),
];

/** A video block: a SimpleBlock (keyframe flag) or, like Chrome's VP9, a BlockGroup with a ReferenceBlock when it isn't one. */
const video = (rel: number, key: boolean, group: boolean) => {
  const block = [0x81, (rel >> 8) & 0xff, rel & 0xff, key && !group ? 0x80 : 0, 1, 2, 3, 4];
  if (!group) return el(0xa3, block);
  return el(0xa0, [...el(0xa1, block), ...(key ? [] : el(0xfb, [0xff]))]);
};
const audio = (rel: number) => el(0xa3, [0x82, (rel >> 8) & 0xff, rel & 0xff, 0x80, 9, 9]);

/** A cluster of unknown size at `time` ms: a block every 100 ms for a second, audio first. */
const cluster = (time: number, key: boolean, group = false) => [
  ...idBytes(0x1f43b675),
  ...UNKNOWN,
  ...el(0xe7, uint(time)),
  ...audio(0),
  ...video(0, key, group),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((i) => [...audio(i * 100), ...video(i * 100, false, group)]),
];

/** Feeds `bytes` in pieces of `size`. */
function feed(r: WebmRing, bytes: number[], size: number) {
  for (let i = 0; i < bytes.length; i += size) pushChunk(r, Uint8Array.from(bytes.slice(i, i + size)));
}

/** Reads back a replay file: the clusters' times and whether each opens on a video keyframe. */
function readClusters(parts: Uint8Array[]): { times: number[]; ok: boolean; hasDuration: boolean } {
  const r = createRing(Infinity);
  for (const p of parts) pushChunk(r, p);
  pushChunk(r, Uint8Array.from([...idBytes(0x1f43b675), ...UNKNOWN])); // closes the last one
  const all = parts.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(all);
  let o = 0;
  for (const p of parts) {
    bytes.set(p, o);
    o += p.length;
  }
  const hasDuration = bytes.some((b, i) => b === 0x44 && bytes[i + 1] === 0x89);
  return { times: r.clusters.slice(0, -1).map((c) => c.time), ok: r.failed === null, hasDuration };
}

describe('instant replay ring', () => {
  for (const group of [false, true]) {
    it(`keeps the last window from a keyframe cluster, whatever the chunking (${group ? 'BlockGroups' : 'SimpleBlocks'})`, () => {
      // a keyframe every 3 s, clusters every second, 30 s in all
      const stream = [...header()];
      for (let s = 0; s < 30; s++) stream.push(...cluster(s * 1000, s % 3 === 0, group));
      for (const size of [7, 333, 4096, stream.length]) {
        const r = createRing(15_000);
        feed(r, stream, size);
        expect(r.failed).toBeNull();
        expect(r.video).toBe(1);
        // 29.9 s is the newest block, so the replay starts at the keyframe at or before 14.9 s: 12 s
        const parts = replayParts(r, 15_000)!;
        const back = readClusters(parts);
        expect(back.ok).toBe(true);
        expect(back.times[0]).toBe(0);
        expect(back.times).toEqual(Array.from({ length: 18 }, (_, i) => i * 1000));
        expect(back.hasDuration).toBe(false);
        // older clusters are let go: never much more than the window plus one keyframe gap
        expect(heldMs(r)).toBeGreaterThanOrEqual(15_000);
        expect(heldMs(r)).toBeLessThan(15_000 + 3000 + 1000);
      }
    });
  }

  it('starts from the first keyframe when there is less history than asked for', () => {
    const stream = [...header(), ...cluster(0, true), ...cluster(1000, false), ...cluster(2000, true), ...cluster(3000, false)];
    const r = createRing(15_000);
    feed(r, stream, 50);
    expect(readClusters(replayParts(r, 15_000)!).times).toEqual([0, 1000, 2000, 3000]);
  });

  it('has nothing to give before the first keyframe', () => {
    const r = createRing(15_000);
    feed(r, [...header(), ...cluster(0, false)], 64);
    expect(replayParts(r, 15_000)).toBeNull();
  });

  it('marks a stream it cannot read as failed instead of throwing', () => {
    const r = createRing(15_000);
    pushChunk(r, Uint8Array.from([0x00, 0x00, 0x00, 0x00]));
    expect(r.failed).not.toBeNull();
    expect(replayParts(r, 15_000)).toBeNull();
  });

  it('reads clusters of known size too', () => {
    const known = (time: number, key: boolean) => {
      const body = cluster(time, key).slice(12); // drop the ID and unknown size
      return [...idBytes(0x1f43b675), ...sizeBytes(body.length), ...body];
    };
    const r = createRing(15_000);
    feed(r, [...header(), ...known(0, true), ...known(1000, false), ...known(2000, true)], 100);
    expect(readClusters(replayParts(r, 500)!).times).toEqual([0]);
    expect(readClusters(replayParts(r, 15_000)!).times).toEqual([0, 1000, 2000]);
  });
});

describe('instant replay ring without pictures', () => {
  it("doesn't keep minutes of sound waiting for a keyframe", () => {
    const soundOnly = (time: number) => [...idBytes(0x1f43b675), ...UNKNOWN, ...el(0xe7, uint(time)), ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((i) => audio(i * 100))];
    const stream = [...header(), ...cluster(0, true)];
    for (let s = 1; s < 300; s++) stream.push(...soundOnly(s * 1000));
    const r = createRing(15_000);
    feed(r, stream, 4096);
    expect(r.clusters.length).toBeLessThan(65);
    // the picture comes back with a keyframe: the replay starts there
    feed(r, [...cluster(300_000, true), ...cluster(301_000, false), ...idBytes(0x1f43b675), ...UNKNOWN], 4096);
    expect(readClusters(replayParts(r, 15_000)!).times).toEqual([0, 1000]);
  });
});
