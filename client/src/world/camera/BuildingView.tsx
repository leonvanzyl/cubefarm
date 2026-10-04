import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CEO_ID } from '../../../../shared/types';
import { repoOnFloor, useStore } from '../../store';
import { SANS, roundRect } from '../draw';
import { useCanvasTexture } from '../interact';
import { FLOOR_HEIGHT, WALL_H, viewElevation } from '../layout';
import { mix } from '../materials';
import { FACE_HALF_W, FACE_Z } from './cameraMath';
import { CHIP_COLORS, floorSummary, lobbySummary, summaryLine, type ChipKind } from './overviewInfo';
import { hovered, pickables } from './picking';

// The building view: the tower seen from the plaza, every floor's south face covered by its slice of a cross-section:
// the floor's number and project, a figure for everyone in their status colour, and the live summary (busy, in QA,
// needs you). A click on a slice goes there with the elevator's travel, minus the ride. Mounted only while it's up.

const PX = { w: 1024, h: 112 };

interface SliceInfo {
  label: string;
  name: string;
  sub: string;
  color: string;
  line: string;
  chips: ChipKind[];
  alert: boolean;
}

/** One floor's slice as a string, so a slice redraws only when what it shows changes. */
function sliceInfo(f: number, s: ReturnType<typeof useStore.getState>): string {
  if (f === 0) {
    const l = lobbySummary(s.agents[CEO_ID], s.requests);
    const parts = [l.ceo ? `CEO ${l.ceo === 'idle' ? 'free' : l.ceo}` : 'no CEO yet', `${l.waiting} candidate${l.waiting === 1 ? '' : 's'} waiting`];
    if (l.needsYou) parts.push(`${l.needsYou} need${l.needsYou === 1 ? 's' : ''} you`);
    const info: SliceInfo = { label: 'G', name: s.settings.companyName || 'Lobby', sub: 'Lobby', color: '#ff8a5b', line: parts.join(' · '), chips: l.ceo ? [l.ceo] : [], alert: l.needsYou > 0 };
    return JSON.stringify(info);
  }
  const repo = repoOnFloor(s.repos, f);
  if (!repo) return JSON.stringify({ label: String(f), name: 'Empty floor', sub: '', color: '#adb5bd', line: 'nobody here yet', chips: [], alert: false } satisfies SliceInfo);
  const sum = floorSummary(repo, Object.values(s.agents), s.qa);
  const [owner, name] = repo.fullName.split('/');
  const info: SliceInfo = { label: String(f), name: name ?? repo.fullName, sub: owner ?? '', color: repo.color, line: summaryLine(sum), chips: sum.chips, alert: sum.needsYou + sum.errors > 0 };
  return JSON.stringify(info);
}

function drawSlice(ctx: CanvasRenderingContext2D, info: SliceInfo, here: boolean) {
  const { w, h } = PX;
  ctx.clearRect(0, 0, w, h);
  roundRect(ctx, 3, 3, w - 6, h - 6, 18);
  ctx.fillStyle = mix(info.color, '#fffdf6', 0.82);
  ctx.fill();
  ctx.lineWidth = here ? 7 : 4;
  ctx.strokeStyle = here ? info.color : '#1f1d2b';
  ctx.stroke();
  // the floor number
  roundRect(ctx, 14, 14, h - 28, h - 28, 14);
  ctx.fillStyle = info.color;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#1f1d2b';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 46px ${SANS}`;
  ctx.fillText(info.label, h / 2, h / 2 + 2);
  ctx.textAlign = 'left';
  // the project
  const x0 = h + 4;
  ctx.fillStyle = '#1f1d2b';
  ctx.font = `700 34px ${SANS}`;
  let name = info.name;
  while (name.length > 3 && ctx.measureText(name).width > 300) name = `${name.slice(0, -2)}…`;
  ctx.fillText(name, x0, 40);
  ctx.font = `500 22px ${SANS}`;
  ctx.fillStyle = '#5c6078';
  let sub = here ? `📍 you are here${info.sub ? ` · ${info.sub}` : ''}` : info.sub;
  while (sub.length > 3 && ctx.measureText(sub).width > 290) sub = `${sub.slice(0, -2)}…`;
  ctx.fillText(sub, x0, 78);
  // everyone on the floor, in their status colour
  const px = 430;
  const step = 30;
  const max = Math.floor((w - px - 20) / step);
  info.chips.slice(0, max).forEach((c, i) => {
    const cx = px + i * step;
    ctx.beginPath();
    ctx.arc(cx, 30, 10, 0, Math.PI * 2);
    ctx.fillStyle = CHIP_COLORS[c];
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#1f1d2b';
    ctx.stroke();
    roundRect(ctx, cx - 9, 42, 18, 22, 7);
    ctx.fill();
    ctx.stroke();
  });
  // the summary
  ctx.font = `600 26px ${SANS}`;
  ctx.fillStyle = info.alert ? '#c1121f' : '#1f1d2b';
  let line = info.line;
  while (line.length > 3 && ctx.measureText(line).width > w - px - 20) line = `${line.slice(0, -2)}…`;
  ctx.fillText(line, px - 12, 88);
}

const SIZE: [number, number] = [FACE_HALF_W * 2 - 0.3, WALL_H - 0.25];

function Slice({ f, here, y }: { f: number; here: boolean; y: number }) {
  const key = useStore((s) => sliceInfo(f, s));
  const info = JSON.parse(key) as SliceInfo;
  const tex = useCanvasTexture(PX.w, PX.h, (ctx) => drawSlice(ctx, info, here), [key, here]);
  const ref = useRef<THREE.Mesh>(null);
  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    m.userData.pick = { kind: 'floor', floor: f, label: here ? `Look over ${info.name}` : `Go to ${f === 0 ? 'the lobby' : `floor ${f} · ${info.name}`}` };
    pickables.add(m);
    return () => void pickables.delete(m);
  }, [f, here, info.name]);
  return (
    <mesh ref={ref} position={[0, y + WALL_H / 2, FACE_Z]}>
      <planeGeometry args={SIZE} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  );
}

/** Every floor's slice, from the lobby to the top, placed against the floor you're on (y 0; the roof is above them all). */
export function BuildingView() {
  const floor = useStore((s) => s.floor);
  const top = useStore((s) => s.repos.reduce((m, r) => Math.max(m, r.floor), 0));
  const group = useRef<THREE.Group>(null);
  const lit = useRef(-2);
  // the slice under the mouse warms up
  useFrame(() => {
    const g = group.current;
    if (!g || lit.current === hovered.floor) return;
    lit.current = hovered.floor;
    for (const c of g.children) {
      const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
      m.color.set((c.userData.pick as { floor: number } | undefined)?.floor === hovered.floor ? '#ffe9b0' : '#ffffff');
    }
  });
  const floors = Array.from({ length: Math.max(top, floor) + 1 }, (_, f) => f);
  return (
    <group ref={group}>
      {floors.map((f) => (
        <Slice key={f} f={f} here={f === floor} y={f * FLOOR_HEIGHT - viewElevation(floor, top)} />
      ))}
    </group>
  );
}
