import { Outlines } from '@react-three/drei';
import * as THREE from 'three';
import { HALF_D, HALF_W } from '../layout';
import { shade, toon, toonMap } from '../materials';
import { BasketballLook } from './Hoop';
import { HOOP, hoopRim } from './hoopScore';

export type ToyFloor = 'office' | 'lobby';
export type BallKind = 'beach' | 'exercise' | 'yarn' | 'basketball';

export interface BallDef {
  id: string;
  kind: BallKind;
  r: number;
  start: { x: number; y: number; z: number };
  restitution: number;
  density: number;
  damping: number;
  /** Speed of a fully charged throw in m/s, when it isn't the usual. */
  throwSpeed?: number;
}

const INK = '#1f1d2b';

const SPECS: Record<BallKind, Omit<BallDef, 'id' | 'start'>> = {
  beach: { kind: 'beach', r: 0.4, restitution: 0.8, density: 1.2, damping: 0.9 },
  exercise: { kind: 'exercise', r: 0.45, restitution: 0.7, density: 1.6, damping: 0.9 },
  yarn: { kind: 'yarn', r: 0.33, restitution: 0.35, density: 2.5, damping: 1.3 },
  // Its numbers live with the hoop's (hoopScore.ts), where the throw simulation (throwSim.ts) uses them too.
  basketball: { kind: 'basketball', ...HOOP.ball },
};

const ball = (id: string, kind: BallKind, x: number, z: number): BallDef => ({ id, ...SPECS[kind], start: { x, y: SPECS[kind].r + 0.02, z } });
// The basketball waits on the floor just in front of its hoop.
const basketball = (floor: ToyFloor) => ball('basketball', 'basketball', hoopRim(floor).x, hoopRim(floor).z - 0.35);

// Open floor space only: office floors use the break area south of the desks, the lobby its empty south-west corner.
export const BALLS: Record<ToyFloor, BallDef[]> = {
  office: [ball('beach-ball', 'beach', 6.6, 6.8), ball('exercise-ball', 'exercise', 9.8, 8.6), ball('yarn-ball', 'yarn', 12.2, 6.2), basketball('office')],
  lobby: [ball('beach-ball', 'beach', -11, 5.6), ball('exercise-ball', 'exercise', -7.6, 8.2), ball('yarn-ball', 'yarn', -5.4, 4.4), basketball('lobby')],
};

/** Somewhere a ball should never be: outside the walls, in the elevator, through the floor or above the ceiling. */
export const escaped = (p: { x: number; y: number; z: number }) => Math.abs(p.x) > HALF_W || Math.abs(p.z) > HALF_D || p.y < -0.5 || p.y > 6;

// Beach ball: six bold gores with white caps. Nearest filtering keeps the stripes crisp like the rest of the toon look.
const GORES = ['#ef476f', '#ffffff', '#ffd166', '#ffffff', '#118ab2', '#ffffff'];
let beachTex: THREE.DataTexture | null = null;
function beachTexture() {
  if (beachTex) return beachTex;
  const rows = 10;
  const data = new Uint8Array(GORES.length * rows * 4);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < GORES.length; x++) {
      const hex = parseInt((y === 0 || y === rows - 1 ? '#ffffff' : GORES[x]).slice(1), 16);
      const i = (y * GORES.length + x) * 4;
      data[i] = (hex >> 16) & 255;
      data[i + 1] = (hex >> 8) & 255;
      data[i + 2] = hex & 255;
      data[i + 3] = 255;
    }
  }
  beachTex = new THREE.DataTexture(data, GORES.length, rows, THREE.RGBAFormat);
  beachTex.colorSpace = THREE.SRGBColorSpace;
  beachTex.minFilter = THREE.NearestFilter;
  beachTex.magFilter = THREE.NearestFilter;
  beachTex.generateMipmaps = false;
  beachTex.needsUpdate = true;
  return beachTex;
}

const EXERCISE = '#8338ec';
const YARN = '#ff70a6';
// Strands wound round the yarn ball at a few angles.
const STRANDS: [number, number, number][] = [
  [0, 0, 0],
  [Math.PI / 2, 0, 0],
  [0.6, 0, 1.1],
  [-0.7, 0.3, -1.0],
  [1.2, 0.9, 0.4],
];

/** What a ball looks like, centred on its body's origin. */
export function BallLook({ def }: { def: BallDef }) {
  const { r } = def;
  if (def.kind === 'basketball') return <BasketballLook r={r} />;
  if (def.kind === 'beach') {
    return (
      <mesh castShadow material={toonMap('beach-ball', beachTexture())}>
        <sphereGeometry args={[r, 24, 16]} />
        <Outlines thickness={0.02} color={INK} />
      </mesh>
    );
  }
  if (def.kind === 'exercise') {
    return (
      <group>
        <mesh castShadow material={toon(EXERCISE)}>
          <sphereGeometry args={[r, 24, 16]} />
          <Outlines thickness={0.02} color={INK} />
        </mesh>
        {/* seam and valve, so you can see it roll */}
        <mesh rotation={[Math.PI / 2, 0, 0]} material={toon(shade(EXERCISE, -0.14))}>
          <torusGeometry args={[r * 1.002, 0.018, 6, 40]} />
        </mesh>
        <mesh position={[0, 0, r]} rotation={[Math.PI / 2, 0, 0]} material={toon('#f8f9fa')}>
          <cylinderGeometry args={[0.045, 0.05, 0.04, 12]} />
        </mesh>
      </group>
    );
  }
  return (
    <group>
      <mesh castShadow material={toon(YARN)}>
        <sphereGeometry args={[r, 20, 14]} />
        <Outlines thickness={0.02} color={INK} />
      </mesh>
      {STRANDS.map((rot, i) => (
        <mesh key={i} rotation={rot} material={toon(shade(YARN, i % 2 ? -0.12 : 0.08))}>
          <torusGeometry args={[r * 1.005, 0.022, 6, 36]} />
        </mesh>
      ))}
      {/* the loose end */}
      <mesh position={[r * 0.55, -r * 0.62, r * 0.45]} rotation={[0.4, 0, 0.9]} material={toon(shade(YARN, -0.12))}>
        <capsuleGeometry args={[0.022, 0.3, 3, 6]} />
      </mesh>
    </group>
  );
}
