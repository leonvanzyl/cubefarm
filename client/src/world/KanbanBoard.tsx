import { useMemo } from 'react';
import * as THREE from 'three';
import type { RepoView } from '../../../shared/types';
import { kanbanFor, useStore, type Agent, type KanbanCard } from '../store';
import { BOARD } from './layout';
import { drawKanban } from './draw';
import { useCanvasTexture, useInteractable } from './interact';
import { StickyNotes, useStickyBoard } from './StickyNotes';
import { Box, Cyl } from './Toon';

export function KanbanBoard({ repo, agents }: { repo: RepoView; agents: Agent[] }) {
  const qa = useStore((s) => s.qa);
  const real = useMemo(() => kanbanFor(repo, agents, qa), [repo, agents, qa]);
  // what the 3D board shows: the real board, with moves held back until whoever makes them has placed the sticky
  const { shown: cols, ctrl } = useStickyBoard(real, agents);
  // Only repaint the big canvas when what's written on it changes.
  const signature = useMemo(
    () =>
      JSON.stringify([
        repo.fullName,
        repo.autoAssign,
        repo.lastSync ? Math.floor(repo.lastSync / 60000) : 0,
        ...(Object.values(cols) as KanbanCard[][]).map((list) => list.map((c) => [c.key, c.title, c.note, c.agent?.name, c.agent?.color, c.tone, c.ghost, c.ghost ? c.qa?.updatedAt : 0])),
      ]),
    [cols, repo],
  );
  const texH = Math.round((2560 * BOARD.h) / BOARD.w);
  const tex = useCanvasTexture(2560, texH, (ctx) => drawKanban(ctx, 2560, texH, repo, cols), [signature]);
  const ref = useInteractable<THREE.Group>({ id: `board-${repo.id}`, label: 'Open the Kanban board', action: { kind: 'kanban', repoId: repo.id } }, 7);
  const cy = BOARD.y + BOARD.h / 2;
  return (
    <>
      <group ref={ref} position={[0, 0, BOARD.z]}>
        <Box size={[BOARD.w + 0.24, BOARD.h + 0.24, 0.06]} position={[0, cy, 0.03]} color="#aab4c3" outline shadow={false} />
        <mesh position={[0, cy, 0.065]}>
          <planeGeometry args={[BOARD.w, BOARD.h]} />
          <meshBasicMaterial map={tex} toneMapped={false} />
        </mesh>
        <Box size={[3.2, 0.05, 0.16]} position={[3.5, BOARD.y - 0.12, 0.1]} color="#aab4c3" outline />
        {['#e63946', '#1d3557', '#2a9d8f'].map((c, i) => (
          <Cyl key={c} r={0.018} h={0.16} position={[2.6 + i * 0.22, BOARD.y - 0.075, 0.12]} rotation={[0, 0, Math.PI / 2]} color={c} />
        ))}
      </group>
      <StickyNotes ctrl={ctrl} />
    </>
  );
}
