import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { markBloom } from '../gfx/bloomMarks';
import { useStore } from '../../store';
import { ELEVATOR, BALCONY, BALCONY_OUT, FLOOR_HEIGHT, HALF_D, HALF_W, PLANTER, SIDES, WALL_T, balconyFurniture, decorSlots, sideSign } from '../layout';
import { toon } from '../materials';
import { playerAt, wallCut } from '../camera/rig';
import { bodies } from '../people';
import { dogNow } from '../toys/dogState';
import { setEventWeather, weather } from '../weather/weatherState';
import { addProbe, useTheme, useThemeRuntime } from './active';
import { burstAt, Burst } from './kit/Burst';
import { useCostumes } from './kit/costumes';
import { box, cone, cyl, mergeParts, paintedGlow, paintedToon, part, sphere, torus } from './kit/geo';
import { Hotspot, useThemeActions } from './kit/Hotspot';
import { Decor, Single, type ItemRenderers, type Spot } from './kit/Placed';
import { Garland, StringLights } from './kit/runs';
import { chime, unwrap } from './kit/sfx';
import { Tint } from './kit/Tint';
import { daily, loadList, saveList } from './kit/store';
import type { ThemeProps } from './ThemeLayer';
import { THEMES } from './themes';

// Christmas (1–26 Dec): a big tree in the lobby with twinkling lights and presents under it (E opens one: a festive mug
// colour, a sticker for the phone or a confetti burst; they're wrapped again every morning), garlands and string lights
// on every floor, a wreath on each elevator door, snow lying on every balcony and the roof and snow falling outside (the
// weather's own snow, weather/), a snowman or two, Santa hats, antlers and ugly sweaters, and hot chocolate (with
// marshmallows) from the coffee machines.

const DEF = THEMES.christmas;
const ORNAMENTS = ['#e63946', '#ffd166', '#4cc9f0', '#f8f9fa', '#c77dff', '#ff8fab'];

// ---------- the tree ----------

const LAYERS = [
  { r: 1.0, h: 1.1, y: 1.05 },
  { r: 0.82, h: 1.0, y: 1.6 },
  { r: 0.62, h: 0.9, y: 2.1 },
  { r: 0.4, h: 0.75, y: 2.55 },
];

/** How wide the tree is at height y (its outline, for baubles and lights). */
function treeRadius(y: number) {
  let r = 0;
  for (const l of LAYERS) {
    const f = (y - (l.y - l.h / 2)) / l.h;
    if (f >= 0 && f <= 1) r = Math.max(r, l.r * (1 - f));
  }
  return r;
}

function treeGeometry() {
  const parts = [part(cyl(0.38, 0.32, 0.42, 16), '#c1121f', [0, 0.21, 0]), part(torus(0.38, 0.04, 6, 20), '#ffd166', [0, 0.4, 0], [Math.PI / 2, 0, 0]), part(cyl(0.1, 0.12, 0.35, 8), '#7f4f24', [0, 0.55, 0])];
  LAYERS.forEach((l, i) => parts.push(part(cone(l.r, l.h, 18), i % 2 ? '#40916c' : '#2d6a4f', [0, l.y, 0])));
  for (let i = 0; i < 30; i++) {
    const y = 0.75 + (i / 30) * 2.1;
    const a = i * 2.39;
    const r = treeRadius(y) + 0.03;
    if (r < 0.1) continue;
    parts.push(part(sphere(0.065, 10, 8), ORNAMENTS[i % ORNAMENTS.length], [Math.sin(a) * r, y - 0.06, Math.cos(a) * r]));
  }
  return mergeParts(parts);
}

function starGeometry() {
  const arms = Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5) * Math.PI * 2;
    return part(cone(0.07, 0.22, 4), '#ffe066', [Math.sin(a) * 0.1, 3.08 + Math.cos(a) * 0.1, 0], [0, 0, -a], [1, 1, 0.5]);
  });
  return mergeParts([...arms, part(sphere(0.08, 10, 8), '#fff3b0', [0, 3.08, 0], [0, 0, 0], [1, 1, 0.6])]);
}

const BULBS = 64;
const BULB_COLORS = ['#ff3b3b', '#ffd23f', '#2dc653', '#4cc9f0', '#ff8fab'];

/** The tree's lights, spiralling up: one instanced mesh, twinkling. */
function TreeLights() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.SphereGeometry(0.035, 8, 6), []);
  const mat = useMemo(() => markBloom(new THREE.MeshBasicMaterial({ toneMapped: false })), []);
  useEffect(() => () => [geo, mat].forEach((d) => d.dispose()), [geo, mat]);
  const st = useMemo(() => ({ c: new THREE.Color(), base: BULB_COLORS.map((c) => new THREE.Color(c)), next: 0 }), []);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    for (let i = 0; i < BULBS; i++) {
      const y = 0.7 + (i / BULBS) * 2.2;
      const a = i * 0.62;
      const r = treeRadius(y) + 0.02;
      o.position.set(Math.sin(a) * r, y, Math.cos(a) * r);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, st.base[i % st.base.length]);
    }
    m.instanceMatrix.needsUpdate = true;
  }, [st]);
  useFrame(({ clock }) => {
    const m = ref.current;
    const t = clock.elapsedTime;
    if (!m || t < st.next) return;
    st.next = t + 0.12;
    for (let i = 0; i < BULBS; i++) m.setColorAt(i, st.c.copy(st.base[i % st.base.length]).multiplyScalar(Math.sin(t * 3 + i * 1.3) > -0.2 ? 1 : 0.25));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, mat, BULBS]} frustumCulled={false} />;
}

// ---------- presents ----------

/** Under the tree, in the tree's frame (its front, +z, faces the lobby). */
const PRESENTS = [
  { x: -0.95, z: 0.55, w: 0.45, h: 0.32, paper: '#e63946', ribbon: '#ffd166' },
  { x: -0.35, z: 1.05, w: 0.38, h: 0.42, paper: '#2a9d8f', ribbon: '#f8f9fa' },
  { x: 0.35, z: 1.1, w: 0.5, h: 0.28, paper: '#ffd166', ribbon: '#e63946' },
  { x: 0.98, z: 0.5, w: 0.36, h: 0.36, paper: '#9b5de5', ribbon: '#ffd166' },
  { x: 0.05, z: -1.05, w: 0.42, h: 0.38, paper: '#4cc9f0', ribbon: '#e63946' },
];

function presentGeometry(p: (typeof PRESENTS)[number], open: boolean) {
  const { w, h, paper, ribbon } = p;
  if (open) {
    return mergeParts([
      part(box(w, h * 0.85, w), paper, [0, (h * 0.85) / 2, 0]),
      part(box(w * 0.9, 0.02, w * 0.9), '#fff3e0', [0, h * 0.86, 0]),
      // the lid, off and leaning against the box
      part(box(w + 0.04, 0.08, w + 0.04), paper, [w * 0.62, 0.2, 0], [0, 0, 1.2]),
      part(box(0.06, 0.09, w + 0.05), ribbon, [w * 0.62, 0.2, 0], [0, 0, 1.2]),
    ]);
  }
  return mergeParts([
    part(box(w, h, w), paper, [0, h / 2, 0]),
    part(box(w + 0.01, h + 0.01, 0.06), ribbon, [0, h / 2, 0]),
    part(box(0.06, h + 0.01, w + 0.01), ribbon, [0, h / 2, 0]),
    part(sphere(0.06, 8, 6), ribbon, [-0.05, h + 0.04, 0], [0, 0, 0.6], [1.3, 0.7, 0.7]),
    part(sphere(0.06, 8, 6), ribbon, [0.05, h + 0.04, 0], [0, 0, -0.6], [1.3, 0.7, 0.7]),
  ]);
}

const MUG_GIFTS: [string, string][] = [
  ['#c1121f', 'candy-cane red'],
  ['#2d6a4f', 'Christmas-tree green'],
  ['#ffd166', 'tinsel gold'],
];
const STICKERS = ['⛄ “Ship it, snowflake”', '🦌 “Rudolph approved this PR”', '🎄 “Merry merges”', '⭐ “Top of the tree”', '🍪 “Cookie for QA”'];

const PRESENT_KEY = 'cubefarm:presents';
const STICKER_KEY = 'cubefarm:stickers';

/** Opens present `i` (once a day): a gift depending on the day and the present, and what you got. */
function openPresent(i: number, day: string, at: THREE.Vector3, tintMug: ThemeProps['office']['tintMug']): string | null {
  const opened = daily(PRESENT_KEY, day);
  if (opened.includes(i)) {
    useStore.getState().pushToast('info', '🎁 Already opened. Santa wraps them again tomorrow!');
    return null;
  }
  daily(PRESENT_KEY, day, [...opened, i]);
  unwrap({ x: at.x, y: at.y, z: at.z });
  const s = useStore.getState();
  const roll = (i * 7 + [...day].reduce((n, c) => n + c.charCodeAt(0), 0)) % 3;
  if (roll === 0 && s.held?.kind === 'mug') {
    const [color, name] = MUG_GIFTS[i % MUG_GIFTS.length];
    tintMug(s.held.id, color);
    s.setHeld({ ...s.held });
    s.pushToast('success', `🎁 A ${name} mug! The one in your hand is festive now.`);
    return `mug:${name}`;
  }
  if (roll === 2) {
    burstAt(at.x, at.y + 0.3, at.z, THEMES.christmas.confetti!.colors);
    chime(at);
    s.pushToast('success', '🎁 Pop! A burst of confetti. Merry Christmas!');
    return 'confetti';
  }
  const sticker = STICKERS[(i + day.length) % STICKERS.length];
  const have = loadList<string>(STICKER_KEY);
  if (!have.includes(sticker)) saveList(STICKER_KEY, [...have, sticker]);
  chime(at);
  s.pushToast('success', `🎁 A sticker for your phone: ${sticker}`);
  return `sticker:${sticker}`;
}

function Tree({ at }: { at: Spot[] }) {
  const tree = useMemo(treeGeometry, []);
  const star = useMemo(starGeometry, []);
  useEffect(() => () => star.dispose(), [star]);
  const day = useTheme((s) => s.day);
  const opened = useOpened(day);
  const geos = useMemo(() => PRESENTS.map((p) => ({ closed: presentGeometry(p, false), open: presentGeometry(p, true) })), []);
  useEffect(() => () => geos.forEach((g) => [g.closed, g.open].forEach((x) => x.dispose())), [geos]);
  return (
    <>
      {at.map((s) => (
        <Single key={s.id} geometry={tree} at={s}>
          <mesh geometry={star} material={paintedGlow()} />
          <TreeLights />
          {PRESENTS.map((p, i) => (
            <Hotspot key={i} id={`present-${i}`} label={opened.includes(i) ? 'Opened: more tomorrow' : 'Open a present 🎁'} position={[p.x, 0, p.z]} rotationY={i * 0.4}>
              <mesh geometry={opened.includes(i) ? geos[i].open : geos[i].closed} material={paintedToon()} castShadow />
            </Hotspot>
          ))}
        </Single>
      ))}
    </>
  );
}

const openedListeners = new Set<() => void>();
function useOpened(day: string) {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    openedListeners.add(fn);
    return () => void openedListeners.delete(fn);
  }, []);
  return daily(PRESENT_KEY, day);
}

// ---------- the rest ----------

function snowmanGeometry() {
  return mergeParts([
    part(sphere(0.32, 16, 12), '#f8f9fa', [0, 0.3, 0]),
    part(sphere(0.24, 16, 12), '#f8f9fa', [0, 0.72, 0]),
    part(sphere(0.17, 14, 10), '#f8f9fa', [0, 1.04, 0]),
    part(cone(0.035, 0.16, 8), '#f77f00', [0, 1.04, 0.22], [Math.PI / 2, 0, 0]),
    ...[-0.06, 0.06].map((x) => part(sphere(0.022, 6, 5), '#1f1d2b', [x, 1.1, 0.15])),
    ...[0.62, 0.74, 0.86].map((y) => part(sphere(0.025, 6, 5), '#1f1d2b', [0, y, 0.235 - Math.abs(y - 0.74) * 0.4])),
    part(torus(0.15, 0.04, 6, 18), '#e63946', [0, 0.92, 0], [Math.PI / 2, 0, 0]),
    part(box(0.07, 0.25, 0.03), '#e63946', [0.1, 0.8, 0.16], [0.2, 0, 0.2]),
    part(cyl(0.16, 0.16, 0.025, 14), '#1f1d2b', [0, 1.17, 0]),
    part(cyl(0.11, 0.11, 0.18, 14), '#1f1d2b', [0, 1.27, 0]),
    ...[-1, 1].map((s) => part(cyl(0.012, 0.015, 0.4, 5), '#7f4f24', [s * 0.32, 0.78, 0], [0, 0, s * 1.0])),
  ]);
}

/** A snowman: full size on the floor, a little one on a counter. */
function Snowmen({ at }: { at: Spot[] }) {
  const geo = useMemo(snowmanGeometry, []);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <>
      {at.map((s) => (
        <group key={s.id} position={[s.x, s.y, s.z]} rotation={[0, s.rotY + (s.y > 0 ? 0 : Math.PI), 0]} scale={s.y > 0 ? 0.3 : 0.95}>
          <mesh geometry={geo} material={paintedToon()} castShadow />
        </group>
      ))}
    </>
  );
}

const ITEMS: ItemRenderers = { tree: Tree, snowman: Snowmen };

function wreathGeometry() {
  const tufts = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    return part(sphere(0.075, 8, 6), i % 2 ? '#2d6a4f' : '#40916c', [Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0]);
  });
  const berries = [0.4, 1.9, 3.3, 4.6].map((a) => part(sphere(0.03, 6, 5), '#d00000', [Math.cos(a) * 0.24, Math.sin(a) * 0.24, 0.06]));
  return mergeParts([
    ...tufts,
    ...berries,
    part(sphere(0.06, 8, 6), '#d00000', [0, -0.24, 0.07]),
    part(cone(0.05, 0.14, 6), '#e63946', [-0.08, -0.25, 0.07], [0, 0, 1.2]),
    part(cone(0.05, 0.14, 6), '#e63946', [0.08, -0.25, 0.07], [0, 0, -1.2]),
  ]);
}

/** A wreath on each elevator door, sliding open with it (the doors open just as Elevator.tsx opens them). */
function Wreaths() {
  const geo = useMemo(wreathGeometry, []);
  useEffect(() => () => geo.dispose(), [geo]);
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const open = useRef(0);
  const { doorHalf } = ELEVATOR;
  const z = HALF_D + 0.07;
  const root = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const travel = useStore.getState().travel;
    let near = Math.hypot(playerAt.x, playerAt.z - (HALF_D + 0.15)) < 2.8;
    for (const b of bodies()) if (b.stage !== 'seated' && Math.abs(b.x) < doorHalf + 0.6 && Math.abs(b.z - (HALF_D + 0.15)) < 2) near = true;
    if (dogNow.drawn && Math.abs(dogNow.x) < doorHalf + 0.6 && Math.abs(dogNow.z - (HALF_D + 0.15)) < 2) near = true;
    const want = travel?.phase === 'closing' ? 0 : near || travel?.phase === 'opening' ? 1 : 0;
    open.current += (want - open.current) * (1 - Math.exp(-dt * 5));
    const slide = open.current * doorHalf * 0.98;
    left.current?.position.setX(-doorHalf / 2 - slide);
    right.current?.position.setX(doorHalf / 2 + slide);
    // the overview's cutaway takes the south wall, and the doors with it
    if (root.current) root.current.visible = wallCut().z !== 1;
  });
  return (
    <group ref={root}>
      <group ref={left} position={[-doorHalf / 2, 1.65, z]} rotation={[0, Math.PI, 0]} scale={0.85}>
        <mesh geometry={geo} material={paintedToon()} />
      </group>
      <group ref={right} position={[doorHalf / 2, 1.65, z]} rotation={[0, Math.PI, 0]} scale={0.85}>
        <mesh geometry={geo} material={paintedToon()} />
      </group>
    </group>
  );
}

/** Snow lying on every balcony (and the patio and the roof's canopy), on the railings and on your floor's planters. */
function SnowCover({ kind, floor, top }: { kind: 'office' | 'lobby'; floor: number; top: number }) {
  const geo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const deep = BALCONY_OUT - HALF_W - WALL_T - 0.05;
    const len = BALCONY.maxZ - BALCONY.minZ - 0.2;
    for (let f = 0; f <= Math.max(top, floor) + 1; f++) {
      const y = (f - floor) * FLOOR_HEIGHT;
      for (const side of SIDES) {
        const s = sideSign(side);
        // a drift that's deeper against the railing
        parts.push(part(box(deep, 0.04, len), '#f8fbff', [s * (HALF_W + WALL_T + deep / 2 + 0.02), y + 0.02, 0]));
        parts.push(part(box(0.35, 0.09, len), '#f1f6ff', [s * (BALCONY_OUT - 0.3), y + 0.05, 0]));
        if (f <= Math.max(top, floor)) parts.push(part(box(BALCONY.railT + 0.08, 0.05, len + 0.2), '#f8fbff', [s * (BALCONY_OUT - BALCONY.railT / 2), y + BALCONY.rail + 0.02, 0]));
      }
    }
    for (const side of SIDES) {
      for (const p of balconyFurniture(kind, side).planters) parts.push(part(box(PLANTER.w + 0.02, 0.06, PLANTER.l), '#f8fbff', [(p.minX + p.maxX) / 2, PLANTER.h + 0.02, (p.minZ + p.maxZ) / 2]));
    }
    return mergeParts(parts);
  }, [kind, floor, top]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={paintedToon()} receiveShadow />;
}

/** Snow falling outside while it's on: the weather's own snow (weather/), held like a world event's weather. It leaves
 * Off and the real weather alone, and ?weather= (QA) wins. */
const SNOW = { kind: 'snow' as const, wind: 0.15 };
function useSnowfall() {
  useEffect(() => {
    const hold = () => {
      const mode = useStore.getState().settings.weather?.mode ?? 'cycle';
      if (mode !== 'cycle' || weather.url || weather.probe) return;
      if (!weather.event) setEventWeather(SNOW); // a world event's own weather (the hurricane) takes its turn first
    };
    hold();
    const t = setInterval(hold, 2000);
    return () => {
      clearInterval(t);
      if (weather.event === SNOW) setEventWeather(null);
    };
  }, []);
}

// ---------- hot chocolate ----------

const COFFEE = '#6f4518'; // the drink's colour in CoffeeMachine.tsx and mugLook.tsx: one cached toon material

let cocoaTex: THREE.CanvasTexture | null = null;
function cocoaTexture() {
  if (cocoaTex) return cocoaTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#8a5a3c';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#fffaf2';
  for (const [x, y, r] of [[52, 54, 0.4], [76, 60, -0.3], [62, 80, 0.9], [44, 76, 0.2], [80, 82, -0.6]]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(r);
    ctx.beginPath();
    ctx.roundRect(-9, -9, 18, 18, 5);
    ctx.fill();
    ctx.restore();
  }
  cocoaTex = new THREE.CanvasTexture(c);
  cocoaTex.colorSpace = THREE.SRGBColorSpace;
  return cocoaTex;
}

/** Every coffee machine pours hot chocolate with marshmallows while the theme's on: the drink's shared material. */
function useHotChocolate() {
  useEffect(() => {
    const m = toon(COFFEE) as THREE.MeshToonMaterial;
    const before = { color: m.color.clone(), map: m.map };
    m.color.set('#ffffff');
    m.map = cocoaTexture();
    m.needsUpdate = true;
    return () => {
      m.color.copy(before.color);
      m.map = before.map;
      m.needsUpdate = true;
    };
  }, []);
}

export default function Christmas({ kind, floor, top, office }: ThemeProps) {
  useCostumes();
  useHotChocolate();
  useSnowfall();
  const day = useTheme((s) => s.day);
  const feature = useMemo(() => decorSlots('lobby').find((s) => s.id === 'lobby-feature')!, []);
  const presentAt = useCallback(
    (i: number) => {
      const p = PRESENTS[i];
      const c = Math.cos(feature.rotY);
      const sn = Math.sin(feature.rotY);
      return new THREE.Vector3(feature.x + p.x * c + p.z * sn, 0.3, feature.z - p.x * sn + p.z * c);
    },
    [feature],
  );
  const open = useCallback(
    (i: number) => {
      const got = openPresent(i, day, presentAt(i), office.tintMug);
      openedListeners.forEach((fn) => fn());
      useThemeRuntime.setState({ status: status(day) });
      return got;
    },
    [day, presentAt, office],
  );
  const act = useCallback(
    (id: string) => {
      const m = /^present-(\d)$/.exec(id);
      if (m) open(Number(m[1]));
    },
    [open],
  );
  useThemeActions(act);
  useEffect(() => {
    useThemeRuntime.setState({ status: status(day) });
    return () => useThemeRuntime.setState({ status: null });
  }, [day]);
  useEffect(
    () =>
      addProbe({
        open: (i: number) => open(i),
        presents: () => ({ opened: daily(PRESENT_KEY, day), stickers: loadList<string>(STICKER_KEY) }),
        cocoa: () => !!(toon(COFFEE) as THREE.MeshToonMaterial).map,
      }),
    [open, day],
  );
  if (kind === 'roof') return <Tint def={DEF} />;
  return (
    <group>
      <Decor id="christmas" kind={kind} items={ITEMS} />
      <StringLights kind={kind} colors={DEF.lights!} />
      <Garland kind={kind} />
      <Wreaths />
      <SnowCover kind={kind} floor={floor} top={top} />
      <Tint def={DEF} />
      {kind === 'lobby' && <Burst />}
    </group>
  );
}

function status(day: string) {
  const opened = daily(PRESENT_KEY, day).length;
  const stickers = loadList<string>(STICKER_KEY).length;
  return `🎁 ${opened}/${PRESENTS.length} presents opened today${stickers ? ` · ${stickers} sticker${stickers === 1 ? '' : 's'}` : ''}`;
}
