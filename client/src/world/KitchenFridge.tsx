import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useRenderPaused } from '../perf';
import { useStore } from '../store';
import { fridgeHum, listenerAt, type FridgeHum } from '../ui/sfx';
import { Slice } from './food';
import { SNACK_IDS, grabLabel, swingTo, type SnackId } from './fridge';
import { doorOpen, fridgeAt, fridgeVersion, lunchText, mountFridge, setLunchLabel, stockOf, subscribeFridge, tickFridge } from './fridgeState';
import { useInteractable } from './interact';
import { glow, toon } from './materials';
import { DRINK_H, SnackLook, Tupperware } from './SnackLook';
import { Ball, Box, Cyl } from './Toon';

// The kitchenette fridge (#291): E opens its door, which swings out on the handle side, a light comes on inside and
// the stock shows on its shelves and in the door's bins; E on a snack grabs it (fridgeState.ts), E on the door shuts
// it, and left open it beeps and then shuts by itself once everyone has walked away. It hums, very quietly. Its
// footprint is the old box's: 0.8 m square, 2 m tall, standing at `position` (the middle of its foot), its front
// facing local -x.

type V3 = [number, number, number];

const W = 0.8;
const H = 2;
const WHITE = '#f1f3f5';
const LINER = '#dfe7ef';
/** The hinge: the front's +z edge (the handle is on the -z side, where the old box had it). */
const HINGE: V3 = [-W / 2, 0, W / 2];
const RANGE = 3;
const TICK_MS = 250;

const linerDim = toon(LINER);
const linerLit = toon('#f8fbff', { emissive: '#fff4d6', emissiveIntensity: 0.55 });
const bulbOff = toon('#ced4da');
const bulbOn = glow('#fff3c4');

/** Where each snack's items stand: in the door's bins (hinge frame) or on a shelf (the fridge's frame), one after another. */
interface Slot {
  door: boolean;
  at: V3;
  step: V3;
  /** Turned on the shelf (bars lie front to back). */
  turn?: number;
  /** The aim box round the slot: its middle and size. */
  hit: { at: V3; size: V3 };
}

const bar = (z: number, y: number, dz: number, hitZ: number, hitD: number): Slot => ({ door: false, at: [-0.02, y, z], step: [0, 0, dz], turn: Math.PI / 2, hit: { at: [0, y + 0.05, hitZ], size: [0.4, 0.14, hitD] } });
const can = (id: SnackId, z: number, base: number, dz: number): Slot => ({ door: true, at: [0.055, base + DRINK_H[id]! / 2, z], step: [0, 0, dz], hit: { at: [0.06, base + 0.1, z + dz * 1.5], size: [0.14, 0.22, Math.abs(dz) * 4 + 0.04] } });

// Shelves at these heights (their tops), the door's bins at these.
const SHELVES = [0.51, 0.96, 1.41];
const BINS = [0.71, 1.26];

const SLOTS: Record<SnackId, Slot> = {
  overclock: can('overclock', -0.09, BINS[1], -0.075),
  sparkling: can('sparkling', -0.45, BINS[1], -0.07),
  coldbrew: can('coldbrew', -0.09, BINS[0], -0.08),
  mate: can('mate', -0.45, BINS[0], -0.08),
  chocolate: bar(-0.3, SHELVES[2] + 0.007, 0.065, -0.2, 0.3),
  protein: bar(0.06, SHELVES[2] + 0.009, 0.06, 0.15, 0.3),
  cheese: bar(-0.31, SHELVES[1] + 0.012, 0.035, -0.25, 0.18),
  // slices round a plate (drawn apart, below)
  pizza: { door: false, at: [0.03, SHELVES[1] + 0.02, 0.15], step: [0, 0, 0], hit: { at: [0.03, SHELVES[1] + 0.05, 0.15], size: [0.36, 0.12, 0.36] } },
};

/** One snack's items, as many as are in stock, and its spot to aim at (only while the door is open). */
function SnackSlot({ snack, count, open }: { snack: SnackId; count: number; open: boolean }) {
  const s = SLOTS[snack];
  const ref = useInteractable<THREE.Group>(open ? { id: `fridge:${snack}`, label: grabLabel(snack, count), action: { kind: 'fridge', op: 'take', snack } } : null, RANGE);
  const items = Array.from({ length: count }, (_, i) => i);
  return (
    <group ref={ref}>
      {snack === 'pizza' ? (
        <group position={s.at}>
          <Cyl r={0.17} h={0.012} position={[0, -0.012, 0]} color="#ffffff" shadow={false} />
          {items.map((i) => (
            <group key={i} rotation={[0, (i * Math.PI) / 4 + Math.PI / 2, 0]}>
              <Slice r={0.15} />
            </group>
          ))}
        </group>
      ) : (
        items.map((i) => (
          <group key={i} position={[s.at[0] + s.step[0] * i, s.at[1] + s.step[1] * i, s.at[2] + s.step[2] * i]} rotation={[0, s.turn ?? 0, 0]}>
            <SnackLook snack={snack} />
          </group>
        ))
      )}
      <mesh visible={false} position={s.hit.at}>
        <boxGeometry args={s.hit.size} />
      </mesh>
    </group>
  );
}

/** The tupperware at the back: E reads its label and leaves it be. */
function Lunch({ open }: { open: boolean }) {
  const ref = useInteractable<THREE.Group>(open ? { id: 'fridge:lunch', label: `“${lunchText()}”`, action: { kind: 'fridge', op: 'lunch' } } : null, RANGE);
  return (
    <group ref={ref} position={[0.08, SHELVES[0], 0.05]}>
      <Tupperware />
      <mesh visible={false} position={[0, 0.06, 0]}>
        <boxGeometry args={[0.26, 0.14, 0.22]} />
      </mesh>
    </group>
  );
}

/** The fridge. `floor` keeps its stock; `who` (names, one per line) is whose lunch the tupperware might be. */
export function Fridge({ position, floor, who }: { position: V3; floor: number; who: string }) {
  useSyncExternalStore(subscribeFridge, fridgeVersion);
  const open = doorOpen();
  const root = useRef<THREE.Group>(null);
  const door = useRef<THREE.Group>(null);
  const liner = useRef<THREE.Mesh>(null);
  const bulb = useRef<THREE.Mesh>(null);
  const paused = useRenderPaused();
  const away = useStore((s) => s.travel !== null || s.overlay !== null);
  const quiet = paused || away;
  const run = useMemo(() => ({ angle: 0, lit: false, hum: null as FridgeHum | null, tried: 0, quiet }), []);
  run.quiet = quiet;

  const target = useInteractable<THREE.Group>({ id: 'fridge:door', label: open ? 'Close the fridge' : 'Open the fridge', action: { kind: 'fridge', op: 'door' } }, RANGE);

  // On the floor: this floor's stock, the door shut, and its clock running (not in the frame loop: it may stop).
  useEffect(() => {
    const g = root.current;
    if (!g) return;
    g.updateWorldMatrix(true, false);
    const front = g.localToWorld(new THREE.Vector3(-W / 2, 0, 0));
    const unmount = mountFridge(floor, front.x, front.z);
    const timer = setInterval(() => tickFridge(run.quiet || document.hidden), TICK_MS);
    return () => {
      clearInterval(timer);
      unmount();
      run.hum?.stop();
      run.hum = null;
    };
  }, [floor, run]);

  useEffect(() => setLunchLabel(who ? who.split('\n') : [], floor), [who, floor]);

  // Out of view (a hidden tab, a panel, the elevator): the hum goes quiet now, the frame loop may not run.
  useEffect(() => {
    if (quiet) run.hum?.level(0);
  }, [quiet, run]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const isOpen = doorOpen();
    run.angle = swingTo(run.angle, isOpen, dt);
    if (door.current) door.current.rotation.y = run.angle;
    // the light comes on as the seal lets go, and off as it shuts
    const lit = run.angle > 0.05;
    if (lit !== run.lit) {
      run.lit = lit;
      if (liner.current) liner.current.material = lit ? linerLit : linerDim;
      if (bulb.current) bulb.current.material = lit ? bulbOn : bulbOff;
    }
    // the hum: only within a few metres, a little stronger while the door's open (the compressor working harder)
    const ear = listenerAt();
    const d = Math.hypot(ear.x - fridgeAt.x, ear.z - fridgeAt.z);
    const level = run.quiet ? 0 : Math.max(0, Math.min(1, (8 - d) / 5)) * (isOpen ? 1.4 : 1);
    if (!run.hum && level > 0) {
      const now = performance.now();
      if (now - run.tried > 1000) {
        run.tried = now;
        run.hum = fridgeHum(fridgeAt); // once audio is up
      }
    }
    run.hum?.level(level);
  });

  return (
    <group ref={root} position={position}>
      <group ref={target}>
        {/* the cabinet: back, sides, top and the kick plate, open at the front */}
        <Box size={[0.04, H, W]} position={[W / 2 - 0.02, H / 2, 0]} color={WHITE} outline />
        <Box size={[W, H, 0.04]} position={[0, H / 2, -W / 2 + 0.02]} color={WHITE} outline />
        <Box size={[W, H, 0.04]} position={[0, H / 2, W / 2 - 0.02]} color={WHITE} outline />
        <Box size={[W, 0.06, W]} position={[0, H - 0.03, 0]} color={WHITE} outline />
        <Box size={[W, 0.12, W]} position={[0, 0.06, 0]} color="#ced4da" outline />
        {/* inside: the liner lights up, the bulb under the top, glass shelves and the crisper drawer */}
        <mesh ref={liner} position={[W / 2 - 0.045, H / 2, 0]} rotation={[0, -Math.PI / 2, 0]} material={linerDim}>
          <planeGeometry args={[W - 0.08, H - 0.2]} />
        </mesh>
        <mesh ref={bulb} position={[0.25, H - 0.1, 0]} material={bulbOff}>
          <sphereGeometry args={[0.035, 10, 8]} />
        </mesh>
        {SHELVES.map((y) => (
          <Box key={y} size={[0.62, 0.02, W - 0.08]} position={[0.05, y - 0.01, 0]} color="#e3f2fd" shadow={false} />
        ))}
        <Box size={[0.6, 0.3, W - 0.1]} position={[0.05, 0.27, 0]} color="#caf0f8" shadow={false} />
        <Box size={[0.02, 0.05, 0.3]} position={[-0.26, 0.36, 0]} color="#90e0ef" shadow={false} />
        {SNACK_IDS.filter((id) => !SLOTS[id].door).map((id) => (
          <SnackSlot key={id} snack={id} count={stockOf(id)} open={open} />
        ))}
        <Lunch open={open} />

        {/* the door, hinged on its +z edge: it swings out towards -x */}
        <group ref={door} position={HINGE}>
          <group position={[0, 0, -W / 2]}>
            <Box size={[0.06, H - 0.04, W]} position={[-0.03, H / 2, 0]} color={WHITE} outline />
            {/* the handle, on the far edge from the hinge */}
            <Box size={[0.04, 0.5, 0.05]} position={[-0.085, 1.3, -0.25]} color="#adb5bd" outline />
            {/* on the outside: magnets, and a sticky note held up by one */}
            <Cyl r={0.03} h={0.014} position={[-0.067, 1.62, 0.12]} rotation={[0, 0, Math.PI / 2]} color="#ef476f" shadow={false} />
            <Ball r={0.024} position={[-0.068, 1.15, 0.2]} scale={[0.5, 1, 1]} color="#06d6a0" shadow={false} />
            <Box size={[0.004, 0.15, 0.15]} position={[-0.062, 1.42, 0.08]} rotation={[0.08, 0, 0]} color="#ffd166" shadow={false} />
            {[0.035, 0.005, -0.025].map((y, i) => (
              <Box key={y} size={[0.005, 0.008, 0.1 - i * 0.025]} position={[-0.064, 1.42 + y, 0.075 - i * 0.012]} rotation={[0.08, 0, 0]} color="#3d405b" shadow={false} />
            ))}
            <Cyl r={0.016} h={0.012} position={[-0.067, 1.485, 0.08]} rotation={[0, 0, Math.PI / 2]} color="#118ab2" shadow={false} />
            {/* on the inside: the liner and two bins */}
            <Box size={[0.012, H - 0.3, W - 0.12]} position={[0.006, H / 2, 0]} color={LINER} shadow={false} />
            {BINS.map((y) => (
              <group key={y}>
                <Box size={[0.11, 0.015, W - 0.12]} position={[0.055, y - 0.0075, 0]} color="#e3f2fd" shadow={false} />
                <Box size={[0.012, 0.07, W - 0.12]} position={[0.11, y + 0.03, 0]} color="#bde0fe" shadow={false} />
              </group>
            ))}
          </group>
          {SNACK_IDS.filter((id) => SLOTS[id].door).map((id) => (
            <SnackSlot key={id} snack={id} count={stockOf(id)} open={open} />
          ))}
        </group>
      </group>
    </group>
  );
}
