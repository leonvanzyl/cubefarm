// Desks that tell a story (#226): a plaque for each merged PR on a plank on top of the monitor (eight and a "+N"), a
// gold star for ten first-time QA passes, and the personal things that pile up with tenure: a plant that grows, a
// photo, a desk toy. Drawn per floor rather than per desk, one InstancedMesh per kind of thing plus one mesh for every
// label (PR numbers, photos) from a shared canvas atlas, so a floor of fully decorated desks costs about a dozen draw
// calls. The MVP of the week gets a strip above the floor's sign.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { deskItems, mvpOfWeek, newCareer, type DeskToy } from '../../../../shared/careers';
import type { Agent } from '../../store';
import { roundRect, SANS } from '../draw';
import { useCanvasTexture } from '../interact';
import { HALF_D, deskPosition, deskRotation } from '../layout';
import { ball, box, cone, cyl, model, ramp, torus, vertexToon, type Part } from '../decor/parts';
import { deskLayout, PLAQUE, SHELF, type Spot } from './deskLayout';

/** Re-render every `ms` (the plants grow, the week moves on). */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// ---------- models ----------

const shelfModel = () => model('story-shelf', () => [box(SHELF.w, SHELF.h, SHELF.d, '#8d5a3b'), box(0.03, 0.03, 0.02, '#6f4530', [-0.4, -0.02, -0.03]), box(0.03, 0.03, 0.02, '#6f4530', [0.4, -0.02, -0.03])]);
const plaqueModel = () => model('story-plaque', () => [box(PLAQUE.w, PLAQUE.h, PLAQUE.d, '#5c3d2e'), box(PLAQUE.w + 0.01, 0.012, PLAQUE.d + 0.012, '#3d2a20', [0, -PLAQUE.h / 2 + 0.004, 0])]);

function starGeometry() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.017 : 0.04;
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false }).translate(0, 0, -0.006);
}
const starModel = () => model('story-star', () => [{ geo: starGeometry(), color: '#ffd43b' }, cyl(0.006, 0.006, 0.03, '#e9c46a', [0, -0.045, 0]), cyl(0.02, 0.02, 0.006, '#e9c46a', [0, -0.058, 0])]);

const potModel = () => model('story-pot', () => [cyl(0.07, 0.06, 0.09, '#e07a5f', [0, 0.045, 0]), cyl(0.066, 0.066, 0.01, '#6f4530', [0, 0.088, 0])]);
// The plant above its pot, scaled as it grows.
const foliageModel = () =>
  model('story-foliage', () => [cyl(0.008, 0.01, 0.06, '#40916c', [0, 0.03, 0]), ball(0.075, '#52b788', [0, 0.08, 0]), ball(0.05, '#40916c', [0.05, 0.12, 0.02]), ball(0.045, '#74c69d', [-0.045, 0.13, -0.01]), ball(0.035, '#52b788', [0, 0.17, 0])]);

const PHOTO = { w: 0.11, h: 0.14 };
const frameModel = () => model('story-frame', () => [box(PHOTO.w, PHOTO.h, 0.012, '#2b2d42', [0, PHOTO.h / 2 + 0.005, 0]), box(0.012, 0.11, 0.012, '#2b2d42', [0, 0.055, -0.04], [0.5, 0, 0])]);

const TOYS: Record<DeskToy, () => THREE.BufferGeometry> = {
  duck: () =>
    model('toy-duck', () => [
      ball(0.05, '#ffd166', [0, 0.042, 0], [1.25, 0.85, 1]),
      ball(0.033, '#ffd166', [0.035, 0.1, 0]),
      cone(0.016, 0.03, '#f77f00', [0.077, 0.098, 0], [0, 0, -Math.PI / 2], 8),
      ball(0.006, '#1f1d2b', [0.055, 0.112, 0.02], undefined, 6),
      ball(0.006, '#1f1d2b', [0.055, 0.112, -0.02], undefined, 6),
      cone(0.02, 0.03, '#ffd166', [-0.065, 0.06, 0], [0, 0, Math.PI / 3], 8),
    ]),
  speaker: () =>
    model('toy-speaker', () => [
      box(0.08, 0.12, 0.07, '#2b2d42', [0, 0.06, 0]),
      cyl(0.026, 0.026, 0.006, '#adb5bd', [0, 0.045, 0.036], [Math.PI / 2, 0, 0]),
      torus(0.026, 0.004, '#495057', [0, 0.045, 0.037]),
      cyl(0.011, 0.011, 0.006, '#e9ecef', [0, 0.095, 0.036], [Math.PI / 2, 0, 0]),
    ]),
  cradle: () =>
    model('toy-cradle', () => {
      const parts: Part[] = [box(0.16, 0.012, 0.08, '#2b2d42', [0, 0.006, 0])];
      for (const z of [-0.03, 0.03]) for (const x of [-0.07, 0.07]) parts.push(cyl(0.003, 0.003, 0.11, '#adb5bd', [x, 0.06, z]));
      for (const z of [-0.03, 0.03]) parts.push(cyl(0.003, 0.003, 0.14, '#adb5bd', [0, 0.115, z], [0, 0, Math.PI / 2]));
      for (let i = 0; i < 5; i++) {
        const x = -0.04 + i * 0.02;
        parts.push(cyl(0.001, 0.001, 0.07, '#ced4da', [x, 0.08, 0]), ball(0.0098, '#dee2e6', [x, 0.04, 0], undefined, 8));
      }
      return parts;
    }),
  magnifier: () =>
    model('toy-magnifier', () => [
      torus(0.04, 0.007, '#2b2d42', [0, 0.008, 0], [Math.PI / 2, 0, 0]),
      cyl(0.036, 0.036, 0.004, '#bde0fe', [0, 0.008, 0]),
      cyl(0.008, 0.009, 0.08, '#8d5a3b', [0.08, 0.008, 0], [0, 0, Math.PI / 2]),
    ]),
};

// ---------- the label atlas ----------

const CELL = 64;
const COLS = 16; // a 1024 x 1024 canvas: 256 labels a floor
const PHOTOS = 4;

type Label = { kind: 'plaque'; n: number } | { kind: 'more'; n: number } | { kind: 'photo'; i: number };
const labelKey = (l: Label) => (l.kind === 'photo' ? `photo:${l.i}` : `${l.kind}:${l.n}`);

function drawLabel(ctx: CanvasRenderingContext2D, l: Label, x: number, y: number) {
  const c = CELL;
  ctx.save();
  ctx.translate(x, y);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (l.kind === 'plaque' || l.kind === 'more') {
    const g = ctx.createLinearGradient(0, 0, c, c);
    g.addColorStop(0, '#ffe8a3');
    g.addColorStop(1, '#e9b949');
    ctx.fillStyle = g;
    ctx.fillRect(2, 2, c - 4, c - 4);
    ctx.strokeStyle = '#8a6116';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, c - 8, c - 8);
    const text = l.kind === 'more' ? `+${l.n}` : `#${l.n}`;
    let size = 28;
    ctx.font = `700 ${size}px ${SANS}`;
    while (size > 12 && ctx.measureText(text).width > c - 12) ctx.font = `700 ${(size -= 2)}px ${SANS}`;
    ctx.fillStyle = '#4a3410';
    ctx.fillText(text, c / 2, c / 2 + 2);
  } else {
    // a few tiny snapshots: a sunset, a heart, a cat, the mountains
    const scenes = [
      ['#ffb703', '#fb8500', '🌅'],
      ['#ffc8dd', '#ff8fab', '💖'],
      ['#caf0f8', '#90e0ef', '🐱'],
      ['#b7e4c7', '#74c69d', '🏔️'],
    ][l.i % PHOTOS];
    const g = ctx.createLinearGradient(0, 0, 0, c);
    g.addColorStop(0, scenes[0]);
    g.addColorStop(1, scenes[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c, c);
    ctx.font = `34px ${SANS}`;
    ctx.fillText(scenes[2], c / 2, c / 2 + 3);
  }
  ctx.restore();
}

// ---------- building a floor's story ----------

interface Story {
  shelves: THREE.Matrix4[];
  plaques: THREE.Matrix4[];
  stars: THREE.Matrix4[];
  pots: THREE.Matrix4[];
  foliage: THREE.Matrix4[];
  frames: THREE.Matrix4[];
  toys: Record<DeskToy, THREE.Matrix4[]>;
  labels: { label: Label; m: THREE.Matrix4; w: number; h: number }[];
}

const at = (frame: THREE.Matrix4, s: Spot, extra?: THREE.Matrix4) => {
  const m = frame.clone().multiply(new THREE.Matrix4().makeRotationY(s.rotY ?? 0).setPosition(s.x, s.y, s.z));
  return extra ? m.multiply(extra) : m;
};
const offset = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);

function idHash(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function buildStory(agents: Agent[], now: number): Story {
  const story: Story = { shelves: [], plaques: [], stars: [], pots: [], foliage: [], frames: [], toys: { duck: [], speaker: [], cradle: [], magnifier: [] }, labels: [] };
  for (const a of agents) {
    if (a.role === 'ceo') continue;
    const p = deskPosition(a.desk);
    const frame = new THREE.Matrix4().makeRotationY(deskRotation(a.desk)).setPosition(p.x, 0, p.z);
    const lay = deskLayout(deskItems(a.career ?? newCareer(now), a.id, now));
    if (lay.shelf) story.shelves.push(at(frame, { x: 0, y: SHELF.y, z: SHELF.z }));
    for (const { n, at: s } of lay.plaques) {
      story.plaques.push(at(frame, s));
      story.labels.push({ label: { kind: 'plaque', n }, m: at(frame, s, offset(0, 0.003, PLAQUE.d / 2 + 0.001)), w: PLAQUE.w - 0.01, h: PLAQUE.h - 0.016 });
    }
    if (lay.more) {
      story.plaques.push(at(frame, lay.more.at));
      story.labels.push({ label: { kind: 'more', n: lay.more.n }, m: at(frame, lay.more.at, offset(0, 0.003, PLAQUE.d / 2 + 0.001)), w: PLAQUE.w - 0.01, h: PLAQUE.h - 0.016 });
    }
    if (lay.star) story.stars.push(at(frame, lay.star));
    story.pots.push(at(frame, lay.plant.at));
    story.foliage.push(at(frame, lay.plant.at, offset(0, 0.09, 0).multiply(new THREE.Matrix4().makeScale(lay.plant.grow, lay.plant.grow, lay.plant.grow))));
    if (lay.photo) {
      story.frames.push(at(frame, lay.photo));
      story.labels.push({ label: { kind: 'photo', i: idHash(a.id) % PHOTOS }, m: at(frame, lay.photo, offset(0, PHOTO.h / 2 + 0.005, 0.0065)), w: PHOTO.w - 0.02, h: PHOTO.h - 0.02 });
    }
    if (lay.toy) story.toys[lay.toy.kind].push(at(frame, lay.toy.at));
  }
  return story;
}

/** Every label as one mesh: a quad each, its UVs pointing into its atlas cell. */
function labelGeometry(labels: Story['labels'], cells: Map<string, number>) {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const inset = 0.5 / (CELL * COLS);
  labels.forEach(({ label, m, w, h }, k) => {
    const cell = cells.get(labelKey(label)) ?? 0;
    const cx = cell % COLS;
    const cy = Math.floor(cell / COLS);
    const [u0, u1] = [cx / COLS + inset, (cx + 1) / COLS - inset];
    const [v0, v1] = [1 - (cy + 1) / COLS + inset, 1 - cy / COLS - inset];
    const corners: [number, number, number, number][] = [
      [-w / 2, -h / 2, u0, v0],
      [w / 2, -h / 2, u1, v0],
      [w / 2, h / 2, u1, v1],
      [-w / 2, h / 2, u0, v1],
    ];
    n.set(0, 0, 1).transformDirection(m);
    for (const [x, y, u, vv] of corners) {
      v.set(x, y, 0).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
      nor.push(n.x, n.y, n.z);
      uv.push(u, vv);
    }
    const b = k * 4;
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

function Instances({ geometry, matrices, shadow = false }: { geometry: THREE.BufferGeometry; matrices: THREE.Matrix4[]; shadow?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    matrices.forEach((x, i) => m.setMatrixAt(i, x));
    m.count = matrices.length;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [matrices]);
  if (!matrices.length) return null;
  return <instancedMesh key={matrices.length} ref={ref} args={[geometry, vertexToon, matrices.length]} castShadow={shadow} receiveShadow />;
}

/** What a floor's desk story depends on: who sits where, and the parts of their careers the desks show. */
function storyKey(agents: Agent[]) {
  return agents
    .filter((a) => a.role !== 'ceo')
    .map((a) => {
      const c = a.career;
      return `${a.id}:${a.desk}:${c ? `${c.since}:${c.merged}:${c.reviews}:${c.firstPass}:${c.recent.map((r) => r.n).join('.')}` : '-'}`;
    })
    .join('|');
}

export function DeskStory({ agents }: { agents: Agent[] }) {
  const now = useNow(60_000);
  const key = storyKey(agents);
  // Only rebuilt when a career moves on (or an hour passes), not on every keystroke at the desks.
  const hour = Math.floor(now / 3_600_000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const story = useMemo(() => buildStory(agents, Date.now()), [key, hour]);
  const atlas = useMemo(() => {
    const cells = new Map<string, number>();
    for (const { label } of story.labels) if (!cells.has(labelKey(label)) && cells.size < COLS * COLS) cells.set(labelKey(label), cells.size);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = CELL * COLS;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const paint = () => {
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const { label } of story.labels) {
        const cell = cells.get(labelKey(label));
        if (cell !== undefined) drawLabel(ctx, label, (cell % COLS) * CELL, Math.floor(cell / COLS) * CELL);
      }
      tex.needsUpdate = true;
    };
    paint();
    document.fonts?.ready.then(paint);
    return { cells, tex, material: new THREE.MeshToonMaterial({ map: tex, gradientMap: ramp, transparent: true, alphaTest: 0.1 }) };
  }, [story]);
  const labels = useMemo(() => labelGeometry(story.labels, atlas.cells), [story, atlas]);
  useEffect(
    () => () => {
      atlas.tex.dispose();
      atlas.material.dispose();
    },
    [atlas],
  );
  useEffect(() => () => labels.dispose(), [labels]);

  return (
    <group>
      <Instances geometry={shelfModel()} matrices={story.shelves} />
      <Instances geometry={plaqueModel()} matrices={story.plaques} />
      <Instances geometry={starModel()} matrices={story.stars} />
      <Instances geometry={potModel()} matrices={story.pots} shadow />
      <Instances geometry={foliageModel()} matrices={story.foliage} shadow />
      <Instances geometry={frameModel()} matrices={story.frames} />
      {(Object.keys(story.toys) as DeskToy[]).map((kind) => (
        <Instances key={kind} geometry={TOYS[kind]()} matrices={story.toys[kind]} />
      ))}
      {story.labels.length > 0 && <mesh geometry={labels} material={atlas.material} />}
    </group>
  );
}

/** "MVP of the week" on a strip above the floor's team sign: the most merges in the last seven days. */
export function MvpSign({ agents }: { agents: Agent[] }) {
  const now = useNow(10 * 60_000);
  const mvp = mvpOfWeek(agents, now);
  const text = mvp ? `🏅 MVP of the week: ${mvp.who.name} · ${mvp.merges} merge${mvp.merges === 1 ? '' : 's'}` : '🏅 MVP of the week: still up for grabs';
  const tex = useCanvasTexture(
    1024,
    104,
    (ctx) => {
      roundRect(ctx, 0, 0, 1024, 104, 26);
      ctx.fillStyle = mvp ? '#ffd166' : '#e9ecef';
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#2d3142';
      ctx.font = `700 52px ${SANS}`;
      ctx.fillText(text, 512, 56);
    },
    [text, !!mvp],
  );
  return (
    <mesh position={[4.6, 2.88, HALF_D - 0.03]} rotation={[0, Math.PI, 0]}>
      <planeGeometry args={[4.2, 0.43]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} />
    </mesh>
  );
}
