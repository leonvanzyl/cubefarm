import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { useStore, type Agent } from '../store';
import { loadScreenshot } from '../screenshot';
import { Box, Cyl, Ball } from './Toon';
import { Character } from './Character';
import { drawSign, drawTag, drawTerminal } from './draw';
import { useCanvasTexture, useInteractable } from './interact';
import { glow, shade, toon } from './materials';
import { deskMug, subscribeMugs } from './people';
import { MUG_SIZE, MugLook, mugColor } from './toys/mugLook';

const SCREEN = { w: 1.0, h: 0.6, px: 896, py: 538 };
const WOOD = '#f1d19b';

/** The live terminal texture for one agent's laptop. Only repaints when something changed and the player is nearby. */
function useTerminalTexture(agent: Agent, anchor: React.RefObject<THREE.Object3D | null>) {
  const camera = useThree((s) => s.camera);
  const { canvas, tex } = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = SCREEN.px;
    canvas.height = SCREEN.py;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return { canvas, tex };
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);

  const dirty = useRef(true);
  const lastPaint = useRef(0);
  const shot = useRef<HTMLImageElement | null>(null);
  const agentRef = useRef(agent);
  agentRef.current = agent;
  useEffect(() => {
    dirty.current = true;
  }, [agent]);

  // Fetch only when there is a screenshot to fetch; a failed load keeps the last good one.
  useEffect(() => {
    const show = (img: HTMLImageElement) => {
      shot.current = img;
      dirty.current = true;
    };
    let cancel = loadScreenshot(agent.id, useStore.getState().screens[agent.id], show);
    const unsubscribe = useStore.subscribe((s, prev) => {
      if (s.logs[agent.id] !== prev.logs[agent.id]) dirty.current = true;
      const at = s.screens[agent.id];
      if (at && at !== prev.screens[agent.id]) {
        cancel();
        cancel = loadScreenshot(agent.id, at, show);
      }
    });
    return () => {
      unsubscribe();
      cancel();
    };
  }, [agent.id]);
  useEffect(() => {
    document.fonts?.ready.then(() => (dirty.current = true));
  }, []);

  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const now = performance.now();
    const a = agentRef.current;
    const animating = a.status === 'working' || a.status === 'preparing' || (a.status === 'idle' && (useStore.getState().logs[a.id]?.length ?? 0) <= 1);
    if (!dirty.current && !(animating && now - lastPaint.current > 200)) return;
    if (anchor.current) {
      anchor.current.getWorldPosition(tmp);
      const dist = tmp.distanceTo(camera.position);
      if (dist > 16 && lastPaint.current !== 0) return;
      if (dist > 8 && now - lastPaint.current < 900) return;
    }
    if (now - lastPaint.current < 120) return;
    lastPaint.current = now;
    dirty.current = false;
    const logs = useStore.getState().logs[a.id] ?? [];
    const recentShot = a.screenshotAt != null && Date.now() - a.screenshotAt < 120_000;
    const showBrowser = a.hasScreenshot && a.status !== 'idle' && (a.currentTool?.startsWith('mcp__playwright') || recentShot || a.status === 'done');
    const s = useStore.getState().settings;
    const program = a.role !== 'ceo' && s.runtime === 'terminal' ? a.cli || s.defaultCli : 'claude';
    drawTerminal(canvas.getContext('2d')!, SCREEN.px, SCREEN.py, a, logs, shot.current, !!showBrowser, now, program);
    tex.needsUpdate = true;
  });
  return tex;
}

export function NameTag({ agent }: { agent: Agent }) {
  const tex = useCanvasTexture(512, 96, (ctx) => drawTag(ctx, 512, 96, agent), [agent.name, agent.status, agent.issueNumber, agent.currentTool, agent.color]);
  return (
    // placed by Character, which carries it about with the person
    <Billboard>
      <mesh>
        <planeGeometry args={[1.15, 0.216]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </Billboard>
  );
}

const MONITOR = { y: 1.31, z: -0.3, tilt: -0.06 };
const BEZEL = '#2b2d42';
const STAND = '#3d4152';

/** Desktop monitor on a slim stand, set back on the desk so it stays readable over the agent's head. */
function Monitor({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <group>
      <Cyl r={0.17} rTop={0.15} h={0.025} position={[0, 0.782, MONITOR.z - 0.04]} color={STAND} outline />
      <Box size={[0.07, 0.36, 0.05]} position={[0, 0.95, MONITOR.z - 0.07]} color={STAND} outline />
      <group position={[0, MONITOR.y, MONITOR.z]} rotation={[MONITOR.tilt, 0, 0]}>
        <Box size={[SCREEN.w + 0.07, SCREEN.h + 0.07, 0.05]} color={BEZEL} outline />
        <Box size={[0.6, 0.36, 0.07]} position={[0, 0, -0.055]} color={STAND} />
        {children}
        <mesh position={[0, 0, -0.091]} rotation={[0, Math.PI, 0]} material={glow(accent)}>
          <circleGeometry args={[0.06, 24]} />
        </mesh>
        <mesh position={[SCREEN.w / 2 - 0.02, -SCREEN.h / 2 - 0.018, 0.026]} material={glow('#7CFFB2')}>
          <circleGeometry args={[0.008, 10]} />
        </mesh>
      </group>
    </group>
  );
}

function LiveMonitor({ agent, accent }: { agent: Agent; accent: string }) {
  const screenRef = useRef<THREE.Mesh>(null);
  const tex = useTerminalTexture(agent, screenRef);
  return (
    <Monitor accent={accent}>
      <mesh ref={screenRef} position={[0, 0, 0.026]}>
        <planeGeometry args={[SCREEN.w, SCREEN.h]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </Monitor>
  );
}

function VacantMonitor({ accent, qa }: { accent: string; qa: boolean }) {
  const tex = useCanvasTexture(
    640,
    384,
    (ctx) => {
      ctx.fillStyle = '#151621';
      ctx.fillRect(0, 0, 640, 384);
      drawSign(ctx, 640, 384, [
        { text: qa ? '🔍' : '🪑', size: 70 },
        { text: qa ? 'QA STATION' : 'VACANT', size: 70, color: '#ffd6a5' },
        { text: qa ? 'press E or click to hire a tester' : 'press E or click to hire an agent', size: 36, color: '#a9adc6', weight: 500 },
      ], 'rgba(0,0,0,0)');
    },
    [qa],
  );
  return (
    <Monitor accent={accent}>
      <mesh position={[0, 0, 0.026]}>
        <planeGeometry args={[SCREEN.w, SCREEN.h]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </Monitor>
  );
}

function Keyboard() {
  const tex = useCanvasTexture(
    512,
    176,
    (ctx) => {
      ctx.fillStyle = '#d7dbe3';
      ctx.fillRect(0, 0, 512, 176);
      const rows = [14, 13, 12, 11];
      rows.forEach((n, r) => {
        const kw = (496 - (n - 1) * 5) / n;
        for (let i = 0; i < n; i++) {
          ctx.fillStyle = r === 0 && (i === 0 || i === n - 1) ? '#ffb4a2' : '#ffffff';
          ctx.beginPath();
          ctx.roundRect(8 + i * (kw + 5), 8 + r * 34, kw, 28, 6);
          ctx.fill();
        }
      });
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(130, 144, 252, 26, 6);
      ctx.fill();
    },
    [],
  );
  return (
    <group position={[0, 0.77, 0.27]}>
      <Box size={[0.52, 0.03, 0.18]} position={[0, 0.015, 0]} color="#c3c8d3" outline />
      <mesh position={[0, 0.031, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.5, 0.17]} />
        <meshToonMaterial map={tex} />
      </mesh>
      {/* mouse + pad */}
      <mesh position={[0.46, 0.002, 0.02]} rotation={[-Math.PI / 2, 0, 0]} material={toon('#3d4152')}>
        <planeGeometry args={[0.24, 0.2]} />
      </mesh>
      <mesh position={[0.46, 0.022, 0.02]} scale={[0.75, 0.5, 1]} material={toon('#f4f4f8')} castShadow>
        <sphereGeometry args={[0.05, 14, 10]} />
      </mesh>
    </group>
  );
}

/** The mug on the desk; for a while after a coffee break, the coffee they brought back, full and steaming. */
function DeskMug({ agentId, color }: { agentId: string; color: string }) {
  const coffee = useSyncExternalStore(subscribeMugs, () => deskMug(agentId));
  const [, expire] = useState(0);
  useEffect(() => {
    if (!coffee) return;
    const t = setTimeout(() => expire((n) => n + 1), Math.max(0, coffee.until - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [coffee]);
  const fresh = coffee && coffee.until > Date.now() ? coffee : null;
  if (!fresh) return <Cyl r={0.045} h={0.1} color={color} outline />;
  return (
    // the parent group sits at the plain mug's centre, 0.82 (desk top 0.77 plus half its height)
    <group position={[0, MUG_SIZE.h / 2 - 0.05, 0]} rotation={[0, Math.PI / 2, 0]}>
      <MugLook color={mugColor(fresh.id)} sips={fresh.sips} />
    </group>
  );
}

const LAB_BENCH = '#dfe7ef';
const QA_ORANGE = '#ff9f68';

/**
 * Memoised: the floor re-renders on every agent event (a tool call, a log line), and without this every desk,
 * person and monitor on it would re-render with it. Give it stable props (a position that isn't a new array).
 */
export const Desk = memo(function Desk({
  agent,
  accent,
  repoId,
  position,
  role = 'dev',
  rotationY = 0,
}: {
  agent: Agent | null;
  accent: string;
  repoId: string;
  position: [number, number, number];
  role?: 'dev' | 'qa';
  rotationY?: number;
}) {
  const qa = role === 'qa';
  const ref = useInteractable<THREE.Group>(
    agent
      ? {
          id: `agent-${agent.id}`,
          label: agent.role === 'ceo' ? `Open ${agent.name}'s desk (CEO) · P texts them from anywhere` : `View ${agent.name}'s ${qa ? 'test run' : 'terminal'} · ⚙️ Setup inside`,
          action: { kind: 'terminal', agentId: agent.id },
        }
      : {
          id: `vacant-${role}-${repoId}-${position.join()}`,
          label: qa ? 'Hire a QA tester for this station' : 'Hire an agent for this desk',
          action: { kind: 'hire', repoId, role },
        },
    3.6,
  );
  const mug = agent ? shade(agent.color, 0.1) : '#ffffff';
  const top = qa ? LAB_BENCH : WOOD;
  const chair = qa ? QA_ORANGE : accent;
  const chairRef = useRef<THREE.Group>(null);
  const mugRef = useRef<THREE.Group>(null);
  return (
    <group ref={ref} position={position} rotation={[0, rotationY, 0]}>
      {/* desk */}
      <Box size={[1.9, 0.06, 0.95]} position={[0, 0.74, 0]} color={top} outline />
      {[
        [-0.88, -0.42],
        [0.88, -0.42],
        [-0.88, 0.42],
        [0.88, 0.42],
      ].map(([x, z]) => (
        <Box key={`${x}${z}`} size={[0.06, 0.71, 0.06]} position={[x, 0.355, z]} color="#5c677d" />
      ))}
      <Box size={[1.76, 0.4, 0.03]} position={[0, 0.5, -0.44]} color={shade(top, -0.08)} />

      {agent ? (
        <>
          <LiveMonitor agent={agent} accent={accent} />
          <Keyboard />
          {/* the mug: its owner picks it up for a sip now and then */}
          <group ref={mugRef} position={[0.76, 0.82, 0.02]}>
            <DeskMug agentId={agent.id} color={mug} />
          </group>
        </>
      ) : (
        <VacantMonitor accent={accent} qa={qa} />
      )}
      {qa ? (
        // test-tube rack: every good QA desk has one
        <group position={[-0.72, 0.77, -0.2]}>
          <Box size={[0.3, 0.05, 0.1]} position={[0, 0.06, 0]} color="#adb5bd" outline />
          {['#ff6b6b', '#4cc9f0', '#80ed99'].map((c, i) => (
            <Cyl key={c} r={0.022} h={0.16} position={[-0.09 + i * 0.09, 0.1, 0]} color={c} outline />
          ))}
        </group>
      ) : (
        <>
          <Cyl r={0.06} rTop={0.07} h={0.09} position={[-0.76, 0.815, -0.22]} color="#e07a5f" outline />
          <Ball r={0.09} position={[-0.76, 0.92, -0.22]} color="#52b788" outline />
        </>
      )}

      {/* chair (it rolls back when its owner gets up) */}
      <group ref={chairRef} position={[0, 0, agent ? 0.8 : 0.6]}>
        <Box size={[0.52, 0.08, 0.5]} position={[0, 0.44, 0]} color={chair} outline />
        <Box size={[0.48, 0.42, 0.07]} position={[0, 0.72, 0.28]} color={chair} outline />
        <Cyl r={0.035} h={0.36} position={[0, 0.22, 0]} color="#444a5c" />
        <Cyl r={0.26} h={0.04} position={[0, 0.03, 0]} color="#444a5c" />
      </group>
      {agent && (
        <group position={[0, 0, 0.8]}>
          <Character key={agent.id} agent={agent} chair={chairRef} mug={mugRef}>
            <NameTag agent={agent} />
          </Character>
        </group>
      )}
    </group>
  );
});

export function DeskFloorMarker({ color }: { color: string }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0.3]} receiveShadow material={toon(color, { opacity: 0.35 })}>
      <planeGeometry args={[2.6, 2.3]} />
    </mesh>
  );
}
