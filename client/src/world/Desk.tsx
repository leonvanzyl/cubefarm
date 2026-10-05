import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import { BILLBOARD } from './viewTags';
import * as THREE from 'three';
import { useStore, type Agent } from '../store';
import { loadScreenshot } from '../screenshot';
import { look, type Look } from './batch';
import { Part } from './Batched';
import { useA11y } from '../ui/a11y';
import { showsShapes } from '../ui/a11yPrefs';
import { Box, Cyl, Ball } from './Toon';
import { Character } from './Character';
import { greetPick } from './Chatter';
import { drawSign, drawTag, drawTerminal } from './draw';
import { useCanvasTexture, useInteractable } from './interact';
import { PaintedTexture } from './paint/painter';
import { BLOOM } from './gfx/bloomMarks';
import { DeskGlow } from './gfx/ScreenGlow';
import { shade, toon } from './materials';
import { deskMug, subscribeMugs } from './people';
import { MUG_SIZE, MugLook, mugColor } from './toys/mugLook';
import { useKeyName } from '../ui/controls';

const SCREEN = { w: 1.0, h: 0.6, px: 896, py: 538 };
const WOOD = '#f1d19b';

/**
 * The live terminal texture for one agent's laptop. Only repaints when something changed and the player is nearby, in
 * the paint worker where it can (paint/painter.ts).
 */
function useTerminalTexture(agent: Agent, anchor: React.RefObject<THREE.Object3D | null>) {
  const camera = useThree((s) => s.camera);
  const painted = useMemo(() => new PaintedTexture(SCREEN.px, SCREEN.py), []);
  useEffect(() => () => painted.dispose(), [painted]);

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
    const img = shot.current;
    painted.paint((ctx) => drawTerminal(ctx, SCREEN.px, SCREEN.py, a, logs, img, !!showBrowser, now, program));
  });
  return painted.texture;
}

// A tag's change of tool waits to be painted while it's further than this (too small to read from there).
const TAG_RANGE = 18;

export function NameTag({ agent }: { agent: Agent }) {
  const palette = useA11y((s) => s.prefs.palette);
  const shapes = useA11y((s) => showsShapes(s.prefs));
  const anchor = useRef<THREE.Mesh>(null);
  const tex = useCanvasTexture(
    512,
    96,
    (ctx) => drawTag(ctx, 512, 96, agent, { palette, shapes }),
    [agent.name, agent.status, agent.issueNumber, agent.currentTool, agent.color, palette, shapes],
    { anchor, range: TAG_RANGE },
  );
  return (
    // placed by Character, which carries it about with the person
    <Billboard userData={BILLBOARD}>
      <mesh ref={anchor}>
        <planeGeometry args={[1.15, 0.216]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </Billboard>
  );
}

const MONITOR = { y: 1.31, z: -0.3, tilt: -0.06 };
const BEZEL = '#2b2d42';
const STAND = '#3d4152';
// Shapes every desk shares, so a floor's desks draw them in one batch each (Batched.tsx).
const LOGO = look(new THREE.CircleGeometry(0.06, 24), { shading: 'glow' });
const LED = look(new THREE.CircleGeometry(0.008, 10), { shading: 'glow' });
const PAD = look(new THREE.PlaneGeometry(0.24, 0.2));
const MOUSE = look(new THREE.SphereGeometry(0.05, 14, 10), { castShadow: true });

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
        <Part look={LOGO} color={accent} position={[0, 0, -0.091]} rotation={[0, Math.PI, 0]} />
        <Part look={LED} color="#7CFFB2" position={[SCREEN.w / 2 - 0.02, -SCREEN.h / 2 - 0.018, 0.026]} />
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
        <meshBasicMaterial map={tex} toneMapped={false} userData={BLOOM} />
      </mesh>
    </Monitor>
  );
}

function VacantMonitor({ accent, qa }: { accent: string; qa: boolean }) {
  const use = useKeyName('interact');
  const tex = useCanvasTexture(
    640,
    384,
    (ctx) => {
      ctx.fillStyle = '#151621';
      ctx.fillRect(0, 0, 640, 384);
      drawSign(ctx, 640, 384, [
        { text: qa ? '🔍' : '🪑', size: 70 },
        { text: qa ? 'QA STATION' : 'VACANT', size: 70, color: '#ffd6a5' },
        { text: qa ? `press ${use} or click to hire a tester` : `press ${use} or click to hire an agent`, size: 36, color: '#a9adc6', weight: 500 },
      ], 'rgba(0,0,0,0)');
    },
    [qa, use],
  );
  return (
    <Monitor accent={accent}>
      <mesh position={[0, 0, 0.026]}>
        <planeGeometry args={[SCREEN.w, SCREEN.h]} />
        <meshBasicMaterial map={tex} toneMapped={false} userData={BLOOM} />
      </mesh>
    </Monitor>
  );
}

// Every keyboard is the same picture: painted once, on one material all of them share.
let keys: Look | null = null;
function keyboardKeys() {
  if (keys) return keys;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 176;
  const ctx = canvas.getContext('2d')!;
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
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  keys = look(new THREE.PlaneGeometry(0.5, 0.17), { material: new THREE.MeshToonMaterial({ map: tex }) });
  return keys;
}

function Keyboard() {
  return (
    <group position={[0, 0.77, 0.27]}>
      <Box size={[0.52, 0.03, 0.18]} position={[0, 0.015, 0]} color="#c3c8d3" outline />
      <Part look={keyboardKeys()} color="#ffffff" position={[0, 0.031, 0]} rotation={[-Math.PI / 2, 0, 0]} />
      {/* mouse + pad */}
      <Part look={PAD} color="#3d4152" position={[0.46, 0.002, 0.02]} rotation={[-Math.PI / 2, 0, 0]} />
      <Part look={MOUSE} color="#f4f4f8" position={[0.46, 0.022, 0.02]} scale={[0.75, 0.5, 1]} />
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

/**
 * The CEO suggests letting this person go: a sealed envelope on their desk with a ✉️ bobbing over it. E on it opens
 * the CEO's note (ui/Interview.tsx), where the manager lets them go or keeps them.
 */
function LetGoEnvelope({ agentId, name }: { agentId: string; name: string }) {
  const req = useStore((s) => s.requests.find((r) => r.kind === 'let-go' && r.status === 'pending' && r.agentId === agentId));
  return req ? <Envelope requestId={req.id} name={name} /> : null;
}

function Envelope({ requestId, name }: { requestId: string; name: string }) {
  const ref = useInteractable<THREE.Group>({ id: `letgo-${requestId}`, label: `Read the CEO's note about ${name}`, action: { kind: 'interview', requestId } }, 3.6);
  const marker = useRef<THREE.Group>(null);
  const tex = useCanvasTexture(
    128,
    128,
    (ctx) => {
      ctx.beginPath();
      ctx.arc(64, 64, 56, 0, Math.PI * 2);
      ctx.fillStyle = '#fffdf6';
      ctx.fill();
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#e07a5f';
      ctx.stroke();
      ctx.font = '64px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✉️', 64, 70);
    },
    [],
  );
  useFrame(({ clock }) => {
    if (marker.current) marker.current.position.y = 0.42 + Math.sin(clock.elapsedTime * 2.4) * 0.04;
  });
  return (
    <group ref={ref} position={[-0.45, 0.775, 0.18]} rotation={[0, 0.3, 0]}>
      <Box size={[0.3, 0.012, 0.2]} color="#fffdf6" outline />
      <Box size={[0.3, 0.004, 0.012]} position={[0, 0.008, 0.02]} rotation={[0, 0.55, 0]} color="#e9e2d0" shadow={false} />
      <Box size={[0.3, 0.004, 0.012]} position={[0, 0.008, 0.02]} rotation={[0, -0.55, 0]} color="#e9e2d0" shadow={false} />
      <Cyl r={0.028} h={0.012} position={[0, 0.012, 0.02]} color="#c1121f" />
      <group ref={marker} position={[0, 0.42, 0]}>
        <Billboard userData={BILLBOARD}>
          <mesh>
            <planeGeometry args={[0.3, 0.3]} />
            <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
          </mesh>
        </Billboard>
      </group>
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
  // Aiming at the person themselves, while they've nothing to do, says hi instead (Chatter.tsx).
  const agentId = agent?.id;
  const desk = agent?.role === 'ceo' ? 'to open it' : qa ? 'for their test run' : 'for their terminal';
  const greeting = useMemo(() => (agentId ? greetPick(agentId, desk) : undefined), [agentId, desk]);
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
    greeting,
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
          {agent.role !== 'ceo' && <LetGoEnvelope agentId={agent.id} name={agent.name} />}
        </>
      ) : (
        <VacantMonitor accent={accent} qa={qa} />
      )}
      <DeskGlow color={accent} />
      {qa ? (
        // test-tube rack: every good QA desk has one
        <group position={[-0.72, 0.77, -0.2]}>
          <Box size={[0.3, 0.05, 0.1]} position={[0, 0.06, 0]} color="#adb5bd" outline />
          {['#ff6b6b', '#4cc9f0', '#80ed99'].map((c, i) => (
            <Cyl key={c} r={0.022} h={0.16} position={[-0.09 + i * 0.09, 0.1, 0]} color={c} outline />
          ))}
        </group>
      ) : !agent || agent.role === 'ceo' ? (
        // a team member's plant grows with them (desk/DeskStory.tsx)
        <>
          <Cyl r={0.06} rTop={0.07} h={0.09} position={[-0.76, 0.815, -0.22]} color="#e07a5f" outline />
          <Ball r={0.09} position={[-0.76, 0.92, -0.22]} color="#52b788" outline />
        </>
      ) : null}

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
