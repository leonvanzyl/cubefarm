import { useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { CEO_ID } from '../../../shared/types';
import { isBusy, useStore, type Agent, type Focus } from '../store';
import { babble, babbleNodes, hushBabble, moveBabble, renderBabble } from '../ui/babble';
import { LINE_TTL, MAX_SPEAKERS, PACE, admitSpeaker, babbleVoice, bubbleSeconds, mayTalk, planBabble, type BabbleVoice, type Priority } from '../ui/babbleRules';
import { chatterLine, type ChatTopic, type ChatterEvent } from '../ui/chatterLines';
import { getAudioPrefs, listenerAt } from '../ui/sfx';
import { DROP_NEW, PLAY } from '../ui/sfxMix';
import type { BodyState } from './body';
import { CI_SLOW, DEMO_CI_SLOW, currentWork, greeting, lastFile, logNews, slowChecks, storeNews, type Said } from './chatterEvents';
import { isFree } from './errands';
import type { Pick as AimPick } from './interact';
import { bodyState, errandOf, liveBodies, say, saying } from './people';

// Lives inside the Canvas: the people on the floor you're on talk. Lines come from what happens in the office (the
// store's changes, read by chatterEvents.ts), from a chat at the cooler (ErrandDirector.tsx asks chatSay), from you
// saying hi (E on someone with nothing to do), and, when chatter is lively, from their work. Each line is a timed
// speech bubble (people.ts `say`) and a babble in their own voice (babble.ts), positional from their head. At most
// MAX_SPEAKERS speak at once, the nearest winning; the chatter level paces the rest. It runs in useFrame, so it stops
// with the render loop, and nothing new starts while a panel is open or you're in the elevator.
// window.__swarmChatter shows the recent lines, who's speaking, everyone's voice and the babble's node count.

interface Line {
  who: string;
  near?: boolean;
  event: ChatterEvent;
  priority: Priority;
  /** Clock seconds: when it may start, and when it's old news. */
  at: number;
  ttl: number;
}

interface Speaker {
  id: string;
  text: string;
  /** Clock seconds: when the bubble goes, and when the babble ends. */
  until: number;
  voiceEnd: number;
  d: number;
  voiced: boolean;
}

interface Heard {
  at: number;
  id: string;
  name: string;
  line: string;
  why: ChatterEvent['kind'] | 'say';
  voiced: boolean;
  d: number;
  slot: number;
}

type StoreState = ReturnType<typeof useStore.getState>;

const RANK: Record<Priority, number> = { greet: 0, event: 1, chat: 2, ambient: 3 };
const MAX_PENDING = 40;
const RECENT = 40;
/** A line isn't picked again while it's among the floor's last few, if there's another way to say it. */
const HEARD = 3;
/** How far (m) a hit on someone counts as aiming at them rather than their desk. */
const AIM_RADIUS = 0.42;
/** People this close (m) take turns: nobody starts a line while a neighbour's is still up (their bubbles would overlap). */
const TURN_RADIUS = 2;

const clock = () => performance.now() / 1000;
const round = (n: number) => Math.round(n * 100) / 100;
const between = ([min, max]: readonly [number, number]) => min + Math.random() * (max - min);

const pending: Line[] = [];
const speakers: (Speaker | null)[] = Array.from({ length: MAX_SPEAKERS }, () => null);
const lastLine = new Map<string, string>();
const lastAt = new Map<string, number>();
let floorLast = -Infinity;
const recent: Heard[] = [];
const logSeen = new Map<string, number>();
const errandSeen = new Map<string, string>();
const ambientAt = new Map<string, number>();
let ceoAt: number | null = null;
const ciSince = new Map<string, number>();
const ciDone = new Set<string>();
let nextTick = 0;
let nextCi = 0;
const voices = new Map<string, BabbleVoice>();

// ---------- who and where ----------

function voiceOf(a: Pick<Agent, 'id' | 'look' | 'role'>) {
  const key = `${a.id}:${a.look}:${a.role}`;
  let v = voices.get(key);
  if (!v) voices.set(key, (v = babbleVoice(a.id, a.look, a.role)));
  return v;
}

/** Their mouth, more or less: lower while seated. */
const headY = (b: BodyState) => 1.25 * b.sit + 1.6 * (1 - b.sit);

function distanceTo(b: BodyState) {
  const ear = listenerAt();
  return Math.hypot(ear.x - b.x, ear.y - headY(b), ear.z - b.z);
}

const speakingSlot = (id: string) => speakers.findIndex((s) => s?.id === id);

/** Someone else within TURN_RADIUS of `b` is speaking. */
function neighbourSpeaking(id: string, b: BodyState) {
  for (const s of speakers) {
    const o = s && s.id !== id ? bodyState(s.id) : undefined;
    if (o && Math.hypot(o.x - b.x, o.z - b.z) < TURN_RADIUS) return true;
  }
  return false;
}

/** The nearest other agent on the floor to someone (not a visitor: a courier or a candidate), who isn't speaking already. */
function nearestTo(id: string): string | null {
  const b0 = bodyState(id);
  if (!b0) return null;
  const agents = useStore.getState().agents;
  let best: string | null = null;
  let bd = Infinity;
  for (const [other, b] of liveBodies()) {
    if (other === id || !agents[other] || speakingSlot(other) >= 0) continue;
    const d = Math.hypot(b.x - b0.x, b.z - b0.z);
    if (d < bd) {
      bd = d;
      best = other;
    }
  }
  return best;
}

// ---------- speaking ----------

/** Ends a line early: its babble fades, its bubble goes (unless something else is in it by now). */
function cut(slot: number) {
  const sp = speakers[slot];
  hushBabble(slot);
  if (sp && saying(sp.id)?.text === sp.text) say(sp.id, null);
  speakers[slot] = null;
}

/** A slot for a line from `d` metres away: a free one, the farthest speaker's (cut off) when this one is nearer, or -1. */
function takeSlot(d: number, force = false): number {
  const active = speakers.flatMap((s, slot) => (s ? [{ d: s.d, slot }] : []));
  let r = admitSpeaker(active, d);
  if (r === DROP_NEW && force) r = active.reduce((far, s, i) => (s.d > active[far].d ? i : far), 0);
  if (r === DROP_NEW) return -1;
  if (r === PLAY) return speakers.findIndex((s) => !s);
  cut(active[r].slot);
  return active[r].slot;
}

/** Says a line (an event to put in words, or the words) in slot `slot`: the bubble, and the babble unless bubbles are silent. */
function speak(id: string, what: ChatterEvent | string, priority: Priority, slot: number, d: number, seconds?: number) {
  const t = clock();
  const a = useStore.getState().agents[id];
  const heard = recent.slice(-HEARD).map((r) => r.line);
  const text = typeof what === 'string' ? what : chatterLine(what, Math.random, lastLine.get(id) ?? null, heard);
  const secs = seconds ?? bubbleSeconds(text);
  say(id, text, secs);
  let voiced = false;
  let voiceEnd = t;
  const b = bodyState(id);
  if (!getAudioPrefs().silentBubbles && a && b) {
    const v = voiceOf(a);
    const plan = planBabble(text, v);
    voiced = babble(slot, { x: b.x, y: headY(b), z: b.z }, plan.notes, v, a.name);
    voiceEnd = t + plan.length + 0.1;
  }
  speakers[slot] = { id, text, until: t + secs, voiceEnd, d, voiced };
  lastLine.set(id, text);
  lastAt.set(id, t);
  if (priority !== 'greet') floorLast = t;
  recent.push({ at: Math.round(performance.now()), id, name: a?.name ?? id, line: text, why: typeof what === 'string' ? 'say' : what.kind, voiced, d: round(d), slot });
  if (recent.length > RECENT) recent.splice(0, recent.length - RECENT);
}

/** Lines wait at most `ttl` seconds (LINE_TTL) for their turn. */
function queue(s: Said, ttl = LINE_TTL) {
  const at = clock() + s.delay;
  pending.push({ who: s.who, near: s.near, event: s.event, priority: s.priority, at, ttl: at + ttl });
  if (pending.length > MAX_PENDING) pending.splice(0, pending.length - MAX_PENDING);
}

// ---------- what happened ----------

/**
 * The store changed: news from the office and from everyone's new log lines (none until the first snapshot is in, and
 * none from a time-lapse replaying a recorded day).
 */
function onStore(s: StoreState, prev: StoreState) {
  const fresh = s.loaded && prev.loaded && !s.replaying && !prev.replaying;
  const on = getAudioPrefs().chatter !== 'off';
  if (s.logs !== prev.logs) {
    for (const [id, lines] of Object.entries(s.logs)) {
      if (lines === prev.logs[id] || !lines.length) continue;
      const seen = logSeen.get(id);
      logSeen.set(id, lines[lines.length - 1].id);
      const a = s.agents[id];
      if (!fresh || seen === undefined || !on || !a) continue;
      for (const x of logNews(a, lines.filter((l) => l.id > seen), Date.now())) queue(x);
    }
  }
  if (!fresh || !on) return;
  if (s.agents !== prev.agents || s.qa !== prev.qa || s.repos !== prev.repos) for (const x of storeNews(prev, s, (id) => lastFile(s.logs[id] ?? []))) queue(x);
}

/** Errands worth a word as they start: off for a coffee, or looking over a busy teammate's shoulder. */
function errandNews(st: StoreState) {
  for (const id of liveBodies().keys()) {
    const e = errandOf(id);
    const key = e ? `${e.name}:${e.phase}` : '';
    if (errandSeen.get(id) === key) continue;
    errandSeen.set(id, key);
    if (key === 'coffee:leaving' && Math.random() < 0.6) queue({ who: id, event: { kind: 'coffee' }, delay: 0.4, priority: 'event' });
    if (key === 'visit:there' && e) {
      const host = st.agents[e.spot.replace(/^visit-/, '')];
      if (host) queue({ who: id, event: { kind: 'visit', host: host.name, issue: host.issueNumber }, delay: 2.5, priority: 'event' });
    }
  }
}

/** Small talk: busy people about their work (lively), and the CEO musing about the lobby. */
function smallTalk(st: StoreState, t: number) {
  const level = getAudioPrefs().chatter;
  if (level === 'off') return;
  const pace = PACE[level];
  const now = Date.now();
  for (const id of liveBodies().keys()) {
    const a = st.agents[id];
    if (!a || a.role === 'ceo' || !isBusy(a) || !pace.ambient) continue;
    const due = ambientAt.get(id);
    if (due !== undefined && t < due) continue;
    ambientAt.set(id, t + between(pace.ambient));
    const w = due !== undefined && currentWork(st.logs[id] ?? [], now);
    if (w) queue({ who: id, event: { kind: 'work', ...w }, delay: 0, priority: 'ambient' });
  }
  const ceo = st.agents[CEO_ID];
  if (!ceo || !liveBodies().has(CEO_ID)) {
    ceoAt = null;
    return;
  }
  // The CEO walking the floor (a ritual): a hello to the team soon after they step out of the elevator.
  if (ceoAt === null && st.floor !== 0) queue({ who: CEO_ID, event: { kind: 'ceoVisit' }, delay: 4, priority: 'event' });
  if (ceoAt === null) ceoAt = t + between(pace.ceo);
  else if (t >= ceoAt) {
    ceoAt = t + between(pace.ceo);
    queue({ who: CEO_ID, event: { kind: 'ceo', busy: isBusy(ceo) }, delay: 0, priority: 'ambient' });
  }
}

/** Starts whatever lines may start now: the most important first, then the oldest. */
function startLines(st: StoreState, t: number) {
  const level = getAudioPrefs().chatter;
  if (level === 'off') return;
  const pace = PACE[level];
  pending.sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.at - b.at);
  for (let k = 0; k < pending.length; ) {
    const line = pending[k];
    if (t > line.ttl) {
      pending.splice(k, 1);
      continue;
    }
    if (t < line.at) {
      k++;
      continue;
    }
    const id = line.near ? nearestTo(line.who) : line.who;
    const b = id ? bodyState(id) : undefined;
    // Not on this floor (or nobody to say it): they're not here to say it.
    if (!id || !b) {
      pending.splice(k, 1);
      continue;
    }
    // Nobody talks over a bubble something else put up (a ritual's or a meal's), and the CEO not over their own
    // message being read aloud on your phone.
    const busy = speakingSlot(id) >= 0 || !!saying(id) || neighbourSpeaking(id, b) || (id === CEO_ID && st.voiceSpeaking !== null);
    if (busy || !mayTalk(line.priority, pace, t, lastAt.get(id) ?? -Infinity, floorLast)) {
      k++;
      continue;
    }
    const d = distanceTo(b);
    const slot = takeSlot(d);
    if (slot < 0) {
      k++;
      continue;
    }
    pending.splice(k, 1);
    speak(id, line.event, line.priority, slot, d);
  }
}

function think(t: number) {
  const prefs = getAudioPrefs();
  if (prefs.chatter === 'off' || useStore.getState().replaying) {
    pending.length = 0;
    for (let i = 0; i < MAX_SPEAKERS; i++) if (speakers[i]) cut(i);
    return;
  }
  const st = useStore.getState();
  if (t >= nextCi) {
    nextCi = t + 1;
    for (const x of slowChecks(st.repos, st.agents, ciSince, ciDone, Date.now(), st.demo ? DEMO_CI_SLOW : CI_SLOW)) queue(x);
  }
  errandNews(st);
  smallTalk(st, t);
  // Away from the floor (a panel, the elevator, another tab): nothing new starts, and the news goes stale.
  if (st.overlay || st.travel || document.hidden) return;
  startLines(st, t);
}

// ---------- asked for by others ----------

/**
 * A chat at the cooler or the couch (ErrandDirector.tsx): a line on the topic for `seconds`, or with chatter off the
 * topic's emoji, as chats always had. They take turns: while someone in the huddle is still talking, this one waits to
 * say it (or lets it go when the moment passes). When nearer voices fill the floor, the emoji shows silently.
 */
export function chatSay(id: string, topic: ChatTopic, pr: number | null, venue: string, seconds: number) {
  const b = bodyState(id);
  if (getAudioPrefs().chatter === 'off' || !b) {
    say(id, topic);
    return;
  }
  const mine = speakingSlot(id);
  if (mine >= 0) cut(mine);
  if (neighbourSpeaking(id, b)) {
    queue({ who: id, event: { kind: 'chat', topic, pr, venue }, delay: 0, priority: 'chat' }, seconds);
    return;
  }
  const d = distanceTo(b);
  const slot = takeSlot(d);
  if (slot < 0) say(id, topic, seconds);
  else speak(id, { kind: 'chat', topic, pr, venue }, 'chat', slot, d, seconds);
}

/** Someone the player can say hi to: chatter is on, they've nothing to do, and it's the live office (not a replay). */
export function greetable(id: string) {
  const st = useStore.getState();
  const a = st.agents[id];
  return !!a && getAudioPrefs().chatter !== 'off' && !st.replaying && isFree(a.status) && !!bodyState(id);
}

/** The player said hi (E on them): a hello or a quip about their work, straight away. False when they can't answer. */
export function greet(id: string): boolean {
  const st = useStore.getState();
  const a = st.agents[id];
  const b = bodyState(id);
  if (!a || !b || !greetable(id)) return false;
  const mine = speakingSlot(id);
  if (mine >= 0) cut(mine);
  const d = distanceTo(b);
  speak(id, greeting(a, st, st.settings.managerName, Date.now()), 'greet', takeSlot(d, true), d);
  return true;
}

/**
 * For a desk's interactable (Desk.tsx): aiming at its person, when they've nothing to do, says hi to them instead of
 * opening the desk. `desk` ends the hint: what aiming at the desk instead does ("for their terminal").
 */
export function greetPick(id: string, desk: string): AimPick {
  return (point) => {
    const b = bodyState(id);
    if (!b || !greetable(id)) return null;
    const top = headY(b) + 0.45;
    if (Math.hypot(point.x - b.x, point.z - b.z) > AIM_RADIUS || point.y < 0.55 || point.y > top) return null;
    const name = useStore.getState().agents[id]?.name ?? 'them';
    const focus: Focus = { id: `greet-${id}`, label: `Say hi to ${name} 👋 · aim at the desk ${desk}`, action: { kind: 'greet', agentId: id } };
    return focus;
  };
}

// ---------- the component and the probe ----------

export function Chatter() {
  useEffect(() => useStore.subscribe(onStore), []);
  useFrame(() => {
    const t = clock();
    // Follow the speakers' heads, and free the slots of lines that are over (or whose speaker left the floor, or whose
    // bubble something else took down: a chat that ended).
    for (let i = 0; i < MAX_SPEAKERS; i++) {
      const sp = speakers[i];
      if (!sp) continue;
      const b = bodyState(sp.id);
      if (!b || t >= sp.until || saying(sp.id)?.text !== sp.text) {
        if (t < sp.voiceEnd) hushBabble(i);
        speakers[i] = null;
        continue;
      }
      sp.d = distanceTo(b);
      if (sp.voiced && t < sp.voiceEnd) moveBabble(i, b.x, headY(b), b.z);
    }
    if (t < nextTick) return;
    nextTick = t + 0.25;
    think(t);
  });
  return null;
}

if (typeof window !== 'undefined') {
  const agents = () => useStore.getState().agents;
  (window as unknown as Record<string, unknown>).__swarmChatter = {
    /** The settings: off / quiet / lively, and whether the bubbles babble. */
    get level() {
      return getAudioPrefs().chatter;
    },
    get babble() {
      return !getAudioPrefs().silentBubbles;
    },
    /** The last lines said on any floor you were on: who, what, why, voiced or not, how far (m) and in which slot. */
    get recent() {
      return recent.map((r) => ({ ...r }));
    },
    /** Who is speaking now. */
    get speakers() {
      const t = clock();
      return speakers.flatMap((s, slot) => (s ? [{ slot, id: s.id, name: agents()[s.id]?.name ?? s.id, line: s.text, d: round(s.d), voiced: s.voiced, endsIn: round(s.until - t) }] : []));
    },
    get pending() {
      return pending.map((p) => ({ who: p.who, near: !!p.near, kind: p.event.kind, priority: p.priority }));
    },
    /** Everyone's babble voice (seeded from their id and look, so the same on every load). */
    get voices() {
      return Object.fromEntries(Object.values(agents()).map((a) => [a.id, { name: a.name, ...voiceOf(a) }]));
    },
    /** The babble's audio nodes: the slots' fixed ones, the blips alive now, the most ever alive and all ever made. */
    get nodes() {
      return babbleNodes();
    },
    /** Makes someone on this floor say `text` now (QA), with the speaker cap; false when they're not here or it's full. */
    say(id: string, text: string) {
      const b = bodyState(id);
      if (!b || speakingSlot(id) >= 0) return false;
      const d = distanceTo(b);
      const slot = takeSlot(d);
      if (slot < 0) return false;
      speak(id, text, 'event', slot, d);
      return true;
    },
    greet,
    /** Renders `text` in someone's voice offline and measures it (peak sample and RMS, straight out, before any mixer). */
    measure(text: string, id: string) {
      const a = agents()[id];
      const v = a ? voiceOf(a) : babbleVoice(id);
      return renderBabble(planBabble(text, v).notes, v);
    },
  };
}
