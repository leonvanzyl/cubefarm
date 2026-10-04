import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Outlines } from '@react-three/drei';
import * as THREE from 'three';
import { useRenderPaused } from '../perf';
import { useStore } from '../store';
import { musicTime, nowPlaying, playTrack, setMusicQuiet, stopMusic } from '../ui/music';
import { noise, tone, type Vec3 } from '../ui/sfx';
import { roundRect, SANS } from './draw';
import { useCanvasTexture, useInteractable } from './interact';
import { SONGS, beatAt, beatPulse, firstSongFor, noteAge, trackFor } from './jukeboxSongs';
import { HALF_D, JUKEBOX } from './layout';
import { glow, toon } from './materials';
import { Ball, Box, Cyl } from './Toon';

// Every floor's jukebox: it plays through the playlist (jukeboxSongs.ts) by itself, each floor starting on its own song.
// Aim at it and press E for the next song, or at its red button to stop and start the music (remembered in this
// browser). It bounces, spins its record, cycles its neon and puffs music notes on the beat. Only the current floor
// is drawn, so there's one jukebox at a time; each floor remembers the song it's on for the session.

const ON_KEY = 'cubefarm:jukebox';

function loadOn() {
  try {
    return localStorage.getItem(ON_KEY) !== 'off';
  } catch {
    return true;
  }
}

let on = loadOn();
let floorNow: number | null = null;
const songs = new Map<number, number>(); // floor → playlist index
const spot: Vec3 = { x: 0, y: 1, z: 0 };
const listeners = new Set<() => void>();

const songIndex = (floor: number) => songs.get(floor) ?? firstSongFor(floor);

function emit() {
  for (const fn of listeners) fn();
}

/** Plays the current floor's song from the top (or stops, when the jukebox is off). */
function start() {
  const floor = floorNow;
  if (floor === null || !on) stopMusic();
  else {
    playTrack(trackFor(songIndex(floor)), spot, () => {
      songs.set(floor, (songIndex(floor) + 1) % SONGS.length);
      start();
    });
  }
  emit();
}

// ---------- sounds ----------

const SFX = { group: 'toys', pos: spot } as const;

function clunk() {
  tone({ ...SFX, name: 'jukebox-button', freq: 1500, to: 900, type: 'square', dur: 0.05, peak: 0.04 });
  tone({ ...SFX, name: 'jukebox-button', freq: 160, to: 90, type: 'triangle', at: 0.03, dur: 0.12, peak: 0.08 });
}

/** The needle dropping on a new record: a soft crackle. */
function needle() {
  noise({ ...SFX, name: 'jukebox-needle', at: 0.08, dur: 0.25, peak: 0.03, filter: 'bandpass', freq: 3200, to: 1800, q: 1.5, attack: 0.01 });
}

// ---------- actions (Player's E / click on the jukebox) ----------

export type JukeboxOp = 'next' | 'toggle';

/** E on the jukebox: the next song (switching it on if it was off), or its button: music on or off. */
export function jukeboxAction(op: JukeboxOp) {
  if (floorNow === null) return;
  clunk();
  if (op === 'next') {
    songs.set(floorNow, (songIndex(floorNow) + 1) % SONGS.length);
    on = true;
  } else on = !on;
  try {
    localStorage.setItem(ON_KEY, on ? 'on' : 'off');
  } catch {
    // storage may be unavailable; the choice just won't be remembered
  }
  if (on) needle();
  start();
}

// ---------- probe ----------

/** window.__swarmJukebox: the current floor's jukebox, for QA and Playwright. */
export interface JukeboxSnapshot {
  on: boolean;
  floor: number | null;
  song: { id: string; title: string; artist: string; index: number } | null;
  /** Seconds into the song and the beat, while it plays. */
  time: number | null;
  beat: number | null;
}

if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmJukebox')) {
  Object.defineProperty(window, '__swarmJukebox', {
    get: (): JukeboxSnapshot => {
      const t = nowPlaying();
      const sec = musicTime();
      const index = floorNow === null ? null : songIndex(floorNow);
      const s = index === null ? null : SONGS[index];
      return {
        on,
        floor: floorNow,
        song: s && index !== null ? { id: s.id, title: s.title, artist: s.artist, index } : null,
        time: sec,
        beat: t && sec !== null ? beatAt(t, sec) : null,
      };
    },
    enumerable: false,
    configurable: false,
  });
  // __swarmJukeboxDo('next' | 'toggle'): press it without aiming (pointer lock doesn't work headless).
  Object.defineProperty(window, '__swarmJukeboxDo', { value: (op: JukeboxOp) => jukeboxAction(op), enumerable: false, configurable: false });
}

// ---------- drawing ----------

const { w: W, d: D } = JUKEBOX;
const BODY = '#d62828';
const TRIM = '#ffd166';
const INK = '#1f1d2b';
const ARCH_Y = 1.0;
const NOTES = [0, 1, 2, 3];
const NOTE_LIFE = 3; // beats each note rises for
const ROT_FRONT: [number, number, number] = [0, Math.PI, 0];

// One jukebox is on screen at a time, so it owns these and recolours them every frame.
const neonArch = new THREE.MeshBasicMaterial({ color: '#ff5d8f', toneMapped: false });
const neonSides = new THREE.MeshBasicMaterial({ color: '#4cc9f0', toneMapped: false });
const noteMats = NOTES.map(() => new THREE.SpriteMaterial({ transparent: true, depthWrite: false, toneMapped: false }));
const hsl = { h: 0, s: 0, l: 0 };
let noteTex: THREE.CanvasTexture | null = null;

/** A ♪ with an ink outline, shared by the floating notes. */
function musicNoteTexture() {
  if (noteTex) return noteTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.font = 'bold 54px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = INK;
    ctx.strokeText('♪', 32, 34);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('♪', 32, 34);
  }
  noteTex = new THREE.CanvasTexture(c);
  noteTex.colorSpace = THREE.SRGBColorSpace;
  for (const m of noteMats) m.map = noteTex;
  return noteTex;
}

function useJukeboxView() {
  const [view, setView] = useState(() => ({ on, index: floorNow === null ? 0 : songIndex(floorNow) }));
  useEffect(() => {
    const fn = () => setView({ on, index: floorNow === null ? 0 : songIndex(floorNow) });
    listeners.add(fn);
    fn();
    return () => void listeners.delete(fn);
  }, []);
  return view;
}

/** The jukebox against the south wall at `x`, facing into the room. `floor` picks its first song (lobby: 0). */
export function Jukebox({ x, floor }: { x: number; floor: number }) {
  // Quiet behind a panel or the phone and while the elevator travels, like the other loops. Set before the music
  // starts, and not from the frame loop, which stops while the view is paused.
  const paused = useRenderPaused();
  const away = useStore((s) => s.travel !== null || s.overlay !== null);
  useEffect(() => setMusicQuiet(paused || away), [paused, away]);

  // Start (and stop) the music with the floor.
  useEffect(() => {
    floorNow = floor;
    spot.x = x;
    spot.y = ARCH_Y;
    spot.z = HALF_D - D / 2;
    start();
    return () => {
      floorNow = null;
      stopMusic();
    };
  }, [x, floor]);

  const view = useJukeboxView();
  const song = SONGS[view.index];
  const dance = useRef<THREE.Group>(null);
  const record = useRef<THREE.Group>(null);
  const dome = useRef<THREE.Mesh>(null);
  const notes = useRef<(THREE.Sprite | null)[]>([]);
  const base = useMemo(() => {
    new THREE.Color(song.color).getHSL(hsl);
    return hsl.h;
  }, [song.color]);
  useMemo(musicNoteTexture, []);

  const display = useMemo(
    () => (ctx: CanvasRenderingContext2D) =>
      view.on
        ? drawDisplay(ctx, song.color, [
            { text: '♪ NOW PLAYING ♪', size: 34, weight: 700 },
            { text: song.title, size: 64, weight: 800 },
            { text: song.artist, size: 42, weight: 600 },
          ])
        : drawDisplay(ctx, '#495057', [
            { text: 'JUKEBOX', size: 74, weight: 800 },
            { text: 'press E to play', size: 44, weight: 600 },
          ]),
    [view.on, song],
  );

  const picker = useInteractable<THREE.Group>({ id: 'jukebox:next', label: view.on ? `Next song · now playing ${song.title}` : 'Play the jukebox', action: { kind: 'jukebox', op: 'next' } }, 3);
  const power = useInteractable<THREE.Group>({ id: 'jukebox:power', label: view.on ? 'Stop the music' : 'Play music', action: { kind: 'jukebox', op: 'toggle' } }, 3);

  useFrame(() => {
    const t = nowPlaying();
    const sec = musicTime();
    const playing = t !== null && sec !== null;
    const beat = playing ? beatAt(t, sec) : 0;
    const p = playing ? beatPulse(beat) : 0;
    if (dance.current) dance.current.scale.set(1 - 0.015 * p, 1 + 0.035 * p, 1 - 0.015 * p);
    if (dome.current) dome.current.scale.setScalar(1 + 0.4 * p);
    if (record.current && playing) record.current.rotation.z = -Math.max(0, sec) * 3.5;
    neonArch.color.setHSL((base + beat / 16) % 1, playing ? 0.9 : 0.15, playing ? 0.55 + 0.12 * p : 0.32);
    neonSides.color.setHSL((base + 0.5 + beat / 16) % 1, playing ? 0.9 : 0.15, playing ? 0.55 + 0.12 * p : 0.32);
    for (let i = 0; i < NOTES.length; i++) {
      const s = notes.current[i];
      if (!s) continue;
      const k = playing ? noteAge(beat, i, NOTES.length, NOTE_LIFE) : -1;
      s.visible = k >= 0;
      if (k < 0) continue;
      const side = i % 2 === 0 ? -1 : 1;
      s.position.set(side * (0.22 + k * 0.15) + Math.sin(k * 7 + i) * 0.06, ARCH_Y + 0.5 + k * 0.85, 0.05);
      s.scale.setScalar(0.13 + k * 0.07);
      noteMats[i].opacity = 1 - k * k;
      noteMats[i].color.setHSL((base + i * 0.13) % 1, 0.85, 0.65);
    }
  });

  return (
    <group position={[x, 0, HALF_D - D / 2]} rotation={ROT_FRONT}>
      {/* plinth */}
      <Box size={[W, 0.1, D - 0.04]} position={[0, 0.05, 0]} color="#3d2c2e" outline />
      <group ref={dance}>
        <Box size={[W - 0.08, 0.9, D - 0.1]} position={[0, 0.55, 0]} color={BODY} outline />
        {/* the arched top */}
        <mesh position={[0, ARCH_Y, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow material={toon(BODY)}>
          <cylinderGeometry args={[0.46, 0.46, D - 0.1, 24, 1, false, Math.PI / 2, Math.PI]} />
          <Outlines thickness={0.018} color={INK} />
        </mesh>
        <Ball r={0.06} position={[0, ARCH_Y + 0.5, 0]} color={TRIM} outline shadow={false} />
        {/* the lit window in the arch, and the record spinning behind it */}
        <mesh position={[0, ARCH_Y, D / 2 - 0.045]} material={glow('#fff3b0')}>
          <circleGeometry args={[0.36, 24, 0, Math.PI]} />
        </mesh>
        <group ref={record} position={[0, ARCH_Y + 0.15, D / 2 - 0.04]}>
          <mesh material={toon('#1f1d2b')}>
            <circleGeometry args={[0.15, 24]} />
          </mesh>
          <mesh position={[0, 0, 0.002]} material={toon(song.color)}>
            <circleGeometry args={[0.055, 16]} />
          </mesh>
          <mesh position={[0.028, 0.016, 0.003]} material={toon('#fffdf5')}>
            <circleGeometry args={[0.014, 8]} />
          </mesh>
        </group>
        {/* neon: a tube round the arch and one up each side */}
        <mesh position={[0, ARCH_Y, D / 2 - 0.03]} material={neonArch}>
          <torusGeometry args={[0.41, 0.035, 8, 32, Math.PI]} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * (W / 2 - 0.08), 0.55, D / 2 - 0.03]} material={neonSides}>
            <boxGeometry args={[0.06, 0.82, 0.04]} />
          </mesh>
        ))}
        {/* now playing */}
        <DisplayPanel draw={display} deps={[view.on, song.id]} />
        {/* the song picker: a row of buttons, E for the next song */}
        <group ref={picker} position={[-0.07, 0.66, D / 2 - 0.03]}>
          <Box size={[0.56, 0.1, 0.06]} color={TRIM} outline shadow={false} />
          {['#ef476f', '#ffd166', '#06d6a0', '#118ab2'].map((c, i) => (
            <Box key={c} size={[0.09, 0.05, 0.03]} position={[-0.195 + i * 0.13, 0, 0.04]} color={c} shadow={false} />
          ))}
          <mesh visible={false} position={[0.02, 0.2, 0.03]}>
            <boxGeometry args={[0.6, 0.56, 0.1]} />
          </mesh>
        </group>
        {/* the power button */}
        <group ref={power} position={[0.32, 0.66, D / 2 - 0.02]}>
          <Cyl r={0.05} h={0.05} rotation={[Math.PI / 2, 0, 0]} color={view.on ? '#e63946' : '#6c757d'} outline shadow={false} />
          <mesh visible={false}>
            <boxGeometry args={[0.14, 0.14, 0.12]} />
          </mesh>
        </group>
        {/* the speaker, thumping on the beat */}
        <mesh position={[0, 0.36, D / 2 - 0.045]} material={toon('#2b2d42')}>
          <circleGeometry args={[0.22, 24]} />
        </mesh>
        <mesh position={[0, 0.36, D / 2 - 0.04]} material={toon('#495057')}>
          <ringGeometry args={[0.12, 0.17, 24]} />
        </mesh>
        <mesh ref={dome} position={[0, 0.36, D / 2 - 0.04]} material={toon('#adb5bd')}>
          <sphereGeometry args={[0.07, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
        {NOTES.map((i) => (
          <sprite key={i} ref={(s) => void (notes.current[i] = s)} material={noteMats[i]} visible={false} />
        ))}
      </group>
    </group>
  );
}

const DISPLAY = { w: 0.6, h: 0.26, px: 512 };
const DISPLAY_PX_H = Math.round((DISPLAY.px * DISPLAY.h) / DISPLAY.w);

/** The now-playing card: centred lines, each shrunk until it fits the width. */
function drawDisplay(ctx: CanvasRenderingContext2D, bg: string, lines: { text: string; size: number; weight: number }[]) {
  const w = DISPLAY.px;
  const h = DISPLAY_PX_H;
  roundRect(ctx, 0, 0, w, h, 22);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  const total = lines.reduce((sum, l) => sum + l.size * 1.15, 0);
  let y = (h - total) / 2;
  for (const l of lines) {
    let size = l.size;
    ctx.font = `${l.weight} ${size}px ${SANS}`;
    while (size > 20 && ctx.measureText(l.text).width > w - 44) {
      size -= 2;
      ctx.font = `${l.weight} ${size}px ${SANS}`;
    }
    ctx.fillText(l.text, w / 2, y + (l.size * 1.15) / 2);
    y += l.size * 1.15;
  }
}

function DisplayPanel({ draw, deps }: { draw: (ctx: CanvasRenderingContext2D) => void; deps: unknown[] }) {
  const tex = useCanvasTexture(DISPLAY.px, DISPLAY_PX_H, draw, deps);
  return (
    <mesh position={[0, 0.87, D / 2 - 0.045]}>
      <planeGeometry args={[DISPLAY.w, DISPLAY.h]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} />
    </mesh>
  );
}
