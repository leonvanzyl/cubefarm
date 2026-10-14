// What each snack from the fridge (fridge.ts) looks like: one small procedural toon mesh apiece, standing upright and
// centred on its middle, shared by the fridge's shelves, the player's hands (HeldSnack.tsx) and the agents' (Character.tsx).
// Food gets shorter with every bite; a drink looks the same to the last sip. Plain meshes, so they move with whatever holds them.

import { snackOf, type SnackId } from './fridge';
import { toon } from './materials';
import { Outlines } from './Outlines';

const INK = '#1f1d2b';
const METAL = '#ced4da';

/** How tall each one stands (m), for putting it on a shelf. */
export const SNACK_HEIGHT: Record<SnackId, number> = {
  overclock: 0.13,
  fizz: 0.12,
  coldbrew: 0.17,
  mate: 0.18,
  pizza: 0.03,
  bar: 0.035,
  cheese: 0.13,
  choc: 0.022,
};

/** A snack at hand size; `left` of its sips or bites (default all) shortens food as it's eaten. */
export function SnackLook({ snack, left, outline = true }: { snack: SnackId; left?: number; outline?: boolean }) {
  const s = snackOf(snack);
  if (!s) return null;
  const k = Math.max(0.2, Math.min(1, (left ?? s.sips) / s.sips));
  const ink = outline ? <Outlines thickness={0.004} color={INK} /> : null;
  switch (snack) {
    case 'overclock':
    case 'fizz': {
      const h = SNACK_HEIGHT[snack];
      return (
        <group>
          <mesh material={toon(s.color)}>
            <cylinderGeometry args={[0.033, 0.033, h - 0.012, 14]} />
            {ink}
          </mesh>
          <mesh material={toon(s.accent)}>
            <cylinderGeometry args={[0.0335, 0.0335, h * 0.3, 14]} />
          </mesh>
          <mesh position={[0, h / 2 - 0.004, 0]} material={toon(METAL)}>
            <cylinderGeometry args={[0.028, 0.033, 0.01, 14]} />
          </mesh>
          <mesh position={[0, -h / 2 + 0.004, 0]} material={toon(METAL)}>
            <cylinderGeometry args={[0.033, 0.028, 0.01, 14]} />
          </mesh>
        </group>
      );
    }
    case 'coldbrew':
    case 'mate': {
      const h = SNACK_HEIGHT[snack];
      const body = h * 0.62;
      return (
        <group>
          <mesh position={[0, -h / 2 + body / 2, 0]} material={toon(s.color)}>
            <cylinderGeometry args={[0.03, 0.03, body, 12]} />
            {ink}
          </mesh>
          <mesh position={[0, -h / 2 + body / 2, 0]} material={toon(s.accent)}>
            <cylinderGeometry args={[0.0305, 0.0305, body * 0.45, 12]} />
          </mesh>
          <mesh position={[0, -h / 2 + body + h * 0.12, 0]} material={toon(s.color)}>
            <cylinderGeometry args={[0.013, 0.03, h * 0.24, 12]} />
          </mesh>
          <mesh position={[0, h / 2 - 0.01, 0]} material={toon(s.accent)}>
            <cylinderGeometry args={[0.014, 0.014, 0.02, 10]} />
            {ink}
          </mesh>
        </group>
      );
    }
    case 'pizza': {
      // lying flat, its tip bitten back towards the crust (the crust along +Z); a slice like food.tsx's, as plain meshes
      const r = 0.12 * k + 0.02;
      return (
        <group position={[0, 0, -r / 2]}>
          <mesh material={toon(s.color)}>
            <cylinderGeometry args={[r, r, 0.014, 6, 1, false, -Math.PI / 8, Math.PI / 4]} />
            {ink}
          </mesh>
          <mesh position={[0, 0.002, r * 0.9]} material={toon('#d08c45')}>
            <boxGeometry args={[r * 0.78, 0.022, 0.03]} />
          </mesh>
          <mesh position={[0.005, 0.009, r * 0.6]} scale={[1, 0.35, 1]} material={toon(s.accent)}>
            <sphereGeometry args={[0.015, 8, 6]} />
          </mesh>
        </group>
      );
    }
    case 'bar':
    case 'choc': {
      const len = (snack === 'bar' ? 0.12 : 0.11) * k;
      const w = snack === 'bar' ? 0.035 : 0.06;
      const h = SNACK_HEIGHT[snack];
      return (
        <group>
          <mesh position={[0, 0, (snack === 'bar' ? 0.12 : 0.11) / 2 - len / 2]} material={toon(s.color)}>
            <boxGeometry args={[w, h, len]} />
            {ink}
          </mesh>
          <mesh position={[0, h / 2 + 0.001, 0.02]} material={toon(s.accent)}>
            <boxGeometry args={[w * 0.7, 0.002, Math.min(len, 0.04)]} />
          </mesh>
        </group>
      );
    }
    case 'cheese': {
      const h = SNACK_HEIGHT.cheese * k;
      return (
        <group>
          <mesh position={[0, -SNACK_HEIGHT.cheese / 2 + h / 2, 0]} material={toon(s.color)}>
            <cylinderGeometry args={[0.012, 0.012, h, 10]} />
            {ink}
          </mesh>
          <mesh position={[0, -SNACK_HEIGHT.cheese / 2 + 0.02, 0]} material={toon(s.accent)}>
            <cylinderGeometry args={[0.015, 0.015, 0.04, 10]} />
          </mesh>
        </group>
      );
    }
  }
}
