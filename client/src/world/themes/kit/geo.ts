import * as THREE from 'three';
import { markBloom } from '../../gfx/bloomMarks';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon } from '../../materials';

// Building holiday props cheaply: every part gets its colour baked in as a vertex colour, so a whole prop (a pumpkin
// with its stem, a tree with its baubles, a witch's hat with its band) merges into one geometry and costs one draw
// call with one shared material, instanced when there are many of it.

type V3 = [number, number, number];

/** Bakes a colour into every vertex of `g` (and drops its index, so any parts can merge). */
export function paint(g: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  const c = new THREE.Color(color);
  const n = flat.attributes.position.count;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) data.set([c.r, c.g, c.b], i * 3);
  flat.setAttribute('color', new THREE.BufferAttribute(data, 3));
  if (!flat.attributes.uv) flat.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return flat;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();

/** Moves a geometry: scaled, then turned (XYZ), then moved, like a mesh would be. */
export function place(g: THREE.BufferGeometry, at: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 | number = 1): THREE.BufferGeometry {
  const s = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : new THREE.Vector3(...scale);
  q.setFromEuler(e.set(...rot));
  return g.applyMatrix4(m4.compose(new THREE.Vector3(...at), q, s));
}

/** A coloured part, moved into place: the building block of every prop. */
export const part = (g: THREE.BufferGeometry, color: string, at?: V3, rot?: V3, scale?: V3 | number) => paint(place(g, at, rot, scale), color);

/** Merges painted parts into one geometry and frees them. */
export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = (parts.length && mergeGeometries(parts)) || new THREE.BufferGeometry();
  for (const p of parts) p.dispose();
  out.computeBoundingSphere();
  return out;
}

export const sphere = (r: number, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
export const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);
export const cyl = (rTop: number, rBottom: number, h: number, seg = 14, open = false) => new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open);
export const cone = (r: number, h: number, seg = 16) => new THREE.ConeGeometry(r, h, seg);
export const torus = (r: number, tube: number, radial = 8, tubular = 20, arc = Math.PI * 2) => new THREE.TorusGeometry(r, tube, radial, tubular, arc);

/** A flat heart in the xy plane, `size` tall, extruded `depth` thick (balloons, confetti, stickies, boppers). */
export function heart(size: number, depth = 0): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, -0.5);
  s.bezierCurveTo(-0.15, -0.32, -0.55, -0.12, -0.5, 0.18);
  s.bezierCurveTo(-0.46, 0.45, -0.12, 0.52, 0, 0.28);
  s.bezierCurveTo(0.12, 0.52, 0.46, 0.45, 0.5, 0.18);
  s.bezierCurveTo(0.55, -0.12, 0.15, -0.32, 0, -0.5);
  const g = depth > 0 ? new THREE.ExtrudeGeometry(s, { depth: depth / size, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 2, curveSegments: 10 }) : new THREE.ShapeGeometry(s, 10);
  if (depth > 0) g.translate(0, 0, -depth / size / 2);
  return g.scale(size, size, size);
}

// ---------- materials ----------

let vcToon: THREE.MeshToonMaterial | null = null;
let vcGlow: THREE.MeshBasicMaterial | null = null;

/** The office's toon look for vertex-coloured props (the same three-step ramp as materials.ts). */
export function paintedToon(): THREE.MeshToonMaterial {
  vcToon ??= new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: (toon('#ffffff') as THREE.MeshToonMaterial).gradientMap });
  return vcToon;
}

let vcToonDouble: THREE.MeshToonMaterial | null = null;

/** The same, seen from both sides: open shells (a bowl, a cape, bunting, bat wings). */
export function paintedToonDouble(): THREE.MeshToonMaterial {
  if (!vcToonDouble) {
    vcToonDouble = paintedToon().clone();
    vcToonDouble.side = THREE.DoubleSide;
  }
  return vcToonDouble;
}

/** Unlit vertex colours for things that glow (bulbs, candle-lit faces): never shaded, never tone mapped. */
export function paintedGlow(): THREE.MeshBasicMaterial {
  vcGlow ??= markBloom(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  return vcGlow;
}

/** A soft round glow for additive halos (candles, bulbs), made once. */
let haloTex: THREE.CanvasTexture | null = null;
export function haloTexture(): THREE.CanvasTexture {
  if (haloTex) return haloTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  haloTex = new THREE.CanvasTexture(c);
  haloTex.colorSpace = THREE.SRGBColorSpace;
  return haloTex;
}
