import { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useStore } from '../store';
import { keyboardFor } from '../ui/keyboards';
import { TYPING_CHANNELS, TYPING_RANGE, placeTypingChannel, typingGeneration, typingSound } from '../ui/typingSfx';
import { isCelebrating } from './gongState';
import { isSeated } from './people';
import {
  TAP_PHASE,
  assignSlots,
  hashString,
  inBurst,
  keyboardSpot,
  nearestK,
  nextKeyDown,
  nextMouseClick,
  nextScrollTick,
  poseFor,
  strokeAt,
  strokeVariation,
  tapSpeed,
  typingSeed,
  type PoseName,
  type Vec3,
} from './typing';

// Lives inside the Canvas: the working people on this floor (or the CEO in the lobby) type, click and
// scroll out loud, in time with their hands. Only the nearest few are heard. It runs in useFrame, so it
// stops with the render loop (tab hidden, a panel covering the view) and starts fresh when it resumes.

const LOOKAHEAD = 0.12; // seconds of keystrokes scheduled ahead on the audio clock
const MAX_PEOPLE = 64;

interface Person {
  seed: number;
  keyboard: number;
  lastTool: string | null;
  lastToolAt: number;
  pose: PoseName;
  spot: Vec3;
  until: number; // rhythm time (seconds) scheduled up to
}

export function TypingSounds() {
  const camera = useThree((s) => s.camera);
  const st = useMemo(
    () => ({
      people: new Map<string, Person>(),
      ids: new Array<string>(MAX_PEOPLE).fill(''),
      dist: new Float64Array(MAX_PEOPLE),
      pick: new Int32Array(TYPING_CHANNELS),
      chosen: new Array<string>(TYPING_CHANNELS).fill(''),
      slots: new Array<string | null>(TYPING_CHANNELS).fill(null),
      placed: new Array<string>(TYPING_CHANNELS).fill(''), // who (and where) each channel was last moved to
      placedMouse: new Array<boolean>(TYPING_CHANNELS).fill(false),
      generation: 0, // typingGeneration() when the channels were placed
    }),
    [],
  );

  useFrame(() => {
    const s = useStore.getState();
    const now = performance.now();
    // Silent while the elevator travels; the next floor starts fresh.
    let repoId: string | null = null;
    if (s.floor !== 0) for (const r of s.repos) if (r.floor === s.floor) repoId = r.id;
    let n = 0;
    if (!s.travel && (s.floor === 0 || repoId)) {
      const cam = camera.position;
      for (const id in s.agents) {
        const a = s.agents[id];
        if (s.floor === 0 ? a.role !== 'ceo' : a.role === 'ceo' || a.repoId !== repoId) continue;
        let p = st.people.get(id);
        if (!p) {
          p = { seed: typingSeed(id), keyboard: keyboardFor(hashString(id)), lastTool: null, lastToolAt: 0, pose: 'relaxed', spot: { x: 0, y: 0, z: 0 }, until: 0 };
          st.people.set(id, p);
        }
        if (a.currentTool) {
          p.lastTool = a.currentTool;
          p.lastToolAt = now;
        }
        // Out of their chair (or the whole floor cheering a merge): hands off the keyboard.
        if ((a.status !== 'working' && a.status !== 'preparing') || !isSeated(id) || isCelebrating(a.repoId, now)) continue;
        p.pose = poseFor(a.status, a.currentTool, p.lastTool, now - p.lastToolAt, false);
        if (p.pose === 'thinking') continue;
        keyboardSpot(a.role, a.desk, p.pose === 'browsing', p.spot);
        const d = Math.hypot(p.spot.x - cam.x, p.spot.y - cam.y, p.spot.z - cam.z);
        if (d > TYPING_RANGE || n >= MAX_PEOPLE) continue;
        st.ids[n] = id;
        st.dist[n] = d;
        n++;
      }
    }
    const k = nearestK(st.dist, n, TYPING_CHANNELS, st.pick);
    for (let i = 0; i < k; i++) st.chosen[i] = st.ids[st.pick[i]];
    assignSlots(st.slots, st.chosen, k);
    // New channels (audio just unlocked, or a new AudioContext) start at the origin: place them all again.
    const generation = typingGeneration();
    if (st.generation !== generation) {
      st.generation = generation;
      st.placed.fill('');
    }

    for (let ch = 0; ch < TYPING_CHANNELS; ch++) {
      const id = st.slots[ch];
      const p = id === null ? undefined : st.people.get(id);
      const a = id === null ? undefined : s.agents[id];
      if (!p || !a || id === null) continue;
      const mouse = p.pose === 'browsing';
      if ((st.placed[ch] !== id || st.placedMouse[ch] !== mouse) && placeTypingChannel(ch, p.spot)) {
        st.placed[ch] = id;
        st.placedMouse[ch] = mouse;
      }
      const tNow = now / 1000 + p.seed;
      const horizon = tNow + LOOKAHEAD;
      // After a gap (paused, out of earshot, another floor) skip what was missed instead of catching up.
      const from = p.until < tNow - 0.05 || p.until > horizon ? tNow : p.until;
      if (mouse) {
        for (let t = nextMouseClick(from); t <= horizon; t = nextMouseClick(t)) {
          if (inBurst(t)) typingSound(ch, 'click', p.keyboard, strokeVariation(t, 5.3, 1), t - tNow, p.spot);
        }
        for (let t = nextScrollTick(from, horizon); t <= horizon; t = nextScrollTick(t, horizon)) {
          typingSound(ch, 'scroll', p.keyboard, strokeVariation(t, 80, 1), t - tNow, p.spot);
        }
      } else {
        const speed = tapSpeed(a.status);
        for (let h = 0; h < 2; h++) {
          const hand = h === 0 ? 0 : 1;
          const phase = hand === 0 ? TAP_PHASE.l : TAP_PHASE.r;
          for (let t = nextKeyDown(from, speed, phase); t <= horizon; t = nextKeyDown(t, speed, phase)) {
            if (inBurst(t)) typingSound(ch, strokeAt(t, speed, hand), p.keyboard, strokeVariation(t, speed, hand), t - tNow, p.spot);
          }
        }
      }
      p.until = horizon;
    }
  });
  return null;
}
