import { useMemo } from 'react';
import type { RepoView } from '../../../shared/types';
import { EMPTY_NUMBERS, signLine } from '../ops';
import { agentsOnRepo, floorPrCounts, useStore } from '../store';
import { useKeyName } from '../ui/controls';
import { ActivityIcon } from './ActivityIcon';
import { ActivityTicker } from './ActivityTicker';
import { AppMonitor } from './AppMonitor';
import { Desk } from './Desk';
import { drawSign } from './draw';
import { Elevator } from './Elevator';
import { ErrandDirector } from './ErrandDirector';
import { Gong } from './Gong';
import { useCanvasTexture } from './interact';
import { KanbanBoard } from './KanbanBoard';
import { Jukebox } from './Jukebox';
import { Leaver, useLeavers } from './Leavers';
import { DESK_RUGS, HALF_D, HALF_W, JUKEBOX, MAX_DESKS, QA_LAB, QA_ROTATION, QA_RUG, deskPosition, qaDeskPosition } from './layout';
import { shade } from './materials';
import { MergeConfetti } from './MergeConfetti';
import { Beacon, useFloorAlarm } from './MissionControl';
import { CoinBurst } from './decor/CoinBurst';
import { Decorations } from './decor/Decorations';
import { DeskStory, MvpSign } from './desk/DeskStory';
import { CoffeeTable, Couch, Kitchenette, Plant, Rug, WallClock, WaterCooler } from './Props';
import { OfficeRituals } from './Rituals';
import { PongTable } from './PongTable';
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

// Made once, so the memoised desks see the same position every render.
const DEV_DESKS = Array.from({ length: MAX_DESKS }, (_, slot): [number, number, number] => [deskPosition(slot).x, 0, deskPosition(slot).z]);
const QA_DESKS = QA_LAB.stations.map((_, slot): [number, number, number] => [qaDeskPosition(slot).x, 0, qaDeskPosition(slot).z]);

export function OfficeFloor({ repo }: { repo: RepoView }) {
  const use = useKeyName('interact');
  const allAgents = useStore((s) => s.agents);
  const agents = useMemo(() => agentsOnRepo(allAgents, repo.id), [allAgents, repo.id]);
  const devBySlot = useMemo(() => new Map(agents.filter((a) => a.role === 'dev').map((a) => [a.desk, a])), [agents]);
  const qaBySlot = useMemo(() => new Map(agents.filter((a) => a.role === 'qa').map((a) => [a.desk, a])), [agents]);
  const { leavers, gone } = useLeavers(agents);
  const working = agents.filter((a) => a.status === 'working' || a.status === 'preparing').length;
  const qaRecords = useStore((s) => s.qa);
  const { inQa, ready } = useMemo(() => floorPrCounts(repo, qaRecords), [repo, qaRecords]);
  // Mission control's numbers for this floor, compact, on its team sign; the beacon on top spins while something here needs you.
  const ops = useStore((s) => signLine(s.ops.floors.find((f) => f.repoId === repo.id) ?? EMPTY_NUMBERS));
  const { alarm, ref: signRef } = useFloorAlarm(repo.id);
  const name = repo.fullName.split('/')[1] ?? repo.fullName;
  const rugColor = shade(repo.color, 0.24);

  return (
    <group>
      <Shell kind="office" accent={repo.color} floorColor="#d9b48a" />
      {DESK_RUGS.map((r) => (
        <Rug key={r.minZ} position={[(r.minX + r.maxX) / 2, 0.004, (r.minZ + r.maxZ) / 2]} size={[r.maxX - r.minX, r.maxZ - r.minZ]} color={rugColor} />
      ))}

      {DEV_DESKS.map((position, slot) => (
        <Desk key={slot} agent={devBySlot.get(slot) ?? null} accent={repo.color} repoId={repo.id} position={position} />
      ))}

      {/* QA lab */}
      <Rug position={[(QA_RUG.minX + QA_RUG.maxX) / 2, 0.005, (QA_RUG.minZ + QA_RUG.maxZ) / 2]} size={[QA_RUG.maxX - QA_RUG.minX, QA_RUG.maxZ - QA_RUG.minZ]} color="#ffd8bf" />
      {QA_DESKS.map((position, slot) => (
        <Desk key={`qa${slot}`} role="qa" rotationY={QA_ROTATION} agent={qaBySlot.get(slot) ?? null} accent={repo.color} repoId={repo.id} position={position} />
      ))}
      <WallSign
        position={[HALF_W - 0.03, 3.2, -2]}
        rotationY={-Math.PI / 2}
        size={[3.2, 0.55]}
        px={[768, 132]}
        draw={(ctx) => drawSign(ctx, 768, 132, [{ text: `🔍 QA LAB · ${inQa} in testing`, size: 56 }], '#ff9f68')}
        deps={[inQa]}
      />

      <KanbanBoard repo={repo} agents={agents} />
      <ActivityTicker repoId={repo.id} />
      {agents.map((a) => <ActivityIcon key={a.id} agent={a} />)}
      <AppMonitor repo={repo} agents={agents} />
      <MergeConfetti repo={repo} agents={agents} />
      <CoinBurst repo={repo} agents={agents} />
      <DeskStory agents={agents} />
      <MvpSign agents={agents} />
      <Decorations repo={repo} />
      <Gong repoId={repo.id} />
      <PongTable repoId={repo.id} />
      <Elevator floorLabel={`▲ ${repo.floor} · ${name}`} accent={repo.color} />
      <Toys floor="office" />
      <ErrandDirector floor="office" agents={agents} leavers={leavers} onGone={gone} repoId={repo.id} />
      <OfficeRituals repo={repo} agents={agents} />
      {leavers.map((a) => (
        <Leaver key={a.id} agent={a} />
      ))}

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
      <group ref={signRef}>
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
                { text: `👩‍💻 ${agents.length} on the team`, size: 50, color: '#2d3142' },
                { text: `⚙️ ${working} busy · 🔍 ${inQa} in QA · ✅ ${ready} to merge`, size: 42, color: '#2d3142', weight: 600 },
                { text: `📋 ${repo.issues.length} open issue${repo.issues.length === 1 ? '' : 's'}${repo.autoAssign ? ' · ⚡ auto' : ''}`, size: 40, color: '#5c6078', weight: 500 },
                alarm ? { text: `🚨 ${alarm.text.split(':')[0]} · press ${use}`, size: 38, color: '#d62839' } : { text: ops, size: 36, color: '#3a6ea5', weight: 600 },
              ],
              '#fffdf5',
            )
          }
          deps={[agents.length, working, inQa, ready, repo.issues.length, repo.autoAssign, ops, alarm?.text, use]}
        />
        <group position={[4.6, 2.62, HALF_D - 0.12]}>
          <Beacon on={!!alarm} size={0.12} />
        </group>
      </group>

      <Plant position={[-7.1, 0, -HALF_D + 0.7]} />
      <Plant position={[7.1, 0, -HALF_D + 0.7]} />
      <Plant position={[-HALF_W + 0.7, 0, HALF_D - 0.8]} scale={1.2} />
      <Plant position={[-11, 0, -HALF_D + 0.7]} scale={1.1} />
      <Plant position={[HALF_W - 0.7, 0, HALF_D - 0.7]} scale={0.9} pot="#8338ec" />
      <Couch position={[-HALF_W + 0.9, 0, 6.5]} rotationY={-Math.PI / 2} color={shade(repo.color, -0.05)} />
      <CoffeeTable position={[-HALF_W + 2.6, 0, 6.5]} rotationY={Math.PI / 2} />
      <Kitchenette position={[HALF_W - 0.45, 0, 7]} />
      <WaterCooler position={[HALF_W - 0.5, 0, -9.5]} />
      <Jukebox x={JUKEBOX.officeX} floor={repo.floor} />
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
