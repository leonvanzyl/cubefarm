import { useMemo } from 'react';
import type { RepoView } from '../../../shared/types';
import { agentsOnRepo, useStore } from '../store';
import { AppMonitor } from './AppMonitor';
import { Desk } from './Desk';
import { drawSign } from './draw';
import { Elevator } from './Elevator';
import { Gong } from './Gong';
import { useCanvasTexture } from './interact';
import { KanbanBoard } from './KanbanBoard';
import { DESK_RUGS, HALF_D, HALF_W, MAX_DESKS, QA_LAB, QA_ROTATION, QA_RUG, deskPosition, qaDeskPosition } from './layout';
import { shade } from './materials';
import { MergeConfetti } from './MergeConfetti';
import { CoffeeTable, Couch, Kitchenette, Plant, Rug, WallClock, WaterCooler } from './Props';
import { Shell } from './Shell';
import { Toys } from './toys';

export function WallSign({
  position,
  size,
  px,
  draw,
  deps,
  rotationY = Math.PI,
}: {
  position: [number, number, number];
  size: [number, number];
  px: [number, number];
  draw: (ctx: CanvasRenderingContext2D) => void;
  deps: unknown[];
  rotationY?: number;
}) {
  const tex = useCanvasTexture(px[0], px[1], draw, deps);
  return (
    <mesh position={position} rotation={[0, rotationY, 0]}>
      <planeGeometry args={size} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} />
    </mesh>
  );
}

export function OfficeFloor({ repo }: { repo: RepoView }) {
  const allAgents = useStore((s) => s.agents);
  const agents = useMemo(() => agentsOnRepo(allAgents, repo.id), [allAgents, repo.id]);
  const devBySlot = useMemo(() => new Map(agents.filter((a) => a.role === 'dev').map((a) => [a.desk, a])), [agents]);
  const qaBySlot = useMemo(() => new Map(agents.filter((a) => a.role === 'qa').map((a) => [a.desk, a])), [agents]);
  const working = agents.filter((a) => a.status === 'working' || a.status === 'preparing').length;
  const qaRecords = useStore((s) => s.qa);
  const inQa = Object.values(qaRecords).filter((q) => q.repoId === repo.id && q.status !== 'passed').length;
  const ready = Object.values(qaRecords).filter((q) => q.repoId === repo.id && q.status === 'passed').length;
  const name = repo.fullName.split('/')[1] ?? repo.fullName;
  const rugColor = shade(repo.color, 0.24);

  return (
    <group>
      <Shell accent={repo.color} floorColor="#d9b48a" seed={repo.floor} />
      {DESK_RUGS.map((r) => (
        <Rug key={r.minZ} position={[(r.minX + r.maxX) / 2, 0.004, (r.minZ + r.maxZ) / 2]} size={[r.maxX - r.minX, r.maxZ - r.minZ]} color={rugColor} />
      ))}

      {Array.from({ length: MAX_DESKS }, (_, slot) => {
        const { x, z } = deskPosition(slot);
        return <Desk key={slot} agent={devBySlot.get(slot) ?? null} accent={repo.color} repoId={repo.id} position={[x, 0, z]} />;
      })}

      {/* QA lab */}
      <Rug position={[(QA_RUG.minX + QA_RUG.maxX) / 2, 0.005, (QA_RUG.minZ + QA_RUG.maxZ) / 2]} size={[QA_RUG.maxX - QA_RUG.minX, QA_RUG.maxZ - QA_RUG.minZ]} color="#ffd8bf" />
      {QA_LAB.stations.map((_, slot) => {
        const { x, z } = qaDeskPosition(slot);
        return <Desk key={`qa${slot}`} role="qa" rotationY={QA_ROTATION} agent={qaBySlot.get(slot) ?? null} accent={repo.color} repoId={repo.id} position={[x, 0, z]} />;
      })}
      <WallSign
        position={[HALF_W - 0.03, 3.2, -2]}
        rotationY={-Math.PI / 2}
        size={[3.2, 0.55]}
        px={[768, 132]}
        draw={(ctx) => drawSign(ctx, 768, 132, [{ text: `🔍 QA LAB · ${inQa} in testing`, size: 56 }], '#ff9f68')}
        deps={[inQa]}
      />

      <KanbanBoard repo={repo} agents={agents} />
      <AppMonitor repo={repo} agents={agents} />
      <MergeConfetti repo={repo} agents={agents} />
      <Gong repoId={repo.id} />
      <Elevator floorLabel={`▲ ${repo.floor} · ${name}`} accent={repo.color} />
      <Toys floor="office" />

      <WallSign
        position={[-4.6, 1.95, HALF_D - 0.03]}
        size={[4.2, 1.3]}
        px={[1024, 317]}
        draw={(ctx) =>
          drawSign(
            ctx,
            1024,
            317,
            [
              { text: `FLOOR ${repo.floor}`, size: 58, color: 'rgba(255,255,255,0.85)', weight: 600 },
              { text: repo.fullName, size: 74 },
              { text: repo.description || 'no description', size: 36, weight: 500, color: 'rgba(255,255,255,0.85)' },
            ],
            repo.color,
          )
        }
        deps={[repo.floor, repo.fullName, repo.description, repo.color]}
      />
      <WallSign
        position={[4.6, 1.95, HALF_D - 0.03]}
        size={[4.2, 1.3]}
        px={[1024, 317]}
        draw={(ctx) =>
          drawSign(
            ctx,
            1024,
            317,
            [
              { text: `👩‍💻 ${agents.length} on the team`, size: 54, color: '#2d3142' },
              { text: `⚙️ ${working} busy · 🔍 ${inQa} in QA · ✅ ${ready} to merge`, size: 46, color: '#2d3142', weight: 600 },
              { text: `📋 ${repo.issues.length} open issue${repo.issues.length === 1 ? '' : 's'}${repo.autoAssign ? ' · ⚡ auto' : ''}`, size: 44, color: '#5c6078', weight: 500 },
            ],
            '#fffdf5',
          )
        }
        deps={[agents.length, working, inQa, ready, repo.issues.length, repo.autoAssign]}
      />

      <Plant position={[-7.1, 0, -HALF_D + 0.7]} />
      <Plant position={[7.1, 0, -HALF_D + 0.7]} />
      <Plant position={[-HALF_W + 0.7, 0, HALF_D - 0.8]} scale={1.2} />
      <Plant position={[-11, 0, -HALF_D + 0.7]} scale={1.1} />
      <Plant position={[HALF_W - 0.7, 0, HALF_D - 0.7]} scale={0.9} pot="#8338ec" />
      <Couch position={[-HALF_W + 0.9, 0, 6.5]} rotationY={-Math.PI / 2} color={shade(repo.color, -0.05)} />
      <CoffeeTable position={[-HALF_W + 2.6, 0, 6.5]} rotationY={Math.PI / 2} />
      <Kitchenette position={[HALF_W - 0.45, 0, 7]} />
      <WaterCooler position={[HALF_W - 0.5, 0, -9.5]} />
      <WallClock position={[-10, 2.75, -HALF_D + 0.05]} />
      <WallSign
        position={[10, 2.2, -HALF_D + 0.03]}
        rotationY={0}
        size={[2.2, 1.4]}
        px={[512, 326]}
        draw={(ctx) =>
          drawSign(ctx, 512, 326, [
            { text: '🚀', size: 90 },
            { text: 'SHIP IT', size: 64 },
            { text: 'small PRs, happy reviewers', size: 26, weight: 500 },
          ], '#3a86ff')
        }
        deps={[]}
      />
    </group>
  );
}
