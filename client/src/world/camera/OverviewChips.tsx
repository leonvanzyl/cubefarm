import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { agentsOnRepo, repoOnFloor, useStore, type Agent } from '../../store';
import { CEO_ID } from '../../../../shared/types';
import { SANS, roundRect } from '../draw';
import { useCanvasTexture } from '../interact';
import { CEO_DESK, deskPosition, qaDeskPosition } from '../layout';
import { CHIP_COLORS, chipFor, type ChipKind } from './overviewInfo';
import { pickables } from './picking';

// The overview's status chips: a small label over every desk with its person's name and what they're doing, the same
// size on screen at any zoom (sizeAttenuation off) and drawn over everything. A click on one opens their panel.

const CHIP = { w: 320, h: 72, px: 28, y: 2.45 };
/** The chips' scale for the current lens and view size, so a new chip starts the right size. */
const scale = { x: 0.1, y: 0.025 };
const LABEL: Record<ChipKind, string> = { working: 'working', testing: 'testing', fixing: 'fixing', error: 'needs help', idle: 'idle' };

function drawChip(ctx: CanvasRenderingContext2D, name: string, kind: ChipKind) {
  const { w, h } = CHIP;
  ctx.clearRect(0, 0, w, h);
  ctx.font = `700 30px ${SANS}`;
  const label = LABEL[kind];
  let text = name;
  const room = w - 70 - ctx.measureText(` · ${label}`).width;
  while (text.length > 2 && ctx.measureText(text).width > room) text = `${text.slice(0, -2)}…`;
  const line = `${text} · ${label}`;
  const width = Math.min(w - 8, ctx.measureText(line).width + 64);
  const x0 = (w - width) / 2;
  roundRect(ctx, x0, 6, width, h - 12, (h - 12) / 2);
  ctx.fillStyle = 'rgba(255,253,246,0.96)';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#1f1d2b';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x0 + 28, h / 2, 11, 0, Math.PI * 2);
  ctx.fillStyle = CHIP_COLORS[kind];
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#1f1d2b';
  ctx.textBaseline = 'middle';
  ctx.fillText(line, x0 + 48, h / 2 + 1);
}

/** Where someone's desk is, from their desk slot (the CEO's is in the lobby). */
function deskSpot(a: Agent): [number, number] {
  if (a.role === 'ceo') return [CEO_DESK.x, CEO_DESK.z];
  const p = a.role === 'qa' ? qaDeskPosition(a.desk) : deskPosition(a.desk);
  return [p.x, p.z];
}

const Chip = memo(function Chip({ agent }: { agent: Agent }) {
  const kind = chipFor(agent);
  const tex = useCanvasTexture(CHIP.w, CHIP.h, (ctx) => drawChip(ctx, agent.name, kind), [agent.name, kind]);
  const material = useMemo(() => new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false, toneMapped: false }), [tex]);
  useEffect(() => () => material.dispose(), [material]);
  const ref = useRef<THREE.Sprite>(null);
  const [x, z] = deskSpot(agent);
  useEffect(() => {
    const s = ref.current;
    if (!s) return;
    s.userData.pick = { kind: 'agent', agentId: agent.id, label: `Open ${agent.name}'s panel` };
    pickables.add(s);
    return () => void pickables.delete(s);
  }, [agent.id, agent.name]);
  return <sprite ref={ref} material={material} position={[x, CHIP.y, z]} scale={[scale.x, scale.y, 1]} renderOrder={20} />;
});

/** Chips for everyone on the floor you're on. Keeps them CHIP.px tall on screen whatever the zoom. */
export function OverviewChips() {
  const floor = useStore((s) => s.floor);
  const repos = useStore((s) => s.repos);
  const all = useStore((s) => s.agents);
  const repo = floor === 0 ? null : repoOnFloor(repos, floor);
  const people = useMemo(() => (repo ? agentsOnRepo(all, repo.id) : all[CEO_ID] ? [all[CEO_ID]] : []), [repo, all]);
  const group = useRef<THREE.Group>(null);
  const last = useRef({ k: 0, h: 0 });
  useFrame(({ camera, size }) => {
    const g = group.current;
    if (!g) return;
    const k = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5];
    if (k === last.current.k && size.height === last.current.h) return;
    last.current.k = k;
    last.current.h = size.height;
    // with sizeAttenuation off, a sprite's on-screen height is scale × projection[5] × half the view's height
    scale.y = (CHIP.px * 2) / (k * size.height);
    scale.x = (scale.y * CHIP.w) / CHIP.h;
    for (const c of g.children) c.scale.set(scale.x, scale.y, 1);
  });
  return (
    <group ref={group}>
      {people.map((a) => (
        <Chip key={a.id} agent={a} />
      ))}
    </group>
  );
}
