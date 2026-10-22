import { Slice } from './food';
import { SNACKS, type SnackId } from './fridge';
import { Ball, Box, Cyl } from './Toon';

// The fridge's snacks (fridge.ts), one small toon shape each: on its shelf (KitchenFridge.tsx), in your hands (HeldSnack.tsx)
// and in an agent's (Character.tsx). Centred on where it's held: a drink stands upright (+y), food lies along z with
// its far end at -z, and a bitten one is shorter, eaten from that far end towards the hand. No ink outlines: they'd be
// as thick as a can at this size.

/** How long the food is (m) along z, whole. */
export const FOOD_LEN: Partial<Record<SnackId, number>> = { protein: 0.12, cheese: 0.12, chocolate: 0.12, pizza: 0.13 };

/** A drink's height (m), for standing it on a shelf. */
export const DRINK_H: Partial<Record<SnackId, number>> = { overclock: 0.125, sparkling: 0.13, coldbrew: 0.17, mate: 0.19 };

/** A drink can's or bottle's colours: body, band (label), top. */
const DRINKS = {
  overclock: { body: '#22223b', band: '#39ff14', top: '#ced4da' },
  sparkling: { body: '#caf0f8', band: '#ff8fab', top: '#ced4da' },
  coldbrew: { body: '#3d2817', band: '#d4a373', top: '#1f1d2b' },
  mate: { body: '#74c69d', band: '#2d6a4f', top: '#f9c74f' },
} as const;

/** One snack, `left` sips or bites to go (whole when left out). */
export function SnackLook({ snack, left }: { snack: SnackId; left?: number }) {
  const def = SNACKS[snack];
  const k = left === undefined ? 1 : Math.max(0.25, left / def.portions);
  switch (snack) {
    case 'overclock':
    case 'sparkling': {
      const c = DRINKS[snack];
      const h = DRINK_H[snack]!;
      const r = snack === 'sparkling' ? 0.029 : 0.033;
      return (
        <group>
          <Cyl r={r} h={h} color={c.body} shadow={false} seg={14} />
          <Cyl r={r + 0.001} h={h * 0.3} position={[0, 0.005, 0]} color={c.band} shadow={false} seg={14} />
          <Cyl r={r * 0.8} rTop={r * 0.75} h={0.012} position={[0, h / 2 + 0.005, 0]} color={c.top} shadow={false} seg={14} />
        </group>
      );
    }
    case 'coldbrew':
    case 'mate': {
      const c = DRINKS[snack];
      const h = DRINK_H[snack]!;
      const body = h * 0.66;
      const neck = h - body;
      return (
        <group position={[0, -h / 2, 0]}>
          <Cyl r={0.034} h={body} position={[0, body / 2, 0]} color={c.body} shadow={false} seg={14} />
          <Cyl r={0.035} h={body * 0.45} position={[0, body * 0.48, 0]} color={c.band} shadow={false} seg={14} />
          <Cyl r={0.016} rTop={0.016} h={neck * 0.8} position={[0, body + neck * 0.4, 0]} color={c.body} shadow={false} seg={10} />
          <Cyl r={0.032} rTop={0.017} h={0.03} position={[0, body + 0.012, 0]} color={c.body} shadow={false} seg={14} />
          <Cyl r={0.018} h={0.018} position={[0, h - 0.005, 0]} color={c.top} shadow={false} seg={10} />
        </group>
      );
    }
    case 'pizza': {
      // held by the crust, the tip ahead, bitten from the tip back
      const r = FOOD_LEN.pizza!;
      return (
        <group position={[0, 0, -r / 2]}>
          <group position={[0, 0, r * (1 - k)]} scale={[1, 1, k]}>
            <Slice r={r} />
          </group>
        </group>
      );
    }
    case 'protein': {
      const len = FOOD_LEN.protein! * k;
      return (
        <group position={[0, 0, (FOOD_LEN.protein! - len) / 2]}>
          <Box size={[0.036, 0.016, len]} color="#ff6b35" shadow={false} />
          <Box size={[0.037, 0.017, Math.min(len, 0.035)]} position={[0, 0, len / 2 - Math.min(len, 0.035) / 2 - 0.004]} color="#1d3557" shadow={false} />
          {k < 1 && <Box size={[0.03, 0.012, 0.004]} position={[0, 0, -len / 2]} color="#a47148" shadow={false} />}
        </group>
      );
    }
    case 'cheese': {
      const len = FOOD_LEN.cheese! * k;
      return (
        <group position={[0, 0, (FOOD_LEN.cheese! - len) / 2]}>
          <Cyl r={0.011} h={len} rotation={[Math.PI / 2, 0, 0]} color="#fff1c1" shadow={false} seg={10} />
          {/* the end still in its film */}
          <Cyl r={0.013} h={0.03} position={[0, 0, len / 2 - 0.015]} rotation={[Math.PI / 2, 0, 0]} color="#ffd166" shadow={false} seg={10} />
          {k < 1 && <Ball r={0.011} position={[0, 0, -len / 2]} scale={[1, 1, 0.4]} color="#fff1c1" shadow={false} />}
        </group>
      );
    }
    case 'chocolate': {
      const len = FOOD_LEN.chocolate! * k;
      // opened: the bar peeks out of its torn wrapper and foil
      const bare = k < 1 ? Math.min(len - 0.02, 0.035) : 0;
      return (
        <group position={[0, 0, (FOOD_LEN.chocolate! - len) / 2]}>
          <Box size={[0.05, 0.012, len - bare]} position={[0, 0, bare / 2]} color="#9d0208" shadow={false} />
          <Box size={[0.051, 0.013, 0.02]} position={[0, 0, len / 2 - 0.03]} color="#ffba08" shadow={false} />
          {bare > 0 && (
            <>
              <Box size={[0.046, 0.01, bare]} position={[0, 0, -len / 2 + bare / 2]} color="#5e3023" shadow={false} />
              <Box size={[0.047, 0.012, 0.003]} position={[0, 0, -len / 2 + bare + 0.001]} color="#ced4da" shadow={false} />
            </>
          )}
        </group>
      );
    }
  }
}

/** The labelled tupperware at the back of the bottom shelf, its bottom at y 0. */
export function Tupperware() {
  return (
    <group>
      <Box size={[0.2, 0.08, 0.15]} position={[0, 0.04, 0]} color="#d8f3dc" shadow={false} />
      <Box size={[0.17, 0.05, 0.12]} position={[0, 0.035, 0]} color="#e9c46a" shadow={false} />
      <Box size={[0.21, 0.02, 0.16]} position={[0, 0.09, 0]} color="#4361ee" shadow={false} />
      {/* the masking-tape label, scrawled on */}
      <Box size={[0.004, 0.035, 0.11]} position={[-0.101, 0.045, 0]} color="#fefae0" shadow={false} />
      <Box size={[0.005, 0.004, 0.08]} position={[-0.102, 0.052, -0.005]} color="#e63946" shadow={false} />
      <Box size={[0.005, 0.004, 0.06]} position={[-0.102, 0.04, 0.008]} color="#1f1d2b" shadow={false} />
    </group>
  );
}
