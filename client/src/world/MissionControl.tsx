import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import type { OpsAlarm } from '../../../shared/types';
import { usageMeter } from '../ops';
import { officeNow } from '../officeTime';
import { useStore, type Focus } from '../store';
import { useKeyName } from '../ui/controls';
import { drawCost, drawFlow, drawPipeline, drawStrip, drawTeam, drawThroughput, drawUsage, type FloorTag, type UsageScreen } from './drawOps';
import { useCanvasTexture, useInteractable } from './interact';
import { HALF_D, MISSION, missionColumn } from './layout';
import { glow, toon } from './materials';
import { Box, Cyl } from './Toon';

// Mission control (#216): a curved bank of big screens on the lobby's north wall with the whole office's numbers from
// the server's ops view (the store, never polled), Claude's usage meter (E: resume full speed while pacing), and a
// beacon that spins when something needs the manager (E: the console at that card). Each screen repaints only when
// its own numbers change. window.__swarmOps shows what each screen last drew and how often it was painted.

const repaints: Record<string, number> = {};
const shown: Record<string, unknown> = {};

if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmOps')) {
  Object.defineProperty(window, '__swarmOps', {
    get: () => {
      const s = useStore.getState();
      return { ...s.ops, usage: s.usage, screens: { ...shown }, repaints: { ...repaints } };
    },
  });
}

/** A canvas texture keyed by the data it shows: it repaints when (and only when) that data changes. */
function useScreen<T>(name: string, px: [number, number], data: T, draw: (ctx: CanvasRenderingContext2D, w: number, h: number, data: T) => void) {
  const key = JSON.stringify(data);
  return useCanvasTexture(
    px[0],
    px[1],
    (ctx) => {
      repaints[name] = (repaints[name] ?? 0) + 1;
      shown[name] = data;
      draw(ctx, px[0], px[1], data);
    },
    [key],
  );
}

const BEZEL = '#23263a';
const POST = '#3d4057';
const TOP_PX: [number, number] = [1024, 602];
const BOTTOM_PX: [number, number] = [1024, 494];

/** A screen's picture, just in front of its column's bezel. */
function Face({ tex, w, h, y }: { tex: THREE.Texture; w: number; h: number; y: number }) {
  return (
    <mesh position={[0, y, 0.002]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  );
}

const additive = (color: string, opacity: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
const BEAM = additive('#ff3048', 0.45);

/** The rotating mirror inside a lit beacon: two beams sweeping round, and a red glow that throbs with them. */
function Sweep({ size }: { size: number }) {
  const ref = useRef<THREE.Group>(null);
  const halo = useMemo(() => additive('#ff2d43', 0.3), []);
  useFrame((state, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 4.5;
    halo.opacity = 0.22 + 0.2 * Math.abs(Math.sin(state.clock.elapsedTime * 4.5));
  });
  return (
    <group>
      <group ref={ref}>
        {[1, -1].map((side) => (
          <mesh key={side} material={BEAM} position={[side * size * 2.6, 0, 0]}>
            <planeGeometry args={[size * 5, size * 1.4]} />
          </mesh>
        ))}
        <mesh material={glow('#ffe1e5')} position={[0, 0, size * 0.25]}>
          <boxGeometry args={[size * 0.5, size * 0.5, size * 0.12]} />
        </mesh>
      </group>
      <Billboard>
        <mesh material={halo}>
          <circleGeometry args={[size * 2.6, 24]} />
        </mesh>
      </Billboard>
    </group>
  );
}

/** A warning beacon: dark until `on`, then a red dome with a beam sweeping round. `size` is the dome's radius. */
export function Beacon({ on, size = 0.11 }: { on: boolean; size?: number }) {
  return (
    <group>
      <Cyl r={size * 1.25} h={size * 0.5} position={[0, size * 0.25, 0]} color={POST} outline shadow={false} />
      <mesh position={[0, size * 0.5, 0]} material={on ? glow('#ff2d43') : toon('#7a3440')}>
        <sphereGeometry args={[size, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      {on && (
        <group position={[0, size * 0.85, 0]}>
          <Sweep size={size} />
        </group>
      )}
    </group>
  );
}

/** E on an alarm: the console at its card. The label is the alarm without its details ("PR #7 needs you"). */
const alarmFocus = (id: string, a: OpsAlarm): Focus => ({
  id,
  label: `🚨 ${a.text.split(':')[0]} on floor ${a.floor}: open it in the console`,
  action: { kind: 'manager', tab: 'ops', card: a.id },
});

export function MissionControl() {
  const use = useKeyName('interact');
  const ops = useStore((s) => s.ops);
  const repos = useStore((s) => s.repos);
  const usage = useStore((s) => s.usage);

  const tags = useMemo(
    () =>
      ops.floors.map((f) => {
        const r = repos.find((x) => x.id === f.repoId);
        const tag: FloorTag = { floor: f.floor, name: r ? (r.fullName.split('/')[1] ?? r.fullName) : f.repoId, color: r?.color ?? '#8d99ae' };
        return { tag, n: f };
      }),
    [ops.floors, repos],
  );
  const t = ops.total;

  const pipeline = useScreen(
    'pipeline',
    TOP_PX,
    {
      floors: tags.map(({ tag, n }) => ({ ...tag, ready: n.ready, building: n.building, inQa: n.inQa, fixing: n.fixing, toMerge: n.toMerge, needsYou: n.needsYou, triage: n.triage })),
      total: { ready: t.ready, building: t.building, inQa: t.inQa, fixing: t.fixing, toMerge: t.toMerge, needsYou: t.needsYou, triage: t.triage },
    },
    drawPipeline,
  );
  const throughput = useScreen(
    'throughput',
    TOP_PX,
    { today: t.mergedToday, hour: t.mergedHour, spark: t.spark, floors: tags.map(({ tag, n }) => ({ ...tag, today: n.mergedToday })) },
    drawThroughput,
  );
  const flowOf = (n: typeof t) => ({ leadMs: n.leadMs, qaWaitMs: n.qaWaitMs, qaPass: n.qaPass, ciPass: n.ciPass, ciRuns: n.ciRuns, ciMs: n.ciMs });
  const flow = useScreen('flow', TOP_PX, { total: flowOf(t), floors: tags.map(({ tag, n }) => ({ ...tag, ...flowOf(n) })) }, drawFlow);
  const team = useScreen(
    'team',
    BOTTOM_PX,
    { floors: tags.map(({ tag, n }) => ({ ...tag, busy: n.busy, idle: n.idle, errors: n.errors })), total: { busy: t.busy, idle: t.idle, errors: t.errors } },
    drawTeam,
  );
  const m = usageMeter(usage, officeNow());
  const meterData: UsageScreen = {
    ...m,
    hint: usage.state === 'pacing' ? `Press ${use} to resume full speed` : usage.state === 'paused' ? "A pause at the limit can't be cleared early" : 'New work starts at full speed',
  };
  const meter = useScreen('usage', BOTTOM_PX, meterData, drawUsage);
  const cost = useScreen('cost', BOTTOM_PX, { floors: tags.map(({ tag, n }) => ({ ...tag, usd: n.costToday })), ceo: ops.ceoCostToday, total: t.costToday }, drawCost);
  const alarm = ops.alarms[0] ?? null;
  const strip = useScreen('strip', [2048, 171], { alarms: ops.alarms.map((a) => (ops.floors.length > 1 ? `${a.text} · floor ${a.floor}` : a.text)) }, drawStrip);

  const wall = useInteractable<THREE.Group>(
    alarm ? alarmFocus('mission-control', alarm) : { id: 'mission-control', label: 'Mission control: open it in the console', action: { kind: 'manager', tab: 'ops' } },
    9,
  );
  const meterRef = useInteractable<THREE.Group>(
    usage.state === 'pacing'
      ? { id: 'usage-meter', label: "Resume full speed (Claude's usage is pacing new work)", action: { kind: 'resume' } }
      : { id: 'usage-meter', label: `Claude usage: ${m.state.toLowerCase()} · open it in the console`, action: { kind: 'manager', tab: 'ops', card: 'usage' } },
    5,
  );

  const cols = [-1, 0, 1].map(missionColumn);
  const { top, bottom, colW } = MISSION;
  const s = MISSION.strip;
  // One bezel per column behind both its screens (two boxes meeting edge to edge would flicker).
  const colTop = top.y + top.h / 2 + 0.045;
  const colBottom = bottom.y - bottom.h / 2 - 0.045;
  return (
    <group>
      <group ref={wall}>
        {cols.map((c, i) => (
          <group key={i} position={[c.x, 0, c.z]} rotation={[0, c.rotY, 0]}>
            <Box size={[colW + 0.09, colTop - colBottom, 0.07]} position={[0, (colTop + colBottom) / 2, -0.035]} color={BEZEL} outline shadow={false} />
            <Face tex={[pipeline, throughput, flow][i]} w={colW} h={top.h} y={top.y} />
            {i !== 1 && <Face tex={i === 0 ? team : cost} w={colW} h={bottom.h} y={bottom.y} />}
            {/* the outer columns stand on a post; the middle one hangs on the wall, over the roomba's dock */}
            {i !== 1 && <Box size={[0.12, colBottom, 0.06]} position={[0, colBottom / 2, -0.07]} color={POST} shadow={false} />}
          </group>
        ))}
        <group position={[MISSION.x, s.y, -HALF_D + 0.05]}>
          <Box size={[s.w + 0.08, s.h + 0.08, 0.06]} position={[0, 0, -0.01]} color={BEZEL} outline shadow={false} />
          <mesh position={[0, 0, 0.022]}>
            <planeGeometry args={[s.w, s.h]} />
            <meshBasicMaterial map={strip} toneMapped={false} />
          </mesh>
          <group position={[0, s.h / 2 + 0.04, 0.06]}>
            <Beacon on={!!alarm} size={0.12} />
          </group>
        </group>
      </group>
      <group ref={meterRef} position={[cols[1].x, 0, cols[1].z]}>
        <Face tex={meter} w={colW} h={bottom.h} y={bottom.y} />
      </group>
    </group>
  );
}

/** A floor sign's alarm: E on the sign opens the console at that floor's first alarm (its beacon spins meanwhile). */
export function useFloorAlarm(repoId: string) {
  const alarm = useStore((s) => s.ops.alarms.find((a) => a.repoId === repoId) ?? null);
  const ref = useInteractable<THREE.Group>(alarm ? alarmFocus(`floor-alarm-${repoId}`, alarm) : null, 7);
  return { alarm, ref };
}
