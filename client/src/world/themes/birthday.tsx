import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useStore, type Agent } from '../../store';
import { CEO_ID } from '../../../../shared/types';
import { holdMusicDuck } from '../../ui/music';
import { tone, type Vec3 } from '../../ui/sfx';
import { SANS } from '../draw';
import { useCanvasTexture } from '../interact';
import { decorSlots, HALF_D } from '../layout';
import { placeBody, say, seatBody, setBody } from '../people';
import { midiHz } from '../jukeboxSongs';
import { addProbe, useTheme, useThemeRuntime } from './active';
import { Burst, burstAt } from './kit/Burst';
import { useCostumes } from './kit/costumes';
import { free, sendHome, sendTo } from './kit/crowd';
import { box, cyl, mergeParts, paintedGlow, paintedToon, part, sphere } from './kit/geo';
import { Hotspot, useThemeActions } from './kit/Hotspot';
import { Decor, Placed, type ItemRenderers, type Spot } from './kit/Placed';
import { Bunting, StringLights } from './kit/runs';
import { blow, pop } from './kit/sfx';
import { daily } from './kit/store';
import { stopWalk, walkAlong } from './kit/walker';
import { Tint } from './kit/Tint';
import type { ThemeProps } from './ThemeLayer';
import { THEMES } from './themes';

// The manager's birthday (Settings → Themes): balloons, bunting and a "Happy birthday" banner in the lobby, a cake with
// candles on the manager's desk (E blows them out), party hats all round, and the first time you come into the lobby
// that day the team comes down in the elevator, gathers round and sings Happy Birthday (the public-domain tune,
// synthesized), then cheers, throws confetti and goes back up to work. The CEO's phone greeting comes from the server.

const DEF = THEMES.birthday;
const SUNG_KEY = 'cubefarm:birthday-sung';
const CAKE_KEY = 'cubefarm:cake';

function useName() {
  const manager = useStore((s) => s.settings.managerName);
  const user = useStore((s) => s.user);
  return manager || user || '';
}

// ---------- the lobby's dressing ----------

const BALLOON_COLORS = ['#ff5d8f', '#ffd23f', '#3a86ff', '#06d6a0', '#9b5de5'];

/** Three balloons on strings, tied to a little weight. */
function balloonBunch() {
  const tops: [number, number, number][] = [
    [-0.13, 1.25, 0.02],
    [0.12, 1.38, -0.04],
    [0.0, 1.55, 0.07],
  ];
  return mergeParts([
    part(box(0.08, 0.06, 0.08), '#495057', [0, 0.03, 0]),
    ...tops.flatMap(([x, y, z], i) => [
      part(sphere(0.15, 14, 10), BALLOON_COLORS[i % BALLOON_COLORS.length], [x, y, z], [0, 0, 0], [1, 1.2, 1]),
      part(cyl(0.004, 0.004, y - 0.2, 4), '#adb5bd', [x / 2, (y - 0.12) / 2, z / 2], [z * 1.2, 0, -x * 1.2]),
    ]),
  ]);
}

function Balloons({ at }: { at: Spot[] }) {
  const geo = useMemo(balloonBunch, []);
  return <Placed geometry={geo} at={at} scale={(s) => (s.id.startsWith('desk') ? 0.75 : 1.1)} />;
}

/** "HAPPY BIRTHDAY" on a string of pennants, and the manager's name under it. */
function Banner({ at }: { at: Spot[] }) {
  const name = useName();
  const tex = useCanvasTexture(
    2048,
    420,
    (ctx) => {
      const letters = 'HAPPY BIRTHDAY'.split('');
      const w = 2048 / letters.length;
      ctx.strokeStyle = '#495057';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(0, 20);
      ctx.quadraticCurveTo(1024, 90, 2048, 20);
      ctx.stroke();
      letters.forEach((ch, i) => {
        if (ch === ' ') return;
        const x = i * w + w / 2;
        const y = 20 + 70 * (1 - ((x - 1024) / 1024) ** 2);
        ctx.fillStyle = BALLOON_COLORS[i % BALLOON_COLORS.length];
        ctx.beginPath();
        ctx.moveTo(x - w * 0.45, y);
        ctx.lineTo(x + w * 0.45, y);
        ctx.lineTo(x, y + w * 1.25);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 ${Math.round(w * 0.62)}px ${SANS}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ch, x, y + w * 0.42);
      });
      if (name) {
        const text = `🎂 ${name}! 🎉`;
        ctx.font = `700 60px ${SANS}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(text).width + 60;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.roundRect(1024 - tw / 2, 262, tw, 84, 42);
        ctx.fill();
        ctx.fillStyle = '#ff5d8f';
        ctx.fillText(text, 1024, 306);
      }
    },
    [name],
  );
  return (
    <>
      {at.map((s) => (
        <mesh key={s.id} position={[s.x, s.y - 0.5, s.z]} rotation={[0, s.rotY, 0]}>
          <planeGeometry args={[9, 1.85]} />
          <meshBasicMaterial map={tex} transparent side={THREE.DoubleSide} toneMapped={false} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

const CANDLES = [-0.09, -0.045, 0, 0.045, 0.09];

/** The cake on the manager's desk: E blows the candles out (and lights them again). */
function Cake({ at }: { at: Spot[] }) {
  const day = useTheme((s) => s.day);
  const blown = useCake(day);
  const cake = useMemo(
    () =>
      mergeParts([
        part(cyl(0.2, 0.2, 0.02, 20), '#e9ecef', [0, 0.01, 0]),
        part(cyl(0.17, 0.17, 0.12, 20), '#ffc8dd', [0, 0.08, 0]),
        part(cyl(0.12, 0.12, 0.1, 20), '#fff0f3', [0, 0.19, 0]),
        ...Array.from({ length: 10 }, (_, i) => part(sphere(0.022, 6, 5), '#ff5d8f', [Math.cos(i * 0.63) * 0.17, 0.14, Math.sin(i * 0.63) * 0.17])),
        ...CANDLES.map((x, i) => part(cyl(0.008, 0.008, 0.08, 6), BALLOON_COLORS[i], [x, 0.28, (i % 2) * 0.03 - 0.015])),
      ]),
    [],
  );
  const flames = useMemo(() => mergeParts(CANDLES.map((x, i) => part(sphere(0.013, 6, 5), '#ffb703', [x, 0.335, (i % 2) * 0.03 - 0.015], [0, 0, 0], [1, 1.7, 1]))), []);
  useEffect(() => () => [cake, flames].forEach((g) => g.dispose()), [cake, flames]);
  return (
    <>
      {at.map((s) => (
        <Hotspot key={s.id} id="cake" label={blown ? 'Light the candles again 🕯️' : 'Blow out the candles 🎂'} range={2.4} position={[s.x, s.y, s.z]} rotationY={s.rotY}>
          <mesh geometry={cake} material={paintedToon()} castShadow />
          {!blown && <mesh geometry={flames} material={paintedGlow()} />}
        </Hotspot>
      ))}
    </>
  );
}

const cakeListeners = new Set<() => void>();
function useCake(day: string) {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    cakeListeners.add(fn);
    return () => void cakeListeners.delete(fn);
  }, []);
  return daily<string>(CAKE_KEY, day).includes('blown');
}

const ITEMS: ItemRenderers = { banner: Banner, balloons: Balloons, cake: Cake };

// ---------- the song ----------

// Happy Birthday (public domain) in G, 3/4: [midi note, beats].
const TUNE: [number, number][] = [
  [62, 0.75], [62, 0.25], [64, 1], [62, 1], [67, 1], [66, 2],
  [62, 0.75], [62, 0.25], [64, 1], [62, 1], [69, 1], [67, 2],
  [62, 0.75], [62, 0.25], [74, 1], [71, 1], [67, 1], [66, 1], [64, 2],
  [72, 0.75], [72, 0.25], [71, 1], [67, 1], [69, 1], [67, 3],
];
const BEAT = 0.52;
/** How long the song lasts, in seconds. */
export const SONG_S = TUNE.reduce((n, [, b]) => n + b, 0) * BEAT;

/** The team singing: a choir of soft voices on the tune, from where they stand, under a gentle chord on each bar. */
function sing(pos: Vec3) {
  const release = holdMusicDuck();
  let at = 0.1;
  for (const [midi, beats] of TUNE) {
    const f = midiHz(midi);
    const dur = beats * BEAT * 0.95;
    const o = { name: 'birthday:song', group: 'music', pos, at } as const;
    tone({ ...o, freq: f, type: 'triangle', dur, peak: 0.11, attack: 0.03 });
    tone({ ...o, freq: f * 1.005, type: 'sine', dur, peak: 0.05, attack: 0.05 });
    tone({ ...o, freq: f / 2, type: 'sine', dur, peak: 0.035, attack: 0.05 });
    at += beats * BEAT;
  }
  setTimeout(release, (at + 0.5) * 1000);
}

// ---------- the party ----------

/** Where the guests stand: an arc in front of the elevator, facing whoever just came out of it. */
function arc(n: number) {
  const c = { x: 0, z: HALF_D - 1.8 };
  return Array.from({ length: n }, (_, i) => {
    const a = n === 1 ? 0 : (i / (n - 1) - 0.5) * 1.7;
    const x = c.x + Math.sin(a) * 3.8;
    const z = c.z - Math.cos(a) * 3.8;
    return { x, z, heading: Math.atan2(-(c.x - x), -(c.z - z)) };
  });
}

/** Someone from upstairs, come down for the party: their own look, off the clock. */
const guestOf = (a: Agent): Agent => ({ ...a, id: `party-${a.id}`, status: 'idle', currentTool: null, task: null });

type Stage = 'off' | 'arriving' | 'singing' | 'cheering' | 'leaving';

export default function Birthday({ kind, office: { Character } }: ThemeProps) {
  useCostumes();
  const day = useTheme((s) => s.day);
  const name = useName();
  const agents = useStore((s) => s.agents);
  const [guests, setGuests] = useState<Agent[]>([]);
  const [stage, setStage] = useState<Stage>('off');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const ceoJoined = useRef(false);
  const later = (fn: () => void, s: number) => timers.current.push(setTimeout(fn, s * 1000));

  const party = useCallback(() => {
    if (kind !== 'lobby' || stage !== 'off') return false;
    daily(SUNG_KEY, day, ['sung']);
    const list = Object.values(agents)
      .filter((a) => a.id !== CEO_ID)
      .sort((a, b) => a.repoId.localeCompare(b.repoId) || a.desk - b.desk)
      .slice(0, 8)
      .map(guestOf);
    setGuests([]);
    setStage('arriving');
    const places = arc(list.length + 1);
    // they step out of the elevator a moment apart and take their places (the middle one is the CEO's)
    list.forEach((g, i) => {
      const p = places[i < list.length / 2 ? i : i + 1];
      later(() => {
        // standing in the cabin before they're first drawn, so nobody flashes up seated
        placeBody(g.id, ((i % 3) - 1) * 0.7, HALF_D + 1.1 + Math.floor(i / 3) * 0.6, 0);
        walkAlong(g.id, [{ x: ((i % 3) - 1) * 0.5, z: HALF_D - 0.8 }, p], p.heading);
        setGuests((l) => [...l, g]);
      }, 0.3 + i * 0.6);
    });
    const ceo = agents[CEO_ID];
    ceoJoined.current = !!ceo && free(CEO_ID);
    const mid = places[Math.floor(list.length / 2)];
    if (ceo && ceoJoined.current) sendTo('lobby', { id: CEO_ID, role: 'ceo', desk: 0 }, mid, mid.heading, 'none');
    const start = 0.3 + list.length * 0.6 + 6;
    later(() => {
      setStage('singing');
      for (const g of list) setBody(g.id, { gesture: 'talk' });
      for (const g of list) say(g.id, '🎵');
      sing({ x: 0, y: 1.6, z: HALF_D - 5 });
    }, start);
    later(() => {
      setStage('cheering');
      for (const g of list) {
        setBody(g.id, { gesture: 'cheer' });
        say(g.id, '🎉');
      }
      burstAt(0, 2.2, HALF_D - 5, DEF.confetti!.colors);
      pop();
      later(pop, 0.25);
      useStore.getState().pushToast('success', `🎂 Happy birthday${name ? `, ${name}` : ''}, from the whole team!`);
    }, start + SONG_S + 0.4);
    later(() => {
      setStage('leaving');
      list.forEach((g, i) => {
        say(g.id, null);
        walkAlong(g.id, [{ x: ((i % 3) - 1) * 0.5, z: HALF_D - 0.6 }, { x: ((i % 3) - 1) * 0.6, z: HALF_D + 1.4 }], Math.PI);
      });
      if (ceoJoined.current) sendHome('lobby', { id: CEO_ID, role: 'ceo', desk: 0 });
    }, start + SONG_S + 6);
    later(() => {
      list.forEach((g) => {
        stopWalk(g.id);
        seatBody(g.id);
      });
      setGuests([]);
      setStage('off');
    }, start + SONG_S + 16);
    return true;
  }, [agents, day, kind, name, stage]);

  // The first time you come into the lobby today.
  useEffect(() => {
    if (kind !== 'lobby' || daily<string>(SUNG_KEY, day).length) return;
    const t = setTimeout(() => party(), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, day]);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      if (ceoJoined.current) sendHome('lobby', { id: CEO_ID, role: 'ceo', desk: 0 });
    },
    [],
  );

  const cakeAt = useMemo(() => decorSlots('lobby').find((s) => s.id === 'manager-desk')!, []);
  const act = useCallback(
    (id: string) => {
      if (id !== 'cake') return;
      const wasBlown = daily<string>(CAKE_KEY, day).includes('blown');
      daily(CAKE_KEY, day, wasBlown ? [] : ['blown']);
      cakeListeners.forEach((fn) => fn());
      const at = { x: cakeAt.x, y: cakeAt.y + 0.3, z: cakeAt.z };
      if (wasBlown) {
        tone({ name: 'birthday:light', group: 'toys', pos: at, freq: 1200, to: 1600, type: 'triangle', dur: 0.15, peak: 0.05 });
        useStore.getState().pushToast('info', '🕯️ The candles are lit again.');
        return;
      }
      blow(at);
      burstAt(at.x, at.y + 0.2, at.z, DEF.confetti!.colors);
      useStore.getState().pushToast('success', `🎂 Make a wish${name ? `, ${name}` : ''}!`);
    },
    [cakeAt, day, name],
  );
  useThemeActions(act);

  useEffect(() => {
    useThemeRuntime.setState({ status: `🎂 Happy birthday${name ? `, ${name}` : ''}!` });
    return () => useThemeRuntime.setState({ status: null });
  }, [name]);
  useEffect(
    () =>
      addProbe({
        sing: () => party(),
        party: () => ({ stage, guests: guests.map((g) => g.id) }),
        cake: () => act('cake'),
      }),
    [party, stage, guests, act],
  );

  if (kind === 'roof') return <Tint def={DEF} />;
  return (
    <group>
      <Decor id="birthday" kind={kind} items={ITEMS} />
      <StringLights kind={kind} colors={DEF.lights!} />
      <Bunting kind={kind} colors={DEF.bunting!} />
      <Tint def={DEF} />
      {kind === 'lobby' && <Burst />}
      {guests.map((g) => (
        <Character key={g.id} agent={g} />
      ))}
    </group>
  );
}
