import { useEffect } from 'react';
import * as THREE from 'three';
import { hashId, type Appearance } from '../../appearance';
import { useTheme, useThemeRuntime, type CostumeProps } from '../active';
import { costumeFor, type Costume } from '../themes';
import { box, cone, cyl, heart, mergeParts, paintedToonDouble, part, sphere, torus } from './geo';

// The costumes people wear for a theme (themes.ts picks whose is whose), drawn as one extra mesh on the head and at
// most one on the body: separate props on Character.tsx's head and torso frames, so the character itself is untouched.
// Head frame: the head's centre, radius 0.2, face to -Z. Torso frame: the seat; the chest is a capsule r 0.2 from
// y 0 to 0.62, the neck at 0.5. Geometry is built once per costume and variant, shared by everyone wearing it.

/** Hairstyles that stand up off the head: hats sit higher on them. */
const TALL = new Set<Appearance['hair']>(['quiff', 'afro', 'bun', 'curls']);


const PARTY = [
  ['#ff5d8f', '#ffd23f'],
  ['#3a86ff', '#06d6a0'],
  ['#9b5de5', '#f15bb5'],
  ['#ff8c42', '#3bceac'],
] as const;

const BLACK = '#2b2340';

/** Half a shell round the back (thetaStart -π/2: CylinderGeometry's θ 0 is +z, the back). */
const backShell = (rTop: number, rBottom: number, h: number, arc = Math.PI) => new THREE.CylinderGeometry(rTop, rBottom, h, 20, 1, true, -arc / 2, arc);

function headGeometry(c: Costume, y: number, v: number): THREE.BufferGeometry | null {
  switch (c) {
    case 'witchHat':
      return mergeParts([
        part(cyl(0.34, 0.34, 0.02, 24), BLACK, [0, y, 0]),
        part(cone(0.17, 0.4, 18), BLACK, [0, y + 0.2, 0.02], [0.18, 0, 0]),
        part(cone(0.06, 0.16, 10), BLACK, [0, y + 0.42, 0.13], [1.1, 0, 0]),
        part(cyl(0.172, 0.172, 0.05, 18), v % 2 ? '#ff7b00' : '#9d4edd', [0, y + 0.04, 0.005], [0.18, 0, 0]),
        part(box(0.05, 0.05, 0.01), '#ffd23f', [0, y + 0.04, -0.17], [0.18, 0, 0]),
      ]);
    case 'pumpkinHead': {
      const lobes = Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return part(sphere(0.19, 10, 8), i % 2 ? '#f77f00' : '#fb8500', [Math.sin(a) * 0.09, 0.03, Math.cos(a) * 0.09], [0, a, 0], [0.75, 1.15, 1]);
      });
      return mergeParts([
        ...lobes,
        part(cyl(0.025, 0.035, 0.1, 8), '#386641', [0, 0.28, 0], [0.2, 0, 0.15]),
        // carved face, lit from inside
        part(cyl(0.045, 0.045, 0.03, 3), '#ffd166', [-0.075, 0.07, -0.272], [Math.PI / 2, 0, Math.PI]),
        part(cyl(0.045, 0.045, 0.03, 3), '#ffd166', [0.075, 0.07, -0.272], [Math.PI / 2, 0, Math.PI]),
        part(box(0.16, 0.035, 0.03), '#ffd166', [0, -0.07, -0.27]),
        ...[-0.05, 0, 0.05].map((x) => part(box(0.028, 0.028, 0.03), '#ffd166', [x, -0.045, -0.272], [0, 0, Math.PI / 4])),
      ]);
    }
    case 'ghost':
      return mergeParts([
        part(new THREE.SphereGeometry(0.235, 20, 14, 0, Math.PI * 2, 0, 2.2), '#f8f9fa', [0, 0.01, 0]),
        part(sphere(0.035, 10, 8), '#1f1d2b', [-0.075, 0.03, -0.225], [0, 0, 0], [1, 1.5, 0.4]),
        part(sphere(0.035, 10, 8), '#1f1d2b', [0.075, 0.03, -0.225], [0, 0, 0], [1, 1.5, 0.4]),
        part(sphere(0.03, 10, 8), '#1f1d2b', [0, -0.07, -0.228], [0, 0, 0], [1, 1.3, 0.4]),
      ]);
    case 'catEars':
      return mergeParts(
        [-1, 1].flatMap((s) => [
          part(cone(0.085, 0.17, 4), '#1f1d2b', [s * 0.12, y + 0.06, 0.01], [0, Math.PI / 4, s * -0.35]),
          part(cone(0.05, 0.11, 4), '#ff8fab', [s * 0.115, y + 0.05, -0.03], [0, Math.PI / 4, s * -0.35]),
        ]),
      );
    case 'vampire':
      return null; // all on the body: the cape and the collar
    case 'skeleton':
      // the hoodie's hood, round the back of the head
      return part(new THREE.SphereGeometry(0.24, 20, 14, Math.PI * 1.5 + 0.8, Math.PI * 2 - 1.6, 0, 2.1), '#1f1d2b', [0, 0.02, 0.02]);
    case 'crown':
      return mergeParts([
        part(cyl(0.165, 0.16, 0.08, 20, true), '#ffd23f', [0, y + 0.03, 0]),
        ...Array.from({ length: 6 }, (_, i) => {
          const a = (i / 6) * Math.PI * 2;
          return part(cone(0.035, 0.09, 6), '#ffd23f', [Math.sin(a) * 0.16, y + 0.11, Math.cos(a) * 0.16]);
        }),
        part(sphere(0.026, 8, 6), '#e63946', [0, y + 0.03, -0.168]),
        part(sphere(0.02, 8, 6), '#3a86ff', [-0.12, y + 0.03, -0.115]),
        part(sphere(0.02, 8, 6), '#06d6a0', [0.12, y + 0.03, -0.115]),
      ]);
    case 'santaHat':
      return mergeParts([
        part(torus(0.175, 0.045, 8, 24), '#f8f9fa', [0, y, 0.01], [Math.PI / 2 + 0.15, 0, 0]),
        part(cone(0.17, 0.3, 16), '#d62828', [0, y + 0.14, 0.05], [0.55, 0, 0]),
        part(sphere(0.055, 10, 8), '#f8f9fa', [0, y + 0.25, 0.2]),
      ]);
    case 'antlers':
      return mergeParts([
        ...[-1, 1].flatMap((s) => [
          part(cyl(0.018, 0.025, 0.24, 6), '#8d5a3b', [s * 0.12, y + 0.1, 0.02], [0, 0, s * -0.35]),
          part(cyl(0.014, 0.018, 0.12, 6), '#8d5a3b', [s * 0.2, y + 0.18, 0.02], [0, 0, s * -1.1]),
          part(cyl(0.014, 0.018, 0.1, 6), '#8d5a3b', [s * 0.14, y + 0.25, 0.02], [0, 0, s * 0.3]),
        ]),
        part(sphere(0.042, 10, 8), '#e63946', [0, -0.02, -0.215]),
      ]);
    case 'partyHat': {
      const [a, b] = PARTY[v % PARTY.length];
      return mergeParts([
        part(cyl(0.085, 0.11, 0.09, 16), a, [0, y + 0.045, 0.02], [0.2, 0, 0]),
        part(cyl(0.055, 0.085, 0.09, 16), b, [0, y + 0.13, 0.04], [0.2, 0, 0]),
        part(cone(0.055, 0.1, 16), a, [0, y + 0.22, 0.055], [0.2, 0, 0]),
        part(sphere(0.035, 8, 6), '#f8f9fa', [0, y + 0.28, 0.07]),
      ]);
    }
    case 'heartBoppers':
      return mergeParts([
        part(torus(0.222, 0.012, 6, 24, Math.PI), '#e63946', [0, y - 0.17, 0.02]),
        ...[-1, 1].flatMap((s) => [
          part(cyl(0.006, 0.006, 0.16, 5), '#adb5bd', [s * 0.09, y + 0.09, 0.02], [0, 0, s * -0.25]),
          part(heart(0.11, 0.03), '#ff4d6d', [s * 0.115, y + 0.19, 0.02], [0, 0, s * -0.25]),
        ]),
      ]);
    case 'bunnyEars':
      return mergeParts([
        part(torus(0.222, 0.012, 6, 24, Math.PI), '#f8f9fa', [0, y - 0.17, 0.02]),
        ...[-1, 1].flatMap((s) => [
          part(sphere(0.06, 12, 10), '#f8f9fa', [s * 0.08, y + 0.17, 0.02], [0, 0, s * -0.2], [1, 3.2, 0.45]),
          part(sphere(0.035, 10, 8), '#ffafcc', [s * 0.08, y + 0.17, -0.004], [0, 0, s * -0.2], [1, 4, 0.3]),
        ]),
      ]);
    case 'uglySweater':
      return null;
  }
}

function bodyGeometry(c: Costume, v: number): THREE.BufferGeometry | null {
  switch (c) {
    case 'vampire':
      return mergeParts([
        part(backShell(0.24, 0.34, 0.62), '#1b1430', [0, 0.22, 0.01]),
        part(backShell(0.232, 0.33, 0.6), '#9d0208', [0, 0.22, 0.01]),
        // the tall collar behind the neck, red inside
        part(backShell(0.3, 0.15, 0.32, Math.PI * 1.25), '#1b1430', [0, 0.67, 0.01]),
        part(backShell(0.29, 0.145, 0.31, Math.PI * 1.25), '#c1121f', [0, 0.67, 0.01]),
        part(box(0.06, 0.04, 0.02), '#ffd23f', [0, 0.5, -0.2]),
      ]);
    case 'ghost':
      return part(cyl(0.21, 0.32, 0.6, 22, true), '#f8f9fa', [0, 0.24, 0]);
    case 'skeleton': {
      const ribs = [0.42, 0.35, 0.28, 0.21].map((y, i) =>
        part(torus(0.207, 0.012, 4, 16, 1.5 - i * 0.12), '#f8f9fa', [0, y, 0], [Math.PI / 2, 0, -Math.PI / 2 - (1.5 - i * 0.12) / 2]),
      );
      return mergeParts([part(cyl(0.204, 0.204, 0.5, 22, true), '#1f1d2b', [0, 0.28, 0]), ...ribs, part(box(0.03, 0.26, 0.012), '#f8f9fa', [0, 0.32, -0.21])]);
    }
    case 'uglySweater': {
      const [main, band] = v % 2 ? ['#2d6a4f', '#c1121f'] : ['#c1121f', '#2d6a4f'];
      const flakes = [-0.12, -0.04, 0.04, 0.12].map((x) => part(box(0.035, 0.035, 0.012), '#f8f9fa', [x, 0.33, -Math.sqrt(0.212 ** 2 - x * x) - 0.004], [0, -Math.asin(x / 0.212), Math.PI / 4]));
      return mergeParts([
        part(cyl(0.208, 0.208, 0.44, 24, true), main, [0, 0.3, 0]),
        part(cyl(0.212, 0.212, 0.05, 24, true), band, [0, 0.4, 0]),
        part(cyl(0.212, 0.212, 0.05, 24, true), band, [0, 0.24, 0]),
        part(torus(0.105, 0.04, 8, 20), band, [0, 0.505, -0.01], [Math.PI / 2, 0, 0]),
        ...flakes,
        part(sphere(0.03, 8, 6), '#e63946', [0, 0.16, -0.205]),
      ]);
    }
    default:
      return null;
  }
}

const cache = new Map<string, THREE.BufferGeometry | null>();

/** The costume's geometry for one part, hat height and colour variant; built once, shared, never freed (like PARTS). */
export function costumeGeometry(c: Costume, part: 'head' | 'body', look: Appearance, variant: number): THREE.BufferGeometry | null {
  const y = 0.17 + (TALL.has(look.hair) ? 0.09 : look.headwear !== 'none' ? 0.05 : 0);
  const key = `${c}|${part}|${part === 'head' ? y : ''}|${variant % 4}`;
  if (!cache.has(key)) cache.set(key, part === 'head' ? headGeometry(c, y, variant) : bodyGeometry(c, variant));
  return cache.get(key) ?? null;
}

/** One person's costume piece: what Character.tsx's ThemeCostume draws while a theme with costumes is mounted. */
export function CostumeView({ agent, look, part }: CostumeProps) {
  const id = useTheme((s) => s.id);
  const c = costumeFor(id, agent);
  const geo = c ? costumeGeometry(c, part, look, hashId(agent.id)) : null;
  if (!geo) return null;
  return <mesh geometry={geo} material={paintedToonDouble()} castShadow />;
}

/** Puts the costumes on while the calling theme is mounted. */
export function useCostumes() {
  useEffect(() => {
    useThemeRuntime.setState({ costume: CostumeView });
    return () => {
      if (useThemeRuntime.getState().costume === CostumeView) useThemeRuntime.setState({ costume: null });
    };
  }, []);
}
