import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { TickerItem } from '../../../shared/types';
import { useStore } from '../store';
import { reportTicker } from './activityProbe';
import { SANS } from './draw';
import { BOARD, WALL_H } from './layout';
import { Box } from './Toon';

// The floor's activity ticker: a thin LED strip hung from the ceiling across the top of the whiteboard, scrolling what
// just happened here ("Ken opened PR #212 ◆ Marple passed PR #205 ◆ CI red on #198 ◆ #204 merged 🎉"). The server
// writes the lines (server/ticker.ts). The tape is painted onto a canvas only when a new line arrives; scrolling
// slides the texture along, so a frame paints nothing.

const STRIP = { w: BOARD.w + 0.24, h: 0.18, y: WALL_H - 0.135, z: BOARD.z + 0.2 };
const PX = 48; // the tape's height in pixels
const VISIBLE_PX = Math.round((PX * STRIP.w) / STRIP.h); // how much of the tape the strip shows at once
const MAX_PX = 8192; // the widest tape (WebGL's texture limit on modest GPUs)
const SPEED = 0.42; // metres a second
const SHOWN = 8; // the newest lines on the tape
const SEP = '   ◆   ';
const TONE: Record<TickerItem['tone'], string> = { good: '#7dffa0', bad: '#ff7a68', info: '#ffc75f' };
const QUIET = 'floor news scrolls here ◆ PRs, QA, CI and merges';

/** Paints the lines (oldest first) onto a tape at least as long as the strip; returns its canvas. */
function paintTape(lines: Pick<TickerItem, 'text' | 'tone'>[]) {
  const canvas = document.createElement('canvas');
  let ctx = canvas.getContext('2d')!;
  const font = `600 ${Math.round(PX * 0.62)}px ${SANS}`;
  ctx.font = font;
  const shown = lines.length ? lines : [{ text: QUIET, tone: 'info' as const }];
  const sep = ctx.measureText(SEP).width;
  let parts = shown.map((l) => ({ ...l, w: ctx.measureText(l.text).width }));
  while (parts.length > 1 && parts.reduce((s, p) => s + p.w + sep, 0) > MAX_PX) parts = parts.slice(1);
  canvas.width = Math.min(MAX_PX, Math.ceil(Math.max(VISIBLE_PX, parts.reduce((s, p) => s + p.w + sep, 0))));
  canvas.height = PX;
  ctx = canvas.getContext('2d')!; // resizing reset it
  ctx.fillStyle = '#15110d';
  ctx.fillRect(0, 0, canvas.width, PX);
  ctx.font = font;
  ctx.textBaseline = 'middle';
  let x = sep / 2;
  for (const p of parts) {
    ctx.shadowColor = TONE[p.tone];
    ctx.shadowBlur = 10;
    ctx.fillStyle = TONE[p.tone];
    ctx.fillText(p.text, x, PX / 2 + 1);
    x += p.w;
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,199,95,0.45)';
    ctx.fillText(SEP, x, PX / 2 + 1);
    x += sep;
  }
  // the LED matrix: dark lines between the dots
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(12,9,6,0.6)';
  for (let i = 0; i < canvas.width; i += 3) ctx.fillRect(i, 0, 1, PX);
  for (let j = 0; j < PX; j += 3) ctx.fillRect(0, j, canvas.width, 1);
  return canvas;
}

export function ActivityTicker({ repoId }: { repoId: string }) {
  const all = useStore((s) => s.ticker);
  const lines = useMemo(() => all.filter((t) => t.repoId === repoId).slice(-SHOWN), [all, repoId]);
  // Only a new line (or one dropping off) repaints the tape.
  const signature = lines.map((l) => l.id).join(',');
  const material = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  const scroll = useRef<{ tex: THREE.CanvasTexture; perSecond: number } | null>(null);

  useEffect(() => {
    const paint = () => {
      const canvas = paintTape(lines);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.anisotropy = 8;
      tex.repeat.x = VISIBLE_PX / canvas.width;
      // carry on from the same spot on the tape, so the text in view doesn't jump
      const old = scroll.current?.tex;
      tex.offset.x = old ? ((old.offset.x * (old.image as HTMLCanvasElement).width) / canvas.width) % 1 : 0;
      old?.dispose();
      scroll.current = { tex, perSecond: (SPEED * PX) / STRIP.h / canvas.width };
      material.map = tex;
      material.needsUpdate = true;
      reportTicker(lines.map((l) => l.text));
    };
    paint();
    // the web font may arrive after the first paint
    let alive = true;
    if (document.fonts && document.fonts.status !== 'loaded') void document.fonts.ready.then(() => alive && paint());
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, material]);
  useEffect(
    () => () => {
      scroll.current?.tex.dispose();
      material.dispose();
    },
    [material],
  );

  useFrame((_, delta) => {
    const s = scroll.current;
    if (s) s.tex.offset.x = (s.tex.offset.x + Math.min(delta, 0.1) * s.perSecond) % 1;
  });

  return (
    <group position={[0, STRIP.y, STRIP.z]}>
      <Box size={[STRIP.w + 0.1, STRIP.h + 0.06, 0.08]} position={[0, 0, -0.045]} color="#2b2d42" outline shadow={false} />
      <mesh material={material}>
        <planeGeometry args={[STRIP.w, STRIP.h]} />
      </mesh>
    </group>
  );
}
