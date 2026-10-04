import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { repoOnFloor, useStore } from '../../../store';
import { loop, placeAt } from '../../../ui/eventSfx';
import { seeded } from '../director';
import { clamp01, eyeAbove, inOut, sign, smooth, toonOut, type SceneProps } from '../kit';
import { skyText } from '../news';

// A little stunt plane writing the floor's name across the sky in puffs of smoke, letter by letter, left to right as
// you read it from the windows; then it flies off and the writing slowly spreads, drifts and fades. The letters are
// sampled from the name drawn on a canvas, so any name works; the puffs are one instanced mesh.

const MAX_PUFFS = 460;
const WRITE = { from: 5, to: 47 };

/** Points along the lit pixels of `text` drawn big on a canvas: [u, v] in pixels, column by column, snaking. */
function letterPoints(text: string): { pts: [number, number][]; w: number; h: number } {
  const c = document.createElement('canvas');
  c.width = 900;
  c.height = 120;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.font = 'bold 96px "Segoe UI", sans-serif';
  const w = Math.min(c.width - 10, Math.ceil(ctx.measureText(text).width) + 10);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 5, 62);
  const data = ctx.getImageData(0, 0, w, c.height).data;
  const step = Math.max(4, Math.round(Math.sqrt((w * 60) / MAX_PUFFS)));
  const pts: [number, number][] = [];
  for (let u = 0, col = 0; u < w; u += step, col++) {
    const column: [number, number][] = [];
    for (let v = 0; v < c.height; v += step) if (data[(v * w + u) * 4 + 3] > 120) column.push([u, v]);
    pts.push(...(col % 2 ? column.reverse() : column));
  }
  return { pts: pts.slice(0, MAX_PUFFS), w, h: c.height };
}

export default function Skywriting({ run, elevation }: SceneProps) {
  const plane = useRef<THREE.Group>(null);
  const puffs = useRef<THREE.InstancedMesh>(null);
  const s = sign(run.side);
  const p = useMemo(() => {
    const st = useStore.getState();
    const repo = st.floor > 0 ? repoOnFloor(st.repos, st.floor) : null;
    const text = skyText(repo?.fullName ?? null, st.settings.companyName);
    const { pts, w, h } = letterPoints(text);
    const r = seeded(run.seed);
    const width = Math.min(190, 18 + text.length * 13);
    const scale = width / w;
    const x = s * (215 + r() * 30);
    const y0 = eyeAbove(elevation) + 38 + r() * 10;
    // reading left to right from the windows runs along +z on the east side, -z on the west
    const world = pts.map(([u, v]) => [x, y0 + (h - v) * scale, s * (u - w / 2) * scale] as const);
    return { text, world, x, y0, size: Math.max(1.4, scale * 3.2) };
  }, [run.seed, s, elevation]);
  const m = useMemo(() => ({ mat: new THREE.Matrix4(), v: new THREE.Vector3(), q: new THREE.Quaternion(), sc: new THREE.Vector3(), last: new THREE.Vector3(), first: true }), []);
  useLayoutEffect(() => {
    const mesh = puffs.current;
    if (!mesh) return;
    m.mat.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_PUFFS; i++) mesh.setMatrixAt(i, m.mat);
    mesh.instanceMatrix.needsUpdate = true;
  }, [m]);
  const sound = useMemo(() => ({ engine: null as ReturnType<typeof loop> | null }), []);
  useEffect(() => {
    sound.engine = loop('engine');
    return () => sound.engine?.stop(1);
  }, [sound]);

  useFrame(() => {
    const t = run.t;
    const n = p.world.length;
    const per = (WRITE.to - WRITE.from) / Math.max(1, n);
    const written = clamp01((t - WRITE.from) / (WRITE.to - WRITE.from)) * n;
    const fadeOut = clamp01((run.seconds - t) / 14);
    const mesh = puffs.current;
    if (mesh) {
      for (let i = 0; i < n; i++) {
        const age = t - (WRITE.from + i * per);
        const [x, y, z] = p.world[i];
        const size = age < 0 ? 0 : p.size * (0.4 + 0.6 * smooth(age)) * (1 + age * 0.012) * fadeOut;
        m.v.set(x, y + Math.max(0, age) * 0.03, z + Math.max(0, age) * 0.12);
        m.sc.set(size, size, size);
        mesh.setMatrixAt(i, m.mat.compose(m.v, m.q, m.sc));
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    // the plane: on the latest puff while writing, swooping in before and away after
    const g = plane.current;
    if (!g) return;
    const i = Math.min(n - 1, Math.floor(written));
    const [px, py, pz] = n ? p.world[Math.max(0, i)] : [p.x, p.y0, 0];
    let x = px;
    let y = py;
    let z = pz;
    if (t < WRITE.from) {
      const k = 1 - smooth(t / WRITE.from);
      z -= s * k * 160;
      y += k * 20;
    } else if (t > WRITE.to) {
      const k = smooth((t - WRITE.to) / 12);
      z += s * k * 220;
      y += k * 40;
    }
    if (!m.first) {
      const dx = x - m.last.x;
      const dy = y - m.last.y;
      const dz = z - m.last.z;
      if (dx * dx + dy * dy + dz * dz > 1e-4) g.lookAt(x + dx, y + dy, z + dz);
    }
    m.first = false;
    g.position.set(x, y, z);
    m.last.set(x, y, z);
    g.visible = t < WRITE.to + 12;
    const heard = placeAt(x, y - elevation, z, 120);
    sound.engine?.set(heard.gain * 0.7 * inOut(t, WRITE.to + 12, 3), heard.pan, 1.7);
  });

  return (
    <group>
      <group ref={plane} scale={1.4}>
        <mesh material={toonOut('#f4a261')} rotation-x={Math.PI / 2}>
          <capsuleGeometry args={[0.45, 3.2, 4, 8]} />
        </mesh>
        <mesh material={toonOut('#e63946')} position={[0, 0, 0.6]}>
          <boxGeometry args={[6.5, 0.15, 1.1]} />
        </mesh>
        <mesh material={toonOut('#e63946')} position={[0, 0.5, -1.8]}>
          <boxGeometry args={[0.12, 1, 0.8]} />
        </mesh>
        <mesh material={toonOut('#e63946')} position={[0, 0.1, -1.9]}>
          <boxGeometry args={[2.2, 0.1, 0.6]} />
        </mesh>
      </group>
      <instancedMesh ref={puffs} args={[undefined, undefined, MAX_PUFFS]} material={toonOut('#ffffff', { opacity: 0.92 })} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
      </instancedMesh>
    </group>
  );
}
