// What the captions say and when (captions.ts shows them): which sounds get one, worded short with a priority, a gate
// that keeps them rare (per-sound cooldowns and a cap on how many in a few seconds), the arrow that says where a sound
// came from, and how much of a spoken message to show as it's read. Pure, so the rules are tested without audio.

/** 1 ambient (the jukebox, thunder), 2 events (a merge, a chime), 3 alarms: always shown, and read out by screen readers. */
export type CaptionPriority = 1 | 2 | 3;

export interface CaptionInfo {
  /** Sounds sharing a key share a cooldown (a gong is a dozen tones; a cheer is many voices). */
  key: string;
  text: string;
  priority: CaptionPriority;
  cooldownMs: number;
}

interface Rule {
  match: (name: string) => boolean;
  key?: (name: string) => string;
  text: string | ((detail?: string) => string);
  priority: CaptionPriority;
  cooldownMs: number;
}

const is = (n: string) => (name: string) => name === n;
const starts = (p: string) => (name: string) => name.startsWith(p);
const has = (w: string) => (name: string) => name.includes(w);
const withDetail = (what: string) => (d?: string) => (d ? `[${what}: ${d}]` : `[${what}]`);

// Sound names as sfx.ts records them (window.__swarmSfx). Footsteps, typing, toys and room tone get none: they're
// constant, and the 3D view already shows them.
const RULES: Rule[] = [
  { match: is('gong'), text: '[gong]', priority: 2, cooldownMs: 3000 },
  { match: starts('cheer:'), key: () => 'cheer', text: '[merge cheer]', priority: 2, cooldownMs: 4000 },
  { match: is('cue:merged'), text: '[merge chime]', priority: 2, cooldownMs: 3000 },
  { match: is('cue:ready'), text: '[chime: PR ready to merge]', priority: 2, cooldownMs: 3000 },
  { match: is('cue:qaFailed'), text: '[womp: QA failed a PR]', priority: 3, cooldownMs: 5000 },
  { match: is('cue:error'), text: '[buzz: an agent hit an error]', priority: 3, cooldownMs: 5000 },
  { match: is('cue:welcome'), text: '[welcome jingle]', priority: 2, cooldownMs: 3000 },
  { match: is('chirp'), text: '[phone buzzes]', priority: 2, cooldownMs: 3000 },
  { match: is('ding'), text: '[elevator ding]', priority: 1, cooldownMs: 4000 },
  { match: has('alarm'), key: () => 'alarm', text: withDetail('alarm'), priority: 3, cooldownMs: 20_000 },
  { match: has('thunder'), key: () => 'thunder', text: '[thunder]', priority: 1, cooldownMs: 8000 },
  { match: is('event:roar'), text: '[kaiju roars]', priority: 1, cooldownMs: 8000 },
  { match: is('event:crash'), text: '[crash outside]', priority: 1, cooldownMs: 8000 },
  { match: is('event:boom'), text: '[boom outside]', priority: 1, cooldownMs: 8000 },
  { match: is('event:launch'), text: '[launch outside]', priority: 1, cooldownMs: 8000 },
  // one per song: a new song is captioned at once, the same one again only after a while
  { match: starts('jukebox:'), key: (n) => n, text: withDetail('jukebox'), priority: 1, cooldownMs: 90_000 },
];

/** The caption for a sound, or null when it doesn't get one. `detail` fills in what the name can't say (a song title). */
export function captionFor(name: string, detail?: string): CaptionInfo | null {
  const r = RULES.find((x) => x.match(name));
  if (!r) return null;
  return { key: r.key ? r.key(name) : name, text: typeof r.text === 'string' ? r.text : r.text(detail), priority: r.priority, cooldownMs: r.cooldownMs };
}

/** How long a caption stays up (ms). */
export const captionMs = (p: CaptionPriority) => (p === 3 ? 6000 : 3500);

// ---------- the gate ----------

export const GATE = {
  /** The window the caps count over (ms). */
  windowMs: 10_000,
  /** At most this many event captions in the window; ambient ones only while fewer than ambientMax are up. */
  max: 4,
  ambientMax: 2,
};

export interface CaptionGate {
  last: Record<string, number>;
  shown: number[];
}

export const newCaptionGate = (): CaptionGate => ({ last: {}, shown: [] });

/**
 * Whether a caption may show now (and if so, records it). A key repeats only after its cooldown; alarms always get
 * through otherwise, events while fewer than GATE.max showed in the window, ambient sounds while fewer than ambientMax.
 */
export function admitCaption(g: CaptionGate, c: CaptionInfo, now: number): boolean {
  const prev = g.last[c.key];
  if (prev !== undefined && now - prev < c.cooldownMs) return false;
  g.shown = g.shown.filter((t) => now - t < GATE.windowMs);
  if (c.priority < 3 && g.shown.length >= (c.priority === 1 ? GATE.ambientMax : GATE.max)) return false;
  g.last[c.key] = now;
  g.shown.push(now);
  return true;
}

// ---------- direction ----------

const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

/**
 * The arrow towards a sound `right` metres to the listener's right and `ahead` metres in front (negative: left,
 * behind): ↑ ahead, → right, ↓ behind and the diagonals. None for a sound right on top of you.
 */
export function arrowFor(right: number, ahead: number): string {
  if (Math.hypot(right, ahead) < 1) return '';
  const sector = Math.round(Math.atan2(right, ahead) / (Math.PI / 4));
  return ARROWS[(sector + 8) % 8];
}

/** The arrow for a sound that is only panned (-1 left to 1 right), not placed: left or right, or none near the middle. */
export const arrowForPan = (pan: number) => (pan <= -0.3 ? '←' : pan >= 0.3 ? '→' : '');

/** The caption with its arrow on the side the sound is on. */
export const withArrow = (text: string, arrow: string) => (!arrow ? text : ['↙', '←', '↖'].includes(arrow) ? `${arrow} ${text}` : `${text} ${arrow}`);

// ---------- spoken messages ----------

/** About how fast a voice reads (characters a second), for a browser voice that doesn't say where it is. */
export const SPEECH_CHARS_PER_SEC = 14;

/** About how long reading `text` aloud takes (ms). */
export const estimateSpeechMs = (text: string) => 600 + (text.length / SPEECH_CHARS_PER_SEC) * 1000;

/** The end of the word at `index` (or the next one, from a space): how much is shown once that word is said. */
export function wordEnd(text: string, index: number): number {
  const i =Math.max(0, Math.min(text.length, Math.floor(index)));
  let start = i;
  while (start < text.length && /\s/.test(text[start])) start++;
  const space = text.slice(start).search(/\s/);
  return space < 0 ? text.length : start + space;
}

/** How much of `text` has been said `elapsedMs` into a reading `durationMs` long: whole words, all of it at the end. */
export function spokenChars(text: string, elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0 || elapsedMs >= durationMs) return text.length;
  return wordEnd(text, (Math.max(0, elapsedMs) / durationMs) * text.length);
}

/** The last part of what's been said, about `maxChars` long, starting on a word: a caption is two lines, not a page. */
export function captionTail(text: string, upTo: number, maxChars: number): string {
  const said = text.slice(0, Math.max(0, upTo)).trimEnd();
  if (said.length <= maxChars) return said;
  const tail = said.slice(said.length - maxChars);
  const space = tail.search(/\s/);
  return `…${space >= 0 && space < tail.length - 1 ? tail.slice(space + 1) : tail}`;
}
