import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { markBloom } from '../../gfx/bloomMarks';
import { decorRuns, type DecorRun } from '../../layout';
import { cone, mergeParts, paintedToon, paintedToonDouble, part, sphere } from './geo';

// Along the walls under the ceiling (layout.ts decorRuns): string lights that twinkle, tinsel garlands with bows, and
// bunting. Each kind is one or two draw calls for the whole floor; the lights' twinkle rewrites a few colours ten times
// a second rather than every frame.

type FloorKind = 'office' | 'lobby';
type P = { x: number; y: number; z: number };

const HOOK_EVERY = 1.6; // metres between the hooks a run hangs from
const SAG = 0.12;

/** Points along a run, `step` apart, sagging between hooks. */
export function sagPoints(run: DecorRun, step: number, sag = SAG): P[] {
  const [x0, z0] = run.from;
  const [x1, z1] = run.to;
  const len = Math.hypot(x1 - x0, z1 - z0);
  const hooks = Math.max(1, Math.round(len / HOOK_EVERY));
  const n = Math.max(2, Math.round(len / step));
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const h = (t * hooks) % 1;
    out.push({ x: x0 + (x1 - x0) * t, y: run.y - sag * 4 * h * (1 - h), z: z0 + (z1 - z0) * t });
  }
  return out;
}

/** Twinkling bulbs in `colors`, taking turns along every run. */
export function StringLights({ kind, colors }: { kind: FloorKind; colors: string[] }) {
  const bulbs = useMemo(() => decorRuns(kind).flatMap((r) => sagPoints(r, 0.45).map((p) => ({ ...p, y: p.y - 0.05 }))), [kind]);
  const wire = useMemo(() => {
    const pts: number[] = [];
    for (const r of decorRuns(kind)) {
      const line = sagPoints(r, 0.2);
      for (let i = 1; i < line.length; i++) pts.push(line[i - 1].x, line[i - 1].y, line[i - 1].z, line[i].x, line[i].y, line[i].z);
    }
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }, [kind]);
  const geo = useMemo(() => new THREE.SphereGeometry(0.04, 6, 4).scale(1, 1.3, 1), []);
  const mat = useMemo(() => markBloom(new THREE.MeshBasicMaterial({ toneMapped: false }), 'night'), []);
  const wireMat = useMemo(() => new THREE.LineBasicMaterial({ color: '#2b2d42' }), []);
  useEffect(
    () => () => {
      [wire, geo, mat, wireMat].forEach((d) => d.dispose());
    },
    [wire, geo, mat, wireMat],
  );
  const ref = useRef<THREE.InstancedMesh>(null);
  const st = useMemo(() => ({ base: colors.map((c) => new THREE.Color(c)), tmp: new THREE.Color(), next: 0 }), [colors]);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    bulbs.forEach((b, i) => {
      o.position.set(b.x, b.y, b.z);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, st.base[i % st.base.length]);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
  }, [bulbs, st]);
  useFrame(({ clock }) => {
    const m = ref.current;
    const t = clock.elapsedTime;
    if (!m || t < st.next) return;
    st.next = t + 0.1;
    for (let i = 0; i < bulbs.length; i++) {
      const k = 0.55 + 0.45 * Math.max(0, Math.sin(t * 2.2 + i * 1.7 + (i % 3) * 2.1));
      m.setColorAt(i, st.tmp.copy(st.base[i % st.base.length]).multiplyScalar(0.35 + k));
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <group>
      <lineSegments geometry={wire} material={wireMat} />
      <instancedMesh ref={ref} args={[geo, mat, bulbs.length]} />
    </group>
  );
}

/** Green tinsel swags along the walls, with a red bow at every hook. */
export function Garland({ kind }: { kind: FloorKind }) {
  const geo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (const r of decorRuns(kind)) {
      const pts = sagPoints(r, 0.15, 0.32).map((p) => new THREE.Vector3(p.x, p.y - 0.06, p.z));
      parts.push(part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length, 0.07, 5), '#2d6a4f'));
      // little tufts so it reads as tinsel, not a hose
      pts.forEach((p, i) => i % 3 === 0 && parts.push(part(sphere(0.085, 5, 4), i % 6 === 0 ? '#40916c' : '#1b4332', [p.x, p.y, p.z])));
      for (const h of sagPoints(r, 1.6, 0)) {
        parts.push(part(sphere(0.07, 8, 6), '#d00000', [h.x, h.y - 0.06, h.z]));
        parts.push(part(cone(0.06, 0.16, 6), '#e5383b', [h.x - 0.09, h.y - 0.09, h.z], [0, 0, 1.1]));
        parts.push(part(cone(0.06, 0.16, 6), '#e5383b', [h.x + 0.09, h.y - 0.09, h.z], [0, 0, -1.1]));
      }
    }
    return mergeParts(parts);
  }, [kind]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={paintedToon()} />;
}

/** Little triangular flags in `colors` along the walls (Easter, New Year, the birthday). */
export function Bunting({ kind, colors, y = -0.25 }: { kind: FloorKind; colors: string[]; y?: number }) {
  const geo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    let k = 0;
    for (const r of decorRuns(kind)) {
      const pts = sagPoints({ ...r, y: r.y + y }, 0.36, 0.2);
      const dx = r.to[0] - r.from[0];
      const dz = r.to[1] - r.from[1];
      const yaw = Math.atan2(-dz, dx);
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const flag = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-0.13, 0, 0, 0.13, 0, 0, 0, -0.26, 0], 3));
        flag.computeVertexNormals();
        parts.push(part(flag, colors[k++ % colors.length], [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2], [0, yaw, 0]));
      }
    }
    return mergeParts(parts);
  }, [kind, colors, y]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={paintedToonDouble()} />;
}
