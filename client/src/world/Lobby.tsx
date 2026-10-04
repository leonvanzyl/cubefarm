import { useMemo } from 'react';
import * as THREE from 'three';
import { Billboard } from '@react-three/drei';
import { floorPrCounts, pendingRequests, useStore, type Agent } from '../store';
import { CEO_ID, type HireRequestView } from '../../../shared/types';
import { ActivityIcon } from './ActivityIcon';
import { Character } from './Character';
import { Desk } from './Desk';
import { drawCandidateTag, drawSign, roundRect, SANS } from './draw';
import { Elevator } from './Elevator';
import { ErrandDirector } from './ErrandDirector';
import { useCanvasTexture, useInteractable } from './interact';
import { Jukebox } from './Jukebox';
import { MissionControl } from './MissionControl';
import { CEO_DESK, CEO_ROOM, COFFEE_CORNER, HALF_D, HALF_W, JUKEBOX, LOBBY_RUG, MANAGER_DESK, MANAGER_ROOM, RECEPTION, WAITING, WAITING_ROTATION } from './layout';
import { glow, shade } from './materials';
import { WallSign } from './OfficeFloor';
import { Bookshelf, CoffeeCorner, Couch, CoffeeTable, GlassWall, Plant, Rug, WallClock } from './Props';
import { LobbyRituals } from './Rituals';
import { Shell } from './Shell';
import { Ball, Box, Cyl } from './Toon';
import { Toys } from './toys';

const ACCENT = '#ff8a5b';
const CEO_ACCENT = '#9b5de5';
const CEO_DESK_AT: [number, number, number] = [CEO_DESK.x, 0, CEO_DESK.z]; // one array, so the memoised desk skips re-renders

function useOfficeStats() {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const settings = useStore((s) => s.settings);
  const qa = useStore((s) => s.qa);
  const requests = useStore((s) => s.requests);
  return useMemo(() => {
    const list = Object.values(agents);
    const working = list.filter((a) => a.status === 'working' || a.status === 'preparing').length;
    const openPrs = repos.reduce((n, r) => n + r.pulls.filter((p) => p.state === 'OPEN').length, 0);
    const merged = repos.reduce((n, r) => n + r.pulls.filter((p) => p.state === 'MERGED').length, 0);
    const issues = repos.reduce((n, r) => n + r.issues.length, 0);
    const floors = repos.map((r) => ({
      floor: r.floor,
      name: r.fullName,
      color: r.color,
      team: list.filter((a) => a.repoId === r.id).length,
      working: list.filter((a) => a.repoId === r.id && (a.status === 'working' || a.status === 'preparing')).length,
      prs: r.pulls.filter((p) => p.state === 'OPEN').length,
    }));
    const prCounts = repos.map((r) => floorPrCounts(r, qa));
    const inQa = prCounts.reduce((n, c) => n + c.inQa, 0);
    const readyToMerge = prCounts.reduce((n, c) => n + c.ready, 0);
    const pending = pendingRequests(requests).length;
    return { repos: repos.length, agents: list.length, working, openPrs, inQa, readyToMerge, merged, issues, floors, max: settings.sessionLimit, pending };
  }, [repos, agents, settings, qa, requests]);
}

function ManagerComputer() {
  const stats = useOfficeStats();
  const ref = useInteractable<THREE.Group>({ id: 'manager-console', label: "Open the manager's console", action: { kind: 'manager' } }, 3.2);
  const tex = useCanvasTexture(
    1024,
    640,
    (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 1024, 640);
      g.addColorStop(0, '#20224a');
      g.addColorStop(1, '#3a1f4d');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1024, 640);
      ctx.fillStyle = '#ffd6a5';
      ctx.font = `700 54px ${SANS}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('✻ Manager Console', 50, 70);
      const rows: [string, string][] = [
        ['Floors (repos)', `${stats.repos}`],
        ['Agents on staff', `${stats.agents}`],
        ['Sessions running', stats.max ? `${stats.working} / ${stats.max}` : `${stats.working}`],
        ['Open issues', `${stats.issues}`],
        ['PRs in QA / ready to merge', `${stats.inQa} / ${stats.readyToMerge}`],
        ['📄 Hiring decisions waiting', `${stats.pending}`],
      ];
      rows.forEach(([k, v], i) => {
        const y = 150 + i * 68;
        roundRect(ctx, 50, y - 30, 924, 60, 16);
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fill();
        ctx.fillStyle = '#c9c9ee';
        ctx.font = `500 34px ${SANS}`;
        ctx.fillText(k, 76, y);
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 38px ${SANS}`;
        ctx.textAlign = 'right';
        ctx.fillText(v, 948, y);
        ctx.textAlign = 'left';
      });
      ctx.fillStyle = '#7CFFB2';
      ctx.font = `600 32px ${SANS}`;
      ctx.fillText('Press E or click to manage floors, team & issues', 50, 592);
    },
    [stats.repos, stats.agents, stats.working, stats.max, stats.issues, stats.inQa, stats.readyToMerge, stats.pending],
  );
  return (
    <group ref={ref} position={[MANAGER_DESK.x, 0, MANAGER_DESK.z]}>
      <Box size={[MANAGER_DESK.w, 0.08, MANAGER_DESK.d]} position={[0, 0.76, 0]} color="#8d5a3b" outline />
      <Box size={[MANAGER_DESK.w - 0.1, 0.72, 0.06]} position={[0, 0.37, -MANAGER_DESK.d / 2 + 0.05]} color="#6f4530" />
      <Box size={[0.08, 0.72, MANAGER_DESK.d - 0.1]} position={[-MANAGER_DESK.w / 2 + 0.08, 0.37, 0]} color="#6f4530" />
      <Box size={[0.08, 0.72, MANAGER_DESK.d - 0.1]} position={[MANAGER_DESK.w / 2 - 0.08, 0.37, 0]} color="#6f4530" />
      {/* big monitor facing the door */}
      <Box size={[0.1, 0.34, 0.1]} position={[0, 0.97, -0.15]} color="#adb5bd" />
      <Box size={[0.4, 0.03, 0.26]} position={[0, 0.815, -0.15]} color="#adb5bd" outline />
      <Box size={[1.42, 0.92, 0.06]} position={[0, 1.55, -0.18]} color="#343a40" outline />
      <mesh position={[0, 1.55, -0.145]}>
        <planeGeometry args={[1.34, 0.84]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      <Box size={[0.5, 0.025, 0.16]} position={[0, 0.815, 0.25]} color="#f4f4f8" outline />
      <Cyl r={0.05} h={0.11} position={[0.9, 0.855, 0.1]} color="#ffd166" outline />
      <Box size={[0.3, 0.2, 0.03]} position={[-0.95, 0.9, -0.1]} rotation={[-0.3, 0.3, 0]} color="#e9c46a" outline />
      {/* manager chair (yours) */}
      <group position={[0, 0, -1.1]}>
        <Box size={[0.64, 0.12, 0.6]} position={[0, 0.48, 0]} color="#2b2d42" outline />
        <Box size={[0.62, 0.8, 0.12]} position={[0, 0.95, -0.3]} color="#2b2d42" outline />
        <Cyl r={0.04} h={0.4} position={[0, 0.22, 0]} color="#6c757d" />
        <Cyl r={0.3} h={0.04} position={[0, 0.03, 0]} color="#6c757d" />
      </group>
    </group>
  );
}

function Directory() {
  const stats = useOfficeStats();
  const ref = useInteractable<THREE.Group>({ id: 'directory', label: 'Floor directory — take the elevator', action: { kind: 'elevator' } }, 4);
  const tex = useCanvasTexture(
    768,
    560,
    (ctx) => {
      roundRect(ctx, 0, 0, 768, 560, 30);
      ctx.fillStyle = '#23263a';
      ctx.fill();
      ctx.fillStyle = '#ffd6a5';
      ctx.font = `700 46px ${SANS}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('Directory', 36, 52);
      const floors = [...stats.floors].sort((a, b) => b.floor - a.floor).slice(0, 7);
      floors.forEach((f, i) => {
        const y = 118 + i * 58;
        ctx.fillStyle = f.color;
        roundRect(ctx, 36, y - 22, 54, 44, 12);
        ctx.fill();
        ctx.fillStyle = '#1f2233';
        ctx.font = `700 30px ${SANS}`;
        ctx.textAlign = 'center';
        ctx.fillText(String(f.floor), 63, y + 1);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffffff';
        ctx.font = `600 28px ${SANS}`;
        const name = f.name.length > 24 ? `${f.name.slice(0, 23)}…` : f.name;
        ctx.fillText(name, 108, y);
        ctx.fillStyle = '#a9adc6';
        ctx.font = `500 24px ${SANS}`;
        ctx.textAlign = 'right';
        ctx.fillText(`${f.working}/${f.team} busy · ${f.prs} PR`, 740, y);
        ctx.textAlign = 'left';
      });
      const gy = 118 + floors.length * 58;
      ctx.fillStyle = ACCENT;
      roundRect(ctx, 36, gy - 22, 54, 44, 12);
      ctx.fill();
      ctx.fillStyle = '#1f2233';
      ctx.font = `700 30px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.fillText('G', 63, gy + 1);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.font = `600 28px ${SANS}`;
      ctx.fillText("Lobby & manager's office", 108, gy);
      if (stats.floors.length === 0) {
        ctx.fillStyle = '#a9adc6';
        ctx.font = `500 26px ${SANS}`;
        ctx.fillText('No floors yet: connect a repo in the', 36, gy + 80);
        ctx.fillText("manager's office (back left corner).", 36, gy + 116);
      }
    },
    [stats],
  );
  return (
    <group ref={ref} position={[4.4, 1.75, HALF_D - 0.03]} rotation={[0, Math.PI, 0]}>
      <mesh>
        <planeGeometry args={[2.6, 1.9]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

function TrophyCabinet() {
  const stats = useOfficeStats();
  const tex = useCanvasTexture(
    512,
    160,
    (ctx) => drawSign(ctx, 512, 160, [{ text: `🏆 ${stats.merged} PRs merged`, size: 50, color: '#2d3142' }], '#ffe8a3'),
    [stats.merged],
  );
  const cups = Math.min(8, stats.merged);
  return (
    <group position={[12, 0, -HALF_D + 0.55]}>
      <Box size={[4.4, 2.1, 1]} position={[0, 1.05, 0]} color="#b08968" outline />
      <Box size={[4.1, 1.2, 0.8]} position={[0, 1.2, 0.12]} color="#fdf6e3" shadow={false} />
      <Box size={[4.1, 0.04, 0.8]} position={[0, 1.2, 0.12]} color="#b08968" shadow={false} />
      {Array.from({ length: cups }, (_, i) => (
        <group key={i} position={[-1.7 + (i % 4) * 1.1, i < 4 ? 0.62 : 1.22, 0.2]}>
          <Cyl r={0.08} rTop={0.16} h={0.22} position={[0, 0.2, 0]} color="#ffd43b" outline />
          <Cyl r={0.03} h={0.1} position={[0, 0.05, 0]} color="#ffd43b" />
          <Box size={[0.2, 0.04, 0.2]} position={[0, 0.01, 0]} color="#495057" />
        </group>
      ))}
      <mesh position={[0, 2.45, 0.02]}>
        <planeGeometry args={[2.4, 0.75]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

/** The CEO's wall screen: what they're doing, what's next, and who's waiting to be hired. */
function CeoBoard() {
  const ceo = useStore((s) => s.agents[CEO_ID]);
  const info = useStore((s) => s.ceo);
  const requests = useStore((s) => s.requests);
  const pending = pendingRequests(requests).length;
  const now = ceo?.status === 'working' ? (info.job?.label ?? 'Working') : 'Free for a chat (press P)';
  const next = info.queue.length ? `${info.queue[0].label}${info.queue.length > 1 ? ` (+${info.queue.length - 1})` : ''}` : 'nothing queued';
  return (
    <WallSign
      position={[HALF_W - 0.03, 2.05, CEO_DESK.z]}
      rotationY={-Math.PI / 2}
      size={[3.4, 1.9]}
      px={[816, 456]}
      draw={(ctx) =>
        drawSign(
          ctx,
          816,
          456,
          [
            { text: `🧠 ${ceo?.name ?? 'CEO'}'s board`, size: 54 },
            { text: `Now: ${now}`, size: 36, weight: 600 },
            { text: `Next: ${next}`, size: 32, weight: 500, color: 'rgba(255,255,255,0.8)' },
            { text: pending ? `📄 ${pending} candidate${pending === 1 ? '' : 's'} waiting for you` : '📄 no candidates waiting', size: 34, weight: 600, color: pending ? '#ffe066' : '#ffffff' },
          ],
          '#3c2a63',
        )
      }
      deps={[ceo?.name, now, next, pending]}
    />
  );
}

function CeoOffice() {
  const c = CEO_ROOM;
  const ceo = useStore((s) => s.agents[CEO_ID]);
  const people = useMemo(() => (ceo ? [ceo] : []), [ceo]);
  return (
    <group>
      <ErrandDirector floor="lobby" agents={people} />
      <LobbyRituals />
      <Rug position={[(c.minX + c.maxX) / 2, 0.005, (c.minZ + c.maxZ) / 2]} size={[c.maxX - c.minX, c.maxZ - c.minZ]} color="#e6dcff" />
      <GlassWall from={[c.minX, c.minZ]} to={[c.minX, c.maxZ]} />
      <GlassWall from={[c.minX, c.maxZ]} to={[c.doorMinX, c.maxZ]} />
      <GlassWall from={[c.doorMaxX, c.maxZ]} to={[c.maxX, c.maxZ]} />
      <Box size={[c.doorMaxX - c.doorMinX, 0.5, 0.1]} position={[(c.doorMinX + c.doorMaxX) / 2, 2.55, c.maxZ]} color="#8d99ae" />
      <WallSign
        position={[(c.doorMinX + c.doorMaxX) / 2, 3.1, c.maxZ + 0.06]}
        rotationY={0}
        size={[3.4, 0.5]}
        px={[816, 120]}
        draw={(ctx) => drawSign(ctx, 816, 120, [{ text: `CEO${ceo ? ` · ${ceo.name}` : ''}`, size: 52 }], CEO_ACCENT)}
        deps={[ceo?.name]}
      />
      {ceo && <Desk agent={ceo} accent={CEO_ACCENT} repoId="" position={CEO_DESK_AT} />}
      {ceo && <ActivityIcon agent={ceo} />}
      <CeoBoard />
      <Plant position={[c.maxX - 0.7, 0, c.maxZ - 0.7]} scale={1.1} pot={CEO_ACCENT} />
      <Plant position={[c.minX + 0.6, 0, c.maxZ - 0.6]} scale={0.9} />
    </group>
  );
}

/** A pending hire as a person: the look they'll have once hired, sitting in the waiting room. */
function candidateAgent(r: HireRequestView): Agent {
  return {
    id: r.id,
    name: r.name,
    repoId: r.repoId,
    role: r.role,
    title: r.title,
    specialty: r.specialty,
    brief: r.brief,
    hiredBy: 'ceo',
    look: r.look,
    task: null,
    desk: 0,
    color: r.color,
    hair: r.hair,
    skin: r.skin,
    model: r.model,
    effort: r.effort,
    cli: '',
    terminal: false,
    status: 'idle',
    issueNumber: null,
    issueTitle: null,
    branch: null,
    prNumber: null,
    prUrl: null,
    currentTool: null,
    startedAt: null,
    endedAt: null,
    costUsd: 0,
    turns: 0,
    browserUrl: null,
    hasScreenshot: false,
    screenshotAt: null,
    lastError: null,
  };
}

function CandidateTag({ req }: { req: HireRequestView }) {
  const floor = useStore((s) => s.repos.find((r) => r.id === req.repoId)?.floor ?? null);
  const tex = useCanvasTexture(512, 128, (ctx) => drawCandidateTag(ctx, 512, 128, req.name, req.title, floor, req.color), [req.name, req.title, floor, req.color]);
  return (
    <Billboard position={[0, 1.95, -0.1]}>
      <mesh>
        <planeGeometry args={[1.15, 0.29]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </Billboard>
  );
}

function WaitingChair({ z, req }: { z: number; req: HireRequestView | null }) {
  const ref = useInteractable<THREE.Group>(
    req ? { id: `candidate-${req.id}`, label: `Read ${req.name}'s resume (${req.title})`, action: { kind: 'phone', tab: 'hires', requestId: req.id } } : null,
    3.2,
  );
  const agent = useMemo(() => (req ? candidateAgent(req) : null), [req]);
  const seat = '#06d6a0';
  return (
    <group ref={ref} position={[WAITING.x, 0, z]} rotation={[0, WAITING_ROTATION, 0]}>
      <Box size={[0.52, 0.08, 0.5]} position={[0, 0.44, 0]} color={seat} outline />
      <Box size={[0.48, 0.42, 0.07]} position={[0, 0.72, 0.28]} color={seat} outline />
      {[
        [-0.22, -0.2],
        [0.22, -0.2],
        [-0.22, 0.2],
        [0.22, 0.2],
      ].map(([x, zz]) => (
        <Box key={`${x}${zz}`} size={[0.05, 0.42, 0.05]} position={[x, 0.2, zz]} color="#444a5c" />
      ))}
      {agent && <Character agent={agent} />}
      {req && <CandidateTag req={req} />}
    </group>
  );
}

function WaitingRoom() {
  const requests = useStore((s) => s.requests);
  const waiting = useMemo(() => pendingRequests(requests).filter((r) => r.kind === 'hire'), [requests]);
  const n = waiting.length;
  return (
    <group>
      {WAITING.seats.map((z, i) => (
        <WaitingChair key={z} z={z} req={waiting[i] ?? null} />
      ))}
      <WallSign
        position={[HALF_W - 0.03, 2.5, (WAITING.seats[0] + WAITING.seats[WAITING.seats.length - 1]) / 2]}
        rotationY={-Math.PI / 2}
        size={[3.6, 0.62]}
        px={[864, 150]}
        draw={(ctx) =>
          drawSign(ctx, 864, 150, [{ text: n ? `🪑 Waiting room · ${n} candidate${n === 1 ? '' : 's'}${n > WAITING.seats.length ? ` (${n - WAITING.seats.length} more outside)` : ''}` : '🪑 Waiting room', size: 50 }], '#06a77d')
        }
        deps={[n]}
      />
    </group>
  );
}

export function Lobby() {
  const m = MANAGER_ROOM;
  const user = useStore((s) => s.user);
  const managerName = useStore((s) => s.settings.managerName);
  const company = useStore((s) => s.settings.companyName);
  const boss = managerName || user;
  return (
    <group>
      <Shell kind="lobby" accent={ACCENT} floorColor="#e2c7a3" />
      <Rug position={[(LOBBY_RUG.minX + LOBBY_RUG.maxX) / 2, 0.004, (LOBBY_RUG.minZ + LOBBY_RUG.maxZ) / 2]} size={[LOBBY_RUG.maxX - LOBBY_RUG.minX, LOBBY_RUG.maxZ - LOBBY_RUG.minZ]} color="#ffd6a5" />

      {/* manager's office */}
      <Rug position={[(m.minX + m.maxX) / 2, 0.005, (m.minZ + m.maxZ) / 2]} size={[m.maxX - m.minX, m.maxZ - m.minZ]} color="#cde7e1" />
      <GlassWall from={[m.maxX, m.minZ]} to={[m.maxX, m.maxZ]} />
      <GlassWall from={[m.minX, m.maxZ]} to={[m.doorMinX, m.maxZ]} />
      <GlassWall from={[m.doorMaxX, m.maxZ]} to={[m.maxX, m.maxZ]} />
      <Box size={[m.doorMaxX - m.doorMinX, 0.5, 0.1]} position={[(m.doorMinX + m.doorMaxX) / 2, 2.55, m.maxZ]} color="#8d99ae" />
      <WallSign
        position={[(m.doorMinX + m.doorMaxX) / 2, 3.1, m.maxZ + 0.06]}
        rotationY={0}
        size={[3.4, 0.5]}
        px={[816, 120]}
        draw={(ctx) => drawSign(ctx, 816, 120, [{ text: `MANAGER${boss ? ` · ${boss}` : ''}`, size: 52 }], '#2b2d42')}
        deps={[boss]}
      />
      <ManagerComputer />
      <Bookshelf position={[-HALF_W + 0.4, 0, -8]} rotationY={Math.PI / 2} />
      <Plant position={[m.maxX - 0.6, 0, m.minZ + 0.6]} scale={1.1} pot="#3a86ff" />
      <Plant position={[m.minX + 0.6, 0, m.maxZ - 0.6]} scale={0.9} />
      <WallSign
        position={[MANAGER_DESK.x, 2.3, -HALF_D + 0.03]}
        rotationY={0}
        size={[2.4, 1.2]}
        px={[512, 256]}
        draw={(ctx) =>
          drawSign(ctx, 512, 256, [
            { text: '⭐', size: 70 },
            { text: 'World’s Best', size: 44, weight: 600 },
            { text: 'Agent Wrangler', size: 50 },
          ], '#9b5de5')
        }
        deps={[]}
      />

      {/* reception */}
      <group position={[RECEPTION.x, 0, RECEPTION.z]}>
        <Box size={[RECEPTION.w, 1.05, RECEPTION.d]} position={[0, 0.525, 0]} color="#ffffff" outline />
        <Box size={[RECEPTION.w + 0.1, 0.08, RECEPTION.d + 0.1]} position={[0, 1.09, 0]} color={ACCENT} outline />
        <Box size={[RECEPTION.w - 0.4, 0.3, 0.02]} position={[0, 0.6, RECEPTION.d / 2 + 0.01]} color={shade(ACCENT, 0.15)} shadow={false} />
        {/* a very cheerful receptionist bot */}
        <group position={[0, 1.13, -0.1]}>
          <Cyl r={0.2} rTop={0.16} h={0.4} position={[0, 0.2, 0]} color="#e9ecef" outline />
          <Ball r={0.22} position={[0, 0.58, 0]} color="#f8f9fa" outline />
          <mesh position={[-0.08, 0.6, 0.2]} material={glow('#4cc9f0')}>
            <sphereGeometry args={[0.035, 10, 8]} />
          </mesh>
          <mesh position={[0.08, 0.6, 0.2]} material={glow('#4cc9f0')}>
            <sphereGeometry args={[0.035, 10, 8]} />
          </mesh>
          <Cyl r={0.012} h={0.2} position={[0, 0.88, 0]} color="#adb5bd" />
          <mesh position={[0, 0.99, 0]} material={glow(ACCENT)}>
            <sphereGeometry args={[0.045, 10, 8]} />
          </mesh>
        </group>
      </group>
      <WallSign
        position={[3, 2.25, -HALF_D + 0.03]}
        rotationY={0}
        size={[7, 1.6]}
        px={[1400, 320]}
        draw={(ctx) =>
          drawSign(ctx, 1400, 320, [
            { text: `✻ ${company || 'cubefarm'}`, size: 120 },
            { text: company ? 'powered by a team of AI coding agents' : 'a team of AI coding agents', size: 48, weight: 500 },
          ], ACCENT)
        }
        deps={[company]}
      />

      <MissionControl />
      <CeoOffice />
      <WaitingRoom />
      <Elevator floorLabel="▲ G · Lobby" accent={ACCENT} />
      <Toys floor="lobby" />
      <Directory />
      <TrophyCabinet />
      <WallClock position={[8.4, 2.8, -HALF_D + 0.05]} />
      <Couch position={[11.5, 0, 4]} rotationY={Math.PI} color="#4cc9f0" />
      <CoffeeTable position={[11.5, 0, 6.2]} />
      <Jukebox x={JUKEBOX.lobbyX} floor={0} />
      {/* coffee for visitors, across from the sofa: the counter's front faces north, into the lobby */}
      <CoffeeCorner position={[COFFEE_CORNER.x, 0, HALF_D - COFFEE_CORNER.d / 2 + 0.02]} rotationY={-Math.PI / 2} />
      <Plant position={[HALF_W - 0.7, 0, HALF_D - 0.7]} scale={1.2} />
      <Plant position={[-HALF_W + 0.7, 0, HALF_D - 0.7]} scale={1.2} pot="#06d6a0" />
      <Plant position={[-3, 0, HALF_D - 0.6]} />
      <Plant position={[3, 0, -HALF_D + 0.7]} scale={0.8} />
    </group>
  );
}
