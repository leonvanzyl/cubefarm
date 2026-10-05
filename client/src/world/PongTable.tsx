import { memo, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import type { PongRow } from '../../../shared/types';
import { PONG_PLAYER } from '../../../shared/pong';
import { useStore } from '../store';
import { roundRect, SANS } from './draw';
import { useCanvasTexture } from './interact';
import { HALF_D, PONG_BOARD, PONG_TABLE } from './layout';
import { toon } from './materials';
import { Outlines } from './Outlines';
import { paddleTaken, pongView, subscribePong, type PongView } from './toys/pongState';
import { PONG } from './toys/pongPhysics';
import { Box, Cyl } from './Toon';

// The ping-pong table on every office floor, as furniture: the table, its net, the paddles hanging on its side (gone
// while someone plays at that end), a cup of balls, the little scoreboard at the net and the floor's leaderboard on
// the south wall (kept by the server, shared/pong.ts). Drawn with the floor, so it's there before the toys load; the
// game itself is the toy world's (toys/PingPong.tsx).

const INK = '#1f1d2b';
const T = PONG_TABLE;
const TOP_T = 0.03; // the playing surface's thickness
const LINE = '#f8f9fa';

/** A paddle: a red rubber face on a dark back, round, with a wooden handle below (or none, held by the arm). Faces -Z. */
export function PaddleLook({ handle = true }: { handle?: boolean }) {
  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.004]} material={toon('#e63946')} castShadow>
        <cylinderGeometry args={[0.078, 0.078, 0.008, 24]} />
        <Outlines thickness={0.006} color={INK} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.004]} material={toon('#22223b')}>
        <cylinderGeometry args={[0.078, 0.078, 0.008, 24]} />
      </mesh>
      {handle && (
        <mesh position={[0, -0.115, 0]} material={toon('#d4a373')}>
          <boxGeometry args={[0.026, 0.085, 0.022]} />
        </mesh>
      )}
    </group>
  );
}

let netMat: THREE.MeshBasicMaterial | null = null;
/** A fine white mesh with a solid band along the top, on a transparent canvas. */
function netMaterial() {
  if (netMat) return netMat;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = 'rgba(30,30,40,0.85)';
  ctx.lineWidth = 1.2;
  for (let x = 0; x <= 256; x += 6) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 32);
    ctx.stroke();
  }
  for (let y = 4; y <= 32; y += 6) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  ctx.fillStyle = '#f8f9fa';
  ctx.fillRect(0, 0, 256, 5);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  netMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
  return netMat;
}

/** The table: a blue top with white lines on a grey frame and legs, and the net across the middle. */
const Table = memo(function Table() {
  const half = { x: T.len / 2, z: T.wid / 2 };
  const line = 0.02;
  const net = PONG.net;
  const span = T.wid + net.overhang * 2;
  return (
    <group position={[T.x, 0, T.z]}>
      <mesh position={[0, T.top - TOP_T / 2, 0]} material={toon('#1d4e89')} castShadow receiveShadow>
        <boxGeometry args={[T.len, TOP_T, T.wid]} />
        <Outlines thickness={0.012} color={INK} />
      </mesh>
      {/* the white edges, and the centre line between the two halves of each side */}
      {[
        [0, half.z - line / 2, T.len, line],
        [0, -half.z + line / 2, T.len, line],
        [half.x - line / 2, 0, line, T.wid],
        [-half.x + line / 2, 0, line, T.wid],
        [0, 0, T.len, 0.006],
      ].map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, T.top + 0.001, z]} material={toon(LINE)}>
          <boxGeometry args={[w, 0.002, d]} />
        </mesh>
      ))}
      {/* frame and legs */}
      <Box size={[T.len - 0.3, 0.08, T.wid - 0.3]} position={[0, T.top - TOP_T - 0.04, 0]} color="#495057" shadow={false} />
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => <Box key={`${sx}${sz}`} size={[0.05, T.top - TOP_T, 0.05]} position={[sx * (half.x - 0.25), (T.top - TOP_T) / 2, sz * (half.z - 0.2)]} color="#343a40" />),
      )}
      {/* the net and its posts */}
      <mesh position={[0, T.top + net.h / 2, 0]} rotation={[0, Math.PI / 2, 0]} material={netMaterial()}>
        <planeGeometry args={[span, net.h]} />
      </mesh>
      {[-1, 1].map((sz) => (
        <group key={sz}>
          <Box size={[0.03, net.h + 0.02, 0.03]} position={[0, T.top + net.h / 2, sz * (half.z + net.overhang)]} color="#212529" />
          <Box size={[0.05, 0.03, 0.08]} position={[0, T.top - 0.005, sz * (half.z + 0.02)]} color="#212529" />
        </group>
      ))}
      {/* a cup of balls clipped to the table's north edge by the net */}
      <group position={[0.25, T.top - 0.03, -half.z - 0.05]}>
        <Cyl r={0.045} rTop={0.05} h={0.09} color="#adb5bd" outline />
        {[
          [-0.015, 0.05, 0.01],
          [0.017, 0.055, -0.008],
          [0, 0.075, 0.004],
        ].map(([x, y, z], i) => (
          <mesh key={i} position={[x, y, z]} material={toon('#ff9f1c')}>
            <sphereGeometry args={[PONG.ball.r, 12, 10]} />
          </mesh>
        ))}
      </group>
    </group>
  );
});

/** The paddles hanging on hooks on the table's south side, near each end; one goes while someone plays at its end. */
function HangingPaddles() {
  useSyncExternalStore(subscribePong, pongView);
  return (['west', 'east'] as const).map((end) =>
    paddleTaken(end) ? null : (
      <group key={end} position={[T.x + (end === 'west' ? -1 : 1) * (T.len / 2 - 0.42), T.top - 0.16, T.z + T.wid / 2 + 0.025]} rotation={[0.08, Math.PI, 0]}>
        <PaddleLook />
      </group>
    ),
  );
}

// ---------- the scoreboard at the net ----------

/** A seat's name for the boards: the manager's own, or the agent's. */
function nameOf(id: string | null, names: Record<string, string>, you: string) {
  if (!id) return '';
  return id === PONG_PLAYER ? you : (names[id] ?? '?');
}

function drawScore(ctx: CanvasRenderingContext2D, w: number, h: number, v: PongView | null, left: 'west' | 'east', names: Record<string, string>, you: string) {
  roundRect(ctx, 0, 0, w, h, 26);
  ctx.fillStyle = '#15151f';
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (!v || v.phase === 'waiting') {
    const waiting = v && (v.west || v.east);
    ctx.fillStyle = '#ffd166';
    ctx.font = `700 52px ${SANS}`;
    ctx.fillText('🏓', w / 2, h * 0.33);
    ctx.font = `700 34px ${SANS}`;
    ctx.fillStyle = '#f8f9fa';
    ctx.fillText(waiting ? 'Waiting for a player…' : 'Fancy a game? E at an end', w / 2, h * 0.7);
    return;
  }
  const right = left === 'west' ? 'east' : 'west';
  for (const [end, x] of [
    [left, w * 0.27],
    [right, w * 0.73],
  ] as const) {
    let name = nameOf(v[end], names, you);
    ctx.font = `600 30px ${SANS}`;
    while (name.length > 3 && ctx.measureText(name).width > w * 0.42) name = name.slice(0, -2);
    ctx.fillStyle = '#ced4da';
    ctx.fillText(name, x, h * 0.2);
    ctx.fillStyle = v.phase === 'over' && v.last?.winner === end ? '#06d6a0' : '#ffd166';
    ctx.font = `800 104px ${SANS}`;
    ctx.fillText(String(v.score[end]), x, h * 0.6);
    if (v.server === end && v.phase !== 'over') {
      ctx.fillStyle = '#ff9f1c';
      ctx.beginPath();
      ctx.arc(x, h * 0.9, 9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = '#6c757d';
  ctx.font = `800 70px ${SANS}`;
  ctx.fillText(':', w / 2, h * 0.58);
}

/** A two-faced flip board at the north end of the net: each face lists the players left to right as you see them. */
function Scoreboard() {
  const v = useSyncExternalStore(subscribePong, pongView);
  const agents = useStore((s) => s.agents);
  const you = useStore((s) => s.settings.managerName.trim().split(/\s+/)[0] || 'You');
  const names: Record<string, string> = {};
  for (const a of Object.values(agents)) names[a.id] = a.name;
  const key = [v?.phase, v?.west, v?.east, v?.score.west, v?.score.east, v?.server, v?.last?.winner, you, v?.west && names[v.west], v?.east && names[v.east]];
  const south = useCanvasTexture(512, 300, (ctx) => drawScore(ctx, 512, 300, v, 'west', names, you), key);
  const north = useCanvasTexture(512, 300, (ctx) => drawScore(ctx, 512, 300, v, 'east', names, you), key);
  const w = 0.56;
  const h = 0.33;
  return (
    <group position={[T.x, T.top + 0.42, T.z - T.wid / 2 - 0.1]}>
      <Box size={[0.03, T.top + 0.42, 0.03]} position={[0, -(T.top + 0.42) / 2, 0]} color="#212529" shadow={false} />
      <Box size={[0.24, 0.02, 0.18]} position={[0, -(T.top + 0.42) + 0.01, 0]} color="#212529" shadow={false} />
      <mesh material={toon('#2b2d42')}>
        <boxGeometry args={[w + 0.04, h + 0.04, 0.03]} />
        <Outlines thickness={0.01} color={INK} />
      </mesh>
      <mesh position={[0, 0, 0.016]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={south} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, -0.016]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={north} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ---------- the leaderboard ----------

const BOARD_ROWS = 7;

function drawLeaderboard(ctx: CanvasRenderingContext2D, w: number, h: number, rows: PongRow[], you: string) {
  roundRect(ctx, 0, 0, w, h, 30);
  ctx.fillStyle = '#1b4332';
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#d4a373';
  roundRect(ctx, 5, 5, w - 10, h - 10, 26);
  ctx.stroke();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd166';
  ctx.font = `800 54px ${SANS}`;
  ctx.fillText('🏓 PING-PONG LADDER', w / 2, 62);
  ctx.font = `600 26px ${SANS}`;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('games won – lost on this floor', w / 2, 108);
  if (!rows.length) {
    ctx.font = `600 36px ${SANS}`;
    ctx.fillStyle = '#f8f9fa';
    ctx.fillText('No games yet.', w / 2, h / 2 + 20);
    ctx.fillText('Pick up a paddle!', w / 2, h / 2 + 70);
    return;
  }
  const top = 150;
  const rowH = (h - top - 24) / BOARD_ROWS;
  rows.slice(0, BOARD_ROWS).forEach((r, i) => {
    const y = top + rowH * (i + 0.5);
    const mine = r.id === PONG_PLAYER;
    if (mine) {
      ctx.fillStyle = 'rgba(255,209,102,0.18)';
      roundRect(ctx, 28, y - rowH / 2 + 4, w - 56, rowH - 8, 14);
      ctx.fill();
    }
    ctx.textAlign = 'left';
    ctx.font = `800 40px ${SANS}`;
    ctx.fillStyle = i === 0 ? '#ffd166' : '#f8f9fa';
    ctx.fillText(`${i + 1}.`, 48, y);
    let name = mine ? `${you} (you)` : r.name;
    ctx.font = `600 40px ${SANS}`;
    while (name.length > 3 && ctx.measureText(name).width > w * 0.52) name = name.slice(0, -2);
    ctx.fillText(name, 118, y);
    ctx.textAlign = 'right';
    ctx.font = `700 40px ${SANS}`;
    ctx.fillText(`${r.wins}–${r.losses}`, w - 48, y);
  });
}

/** The floor's leaderboard, hung on the south wall behind the table. */
function Leaderboard({ repoId }: { repoId: string }) {
  const rows = useStore((s) => s.pong[repoId]) ?? EMPTY;
  const you = useStore((s) => s.settings.managerName.trim().split(/\s+/)[0] || 'You');
  const tex = useCanvasTexture(768, 666, (ctx) => drawLeaderboard(ctx, 768, 666, rows, you), [rows, you]);
  const b = PONG_BOARD;
  return (
    <group position={[b.x, b.y, HALF_D - 0.03]} rotation={[0, Math.PI, 0]}>
      <mesh material={toon('#7f5539')}>
        <boxGeometry args={[b.w + 0.06, b.h + 0.06, 0.03]} />
        <Outlines thickness={0.012} color={INK} />
      </mesh>
      <mesh position={[0, 0, 0.017]}>
        <planeGeometry args={[b.w, b.h]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

const EMPTY: PongRow[] = [];

/** Everything ping-pong a floor shows, whether or not the toys (and the game) have loaded. */
export function PongTable({ repoId }: { repoId: string }) {
  return (
    <group>
      <Table />
      <HangingPaddles />
      <Scoreboard />
      <Leaderboard repoId={repoId} />
    </group>
  );
}
