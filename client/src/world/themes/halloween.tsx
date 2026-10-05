import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { markBloom } from '../gfx/bloomMarks';
import { useStore } from '../../store';
import { outsideHearing } from '../../ui/outsideMix';
import { listenerAt, noise, tone } from '../../ui/sfx';
import { SANS } from '../draw';
import { doorOpen } from '../doors';
import { useCanvasTexture } from '../interact';
import { BALCONY_OUT, SIDES } from '../layout';
import { nightFactor } from '../sky/time';
import { dayTime } from '../sky/useDayTime';
import { addProbe } from './active';
import { useCostumes } from './kit/costumes';
import { box, cone, cyl, haloTexture, mergeParts, paintedToon, paintedToonDouble, part, sphere } from './kit/geo';
import { Hotspot, useThemeActions } from './kit/Hotspot';
import { Decor, Placed, Single, type ItemRenderers, type Spot } from './kit/Placed';
import { StringLights } from './kit/runs';
import { crinkle } from './kit/sfx';
import { Tint } from './kit/Tint';
import type { ThemeProps } from './ThemeLayer';
import { THEMES } from './themes';

// Halloween (24–31 Oct): carved pumpkins glowing on every desk, the reception and the balconies, cobwebs in the
// corners, a witch's broom by the elevator, orange and purple lights, a gravestone for the flaky e2e test in the
// lobby, a big inflatable pumpkin on the patio, bats round the building at night, an owl and the odd creaking door
// outside, a purple evening sky, costumes, and a candy bowl at reception (E takes one).

const DEF = THEMES.halloween;
const FACE = '#ffb347';

// ---------- pumpkins ----------

/** A pumpkin `r` round, sitting on y 0, its face to +z: ribbed lobes and a stem (the face is drawn separately, lit). */
function pumpkinBody(r: number) {
  const lobes = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return part(sphere(r * 0.62, 9, 6), i % 2 ? '#f77f00' : '#fb8500', [Math.sin(a) * r * 0.42, r * 0.78, Math.cos(a) * r * 0.42], [0, a, 0], [0.8, 1.25, 1]);
  });
  return mergeParts([...lobes, part(cyl(r * 0.1, r * 0.14, r * 0.4, 8), '#386641', [0, r * 1.55, 0], [0.15, 0, 0.2])]);
}

/** The carved face: two triangle eyes, a nose and a toothy grin, just proud of the front lobe. */
function pumpkinFace(r: number) {
  const z = r * 1.02;
  const tri = (x: number, y: number, s: number) => part(cyl(s, s, r * 0.08, 3), FACE, [x, y, z], [Math.PI / 2, 0, Math.PI]);
  return mergeParts([
    tri(-r * 0.33, r * 0.98, r * 0.17),
    tri(r * 0.33, r * 0.98, r * 0.17),
    tri(0, r * 0.74, r * 0.09),
    part(box(r * 0.8, r * 0.16, r * 0.08), FACE, [0, r * 0.48, z * 0.98]),
    ...[-0.22, 0.22].map((x) => part(box(r * 0.14, r * 0.14, r * 0.08), FACE, [x * r, r * 0.6, z * 0.99], [0, 0, Math.PI / 4])),
  ]);
}

const sizeOf = (s: Spot) => (s.id.startsWith('reception') ? 1.6 : s.id.startsWith('balcony') ? 2.4 : 1);

/** Every pumpkin on the floor: one instanced body, one face that flickers like a candle, and one set of halos. */
function JackOLanterns({ at }: { at: Spot[] }) {
  const body = useMemo(() => pumpkinBody(0.1), []);
  const face = useMemo(() => pumpkinFace(0.1), []);
  const faceMat = useMemo(() => markBloom(new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false })), []);
  const ref = useRef<THREE.InstancedMesh>(null);
  const halos = useMemo(() => {
    const pts = at.flatMap((s) => {
      const k = sizeOf(s);
      return [s.x + Math.sin(s.rotY) * 0.16 * k, s.y + 0.1 * k, s.z + Math.cos(s.rotY) * 0.16 * k];
    });
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }, [at]);
  const haloMat = useMemo(
    () => new THREE.PointsMaterial({ map: haloTexture(), color: '#ff9a3c', size: 0.7, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    [],
  );
  useEffect(() => () => [face, faceMat, halos, haloMat].forEach((d) => d.dispose()), [face, faceMat, halos, haloMat]);
  const c = useMemo(() => new THREE.Color(), []);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    for (let i = 0; i < at.length; i++) m.setColorAt(i, c.set(FACE));
  }, [at, c]);
  const next = useRef(0);
  useFrame(({ clock }) => {
    const m = ref.current;
    const t = clock.elapsedTime;
    if (!m || t < next.current) return;
    next.current = t + 0.07;
    for (let i = 0; i < at.length; i++) {
      // a candle: mostly steady, with quick dips
      const k = 0.78 + 0.14 * Math.sin(t * 9.1 + i * 2.3) + 0.08 * Math.sin(t * 23.7 + i * 5.1);
      m.setColorAt(i, c.set(FACE).multiplyScalar(k));
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    haloMat.opacity = (0.18 + 0.42 * nightFactor(dayTime.t)) * (0.85 + 0.15 * Math.sin(t * 11));
  });
  return (
    <group>
      {/* small, and many of them: no shadows, to keep the shadow pass as it was */}
      <Placed geometry={body} at={at} scale={sizeOf} shadow={false} />
      <InstancedRef at={at} geometry={face} material={faceMat} innerRef={ref} />
      <points geometry={halos} material={haloMat} />
    </group>
  );
}

/** The faces: their own instanced mesh, so each one's candle flickers in its own time. */
function InstancedRef({ at, geometry, material, innerRef }: { at: Spot[]; geometry: THREE.BufferGeometry; material: THREE.Material; innerRef: React.RefObject<THREE.InstancedMesh | null> }) {
  useLayoutEffect(() => {
    const m = innerRef.current;
    if (!m) return;
    const o = new THREE.Object3D();
    at.forEach((s, i) => {
      o.position.set(s.x, s.y, s.z);
      o.rotation.set(0, s.rotY, 0);
      o.scale.setScalar(sizeOf(s) * 1.001);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [at, innerRef]);
  return <instancedMesh ref={innerRef} args={[geometry, material, at.length]} />;
}

function InflatablePumpkin({ at }: { at: Spot[] }) {
  const geo = useMemo(() => {
    const r = 0.8;
    return mergeParts([
      pumpkinBody(r),
      pumpkinFace(r),
      // the fan's tether pegs
      ...[-1, 1].map((s) => part(cyl(0.015, 0.015, 0.9, 5), '#adb5bd', [s * 0.85, 0.4, 0.2], [0, 0, s * 0.6])),
    ]);
  }, []);
  return <>{at.map((s) => <Single key={s.id} geometry={geo} at={s} />)}</>;
}

// ---------- the rest of the props ----------

/** Cobwebs across the ceiling corners, and a spider on a thread from one of them. */
function Cobwebs({ at }: { at: Spot[] }) {
  const lines = useMemo(() => {
    const pts: number[] = [];
    const push = (a: THREE.Vector3, b: THREE.Vector3) => pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    for (const s of at) {
      const corner = new THREE.Vector3(s.x, s.y - 0.02, s.z);
      const u = new THREE.Vector3(-Math.sign(s.x), 0, 0);
      const v = new THREE.Vector3(0, 0, -Math.sign(s.z));
      const w = new THREE.Vector3(0, -1, 0);
      const anchors = [u.clone().multiplyScalar(0.9), u.clone().multiplyScalar(0.55).addScaledVector(w, 0.3), w.clone().multiplyScalar(0.75), v.clone().multiplyScalar(0.55).addScaledVector(w, 0.3), v.clone().multiplyScalar(0.9)].map((d) =>
        corner.clone().add(d),
      );
      for (const a of anchors) push(corner, a);
      for (const k of [0.3, 0.55, 0.8]) {
        for (let i = 1; i < anchors.length; i++) {
          const a = corner.clone().lerp(anchors[i - 1], k);
          const b = corner.clone().lerp(anchors[i], k);
          const mid = a.clone().lerp(b, 0.5).lerp(corner, 0.08); // a little slack
          push(a, mid);
          push(mid, b);
        }
      }
    }
    const first = at[0];
    if (first) {
      const top = new THREE.Vector3(first.x - Math.sign(first.x) * 0.35, first.y - 0.25, first.z - Math.sign(first.z) * 0.35);
      push(top, top.clone().setY(first.y - 1.1));
    }
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }, [at]);
  const spider = useMemo(() => {
    const first = at[0];
    if (!first) return null;
    const x = first.x - Math.sign(first.x) * 0.35;
    const z = first.z - Math.sign(first.z) * 0.35;
    const y = first.y - 1.15;
    return mergeParts([
      part(sphere(0.05, 10, 8), '#1f1d2b', [x, y, z]),
      part(sphere(0.032, 8, 6), '#1f1d2b', [x, y + 0.06, z]),
      ...[-1, 1].flatMap((sx) => [0.6, 0.2, -0.2, -0.6].map((a) => part(cyl(0.006, 0.006, 0.12, 4), '#1f1d2b', [x + sx * 0.06, y, z + a * 0.06], [0, 0, sx * 1.1]))),
    ]);
  }, [at]);
  const mat = useMemo(() => new THREE.LineBasicMaterial({ color: '#e9ecef', transparent: true, opacity: 0.75 }), []);
  useEffect(() => () => [lines, mat].forEach((d) => d.dispose()), [lines, mat]);
  useEffect(() => () => spider?.dispose(), [spider]);
  return (
    <group>
      <lineSegments geometry={lines} material={mat} />
      {spider && <mesh geometry={spider} material={paintedToon()} />}
    </group>
  );
}

function Broom({ at }: { at: Spot[] }) {
  const geo = useMemo(
    () =>
      mergeParts([
        part(cyl(0.022, 0.026, 1.25, 8), '#8d5a3b', [0, 0.82, 0]),
        part(cone(0.16, 0.42, 12), '#d4a373', [0, 0.18, 0], [Math.PI, 0, 0]),
        part(cyl(0.07, 0.075, 0.07, 10), '#7f4f24', [0, 0.38, 0]),
        part(cyl(0.12, 0.13, 0.04, 10), '#9d4edd', [0, 0.27, 0]),
      ]),
    [],
  );
  // leaning back against the wall
  return <>{at.map((s) => <Single key={s.id} geometry={geo} at={s} />)}</>;
}

function Gravestone({ at }: { at: Spot[] }) {
  const geo = useMemo(
    () =>
      mergeParts([
        part(box(0.9, 0.8, 0.22), '#c3c9d4', [0, 0.4, 0]),
        part(new THREE.CylinderGeometry(0.45, 0.45, 0.22, 20, 1, false, -Math.PI / 2, Math.PI), '#c3c9d4', [0, 0.8, 0], [Math.PI / 2, 0, 0]),
        part(box(1.0, 0.1, 0.3), '#9aa3b1', [0, 0.05, 0]),
        part(sphere(0.6, 16, 8), '#6b4f3a', [0, -0.02, 0.5], [0, 0, 0], [1, 0.18, 0.7]),
        part(sphere(0.07, 8, 6), '#52b788', [-0.3, 0.06, 0.65]),
        part(sphere(0.06, 8, 6), '#52b788', [0.33, 0.05, 0.8]),
        part(cyl(0.04, 0.04, 0.12, 8), '#f8f9fa', [0.25, 0.08, 0.4]),
      ]),
    [],
  );
  const candle = useMemo(() => markBloom(new THREE.MeshBasicMaterial({ color: FACE, toneMapped: false })), []);
  useEffect(() => () => candle.dispose(), [candle]);
  const tex = useCanvasTexture(
    512,
    512,
    (ctx) => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#2b2d42';
      ctx.font = `700 150px ${SANS}`;
      ctx.fillText('RIP', 256, 150);
      ctx.font = `700 76px ${SANS}`;
      ctx.fillText('flaky e2e', 256, 290);
      ctx.font = `500 44px ${SANS}`;
      ctx.fillText('it passed locally', 256, 390);
    },
    [],
  );
  return (
    <>
      {at.map((s) => (
        <Single key={s.id} geometry={geo} at={s}>
          <mesh position={[0, 0.66, 0.112]}>
            <planeGeometry args={[0.86, 0.86]} />
            <meshBasicMaterial map={tex} transparent toneMapped={false} />
          </mesh>
          {/* the candle on the grave */}
          <mesh position={[0.25, 0.17, 0.4]} material={candle}>
            <sphereGeometry args={[0.025, 8, 6]} />
          </mesh>
        </Single>
      ))}
    </>
  );
}

let candies = 0;
const CANDY = ['a toffee', 'a gummy bat', 'a candy corn', 'a chocolate eyeball', 'a lollipop', 'a sour worm'];
const WRAPPERS = ['#ff7b00', '#9d4edd', '#06d6a0', '#ef476f', '#ffd166', '#4cc9f0'];

function takeCandy(at?: Spot) {
  candies++;
  crinkle(at ? { x: at.x, y: at.y + 0.1, z: at.z } : undefined);
  useStore.getState().pushToast('info', `🍬 You took ${CANDY[(candies - 1) % CANDY.length]} (${candies} so far). Happy Halloween!`);
}

function CandyBowl({ at }: { at: Spot[] }) {
  const geo = useMemo(() => {
    const parts = [
      part(new THREE.SphereGeometry(0.2, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), '#ff7b00', [0, 0.2, 0], [0, 0, 0], [1, 0.75, 1]),
      part(new THREE.TorusGeometry(0.2, 0.018, 6, 24), '#1f1d2b', [0, 0.2, 0], [Math.PI / 2, 0, 0]),
      part(cyl(0.08, 0.1, 0.03, 14), '#1f1d2b', [0, 0.015, 0]),
    ];
    for (let i = 0; i < 12; i++) {
      const a = i * 2.4;
      const r = i === 0 ? 0 : 0.05 + (i % 3) * 0.04;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = 0.2 + (0.14 - r) * 0.35 + (i % 2) * 0.015;
      const c = WRAPPERS[i % WRAPPERS.length];
      parts.push(part(sphere(0.038, 8, 6), c, [x, y, z], [0, a, 0], [1.3, 0.8, 0.8]));
      parts.push(part(cone(0.026, 0.045, 6), c, [x + Math.cos(a) * 0.065, y, z - Math.sin(a) * 0.065], [0, a, Math.PI / 2]));
    }
    return mergeParts(parts);
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <>
      {at.map((s) => (
        <Hotspot key={s.id} id="candy" label="Take a candy 🍬" position={[s.x, s.y, s.z]} rotationY={s.rotY}>
          <mesh geometry={geo} material={paintedToonDouble()} castShadow />
        </Hotspot>
      ))}
    </>
  );
}

const ITEMS: ItemRenderers = {
  jackOLantern: JackOLanterns,
  bigPumpkin: JackOLanterns,
  cobweb: Cobwebs,
  broom: Broom,
  gravestone: Gravestone,
  inflatablePumpkin: InflatablePumpkin,
  candyBowl: CandyBowl,
};

// ---------- bats ----------

const BATS = 10;

/** Bats looping round outside the side walls at night: one instanced mesh, wings beating by squashing each bat. */
function Bats() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => {
    const wing = (s: number) => {
      const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, s * 0.32, 0.08, -0.05, s * 0.26, -0.02, 0.1, 0, 0, 0, s * 0.26, -0.02, 0.1, s * 0.12, -0.05, 0.12], 3));
      g.computeVertexNormals();
      return part(g, '#1b1430');
    };
    return mergeParts([wing(1), wing(-1), part(sphere(0.06, 8, 6), '#1b1430', [0, 0, 0.04], [0, 0, 0], [0.8, 0.8, 1.3]), part(cone(0.02, 0.05, 4), '#1b1430', [0.03, 0.06, 0]), part(cone(0.02, 0.05, 4), '#1b1430', [-0.03, 0.06, 0])]);
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  const bats = useMemo(
    () =>
      Array.from({ length: BATS }, (_, i) => ({
        side: SIDES[i % 2],
        r: 1.6 + (i % 3) * 0.9,
        z0: -8 + ((i * 5.3) % 16),
        y: 3 + ((i * 1.7) % 3),
        speed: 0.5 + (i % 4) * 0.12,
        phase: i * 1.9,
      })),
    [],
  );
  const o = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const night = nightFactor(dayTime.t);
    m.visible = night > 0.3;
    if (!m.visible) return;
    const t = clock.elapsedTime;
    bats.forEach((b, i) => {
      const a = t * b.speed + b.phase;
      const s = b.side === 'west' ? -1 : 1;
      o.position.set(s * (BALCONY_OUT + 1 + b.r + Math.cos(a) * b.r * 0.6), b.y + Math.sin(a * 2.3) * 0.4, b.z0 + Math.sin(a) * b.r * 1.6);
      o.rotation.set(0, Math.atan2(-Math.sin(a) * s, Math.cos(a) * 1.6), Math.sin(a * 1.3) * 0.3);
      const flap = Math.abs(Math.sin(t * 14 + b.phase));
      o.scale.set((0.5 + flap * 0.9) * 2, 2, 2);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, paintedToonDouble(), BATS]} frustumCulled={false} />;
}

// ---------- the night outside ----------

/** How loud the outside is where you stand (outsideMix.ts), for the owl and the door. */
function outsideLevel(kind: 'office' | 'lobby') {
  const ear = listenerAt();
  return outsideHearing(kind, ear.x, ear.z, { west: doorOpen('west'), east: doorOpen('east') }).level;
}

/** A distant tawny owl: a long "hoo", a pause, then a wavering "hoo-hoo-hoo". */
export function owl(level = 1) {
  const peak = 0.05 * Math.min(1, Math.max(0.15, level * 1.5));
  const pan = Math.random() * 1.4 - 0.7;
  const o = { name: 'halloween:owl', group: 'outside', pan, type: 'sine' } as const;
  tone({ ...o, freq: 400, to: 360, dur: 0.55, peak, attack: 0.06 });
  [0, 0.28, 0.52].forEach((at, i) => tone({ ...o, at: 1.15 + at, freq: 390 - i * 8, to: 350 - i * 8, dur: 0.24, peak: peak * (0.8 - i * 0.15), attack: 0.04 }));
}

/** An old door creaking open somewhere: a rough, slowly rising and falling groan in short grains. */
export function creak(level = 1) {
  const peak = 0.03 * Math.min(1, Math.max(0.15, level * 1.5));
  const pan = Math.random() * 1.2 - 0.6;
  for (let i = 0; i < 16; i++) {
    const k = i / 15;
    const f = 170 + Math.sin(k * Math.PI) * 110 + Math.random() * 15;
    tone({ name: 'halloween:creak', group: 'outside', pan, type: 'sawtooth', at: i * 0.045, freq: f, to: f * 1.04, dur: 0.05, peak: peak * (0.5 + Math.sin(k * Math.PI) * 0.5), attack: 0.004 });
  }
  noise({ name: 'halloween:creak', group: 'outside', pan, dur: 0.75, peak: peak * 0.3, filter: 'bandpass', freq: 900, to: 1400, q: 3, attack: 0.05 });
}

/** Owls at night and the odd creak, quiet and only as loud as the outside is where you stand. */
function SpookySounds({ kind }: { kind: 'office' | 'lobby' }) {
  useEffect(() => {
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => timers.push(setTimeout(() => alive && fn(), ms));
    const nextOwl = () =>
      later(() => {
        if (!document.hidden && nightFactor(dayTime.t) > 0.4 && !useStore.getState().overlay) owl(outsideLevel(kind));
        nextOwl();
      }, 20_000 + Math.random() * 35_000);
    const nextCreak = () =>
      later(() => {
        if (!document.hidden && !useStore.getState().overlay) creak(outsideLevel(kind));
        nextCreak();
      }, 45_000 + Math.random() * 60_000);
    nextOwl();
    nextCreak();
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, [kind]);
  return null;
}

export default function Halloween({ kind }: ThemeProps) {
  useCostumes();
  const act = useCallback((id: string) => {
    if (id === 'candy') takeCandy();
  }, []);
  useThemeActions(act);
  useEffect(
    () =>
      addProbe({
        candy: () => (takeCandy(), candies),
        candies: () => candies,
        owl: () => owl(1),
        creak: () => creak(1),
      }),
    [],
  );
  if (kind === 'roof')
    return (
      <group>
        <Tint def={DEF} />
        <Bats />
      </group>
    );
  return (
    <group>
      <Decor id="halloween" kind={kind} items={ITEMS} />
      <StringLights kind={kind} colors={DEF.lights!} />
      <Tint def={DEF} />
      <Bats />
      <SpookySounds kind={kind} />
    </group>
  );
}
