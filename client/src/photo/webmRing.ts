// Instant replay's memory: a MediaRecorder's live WebM stream, kept as its header plus the last few seconds of
// clusters, so "save the last 15 s" can hand back a playable file without re-encoding. Pure (bytes in, bytes out):
// it parses just enough EBML to find each cluster's time and whether it opens on a video keyframe (the only place a
// file can start), drops what's older than the window, and writes the kept clusters back with times from zero.

const ID = {
  ebml: 0x1a45dfa3,
  segment: 0x18538067,
  seekHead: 0x114d9b74,
  info: 0x1549a966,
  duration: 0x4489,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackNumber: 0xd7,
  trackType: 0x83,
  cluster: 0x1f43b675,
  timecode: 0xe7,
  simpleBlock: 0xa3,
  blockGroup: 0xa0,
  block: 0xa1,
  referenceBlock: 0xfb,
  cues: 0x1c53bb6b,
  tags: 0x1254c367,
  chapters: 0x1043a770,
  attachments: 0x1941a469,
  void: 0xec,
} as const;

/** Elements that sit directly in the Segment: one of them ends a cluster of unknown size. */
const LEVEL1 = new Set<number>([ID.seekHead, ID.info, ID.tracks, ID.cluster, ID.cues, ID.tags, ID.chapters, ID.attachments]);
/** Level-1 elements a replay file doesn't keep: their positions and durations describe the whole recording. */
const DROPPED = new Set<number>([ID.seekHead, ID.cues, ID.tags, ID.void]);
const UNKNOWN_SIZE = Uint8Array.of(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff);

interface Cluster {
  /** Milliseconds (the muxer's default timecode scale). */
  time: number;
  /** Whether its first video block is a keyframe; null until that block has arrived. */
  key: boolean | null;
  /** Its children as they arrived, the Timecode left out (it is written afresh). */
  parts: Uint8Array[];
  bytes: number;
}

export interface WebmRing {
  pending: Uint8Array;
  state: 'top' | 'segment' | 'cluster';
  header: Uint8Array[];
  /** The video track's number, once the Tracks element has been read. */
  video: number | null;
  clusters: Cluster[];
  /** Bytes left in a cluster of known size; -1 for one of unknown size (a live recording's). */
  clusterLeft: number;
  /** The newest block's time (ms). */
  latest: number;
  /** Set when the stream couldn't be parsed; nothing more is kept. */
  failed: string | null;
  /** How much history to keep (ms). */
  windowMs: number;
}

export function createRing(windowMs: number): WebmRing {
  return { pending: new Uint8Array(0), state: 'top', header: [], video: null, clusters: [], clusterLeft: -1, latest: 0, failed: null, windowMs };
}

// ---------- EBML ----------

interface Head {
  id: number;
  /** Body size, or -1 for unknown. */
  size: number;
  /** Bytes taken by the ID and size. */
  len: number;
}

/** An element ID (marker bits kept) at `p`, or null when the bytes run out. */
function readId(b: Uint8Array, p: number): { id: number; len: number } | null {
  if (p >= b.length) return null;
  const first = b[p];
  const len = first & 0x80 ? 1 : first & 0x40 ? 2 : first & 0x20 ? 3 : first & 0x10 ? 4 : 0;
  if (!len) throw new Error('bad element id');
  if (p + len > b.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + b[p + i];
  return { id, len };
}

/** A size or number vint (marker stripped) at `p`; size -1 when every value bit is set (unknown size). */
function readVint(b: Uint8Array, p: number): { value: number; len: number } | null {
  if (p >= b.length) return null;
  const first = b[p];
  let len = 1;
  let mask = 0x80;
  while (len <= 8 && !(first & mask)) {
    len++;
    mask >>= 1;
  }
  if (len > 8) throw new Error('bad size');
  if (p + len > b.length) return null;
  let value = first & (mask - 1);
  let allOnes = value === mask - 1;
  for (let i = 1; i < len; i++) {
    value = value * 256 + b[p + i];
    if (b[p + i] !== 0xff) allOnes = false;
  }
  return { value: allOnes ? -1 : value, len };
}

function readHead(b: Uint8Array, p: number): Head | null {
  const id = readId(b, p);
  if (!id) return null;
  const size = readVint(b, p + id.len);
  if (!size) return null;
  return { id: id.id, size: size.value, len: id.len + size.len };
}

function readUint(b: Uint8Array, p: number, n: number): number {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + b[p + i];
  return v;
}

/** Each child of a master element's body: its ID and where its body lies. */
function* children(body: Uint8Array): Generator<{ id: number; start: number; end: number; body: Uint8Array }> {
  let p = 0;
  while (p < body.length) {
    const h = readHead(body, p);
    if (!h || h.size < 0) return;
    const start = p;
    const end = p + h.len + h.size;
    if (end > body.length) return;
    yield { id: h.id, start, end, body: body.subarray(p + h.len, end) };
    p = end;
  }
}

function encodeId(id: number): Uint8Array {
  const len = id < 0x100 ? 1 : id < 0x10000 ? 2 : id < 0x1000000 ? 3 : 4;
  const out = new Uint8Array(len);
  for (let i = len - 1, v = id; i >= 0; i--, v = Math.floor(v / 256)) out[i] = v & 0xff;
  return out;
}

function encodeSize(n: number): Uint8Array {
  let len = 1;
  while (len < 8 && n >= 2 ** (7 * len) - 1) len++;
  const out = new Uint8Array(len);
  let v = n;
  for (let i = len - 1; i >= 0; i--, v = Math.floor(v / 256)) out[i] = v & 0xff;
  out[0] |= 0x80 >> (len - 1);
  return out;
}

function encodeUint(n: number): Uint8Array {
  const bytes: number[] = [];
  let v = Math.max(0, Math.round(n));
  do {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  } while (v > 0);
  return Uint8Array.from(bytes);
}

/** One element: ID, size and body. */
function element(id: number, ...body: Uint8Array[]): Uint8Array {
  return concat([encodeId(id), encodeSize(body.reduce((n, b) => n + b.length, 0)), ...body]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ---------- reading the stream ----------

/** Which track is the video, from the Tracks element's body. */
function videoTrack(tracks: Uint8Array): number | null {
  for (const entry of children(tracks)) {
    if (entry.id !== ID.trackEntry) continue;
    let num: number | null = null;
    let type: number | null = null;
    for (const c of children(entry.body)) {
      if (c.id === ID.trackNumber) num = readUint(c.body, 0, c.body.length);
      if (c.id === ID.trackType) type = readUint(c.body, 0, c.body.length);
    }
    if (type === 1 && num !== null) return num;
  }
  return null;
}

/** Info without a Duration (it would describe the whole recording, not the replay). */
function infoWithoutDuration(info: Uint8Array): Uint8Array {
  const kept: Uint8Array[] = [];
  for (const c of children(info)) if (c.id !== ID.duration) kept.push(info.subarray(c.start, c.end));
  return element(ID.info, ...kept);
}

/** A block's track, its time relative to the cluster and whether it says it's a keyframe. */
function blockInfo(body: Uint8Array): { track: number; rel: number; key: boolean } | null {
  const t = readVint(body, 0);
  if (!t || t.len + 3 > body.length) return null;
  const raw = (body[t.len] << 8) | body[t.len + 1];
  return { track: t.value, rel: raw & 0x8000 ? raw - 0x10000 : raw, key: (body[t.len + 2] & 0x80) !== 0 };
}

function closeCluster(r: WebmRing) {
  r.state = 'segment';
  r.clusterLeft = -1;
  prune(r);
}

/** One child of the open cluster, whole. */
function clusterChild(r: WebmRing, id: number, raw: Uint8Array, body: Uint8Array) {
  const c = r.clusters[r.clusters.length - 1];
  if (id === ID.timecode) {
    c.time = readUint(body, 0, body.length);
    r.latest = Math.max(r.latest, c.time);
    return;
  }
  c.parts.push(raw.slice());
  c.bytes += raw.length;
  let block: { track: number; rel: number; key: boolean } | null = null;
  if (id === ID.simpleBlock) block = blockInfo(body);
  else if (id === ID.blockGroup) {
    let referenced = false;
    for (const g of children(body)) {
      if (g.id === ID.block) block = blockInfo(g.body);
      if (g.id === ID.referenceBlock) referenced = true;
    }
    if (block) block.key = !referenced;
  }
  if (!block) return;
  r.latest = Math.max(r.latest, c.time + block.rel);
  if (c.key === null && block.track === r.video) c.key = block.key;
}

/** Drops clusters older than the window, always keeping a keyframe cluster at or before its start. */
function prune(r: WebmRing) {
  const cutoff = r.latest - r.windowMs;
  let keep = -1;
  for (let i = 0; i < r.clusters.length - 1; i++) if (r.clusters[i].key && r.clusters[i].time <= cutoff) keep = i;
  if (keep > 0) r.clusters.splice(0, keep);
  if (r.clusters.length < 2 || r.latest - r.clusters[0].time <= r.windowMs * 4) return;
  // Sound but no picture for a long while (a panel over the view): rather than keep minutes of it waiting for the
  // next keyframe, start again from the newest one there is, or the next to come.
  let newest = -1;
  for (let i = 0; i < r.clusters.length - 1; i++) if (r.clusters[i].key) newest = i;
  r.clusters.splice(0, newest > 0 ? newest : r.clusters.length - 1);
}

/** Feeds the next piece of the recording. Throws nothing: a stream it can't read marks the ring failed. */
export function pushChunk(r: WebmRing, chunk: Uint8Array) {
  if (r.failed) return;
  const b = r.pending.length ? concat([r.pending, chunk]) : chunk;
  let p = 0;
  try {
    for (;;) {
      const h = readHead(b, p);
      if (!h) break;
      if (r.state === 'top') {
        if (h.id === ID.segment) {
          r.header.push(concat([encodeId(ID.segment), UNKNOWN_SIZE]));
          r.state = 'segment';
          p += h.len;
          continue;
        }
        if (h.size < 0) throw new Error('unknown-size element before the segment');
        if (p + h.len + h.size > b.length) break;
        if (h.id === ID.ebml) r.header.push(b.slice(p, p + h.len + h.size));
        p += h.len + h.size;
        continue;
      }
      if (r.state === 'cluster' && (LEVEL1.has(h.id) || r.clusterLeft === 0)) {
        closeCluster(r);
        continue;
      }
      if (r.state === 'segment') {
        if (h.id === ID.cluster) {
          r.clusters.push({ time: 0, key: null, parts: [], bytes: 0 });
          r.state = 'cluster';
          r.clusterLeft = h.size;
          p += h.len;
          continue;
        }
        if (h.size < 0) throw new Error('unknown-size element in the segment');
        if (p + h.len + h.size > b.length) break;
        const body = b.subarray(p + h.len, p + h.len + h.size);
        // Only what comes before the first cluster describes the stream; Cues and Tags at the end are dropped.
        if (!r.clusters.length && !DROPPED.has(h.id)) {
          if (h.id === ID.tracks) r.video = videoTrack(body);
          r.header.push(h.id === ID.info ? infoWithoutDuration(body) : b.slice(p, p + h.len + h.size));
        }
        p += h.len + h.size;
        continue;
      }
      // a child of the open cluster
      if (h.size < 0) throw new Error('unknown-size element in a cluster');
      const end = p + h.len + h.size;
      if (end > b.length) break;
      clusterChild(r, h.id, b.subarray(p, end), b.subarray(p + h.len, end));
      if (r.clusterLeft > 0) r.clusterLeft -= end - p;
      p = end;
    }
  } catch (err) {
    r.failed = err instanceof Error ? err.message : String(err);
    r.clusters = [];
    r.pending = new Uint8Array(0);
    return;
  }
  r.pending = b.slice(p);
  if (r.state === 'cluster' && r.clusterLeft === 0) closeCluster(r);
  else prune(r);
}

/** How many milliseconds the ring holds, from its oldest kept keyframe to the newest block. */
export function heldMs(r: WebmRing): number {
  const first = r.clusters.find((c) => c.key);
  return first ? r.latest - first.time : 0;
}

/** Bytes held (header and clusters). */
export function heldBytes(r: WebmRing): number {
  return r.header.reduce((n, h) => n + h.length, 0) + r.clusters.reduce((n, c) => n + c.bytes, 0) + r.pending.length;
}

/**
 * The last `ms` as a WebM file's parts (for a Blob): the header, then every cluster from the newest keyframe cluster
 * at or before the start, its times shifted to begin at zero. Null until there's a keyframe to start from.
 */
export function replayParts(r: WebmRing, ms: number): Uint8Array[] | null {
  if (r.failed || !r.header.length) return null;
  const cutoff = r.latest - ms;
  let start = -1;
  for (let i = 0; i < r.clusters.length; i++) {
    const c = r.clusters[i];
    if (!c.key) continue;
    if (start < 0 || c.time <= cutoff) start = i;
  }
  if (start < 0) return null;
  const base = r.clusters[start].time;
  const out: Uint8Array[] = [...r.header];
  for (let i = start; i < r.clusters.length; i++) {
    const c = r.clusters[i];
    if (!c.parts.length) continue; // the next one, just begun
    out.push(encodeId(ID.cluster), UNKNOWN_SIZE, element(ID.timecode, encodeUint(c.time - base)), ...c.parts);
  }
  return out;
}
