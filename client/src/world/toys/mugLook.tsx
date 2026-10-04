import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Outlines } from '../Outlines';
import * as THREE from 'three';
import { useInteractable } from '../interact';
import { shade, toon } from '../materials';
import { Box, Cyl } from '../Toon';
import { DISPENSER_ID, fillLevel, steamStrength } from './mugs';

// What a coffee mug looks like, its steam, and the kitchenette's mug dispenser. No physics here, so the
// kitchenette (Props.tsx) can draw the dispenser without loading the toy chunk.

const INK = '#1f1d2b';
const COFFEE = '#6f4518';

/** A mug's size in metres: radius at the rim and at the base, and height. */
export const MUG_SIZE = { r: 0.055, rBase: 0.05, h: 0.12 };

const COLORS = ['#f8f9fa', '#ef476f', '#118ab2', '#ffd166', '#06d6a0'];

/** A mug's colour, picked from its id so the same mug keeps its colour when picked up and dropped again. */
export function mugColor(id: string) {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[n % COLORS.length];
}

// The mug's wall is open at the top, so its inside (and the coffee) shows: a double-sided copy of the toon material.
const walls = new Map<string, THREE.Material>();
function wall(color: string) {
  let m = walls.get(color);
  if (!m) {
    m = toon(color).clone();
    m.side = THREE.DoubleSide;
    walls.set(color, m);
  }
  return m;
}

/**
 * A mug, centred on its middle with the handle towards +X, and coffee standing `sips` high inside.
 * `steam` adds a few wisps over a mug that has coffee in it.
 */
export function MugLook({ color, sips, shadow = true, steam = sips > 0 }: { color: string; sips: number; shadow?: boolean; steam?: boolean }) {
  const { r, rBase, h } = MUG_SIZE;
  const level = fillLevel(sips);
  const bottom = -h / 2 + 0.008;
  const coffeeY = bottom + 0.004 + level * (h - 0.026);
  const coffeeR = rBase + (r - rBase) * ((coffeeY + h / 2) / h) - 0.003;
  return (
    <group>
      <mesh castShadow={shadow} receiveShadow material={wall(color)}>
        <cylinderGeometry args={[r, rBase, h, 20, 1, true]} />
        <Outlines thickness={0.006} color={INK} />
      </mesh>
      <mesh position={[0, bottom, 0]} rotation={[-Math.PI / 2, 0, 0]} material={toon(shade(color, -0.18))}>
        <circleGeometry args={[rBase - 0.002, 20]} />
      </mesh>
      <mesh position={[0, -h / 2 + 0.002, 0]} rotation={[Math.PI / 2, 0, 0]} material={toon(color)}>
        <circleGeometry args={[rBase, 20]} />
      </mesh>
      {level > 0 && (
        <mesh position={[0, coffeeY, 0]} rotation={[-Math.PI / 2, 0, 0]} material={toon(COFFEE)}>
          <circleGeometry args={[coffeeR, 20]} />
        </mesh>
      )}
      <mesh position={[r - 0.003, 0.004, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow={shadow} material={toon(color)}>
        <torusGeometry args={[0.032, 0.01, 6, 14, Math.PI]} />
        <Outlines thickness={0.006} color={INK} />
      </mesh>
      {steam && level > 0 && <Steam y={h / 2} sips={sips} />}
    </group>
  );
}

const WISPS = [0, 1, 2];

/** Soft steam rising from y: a few fading puffs, cheap like the kitchenette's. Fainter, smaller and lower as `sips` run out. */
export function Steam({ y, sips }: { y: number; sips: number }) {
  const g = useRef<THREE.Group>(null);
  const strength = steamStrength(sips);
  useFrame(() => {
    const group = g.current;
    if (!group) return;
    const t = performance.now() / 1000;
    for (let i = 0; i < group.children.length; i++) {
      const c = group.children[i] as THREE.Mesh;
      const k = (t * 0.45 + i / 3) % 1;
      c.position.set(Math.sin(t * 1.3 + i * 2.1) * 0.012, k * 0.14 * (0.5 + 0.5 * strength), 0);
      c.scale.setScalar((0.6 + k * 1.2) * (0.6 + 0.4 * strength));
      (c.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - k) * strength;
    }
  });
  return (
    <group ref={g} position={[0, y, 0]}>
      {WISPS.map((i) => (
        <mesh key={i}>
          <sphereGeometry args={[0.016, 8, 6]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

// Three mugs stacked rim-down on a little stand round a pole.
const STACK = [0, 1, 2];

/** The mug dispenser on the kitchenette counter: aim at it and press E for a fresh, empty mug. */
export function MugDispenser({ position }: { position: [number, number, number] }) {
  const ref = useInteractable<THREE.Group>({ id: `toy:${DISPENSER_ID}`, label: 'Take a mug', action: { kind: 'pickup', toyId: DISPENSER_ID } }, 2.8);
  const { h } = MUG_SIZE;
  return (
    <group ref={ref} position={position}>
      <Cyl r={0.1} h={0.03} position={[0, 0.015, 0]} color="#adb5bd" outline />
      <Cyl r={0.012} h={0.42} position={[0, 0.24, 0]} color="#6c757d" />
      {STACK.map((i) => (
        <group key={i} position={[0, 0.03 + h / 2 + i * (h + 0.002), 0]} rotation={[Math.PI, (i * 2.4) % (Math.PI * 2), 0]}>
          <MugLook color={COLORS[i + 1]} sips={0} />
        </group>
      ))}
      <Box size={[0.04, 0.05, 0.05]} position={[0, 0.47, 0]} color="#6c757d" shadow={false} />
    </group>
  );
}
