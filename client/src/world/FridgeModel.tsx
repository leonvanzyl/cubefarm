import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useRenderPaused } from '../perf';
import { agentsOnRepo, repoOnFloor, useStore } from '../store';
import { fridgeBeep, fridgeHum, type FridgeHum } from '../ui/sfx';
import { playerAt } from './camera/rig';
import { FRIDGE, autoCloseDue, beepDue, lunchLabel, snackOf, type SnackId } from './fridge';
import { closeDoor, enterFloor, fridge, fridgeSpot, fridgeVersion, stockNow, subscribeFridge } from './fridgeState';
import { useInteractable } from './interact';
import { glow, toon } from './materials';
import { SNACK_HEIGHT, SnackLook } from './snackLook';
import { Box, Cyl } from './Toon';

// The kitchenette fridge (fridgeState.ts holds its state, fridge.ts its rules): a hinged door that swings open on the
// handle side, a light inside, shelves and door shelves showing the stock, magnets and a sticky note on the door.
// E opens it, E on a snack takes it, E on the door shuts it, and it shuts by itself once everyone has walked away.
// Its front faces local -x like the counter's; `position` is the middle of its footprint on the floor.

const W = 0.8;
const H = 2;
const OPEN = 1.95; // radians the door swings to
const BODY = '#f1f3f5';
const INK = '#1f1d2b';

/** Where each snack sits: on a shelf (y of its top) or a door rack, in a row along z or stacked up. */
interface Slot {
  y: number;
  z: number;
  x: number;
  door?: boolean;
  stack?: boolean;
  gap?: number;
}

const SLOTS: Record<SnackId, Slot> = {
  overclock: { y: 0.12, z: -0.17, x: -0.12, gap: 0.072 },
  coldbrew: { y: 0.12, z: 0.16, x: -0.12, gap: 0.066 },
  pizza: { y: 0.51, z: -0.14, x: -0.1, stack: true },
  cheese: { y: 0.96, z: -0.2, x: -0.12, gap: 0.035 },
  bar: { y: 0.96, z: 0.02, x: -0.12, stack: true },
  choc: { y: 0.96, z: 0.2, x: -0.12, stack: true },
  // the door's racks: along the door, which runs along local -z from the hinge
  fizz: { y: 0.42, z: -0.4, x: 0.06, door: true, gap: 0.072 },
  mate: { y: 1.12, z: -0.4, x: 0.06, door: true, gap: 0.066 },
};

const SHELVES = [0.5, 0.95, 1.42];
const lightOff = toon('#dee2e6');
const lightOn = glow('#fffbe6');

/** One snack's place: what's left of it, and E to take one (or the empty spot, when it's sold out). */
function StockSlot({ id, count, open }: { id: SnackId; count: number; open: boolean }) {
  const s = snackOf(id)!;
  const at = SLOTS[id];
  const ref = useInteractable<THREE.Group>(
    open ? { id: `fridge:${id}`, label: count > 0 ? `Grab the ${s.short}` : `Out of ${s.short}`, action: { kind: 'fridge', op: 'take', snack: id } } : null,
    2.6,
  );
  const h = SNACK_HEIGHT[id];
  return (
    <group ref={ref} position={[at.x, at.y, at.z]}>
      {Array.from({ length: count }, (_, i) =>
        at.stack ? (
          <group key={i} position={[0, h / 2 + i * (h + 0.004), 0]} rotation={[0, id === 'pizza' ? Math.PI / 2 : 0, 0]}>
            <SnackLook snack={id} outline={false} />
          </group>
        ) : (
          <group key={i} position={[0, h / 2, (i - 1.5) * (at.gap ?? 0.07)]}>
            <SnackLook snack={id} outline={false} />
          </group>
        ),
      )}
      {/* what the crosshair finds: the whole spot, even an empty one */}
      <mesh visible={false} position={[0, 0.09, 0]}>
        <boxGeometry args={[0.24, 0.2, 0.3]} />
      </mesh>
    </group>
  );
}

/** The labelled tupperware: somebody's lunch. E says so and leaves it be. */
function Tupperware({ name, open }: { name: string; open: boolean }) {
  const ref = useInteractable<THREE.Group>(open ? { id: 'fridge:lunch', label: `🥡 "${lunchLabel(name || 'Someone')}"`, action: { kind: 'fridge', op: 'lunch' } } : null, 2.6);
  return (
    <group ref={ref} position={[-0.08, 0.51, 0.16]}>
      <Box size={[0.2, 0.09, 0.16]} position={[0, 0.045, 0]} color="#e9f5db" outline />
      <Box size={[0.21, 0.02, 0.17]} position={[0, 0.1, 0]} color="#4361ee" />
      <Box size={[0.005, 0.04, 0.09]} position={[-0.102, 0.05, 0]} color="#ffffff" />
    </group>
  );
}

export function Fridge({ position }: { position: [number, number, number] }) {
  useSyncExternalStore(subscribeFridge, fridgeVersion);
  const floor = useStore((s) => s.floor);
  const lunchOf = useStore((s) => {
    const r = repoOnFloor(s.repos, s.floor);
    return (r && agentsOnRepo(s.agents, r.id).find((a) => a.role !== 'ceo')?.name) || '';
  });
  const paused = useRenderPaused();
  const away = useStore((s) => s.travel !== null || s.overlay !== null);
  const root = useRef<THREE.Group>(null);
  const door = useRef<THREE.Group>(null);
  const panel = useRef<THREE.Mesh>(null);
  const lamp = useRef<THREE.Mesh>(null);
  const angle = useRef(0);
  const located = useRef(false);
  const hum = useRef<FridgeHum | null>(null);

  // A floor's fridge: shut on arrival, with that floor's stock.
  useEffect(() => {
    enterFloor(floor);
    return () => {
      fridge.open = false;
      fridge.door = null;
      fridge.playerNear = false;
    };
  }, [floor]);
  fridge.lunchOf = lunchOf;

  const open = fridge.open;
  const doorRef = useInteractable<THREE.Group>({ id: 'fridge:door', label: open ? 'Close the fridge' : 'Open the fridge', action: { kind: 'fridge', op: open ? 'close' : 'open' } }, 2.8);

  // Its clock, off the frame loop: shutting by itself, the "door left open" beep, an item back every few minutes, the hum.
  useEffect(() => {
    const t = setInterval(() => {
      const now = performance.now();
      stockNow(now);
      if (fridge.open && (fridge.playerNear || fridge.door)) fridge.lastNear = now;
      if (autoCloseDue(fridge.open, fridge.lastNear, now)) closeDoor();
      if (beepDue(fridge.open, fridge.openAt, fridge.lastBeep, now)) {
        fridge.lastBeep = now;
        fridgeBeep(fridgeSpot);
      }
      if (!hum.current && located.current) hum.current = fridgeHum(fridgeSpot);
    }, 250);
    return () => {
      clearInterval(t);
      hum.current?.stop();
      hum.current = null;
    };
  }, []);
  // The hum goes quiet while the tab is hidden, a panel is up or the elevator moves (the frame loop may be stopped).
  useEffect(() => {
    hum.current?.set(paused || away ? 0 : 1);
  }, [paused, away]);

  useFrame((_, dt) => {
    const g = root.current;
    if (!g) return;
    if (!located.current) {
      located.current = true;
      g.updateWorldMatrix(true, false);
      const at = g.localToWorld(new THREE.Vector3(-W / 2, 1.2, 0)); // once
      fridgeSpot.x = at.x;
      fridgeSpot.y = at.y;
      fridgeSpot.z = at.z;
    }
    fridge.playerNear = Math.hypot(playerAt.x - fridgeSpot.x, playerAt.z - fridgeSpot.z) < FRIDGE.near;
    const want = fridge.open ? OPEN : 0;
    const k = 1 - Math.exp(-dt * (fridge.open ? 7 : 9));
    angle.current += (want - angle.current) * k;
    if (door.current) door.current.rotation.y = angle.current;
    const lit = angle.current > 0.05;
    if (panel.current) panel.current.material = lit ? lightOn : lightOff;
    if (lamp.current) lamp.current.visible = lit;
  });

  const stock = stockNow();
  return (
    <group ref={root} position={position}>
      {/* the cabinet: back, sides, top and bottom, and the inside's back panel that lights up */}
      <Box size={[0.06, H, W]} position={[W / 2 - 0.03, H / 2, 0]} color={BODY} outline />
      {[-1, 1].map((side) => (
        <Box key={side} size={[W, H, 0.05]} position={[0, H / 2, side * (W / 2 - 0.025)]} color={BODY} outline />
      ))}
      <Box size={[W, 0.08, W]} position={[0, H - 0.04, 0]} color={BODY} outline />
      <Box size={[W, 0.12, W]} position={[0, 0.06, 0]} color="#ced4da" outline />
      <mesh ref={panel} position={[W / 2 - 0.065, H / 2, 0]} rotation={[0, -Math.PI / 2, 0]} material={lightOff}>
        <planeGeometry args={[W - 0.1, H - 0.2]} />
      </mesh>
      <mesh ref={lamp} position={[0, H - 0.1, 0]} visible={false} material={lightOn}>
        <boxGeometry args={[0.2, 0.02, 0.08]} />
      </mesh>
      {SHELVES.map((y) => (
        <Box key={y} size={[W - 0.12, 0.02, W - 0.1]} position={[0.02, y, 0]} color="#e7f5ff" shadow={false} />
      ))}
      {/* a jar of pickles and the ketchup on the top shelf */}
      <Cyl r={0.05} h={0.12} position={[-0.05, 1.49, -0.15]} color="#95d5b2" shadow={false} />
      <Cyl r={0.03} rTop={0.02} h={0.16} position={[-0.05, 1.51, 0.12]} color="#d62828" shadow={false} />

      {(Object.keys(SLOTS) as SnackId[])
        .filter((id) => !SLOTS[id].door)
        .map((id) => (
          <StockSlot key={id} id={id} count={stock[id]} open={open} />
        ))}
      <Tupperware name={lunchOf} open={open} />

      {/* the door, hinged at the front's south edge: the handle side swings out */}
      <group ref={door} position={[-W / 2, 0, W / 2]} userData={{ moving: true }}>
        <group ref={doorRef}>
          <Box size={[0.05, H - 0.04, W]} position={[-0.025, H / 2, -W / 2]} color={BODY} outline />
          {/* the handle, near the free edge */}
          <Box size={[0.04, 0.55, 0.04]} position={[-0.08, 1.25, -W + 0.1]} color="#adb5bd" outline />
          {/* magnets and a sticky note on the outside */}
          <Cyl r={0.03} h={0.02} position={[-0.06, 1.62, -0.3]} rotation={[0, 0, Math.PI / 2]} color="#ef476f" shadow={false} />
          <Cyl r={0.025} h={0.02} position={[-0.06, 1.1, -0.55]} rotation={[0, 0, Math.PI / 2]} color="#06d6a0" shadow={false} />
          <Box size={[0.006, 0.14, 0.14]} position={[-0.054, 1.5, -0.38]} color="#ffd166" shadow={false} />
          {[0, 1, 2].map((i) => (
            <Box key={i} size={[0.004, 0.008, 0.09 - i * 0.02]} position={[-0.058, 1.53 - i * 0.03, -0.38]} color={INK} shadow={false} />
          ))}
          {/* the door's racks, inside */}
          {[0.42, 1.12].map((y) => (
            <group key={y}>
              <Box size={[0.1, 0.02, W - 0.12]} position={[0.06, y - 0.01, -W / 2]} color="#e7f5ff" shadow={false} />
              <Box size={[0.01, 0.06, W - 0.12]} position={[0.11, y + 0.03, -W / 2]} color="#a5d8ff" shadow={false} />
            </group>
          ))}
          {(Object.keys(SLOTS) as SnackId[])
            .filter((id) => SLOTS[id].door)
            .map((id) => (
              <StockSlot key={id} id={id} count={stock[id]} open={open} />
            ))}
        </group>
      </group>
    </group>
  );
}
