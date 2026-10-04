// An office floor's decorations (#210): what the floor bought and placed, drawn from cached toon models (repeats
// such as plants and bean bags as one InstancedMesh each); glowing markers on the free slots while you carry one;
// and the floor's decor box by the elevator, where bought decorations wait.
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { DECOR_SLOTS, stored, type DecorItem, type FloorProgressView } from '../../../../shared/progress';
import type { RepoView } from '../../../../shared/types';
import { useStore } from '../../store';
import { roundRect, SANS } from '../draw';
import { useCanvasTexture, useInteractable } from '../interact';
import { DECOR_BOX } from '../layout';
import { glass, shade } from '../materials';
import { decorName } from './actions';
import { decorSize, openSlots, placement } from './decor';
import * as M from './models';
import { vertexGlow, vertexToon } from './parts';

type Pose = { x: number; y: number; z: number; rotY: number };
const NONE: Record<string, DecorItem> = {};
const REPEATED: DecorItem[] = ['plant', 'fig', 'beanbag'];
const shortName = (repo: RepoView) => repo.fullName.split('/')[1] ?? repo.fullName;

/** One model, once per pose: a single draw call however many there are. */
function InstancedModel({ geometry, at, shadow = true }: { geometry: THREE.BufferGeometry; at: Pose[]; shadow?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    at.forEach((p, i) => {
      o.position.set(p.x, p.y, p.z);
      o.rotation.set(0, p.rotY, 0);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.count = at.length;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [at]);
  return <instancedMesh key={at.length} ref={ref} args={[geometry, vertexToon, Math.max(1, at.length)]} castShadow={shadow} receiveShadow />;
}

/** Plants, figs and bean bags: whichever the floor has, each kind one instanced mesh. */
function Repeated({ placed, accent }: { placed: Record<string, DecorItem>; accent: string }) {
  const groups = useMemo(() => {
    const by = new Map<DecorItem, Pose[]>();
    for (const [slot, item] of Object.entries(placed)) {
      if (!REPEATED.includes(item)) continue;
      const p = placement(slot, item);
      if (p) by.set(item, [...(by.get(item) ?? []), p]);
    }
    return [...by];
  }, [placed]);
  const bag = shade(accent, 0.05);
  return (
    <>
      {groups.map(([item, at]) => (
        <InstancedModel key={item} at={at} geometry={item === 'plant' ? M.plantModel() : item === 'fig' ? M.figModel() : M.beanbagModel(bag)} />
      ))}
    </>
  );
}

// ---------- pictures ----------

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, lines: number) {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width || !line) line = next;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  if (out.length > lines) out.splice(lines - 1, out.length, `${out.slice(lines - 1).join(' ').slice(0, 24)}…`);
  return out;
}

function drawPoster(ctx: CanvasRenderingContext2D, w: number, h: number, item: DecorItem, repo: RepoView, firstPr: FloorProgressView['firstPr']) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (item === 'poster-ship') {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#3a86ff');
    g.addColorStop(1, '#8338ec');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 26; i++) ctx.fillRect((i * 97) % w, (i * 151) % (h * 0.6), 4, 4);
    ctx.font = `${w * 0.36}px ${SANS}`;
    ctx.fillText('🚀', w / 2, h * 0.38);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${w * 0.17}px ${SANS}`;
    ctx.fillText('SHIP IT', w / 2, h * 0.7);
    ctx.font = `500 ${w * 0.06}px ${SANS}`;
    ctx.fillText('merged is better than perfect', w / 2, h * 0.82);
    return;
  }
  if (item === 'poster-repo') {
    ctx.fillStyle = repo.color;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.42, w * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${w * 0.075}px ${SANS}`;
    ctx.fillText(`FLOOR ${repo.floor}`, w / 2, h * 0.16);
    ctx.font = `700 ${w * 0.13}px ${SANS}`;
    wrap(ctx, shortName(repo), w * 0.86, 2).forEach((l, i, all) => ctx.fillText(l, w / 2, h * 0.42 + (i - (all.length - 1) / 2) * w * 0.15));
    ctx.font = `500 ${w * 0.06}px ${SANS}`;
    ctx.fillText(repo.fullName.split('/')[0] ?? '', w / 2, h * 0.68);
    ctx.font = `500 ${w * 0.05}px ${SANS}`;
    wrap(ctx, repo.description || 'built by a team of AI agents', w * 0.84, 2).forEach((l, i) => ctx.fillText(l, w / 2, h * 0.8 + i * w * 0.065));
    return;
  }
  ctx.fillStyle = '#fff3d6';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#e9c46a';
  ctx.lineWidth = w * 0.03;
  ctx.strokeRect(w * 0.05, w * 0.05, w * 0.9, h - w * 0.1);
  ctx.fillStyle = '#9c6644';
  ctx.font = `600 ${w * 0.07}px ${SANS}`;
  ctx.fillText('🏆 FIRST MERGE', w / 2, h * 0.14);
  ctx.fillStyle = '#2d3142';
  ctx.font = `700 ${w * 0.24}px ${SANS}`;
  ctx.fillText(firstPr ? `#${firstPr.n}` : '#?', w / 2, h * 0.36);
  ctx.font = `600 ${w * 0.065}px ${SANS}`;
  wrap(ctx, firstPr?.title || 'The first PR this floor merges goes here', w * 0.8, 4).forEach((l, i) => ctx.fillText(l, w / 2, h * 0.56 + i * w * 0.085));
  ctx.fillStyle = '#9c6644';
  ctx.font = `500 ${w * 0.05}px ${SANS}`;
  ctx.fillText(shortName(repo), w / 2, h * 0.9);
}

function Poster({ item, repo, firstPr }: { item: DecorItem; repo: RepoView; firstPr: FloorProgressView['firstPr'] }) {
  const size = decorSize(item);
  const tex = useCanvasTexture(400, 520, (ctx) => drawPoster(ctx, 400, 520, item, repo, firstPr), [item, repo.color, repo.fullName, repo.floor, repo.description, firstPr?.n, firstPr?.title]);
  return (
    <>
      <mesh geometry={M.frameModel(size.w, size.h)} material={vertexToon} />
      <mesh position={[0, 0, 0.047]}>
        <planeGeometry args={[size.w - 0.1, size.h - 0.1]} />
        <meshToonMaterial map={tex} />
      </mesh>
    </>
  );
}

function Neon({ repo }: { repo: RepoView }) {
  const name = shortName(repo);
  const tex = useCanvasTexture(
    1024,
    300,
    (ctx) => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      roundRect(ctx, 24, 24, 976, 252, 60);
      ctx.strokeStyle = '#ff5d8f';
      ctx.lineWidth = 10;
      ctx.shadowColor = '#ff5d8f';
      ctx.shadowBlur = 28;
      ctx.stroke();
      let size = 150;
      ctx.font = `700 ${size}px ${SANS}`;
      while (size > 40 && ctx.measureText(name).width > 880) ctx.font = `700 ${(size -= 8)}px ${SANS}`;
      ctx.shadowColor = repo.color;
      ctx.shadowBlur = 40;
      ctx.strokeStyle = repo.color;
      ctx.lineWidth = 14;
      ctx.strokeText(name, 512, 154);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.strokeText(name, 512, 154);
    },
    [name, repo.color],
  );
  return (
    <>
      <mesh geometry={M.neonBackModel()} material={vertexToon} />
      <mesh position={[0, 0, 0.034]}>
        <planeGeometry args={[2.06, 0.6]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </>
  );
}

function Arcade({ accent }: { accent: string }) {
  const screen = useCanvasTexture(
    256,
    192,
    (ctx) => {
      ctx.fillStyle = '#10002b';
      ctx.fillRect(0, 0, 256, 192);
      ctx.textAlign = 'center';
      ctx.font = `700 20px monospace`;
      ctx.fillStyle = '#ffd166';
      ctx.fillText('CUBEFARM', 128, 34);
      ctx.font = `700 16px monospace`;
      ['▶ CUBETRIS', '  CABLE SNAKE', '  DESK PET'].forEach((t, i) => {
        ctx.fillStyle = i === 0 ? '#7CFFB2' : '#c77dff';
        ctx.fillText(t, 128, 78 + i * 26);
      });
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 14px monospace`;
      ctx.fillText('PRESS  E', 128, 170);
    },
    [],
  );
  const marquee = useCanvasTexture(
    512,
    128,
    (ctx) => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 78px ${SANS}`;
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#ffffff';
      ctx.fillText('ARCADE', 256, 68);
    },
    [],
  );
  const s = M.ARCADE.screen;
  return (
    <>
      <mesh geometry={M.arcadeModel(accent)} material={vertexToon} castShadow receiveShadow />
      <mesh position={[0, s.y, -0.235]} rotation={[-0.12, 0, 0]}>
        <planeGeometry args={[s.w, s.h]} />
        <meshBasicMaterial map={screen} toneMapped={false} />
      </mesh>
      <mesh position={[0, M.ARCADE.h - 0.11, 0.092]}>
        <planeGeometry args={[0.64, 0.18]} />
        <meshBasicMaterial map={marquee} transparent toneMapped={false} />
      </mesh>
    </>
  );
}

const FISH_COLORS = ['#ff8c42', '#ffd166', '#4cc9f0', '#f15bb5'];

function FishTank() {
  const fish = useRef<THREE.InstancedMesh>(null);
  const here = useRef<THREE.Group>(null);
  const { w, d, standH, tankH } = M.TANK;
  const sim = useMemo(() => ({ o: new THREE.Object3D(), at: new THREE.Vector3(), cam: new THREE.Vector3() }), []);
  useLayoutEffect(() => {
    const m = fish.current;
    if (!m) return;
    FISH_COLORS.forEach((c, i) => m.setColorAt(i, new THREE.Color(c)));
    m.instanceColor!.needsUpdate = true;
  }, []);
  useFrame(({ camera, clock }) => {
    const m = fish.current;
    if (!m || !here.current) return;
    here.current.getWorldPosition(sim.at);
    if (sim.at.distanceTo(camera.getWorldPosition(sim.cam)) > 14) return; // nobody close enough to watch them swim
    const t = clock.elapsedTime;
    for (let i = 0; i < FISH_COLORS.length; i++) {
      // a figure of eight round the tank, each fish at its own pace and depth
      const k = t * (0.35 + i * 0.07) + i * 1.7;
      const ax = w / 2 - 0.15;
      const az = (d / 2 - 0.12) * 0.8;
      const x = Math.sin(k) * ax;
      const z = Math.sin(2 * k) * az;
      const dx = Math.cos(k) * ax;
      const dz = 2 * Math.cos(2 * k) * az;
      sim.o.position.set(x, standH + 0.2 + (i / FISH_COLORS.length) * (tankH - 0.32) + Math.sin(t * 1.3 + i) * 0.03, z);
      sim.o.rotation.set(0, Math.atan2(-dz, dx), Math.sin(t * 6 + i) * 0.08);
      sim.o.updateMatrix();
      m.setMatrixAt(i, sim.o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <group ref={here}>
      <mesh geometry={M.tankBaseModel()} material={vertexToon} castShadow receiveShadow />
      <instancedMesh ref={fish} args={[M.fishModel(), vertexToon, FISH_COLORS.length]} frustumCulled={false} />
      <mesh position={[0, standH + 0.05 + (tankH - 0.1) / 2, 0]}>
        <boxGeometry args={[w - 0.04, tankH - 0.1, d - 0.04]} />
        <meshBasicMaterial color="#4cc9f0" transparent opacity={0.18} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={[0, standH + tankH / 2, 0]} material={glass}>
        <boxGeometry args={[w, tankH, d]} />
      </mesh>
    </group>
  );
}

function ItemLook({ item, slot, repo, floor }: { item: DecorItem; slot: string; repo: RepoView; floor: FloorProgressView | undefined }) {
  switch (item) {
    case 'poster-ship':
    case 'poster-repo':
    case 'poster-pr':
      return <Poster item={item} repo={repo} firstPr={floor?.firstPr ?? null} />;
    case 'neon':
      return <Neon repo={repo} />;
    case 'lights':
      return (
        <>
          <mesh geometry={M.lightsWireModel()} material={vertexToon} />
          <mesh geometry={M.lightsBulbModel()} material={vertexGlow} />
        </>
      );
    case 'fishtank':
      return <FishTank />;
    case 'pingpong':
      return <mesh geometry={M.pingpongModel()} material={vertexToon} castShadow receiveShadow />;
    case 'arcade':
      return <Arcade accent={repo.color} />;
    case 'rug': {
      const s = decorSize('rug', slot);
      return <mesh geometry={M.rugModel(s.w, s.d, shade(repo.color, 0.12))} material={vertexToon} receiveShadow />;
    }
    default:
      return null; // drawn by Repeated
  }
}

/** One placed decoration: its look (unless it's a repeated one) and, with empty hands, what E does with it. */
const Placed = memo(function Placed({ slot, item, repo, floor, carrying }: { slot: string; item: DecorItem; repo: RepoView; floor: FloorProgressView | undefined; carrying: boolean }) {
  const p = placement(slot, item);
  const size = decorSize(item, slot);
  const wall = DECOR_SLOTS.find((d) => d.id === slot)?.kind === 'wall';
  const name = decorName(item).toLowerCase();
  const ref = useInteractable<THREE.Group>(
    carrying
      ? null
      : item === 'arcade'
        ? { id: `decor:${slot}`, label: "Play the arcade (your phone's games) · move it from the 📦 decor box", action: { kind: 'decoration', op: 'arcade', slot } }
        : { id: `decor:${slot}`, label: `Pick up the ${name} to move it`, action: { kind: 'decoration', op: 'take', slot } },
    4.5,
  );
  if (!p) return null;
  const hit = item === 'rug' ? { h: 0.05, y: 0.025 } : wall ? { h: size.h, y: 0 } : { h: size.h, y: size.h / 2 };
  return (
    <group position={[p.x, p.y, p.z]} rotation={[0, p.rotY, 0]}>
      <ItemLook item={item} slot={slot} repo={repo} floor={floor} />
      <group ref={ref}>
        <mesh position={[0, hit.y, wall ? 0.05 : 0]} visible={false}>
          <boxGeometry args={[size.w, hit.h, wall ? 0.1 : size.d]} />
        </mesh>
      </group>
    </group>
  );
});

// ---------- carrying one ----------

const markerMat = new THREE.MeshBasicMaterial({ color: '#7CFFB2', transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false });

function Marker({ slot, item, back }: { slot: string; item: DecorItem; back: boolean }) {
  const p = placement(slot, item)!;
  const size = decorSize(item, slot);
  const kind = DECOR_SLOTS.find((d) => d.id === slot)?.kind;
  const name = decorName(item).toLowerCase();
  const ref = useInteractable<THREE.Mesh>({ id: `slot:${slot}`, label: back ? `Put the ${name} back here` : `Place the ${name} here`, action: { kind: 'decoration', op: 'place', slot } }, 7);
  const h = kind === 'wall' ? size.h : kind === 'rug' ? 0.12 : Math.max(0.3, size.h);
  return (
    <group position={[p.x, p.y, p.z]} rotation={[0, p.rotY, 0]}>
      <mesh ref={ref} position={[0, kind === 'wall' ? 0 : h / 2, kind === 'wall' ? 0.04 : 0]} material={markerMat}>
        <boxGeometry args={[size.w, h, kind === 'wall' ? 0.06 : size.d]} />
      </mesh>
    </group>
  );
}

function Markers({ item, placed, from }: { item: DecorItem; placed: Record<string, DecorItem>; from: string | null }) {
  const slots = useMemo(() => openSlots(item, placed, from), [item, placed, from]);
  useFrame(({ clock }) => {
    markerMat.opacity = 0.22 + 0.16 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 4));
  });
  return (
    <>
      {slots.map((slot) => (
        <Marker key={slot} slot={slot} item={item} back={slot === from} />
      ))}
    </>
  );
}

// ---------- the decor box ----------

function DecorBox({ repo, floor, carrying }: { repo: RepoView; floor: FloorProgressView | undefined; carrying: DecorItem | null }) {
  const inside = floor ? Object.keys(floor.owned).reduce((n, item) => n + stored(floor, item as DecorItem), 0) : 0;
  const ref = useInteractable<THREE.Group>(
    { id: `decor-box:${repo.id}`, label: carrying ? `Put the ${decorName(carrying).toLowerCase()} back in the decor box` : `Open the decor box (${inside} inside) · buy more at the lobby kiosk`, action: { kind: 'decoration', op: 'box' } },
    3.5,
  );
  const tex = useCanvasTexture(
    384,
    192,
    (ctx) => {
      ctx.fillStyle = '#c9a46a';
      ctx.fillRect(0, 0, 384, 192);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#5c3d2e';
      ctx.font = `700 64px ${SANS}`;
      ctx.fillText('📦 DECOR', 192, 76);
      ctx.font = `600 34px ${SANS}`;
      ctx.fillText(inside ? `${inside} inside` : 'empty', 192, 146);
    },
    [inside],
  );
  return (
    // against the south wall, its label facing north into the room
    <group ref={ref} position={[DECOR_BOX.x, 0, DECOR_BOX.z]} rotation={[0, Math.PI, 0]}>
      <mesh geometry={M.decorBoxModel()} material={vertexToon} castShadow receiveShadow />
      <mesh position={[0, 0.28, 0.278]}>
        <planeGeometry args={[0.6, 0.3]} />
        <meshToonMaterial map={tex} />
      </mesh>
    </group>
  );
}

export function Decorations({ repo }: { repo: RepoView }) {
  const floor = useStore((s) => s.progress.floors[repo.id]);
  const placed = floor?.placed ?? NONE;
  const held = useStore((s) => (s.held?.kind === 'decor' ? s.held : null));
  // While a placed decoration is in your hands its slot stands empty (the server still has it there until you put it down).
  const shown = useMemo(() => {
    if (!held?.from) return placed;
    const { [held.from]: _carried, ...rest } = placed;
    return rest;
  }, [placed, held]);
  return (
    <group>
      <DecorBox repo={repo} floor={floor} carrying={held?.item ?? null} />
      <Repeated placed={shown} accent={repo.color} />
      {Object.entries(shown).map(([slot, item]) => (
        <Placed key={slot} slot={slot} item={item} repo={repo} floor={floor} carrying={!!held} />
      ))}
      {held && <Markers item={held.item} placed={placed} from={held.from} />}
    </group>
  );
}
