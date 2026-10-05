import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import type { HireRequestView } from '../../../shared/types';
import { useStore, type Agent } from '../store';
import { WALK_SPEED } from './body';
import { playerAt } from './camera/rig';
import { Character } from './Character';
import { drawCandidateTag, drawSign } from './draw';
import { headingFor, nextWaypoint } from './errands';
import { RISE_SECONDS, chairFront, declinedRoute, greetSpot, hiredRoute, leave, reactionFor, syncCandidates, type Lobby, type LobbyCandidate, type Reaction } from './hiring';
import { doorWalkers, setLobby } from './hiringState';
import { useCanvasTexture, useInteractable } from './interact';
import { HALF_W, WAITING, WAITING_ROTATION, WAITING_TABLE } from './layout';
import { WallSign } from './OfficeFloor';
import { bodyState, say, seatBody, setBody } from './people';
import { headingTo } from './socials';
import { BILLBOARD } from './viewTags';
import { Box, Cyl } from './Toon';
import type { Pt } from './toys/roombaBrain';
import { standable, steer, walkways } from './walkways';

// The lobby's waiting room (#227): a candidate in a chair for each hire the CEO has proposed, up to six, then "+N
// waiting" on the sign. E on one opens their interview (ui/Interview.tsx). However the manager decides (there, on the
// phone or in the console), the candidate takes it in person: up out of the chair, a big smile and a handshake, then
// the elevator up to their floor; or a polite nod and out through the glass door. hiring.ts has the rules.

const SEAT = '#06d6a0';
const WEST = Math.PI; // walkways.ts facing: into the lobby
const STAND_FRONT = { x: 0, z: -0.6 }; // chair space: they stand up straight ahead, not beside the chair (the next one's there)
const GIVE_UP = 60; // seconds of walking out before they just go

/** A pending hire as a person: the look they'll have once hired. */
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
    style: null,
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
    career: null,
  };
}

/** Their CV in a manila folder: in their hands on the way out (Character's torso frame, the 'hold' gesture)... */
const CARRIED_CV = (
  <group position={[0, 0.16, -0.36]} rotation={[0.3, 0, 0]}>
    <Box size={[0.26, 0.34, 0.03]} color="#e9c46a" outline />
    <Box size={[0.22, 0.29, 0.01]} position={[0, 0.02, -0.018]} color="#fffdf6" shadow={false} />
  </group>
);
/** ...and on their lap while they wait (chair space), propped against their hands. */
const LAP_CV = (
  <group position={[0, 0.7, -0.3]} rotation={[0.35, 0, 0]}>
    <Box size={[0.26, 0.34, 0.03]} color="#e9c46a" outline />
    <Box size={[0.22, 0.29, 0.01]} position={[0, 0.02, -0.018]} color="#fffdf6" shadow={false} />
    <Box size={[0.08, 0.03, 0.03]} position={[-0.07, 0.18, 0]} color="#e9c46a" shadow={false} />
  </group>
);

/** Name tags take turns high and low, so neighbours' don't overlap. */
function CandidateTag({ req, high }: { req: HireRequestView; high: boolean }) {
  const floor = useStore((s) => s.repos.find((r) => r.id === req.repoId)?.floor ?? null);
  const tex = useCanvasTexture(512, 128, (ctx) => drawCandidateTag(ctx, 512, 128, req.name, req.title, floor, req.color), [req.name, req.title, floor, req.color]);
  return (
    <Billboard position={[0, high ? 2.3 : 1.95, -0.1]} userData={BILLBOARD}>
      <mesh>
        <planeGeometry args={[1.25, 0.31]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </Billboard>
  );
}

function Candidate({ c, req }: { c: LobbyCandidate; req: HireRequestView }) {
  const waiting = c.phase === 'waiting';
  const ref = useInteractable<THREE.Group>(waiting ? { id: `candidate-${req.id}`, label: `Interview ${req.name} (${req.title})`, action: { kind: 'interview', requestId: req.id } } : null, 3.4);
  const agent = useMemo(() => candidateAgent(req), [req]);
  const lap = useRef<THREE.Group>(null);
  useFrame(() => {
    const seated = (bodyState(req.id)?.stage ?? 'seated') === 'seated';
    if (lap.current && lap.current.visible !== seated) lap.current.visible = seated;
  });
  // Gone (out the door, into the elevator, or the lobby left behind): nothing of them stays standing about.
  useEffect(
    () => () => {
      seatBody(req.id);
      say(req.id, null);
    },
    [req.id],
  );
  return (
    <group ref={ref} position={[WAITING.x, 0, WAITING.seats[c.seat]]} rotation={[0, WAITING_ROTATION, 0]}>
      <Character agent={agent} carrying={CARRIED_CV} standAt={STAND_FRONT} />
      <group ref={lap}>{LAP_CV}</group>
      {waiting && <CandidateTag req={req} high={c.seat % 2 === 1} />}
    </group>
  );
}

function WaitingChair({ z }: { z: number }) {
  return (
    <group position={[WAITING.x, 0, z]} rotation={[0, WAITING_ROTATION, 0]}>
      <Box size={[0.52, 0.08, 0.5]} position={[0, 0.44, 0]} color={SEAT} outline />
      <Box size={[0.48, 0.42, 0.07]} position={[0, 0.72, 0.28]} color={SEAT} outline />
      {[
        [-0.22, -0.2],
        [0.22, -0.2],
        [-0.22, 0.2],
        [0.22, 0.2],
      ].map(([x, zz]) => (
        <Box key={`${x}${zz}`} size={[0.05, 0.42, 0.05]} position={[x, 0.2, zz]} color="#444a5c" />
      ))}
    </group>
  );
}

/** The little coffee table between the chairs: magazines, a carafe of water and a couple of glasses. */
function WaitingTable() {
  const t = WAITING_TABLE;
  return (
    <group position={[t.x, 0, t.z]}>
      <Box size={[t.w, 0.05, t.d]} position={[0, 0.47, 0]} color="#f1d19b" outline />
      <Box size={[t.w - 0.12, 0.42, t.d - 0.12]} position={[0, 0.22, 0]} color="#c9a26b" />
      <Box size={[0.22, 0.02, 0.3]} position={[0.05, 0.505, -0.2]} rotation={[0, 0.25, 0]} color="#ef476f" />
      <Box size={[0.22, 0.02, 0.3]} position={[0.02, 0.525, -0.17]} rotation={[0, -0.15, 0]} color="#4cc9f0" />
      <Cyl r={0.06} rTop={0.045} h={0.22} position={[-0.05, 0.6, 0.2]} color="#bde0fe" outline />
      <Cyl r={0.035} h={0.09} position={[0.13, 0.54, 0.25]} color="#e7f5ff" />
      <Cyl r={0.035} h={0.09} position={[0.12, 0.54, 0.1]} color="#e7f5ff" />
    </group>
  );
}

/** Someone the manager has decided on, as they take it in and leave. */
interface Leaving {
  t: number;
  react: Reaction;
  near: boolean;
  spot: Pt;
  said: boolean;
  path: Pt[] | null;
  wp: number;
}

/** Walks decided candidates through their reaction and out; `gone` once they're out of the building (or the cabin). */
function useDepartures(list: LobbyCandidate[], gone: (id: string) => void) {
  const w = walkways('lobby');
  const runs = useMemo(() => new Map<string, Leaving>(), []);
  const latest = useRef(list);
  latest.current = list;
  const player = useMemo(() => ({ x: 0, z: 0 }), []);
  useEffect(
    () => () => {
      runs.clear();
      doorWalkers.clear();
    },
    [runs],
  );
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    player.x = playerAt.x; // where you stand, even while the overview or the follow cam has the camera
    player.z = playerAt.z;
    const finish = (id: string) => {
      runs.delete(id);
      doorWalkers.delete(id);
      gone(id);
    };
    for (const c of latest.current) {
      if (c.phase === 'waiting') continue;
      const st = bodyState(c.id);
      if (!st) continue; // not drawn yet
      let r = runs.get(c.id);
      if (!r) {
        const g = greetSpot(c.seat, player, (x, z) => standable(w, x, z));
        r = { t: 0, react: reactionFor(c.phase, g.near), near: g.near, spot: c.phase === 'hired' ? g.at : chairFront(c.seat), said: false, path: null, wp: 0 };
        runs.set(c.id, r);
        if (c.phase === 'declined') doorWalkers.add(c.id);
      }
      r.t += dt;
      // Up, over (to shake hands), and a moment to react, facing the manager when they're about.
      if (r.t < RISE_SECONDS + r.react.seconds) {
        const reacting = r.t >= RISE_SECONDS;
        if (reacting && !r.said) {
          say(c.id, r.react.say);
          r.said = true;
        }
        const face = r.near ? headingTo(r.spot, player) : headingFor(WEST);
        setBody(c.id, { mode: 'standing', x: r.spot.x, z: r.spot.z, heading: face, speed: WALK_SPEED, gesture: reacting ? r.react.gesture : 'none' });
        continue;
      }
      if (!r.path) {
        say(c.id, c.phase === 'declined' ? '👋' : null);
        r.path = (c.phase === 'hired' ? hiredRoute(w, st) : declinedRoute(w, st)) ?? [];
      }
      r.wp = nextWaypoint(r.path, r.wp, st);
      const goal = r.path[r.wp];
      const d = goal ? Math.hypot(goal.x - st.x, goal.z - st.z) : 0;
      if (!goal || (r.wp === r.path.length - 1 && d < 0.25) || r.t > GIVE_UP) {
        finish(c.id);
        continue;
      }
      if (r.t > RISE_SECONDS + r.react.seconds + 2.5) say(c.id, null);
      // Never through the manager: wait for them to step aside (out on the patio there's nobody else to mind).
      const s = d > 0.05 ? steer({ id: c.id, x: st.x, z: st.z, dx: (goal.x - st.x) / d, dz: (goal.z - st.z) / d }, [], Math.abs(st.x) > HALF_W ? null : player) : null;
      if (s?.wait) setBody(c.id, { mode: 'standing', x: st.x, z: st.z, heading: st.heading, gesture: 'hold' });
      else setBody(c.id, { mode: 'walking', x: goal.x, z: goal.z, heading: Math.atan2(-(goal.x - st.x), -(goal.z - st.z)), speed: WALK_SPEED * Math.max(0.35, s?.speed ?? 1), gesture: 'hold' });
    }
  });
}

export function WaitingRoom() {
  const requests = useStore((s) => s.requests);
  const [lobby, setLobbyState] = useState<Lobby>(() => syncCandidates({ list: [], outside: 0 }, requests));
  useEffect(() => setLobbyState((l) => syncCandidates(l, requests)), [requests]);
  useEffect(() => setLobby(lobby), [lobby]);
  useEffect(() => () => setLobby(null), []);
  const gone = useCallback((id: string) => setLobbyState((l) => leave(l, id)), []);
  useDepartures(lobby.list, gone);
  const byId = useMemo(() => new Map(requests.map((r) => [r.id, r])), [requests]);
  // Someone leaving whose proposal has been dropped meanwhile isn't drawn: free their chair.
  useEffect(() => {
    for (const c of lobby.list) if (!byId.has(c.id)) gone(c.id);
  }, [lobby, byId, gone]);
  const n = lobby.list.filter((c) => c.phase === 'waiting').length;
  const out = lobby.outside;
  const sign = useInteractable<THREE.Group>(n + out > 0 ? { id: 'waiting-room', label: 'See every candidate on your phone', action: { kind: 'phone', tab: 'hires' } } : null, 5);
  const label = n + out ? `${n} candidate${n === 1 ? '' : 's'}${out ? ` · +${out} waiting` : ''}` : 'nobody waiting';
  return (
    <group>
      {WAITING.seats.map((z) => (
        <WaitingChair key={z} z={z} />
      ))}
      <WaitingTable />
      {lobby.list.map((c) => {
        const req = byId.get(c.id);
        return req ? <Candidate key={c.id} c={c} req={req} /> : null;
      })}
      <group ref={sign}>
        <WallSign
          position={[HALF_W - 0.03, 2.95, WAITING_TABLE.z]}
          rotationY={-Math.PI / 2}
          size={[3.6, 0.86]}
          px={[864, 206]}
          draw={(ctx) =>
            drawSign(
              ctx,
              864,
              206,
              [
                { text: '🪑 Waiting room', size: 54 },
                { text: label, size: 42, weight: 600, color: out ? '#ffe066' : '#ffffff' },
              ],
              '#06a77d',
            )
          }
          deps={[label, out]}
        />
      </group>
    </group>
  );
}
