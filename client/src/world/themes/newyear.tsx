import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SANS } from '../draw';
import { useCanvasTexture } from '../interact';
import { APP_SCREEN, HALF_D } from '../layout';
import { toon } from '../materials';
import { triggerEvent } from '../events/eventsState';
import { say } from '../people';
import { agentsOnRepo, useStore } from '../../store';
import { CEO_ID } from '../../../../shared/types';
import { addProbe, themeNow, useThemeRuntime } from './active';
import { Burst, burstAt } from './kit/Burst';
import { useCostumes } from './kit/costumes';
import { free, sendHome, sendTo, windowPlaces, type Person } from './kit/crowd';
import { box, cyl, mergeParts, paintedToon, paintedToonDouble, part, sphere } from './kit/geo';
import { Decor, type ItemRenderers, type Spot } from './kit/Placed';
import { Bunting, StringLights } from './kit/runs';
import { chime, pop } from './kit/sfx';
import { Tint } from './kit/Tint';
import { countdownNumber, newYearState, timeToGo, type NewYearState } from './newyearClock';
import type { ThemeProps } from './ThemeLayer';
import { THEMES } from './themes';

// New Year's Eve (31 Dec–1 Jan): party hats, streamers and gold bunting, champagne at reception, a countdown to
// midnight in the lobby; in the last ten seconds the app monitors count down too, and at local midnight fireworks go
// up over the city (the world events' fireworks, events/) while everyone free on the floor heads to the windows on that
// side to cheer.

const DEF = THEMES.newyear;
const STREAMERS = ['#ffd23f', '#c77dff', '#4cc9f0', '#ff5d8f', '#f8f9fa'];

/** Curly ribbons hanging from the ceiling over the walkways (well above anyone's head). */
function Streamers({ kind }: { kind: 'office' | 'lobby' }) {
  const geo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const xs = kind === 'office' ? [-7, 0, 7] : [-3, 3, 9];
    const zs = kind === 'office' ? [-8.6, -4, 0.6, 5.5, 9] : [-1, 3, 7];
    let k = 0;
    for (const x of xs) {
      for (const z of zs) {
        for (let r = 0; r < 3; r++) {
          const pts = Array.from({ length: 14 }, (_, i) => new THREE.Vector3(x + r * 0.25 + Math.sin(i * 1.3 + r) * 0.08, 3.58 - i * 0.07, z + Math.cos(i * 1.3 + r) * 0.08));
          parts.push(part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, 0.018, 4), STREAMERS[k++ % STREAMERS.length]));
        }
      }
    }
    return mergeParts(parts);
  }, [kind]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={paintedToon()} />;
}

function Champagne({ at }: { at: Spot[] }) {
  const geo = useMemo(
    () =>
      mergeParts([
        part(cyl(0.05, 0.05, 0.22, 12), '#1b4332', [0, 0.11, 0]),
        part(cyl(0.018, 0.05, 0.1, 12), '#1b4332', [0, 0.27, 0]),
        part(cyl(0.022, 0.022, 0.06, 10), '#ffd23f', [0, 0.33, 0]),
        part(box(0.07, 0.06, 0.005), '#f8f9fa', [0, 0.12, 0.05]),
        ...[-0.14, 0.13].flatMap((x) => [
          part(cyl(0.035, 0.012, 0.09, 10, true), '#e0f2ff', [x, 0.16, 0.04]),
          part(cyl(0.004, 0.004, 0.08, 4), '#e0f2ff', [x, 0.075, 0.04]),
          part(cyl(0.03, 0.03, 0.006, 10), '#e0f2ff', [x, 0.004, 0.04]),
          part(cyl(0.03, 0.012, 0.05, 10), '#ffd166', [x, 0.165, 0.04]),
        ]),
      ]),
    [],
  );
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <>
      {at.map((s) => (
        <mesh key={s.id} geometry={geo} material={paintedToonDouble()} position={[s.x, s.y, s.z]} rotation={[0, s.rotY, 0]} castShadow />
      ))}
    </>
  );
}

const ITEMS: ItemRenderers = { champagne: Champagne };

/** The countdown as words: "2027 in 3:12:05", the big number, or the greeting. */
function drawCountdown(ctx: CanvasRenderingContext2D, w: number, h: number, s: NewYearState, big: boolean) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#14143a');
  g.addColorStop(1, '#3a1458');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 26);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (s.phase === 'countdown') {
    ctx.fillStyle = '#ffd23f';
    ctx.font = `700 ${Math.round(h * 0.78)}px ${SANS}`;
    ctx.fillText(String(countdownNumber(s)), w / 2, h * 0.54);
    return;
  }
  if (s.phase === 'show' || s.phase === 'newyear') {
    ctx.fillStyle = '#ffd23f';
    ctx.font = `700 ${Math.round(h * (big ? 0.24 : 0.15))}px ${SANS}`;
    ctx.fillText('🎆 HAPPY NEW YEAR', w / 2, h * 0.36);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(h * 0.3)}px ${SANS}`;
    ctx.fillText(String(s.year), w / 2, h * 0.72);
    return;
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${Math.round(h * 0.2)}px ${SANS}`;
  ctx.fillText(`🥂 Countdown to ${s.year}`, w / 2, h * 0.3);
  ctx.fillStyle = '#ffd23f';
  ctx.font = `700 ${Math.round(h * 0.36)}px ${SANS}`;
  ctx.fillText(timeToGo(s.seconds), w / 2, h * 0.68);
}

/** A board hung over the lobby, in view from the elevator. */
function LobbyBoard({ s }: { s: NewYearState }) {
  const key = s.phase === 'waiting' ? timeToGo(s.seconds) : s.phase === 'countdown' ? countdownNumber(s) : s.phase;
  const tex = useCanvasTexture(1024, 400, (ctx) => drawCountdown(ctx, 1024, 400, s, true), [key, s.year]);
  return (
    <group position={[3, 2.75, 0.5]}>
      <mesh position={[0, 0, -0.03]} material={toon('#2b2d42')}>
        <boxGeometry args={[3.3, 1.35, 0.05]} />
      </mesh>
      <mesh position={[0, 0, 0.001]}>
        <planeGeometry args={[3.2, 1.25]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      {[-1.3, 1.3].map((x) => (
        <mesh key={x} position={[x, 0.75, -0.03]} material={toon('#495057')}>
          <cylinderGeometry args={[0.01, 0.01, 0.2, 4]} />
        </mesh>
      ))}
    </group>
  );
}

/** Over the floor's app monitor for the last seconds and the show (the app is back after that). */
function MonitorCountdown({ s }: { s: NewYearState }) {
  const key = s.phase === 'countdown' ? countdownNumber(s) : s.phase;
  const tex = useCanvasTexture(640, 360, (ctx) => drawCountdown(ctx, 640, 360, s, false), [key, s.year]);
  const a = APP_SCREEN;
  return (
    <mesh position={[a.x, a.y, -HALF_D + a.depth + 0.006]}>
      <planeGeometry args={[a.w, a.h]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  );
}

/** Who's on the floor: its developers and testers, or the CEO in the lobby. */
function usePeople(kind: ThemeProps['kind'], repoId: string | null): Person[] {
  const agents = useStore((s) => s.agents);
  return useMemo(() => {
    if (kind === 'lobby') return agents[CEO_ID] ? [{ id: CEO_ID, role: 'ceo', desk: 0 }] : [];
    return kind === 'office' && repoId ? agentsOnRepo(agents, repoId).map((a) => ({ id: a.id, role: a.role, desk: a.desk })) : [];
  }, [agents, kind, repoId]);
}

export default function NewYear({ kind, repoId }: ThemeProps) {
  useCostumes();
  const [s, setS] = useState(() => newYearState(themeNow()));
  const people = usePeople(kind, repoId);
  const peopleRef = useRef(people);
  peopleRef.current = people;
  const crowd = useRef<Person[]>([]);

  /** Midnight: a cheer, confetti, the fireworks event, and whoever's free off to the windows on its side to cheer. */
  const celebrate = useCallback(() => {
    chime(undefined, true);
    pop();
    const run = triggerEvent('fireworks');
    if (kind === 'roof') return run.seconds;
    burstAt(kind === 'lobby' ? 3 : 0, 2.2, kind === 'lobby' ? 0.5 : -8, DEF.confetti!.colors);
    const all = windowPlaces(kind);
    const near = all.filter((p) => Math.sign(p.x) === (run.side === 'west' ? -1 : 1));
    const places = near.length >= 3 ? near : all;
    const going = peopleRef.current.filter((p) => free(p.id)).slice(0, places.length);
    crowd.current = going;
    going.forEach((p, i) => sendTo(kind, p, places[i], places[i].heading, 'cheer', () => say(p.id, '🎉')));
    setTimeout(() => {
      for (const p of crowd.current) {
        say(p.id, null);
        sendHome(kind, p);
      }
      crowd.current = [];
    }, run.seconds * 1000);
    return run.seconds;
  }, [kind]);

  useEffect(
    () => () => {
      if (kind !== 'roof') for (const p of crowd.current) sendHome(kind, p);
    },
    [kind],
  );

  useEffect(() => {
    let prev = newYearState(themeNow()).phase;
    const t = setInterval(() => {
      const next = newYearState(themeNow());
      setS(next);
      if (prev === 'countdown' && next.phase === 'show') celebrate();
      prev = next.phase;
    }, 250);
    return () => clearInterval(t);
  }, [celebrate]);

  useEffect(() => {
    useThemeRuntime.setState({ status: s.phase === 'waiting' ? `🥂 ${s.year} in ${timeToGo(s.seconds)}` : s.phase === 'countdown' ? `🥂 ${countdownNumber(s)}…` : `🎆 Happy New Year ${s.year}!` });
  }, [s]);
  useEffect(() => () => useThemeRuntime.setState({ status: null }), []);

  useEffect(
    () =>
      addProbe({
        countdown: () => newYearState(themeNow()),
        fireworks: () => celebrate(),
        crowd: () => crowd.current.map((p) => p.id),
      }),
    [celebrate],
  );

  if (kind === 'roof') return <Tint def={DEF} />;
  return (
    <group>
      <Decor id="newyear" kind={kind} items={ITEMS} />
      <StringLights kind={kind} colors={DEF.lights!} />
      <Bunting kind={kind} colors={DEF.bunting!} />
      <Streamers kind={kind} />
      <Tint def={DEF} />
      <Burst />
      {kind === 'lobby' && <LobbyBoard s={s} />}
      {kind === 'office' && (s.phase === 'countdown' || s.phase === 'show') && <MonitorCountdown s={s} />}
      {/* a glitter ball over the middle of the room */}
      <DiscoBall x={kind === 'lobby' ? 3 : 0} z={kind === 'lobby' ? 4 : 2} />
    </group>
  );
}

function DiscoBall({ x, z }: { x: number; z: number }) {
  const ref = useRef<THREE.Mesh>(null);
  // faceted: the parts are unindexed, so face normals light every mirror tile on its own
  const geo = useMemo(() => {
    const g = mergeParts([part(sphere(0.25, 12, 8), '#dee2e6', [0, 0, 0]), part(cyl(0.006, 0.006, 0.3, 4), '#495057', [0, 0.4, 0])]);
    g.computeVertexNormals();
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.6;
  });
  return <mesh ref={ref} geometry={geo} material={paintedToon()} position={[x, 3.15, z]} />;
}
