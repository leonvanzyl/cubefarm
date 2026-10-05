import { useCallback, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useStore } from '../../store';
import { addProbe, useTheme, useThemeRuntime } from './active';
import { Burst, burstAt } from './kit/Burst';
import { useCostumes } from './kit/costumes';
import { cyl, mergeParts, paintedGlow, paintedToon, paintedToonDouble, part, sphere, torus } from './kit/geo';
import { Hotspot, useThemeActions } from './kit/Hotspot';
import { Decor, type ItemRenderers, type Spot } from './kit/Placed';
import { Bunting } from './kit/runs';
import { chime } from './kit/sfx';
import { daily } from './kit/store';
import { Tint } from './kit/Tint';
import { EGG_COUNT, eggsFor, type Egg } from './eggs';
import type { ThemeProps } from './ThemeLayer';
import { THEMES } from './themes';

// Easter (Good Friday to Easter Monday): pastel bunting, baskets of eggs, bunny ears, and an egg hunt: 12 painted eggs
// hidden across the lobby and the office floors (eggs.ts: a fresh seeded set every day). E picks one up with a chime;
// the phone keeps count, and finding all 12 puts the golden-egg trophy on the lobby's trophy cabinet. What you found
// today is remembered in this browser, so a reload keeps it.

const DEF = THEMES.easter;
const HIT = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const FOUND_KEY = 'cubefarm:eggs';

const eggGeometry = (color: string, band: string) =>
  mergeParts([
    part(sphere(0.07, 14, 10), color, [0, 0.095, 0], [0, 0, 0], [1, 1.35, 1]),
    part(torus(0.071, 0.012, 6, 18), band, [0, 0.09, 0], [Math.PI / 2, 0, 0], [1, 1, 1]),
    part(torus(0.058, 0.009, 6, 16), '#ffffff', [0, 0.135, 0], [Math.PI / 2, 0, 0]),
  ]);

function EggBaskets({ at }: { at: Spot[] }) {
  const geo = useMemo(() => {
    const eggs = [-0.08, 0, 0.08, -0.04, 0.05].map((x, i) => part(sphere(0.05, 10, 8), ['#ffafcc', '#a0c4ff', '#caffbf', '#fdffb6', '#ffc6ff'][i], [x, 0.17 + (i > 2 ? 0.04 : 0), (i % 2 ? 0.04 : -0.03)], [0.3 * i, 0, 0.2], [1, 1.3, 1]));
    return mergeParts([
      part(cyl(0.18, 0.13, 0.16, 16, true), '#c68b59', [0, 0.08, 0]),
      part(cyl(0.13, 0.13, 0.01, 16), '#a26b3c', [0, 0.005, 0]),
      part(torus(0.18, 0.012, 5, 20, Math.PI), '#a26b3c', [0, 0.16, 0], [0, Math.PI / 2, 0]),
      part(sphere(0.15, 12, 6), '#95d5b2', [0, 0.13, 0], [0, 0, 0], [1, 0.35, 1]),
      ...eggs,
    ]);
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <>
      {at.map((s) => (
        <mesh key={s.id} geometry={geo} material={paintedToonDouble()} position={[s.x, s.y, s.z]} scale={s.y > 0 ? 1 : 1.6} castShadow />
      ))}
    </>
  );
}

/** The trophy for finding all 12, on the trophy cabinet: only once it's won. */
function GoldenEgg({ at }: { at: Spot[] }) {
  const day = useTheme((s) => s.day);
  const done = useFound(day).length >= EGG_COUNT;
  const geo = useMemo(
    () =>
      mergeParts([
        part(sphere(0.22, 18, 12), '#ffd23f', [0, 0.5, 0], [0, 0, 0], [1, 1.35, 1]),
        part(torus(0.222, 0.02, 6, 24), '#fff3b0', [0, 0.5, 0], [Math.PI / 2, 0, 0]),
        part(cyl(0.12, 0.18, 0.12, 14), '#b08968', [0, 0.06, 0]),
        part(cyl(0.06, 0.06, 0.12, 10), '#ffd23f', [0, 0.18, 0]),
      ]),
    [],
  );
  useEffect(() => () => geo.dispose(), [geo]);
  if (!done) return null;
  return (
    <>
      {at.map((s) => (
        <group key={s.id} position={[s.x, s.y, s.z]}>
          <mesh geometry={geo} material={paintedGlow()} />
        </group>
      ))}
    </>
  );
}

const ITEMS: ItemRenderers = { eggBasket: EggBaskets, goldenEgg: GoldenEgg };

// ---------- the hunt ----------

const foundListeners = new Set<() => void>();
function useFound(day: string) {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    foundListeners.add(fn);
    return () => void foundListeners.delete(fn);
  }, []);
  return daily<string>(FOUND_KEY, day);
}

/** The building's floors, for today's eggs: the lobby and every office floor. */
function useFloors() {
  const repos = useStore((s) => s.repos);
  return useMemo(() => repos.map((r) => r.floor).sort((a, b) => a - b), [repos]);
}

function EggMesh({ egg }: { egg: Egg }) {
  const geo = useMemo(() => eggGeometry(egg.color, egg.band), [egg]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <Hotspot id={`egg:${egg.id}`} label="Pick up the egg 🥚" range={2.4} position={[egg.x, 0, egg.z]} rotationY={(egg.x * 7 + egg.z) % Math.PI}>
      <mesh geometry={geo} material={paintedToon()} rotation={[0, 0, 0.35]} castShadow />
      {/* a bigger, unseen target than the egg itself, so it's easy to aim at */}
      <mesh position={[0, 0.12, 0]} material={HIT}>
        <sphereGeometry args={[0.24, 8, 6]} />
      </mesh>
    </Hotspot>
  );
}

function statusOf(found: number) {
  return found >= EGG_COUNT ? '🏆 All 12 eggs found: the golden egg is yours!' : `🥚 Egg hunt: ${found} / ${EGG_COUNT} found`;
}

export default function Easter({ kind, floor }: ThemeProps) {
  useCostumes();
  const day = useTheme((s) => s.day);
  const floors = useFloors();
  const eggs = useMemo(() => eggsFor(day, floors), [day, floors]);
  const found = useFound(day);
  const here = eggs.filter((e) => e.floor === floor && !found.includes(e.id));

  const find = useCallback(
    (id: string) => {
      const egg = eggs.find((e) => e.id === id);
      const list = daily<string>(FOUND_KEY, day);
      if (!egg || list.includes(id)) return list.length;
      const now = [...list, id];
      daily(FOUND_KEY, day, now);
      foundListeners.forEach((fn) => fn());
      const all = now.length >= EGG_COUNT;
      chime({ x: egg.x, y: 0.2, z: egg.z }, all);
      const s = useStore.getState();
      if (all) {
        burstAt(egg.x, 0.5, egg.z, DEF.confetti!.colors);
        s.pushToast('success', '🏆 All 12 eggs! The golden egg trophy is on the trophy cabinet in the lobby.');
      } else s.pushToast('info', `🥚 Egg ${now.length} of ${EGG_COUNT}!${now.length === EGG_COUNT - 1 ? ' One to go…' : ''}`);
      return now.length;
    },
    [eggs, day],
  );
  const act = useCallback(
    (id: string) => {
      if (id.startsWith('egg:')) find(id.slice(4));
    },
    [find],
  );
  useThemeActions(act);

  useEffect(() => {
    useThemeRuntime.setState({ status: statusOf(found.length) });
  }, [found.length]);
  useEffect(() => () => useThemeRuntime.setState({ status: null }), []);
  useEffect(
    () =>
      addProbe({
        eggs: () => eggs.map((e) => ({ ...e, found: daily<string>(FOUND_KEY, day).includes(e.id) })),
        find: (id: string) => find(id),
        resetEggs: () => {
          daily(FOUND_KEY, day, []);
          foundListeners.forEach((fn) => fn());
        },
      }),
    [eggs, find, day],
  );

  if (kind === 'roof') return <Tint def={DEF} />;
  return (
    <group>
      <Decor id="easter" kind={kind} items={ITEMS} />
      <Bunting kind={kind} colors={DEF.bunting!} />
      <Tint def={DEF} />
      <Burst />
      {here.map((e) => (
        <EggMesh key={e.id} egg={e} />
      ))}
    </group>
  );
}

