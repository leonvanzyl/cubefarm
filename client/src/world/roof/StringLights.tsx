import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LIGHT_POLES, POLE } from '../layout';
import { toon } from '../materials';
import { merged } from '../shapes';
import { lampsOn } from '../sky/lamps';

// The string lights over the decking: festoon bulbs on wires that sag between six poles, zigzagging across and along the
// lounge. Dull glass by day; from dusk they glow warm with a soft halo each, following the office's lamps (DayLights
// sets their level, sky/lamps.tsx). Four draw calls, the halos hidden by day.

/** Which poles each wire runs between (LIGHT_POLES: north and south at each of three x): across in an X, and along. */
const STRANDS: [number, number][] = [
  [0, 3],
  [1, 2],
  [2, 5],
  [3, 4],
  [0, 2],
  [2, 4],
  [1, 3],
  [3, 5],
];
const TOP = POLE.h - 0.12; // where the wires hang from
const SPACING = 0.62; // metres between bulbs
const TINTS = ['#fff1c9', '#fff1c9', '#ffb86b', '#ff8fab', '#8ecae6', '#fff1c9', '#b9fbc0'];
const OFF = new THREE.Color('#bdb6a6');
const ON = new THREE.Color('#ffffff');

/** Points along a wire from a to b, sagging `sag` in the middle (a parabola is close enough to a catenary here). */
function wire(a: { x: number; z: number }, b: { x: number; z: number }, n: number, sag: number) {
  return Array.from({ length: n + 1 }, (_, k) => {
    const u = k / n;
    return new THREE.Vector3(a.x + (b.x - a.x) * u, TOP - sag * 4 * u * (1 - u), a.z + (b.z - a.z) * u);
  });
}

function haloTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function StringLights() {
  const bulbs = useRef<THREE.InstancedMesh>(null);
  const built = useMemo(() => {
    const wires: number[] = [];
    const at: THREE.Vector3[] = [];
    for (const [i, j] of STRANDS) {
      const a = LIGHT_POLES[i];
      const b = LIGHT_POLES[j];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const pts = wire(a, b, 24, 0.12 + len * 0.035);
      for (let k = 0; k < pts.length - 1; k++) wires.push(pts[k].x, pts[k].y, pts[k].z, pts[k + 1].x, pts[k + 1].y, pts[k + 1].z);
      const n = Math.floor(len / SPACING);
      for (const p of wire(a, b, n, 0.12 + len * 0.035).slice(1, -1)) at.push(p.setY(p.y - 0.07));
    }
    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
    const colors = at.map((_, k) => new THREE.Color(TINTS[k % TINTS.length]));
    const haloGeo = new THREE.BufferGeometry();
    haloGeo.setAttribute('position', new THREE.Float32BufferAttribute(at.flatMap((p) => [p.x, p.y, p.z]), 3));
    haloGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors.flatMap((c) => [c.r, c.g, c.b]), 3));
    const poles = merged(LIGHT_POLES.flatMap((p) => [new THREE.CylinderGeometry(POLE.r, POLE.r * 1.3, POLE.h, 8).translate(p.x, POLE.h / 2, p.z), new THREE.SphereGeometry(POLE.r * 1.6, 8, 6).translate(p.x, POLE.h, p.z)]));
    return {
      at,
      colors,
      wireGeo,
      haloGeo,
      poles,
      bulbGeo: new THREE.SphereGeometry(0.055, 10, 8).scale(1, 1.3, 1),
      bulbMat: new THREE.MeshBasicMaterial({ color: OFF.clone(), toneMapped: false }),
      wireMat: new THREE.LineBasicMaterial({ color: '#2b2d42' }),
      haloMat: new THREE.PointsMaterial({ size: 0.55, map: haloTexture(), vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
      level: -1,
    };
  }, []);
  useEffect(
    () => () => {
      for (const d of [built.wireGeo, built.haloGeo, built.poles, built.bulbGeo, built.bulbMat, built.wireMat, built.haloMat, built.haloMat.map]) d?.dispose();
    },
    [built],
  );
  useEffect(() => {
    const m = bulbs.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    built.at.forEach((p, k) => {
      m.setMatrixAt(k, mat.makeTranslation(p.x, p.y, p.z));
      m.setColorAt(k, built.colors[k]);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [built]);
  const halos = useRef<THREE.Points>(null);

  useFrame(() => {
    const level = lampsOn();
    if (Math.abs(level - built.level) < 0.004) return;
    built.level = level;
    built.bulbMat.color.lerpColors(OFF, ON, level);
    built.haloMat.opacity = level * 0.65;
    if (halos.current) halos.current.visible = level > 0.02;
  });

  return (
    <group>
      <mesh geometry={built.poles} material={toon('#3d405b')} castShadow />
      <lineSegments geometry={built.wireGeo} material={built.wireMat} />
      <instancedMesh ref={bulbs} args={[built.bulbGeo, built.bulbMat, built.at.length]} />
      <points ref={halos} geometry={built.haloGeo} material={built.haloMat} visible={false} renderOrder={2} />
    </group>
  );
}
