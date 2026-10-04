import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { floorPrCounts, useStore } from '../../store';
import { roundRect, SANS } from '../draw';
import { useCanvasTexture } from '../interact';
import { TELESCOPE, roofElevation } from '../layout';
import { cityLayout, type CityLayout } from '../outside/cityLayout';
import { merged } from '../shapes';
import { BOARD, billboardSpots, boardTexts, type BoardText, type OfficeNumbers } from './billboardLayout';
import { useRoofReport } from './roofOps';
import { aimAt } from './stargazing';

// The billboards on the rooftops round the office (billboardLayout.ts: where they stand and what they say), with the office's
// own numbers on them: the team at work, PRs merged, the open issues and the company's slogan. Mounted with the roof
// only, they're a smudge of colour to the naked eye and readable through the telescope. Two draw calls: the four faces
// share one canvas, and their frames and legs are one mesh. Like the city they're lit by themselves, not the office.

const CELL = { w: 1024, h: 512 };
const FACE_H = Math.round((CELL.w * BOARD.h) / BOARD.w); // the face's height in its cell, at the board's aspect

let layout: CityLayout | null = null;
const city = () => (layout ??= cityLayout());

/** Board k in its cell of the canvas: a coloured panel, a ring of bulbs, the small line, the big one and the line under. */
function drawBoard(ctx: CanvasRenderingContext2D, k: number, b: BoardText) {
  const x = (k % 2) * CELL.w;
  const y = Math.floor(k / 2) * CELL.h;
  const w = CELL.w;
  const h = FACE_H;
  ctx.fillStyle = '#2b2d42';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = b.bg;
  roundRect(ctx, x + 14, y + 14, w - 28, h - 28, 26);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  for (let i = 0; i < 24; i++) {
    const u = (i + 0.5) / 24;
    for (const by of [y + 30, y + h - 30]) {
      ctx.beginPath();
      ctx.arc(x + 40 + u * (w - 80), by, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = b.fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 54px ${SANS}`;
  ctx.fillText(b.top, x + w / 2, y + 92, w - 120);
  ctx.font = `800 176px ${SANS}`;
  ctx.fillText(b.big, x + w / 2, y + h / 2 + 18, w - 120);
  ctx.font = `600 46px ${SANS}`;
  ctx.fillText(b.under, x + w / 2, y + h - 82, w - 120);
}

/** The office's numbers, as the lobby's boards count them. */
function useOfficeNumbers(): OfficeNumbers {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const qa = useStore((s) => s.qa);
  const company = useStore((s) => s.settings.companyName);
  return useMemo(() => {
    const list = Object.values(agents).filter((a) => a.role !== 'ceo');
    return {
      company,
      floors: repos.length,
      agents: list.length,
      working: list.filter((a) => a.status === 'working' || a.status === 'preparing').length,
      issues: repos.reduce((n, r) => n + r.issues.length, 0),
      openPrs: repos.reduce((n, r) => n + r.pulls.filter((p) => p.state === 'OPEN').length, 0),
      inQa: repos.reduce((n, r) => n + floorPrCounts(r, qa).inQa, 0),
      merged: repos.reduce((n, r) => n + r.pulls.filter((p) => p.state === 'MERGED').length, 0),
    };
  }, [repos, agents, qa, company]);
}

/** Where the faces' corners land on the shared canvas (its v runs up from the bottom). */
function faceUv(k: number) {
  const u0 = (k % 2) * 0.5;
  const top = 1 - Math.floor(k / 2) * 0.5;
  return { u0, u1: u0 + 0.5, v1: top, v0: top - FACE_H / (CELL.h * 2) };
}

export function Billboards({ top }: { top: number }) {
  const elevation = roofElevation(top);
  const spots = useMemo(() => billboardSpots(city(), { x: TELESCOPE.x, y: elevation + TELESCOPE.eye, z: TELESCOPE.z }), [elevation]);
  const numbers = useOfficeNumbers();
  const texts = useMemo(() => boardTexts(numbers), [numbers]);
  const key = JSON.stringify(texts);
  const atlas = useCanvasTexture(CELL.w * 2, CELL.h * 2, (ctx) => texts.forEach((b, k) => drawBoard(ctx, k, b)), [key]);
  const geo = useMemo(() => {
    const faces: THREE.BufferGeometry[] = [];
    const frames: THREE.BufferGeometry[] = [];
    spots.forEach((s, k) => {
      const place = (g: THREE.BufferGeometry, lx: number, ly: number, lz: number) => g.translate(lx, ly, lz).rotateY(s.yaw).translate(s.x, s.y, s.z);
      const face = new THREE.PlaneGeometry(BOARD.w, BOARD.h);
      const { u0, u1, v0, v1 } = faceUv(k % 4);
      const uv = face.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
      faces.push(place(face, 0, 0, 0.2)); // well clear of the frame: from a hundred metres away, closer would flicker
      frames.push(place(new THREE.BoxGeometry(BOARD.w + 0.4, BOARD.h + 0.4, 0.15), 0, 0, 0));
      frames.push(place(new THREE.BoxGeometry(BOARD.w, 0.12, 0.9), 0, -BOARD.h / 2 - 0.1, 0.5)); // the catwalk
      const legH = s.y - BOARD.h / 2 - s.top;
      for (const lx of [-BOARD.w / 3, BOARD.w / 3]) frames.push(place(new THREE.BoxGeometry(0.3, legH, 0.3), lx, -BOARD.h / 2 - legH / 2, -0.1));
    });
    return { faces: merged(faces), frames: merged(frames) };
  }, [spots]);
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);
  const mats = useMemo(
    () => ({
      face: new THREE.MeshBasicMaterial({ map: atlas, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      frame: new THREE.MeshBasicMaterial({ color: '#3d405b', fog: false }),
    }),
    [atlas],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  // where they are, what they say, and which way to aim the telescope at each (for __swarmRoof.aim)
  useRoofReport('billboards', () =>
    spots.map((s, k) => {
      const d = { x: s.x - TELESCOPE.x, y: s.y - elevation - TELESCOPE.eye, z: s.z - TELESCOPE.z };
      const l = Math.hypot(d.x, d.y, d.z);
      return { x: Math.round(s.x), z: Math.round(s.z), dist: Math.round(s.dist), says: `${texts[k % 4].top}: ${texts[k % 4].big}`, ...aimAt([d.x / l, d.y / l, d.z / l]) };
    }),
  );

  return (
    <group position={[0, -elevation - 0.03, 0]}>
      <mesh geometry={geo.frames} material={mats.frame} />
      <mesh geometry={geo.faces} material={mats.face} />
    </group>
  );
}
