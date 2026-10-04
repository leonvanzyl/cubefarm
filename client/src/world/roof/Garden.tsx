import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Outlines } from '../Outlines';
import { GARDEN_BEDS, PICNIC, TREE_PLANTERS, WATER_TANK, type Rect } from '../layout';
import { toon } from '../materials';
import { boxesGeometry, merged, type BoxSpec } from '../shapes';

// The roof's garden and its bits of furniture: raised beds along the north parapet (sunflowers and herbs, tomatoes on
// canes, lettuces), two little trees in planters by the decking, the old wooden water tank on its stand, and the
// picnic table by the grill. All static, merged into a handful of meshes by material.

const INK = '#1f1d2b';

/** A seeded wobble, so the garden grows the same way every visit. */
function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

const mid = (r: Rect) => ({ x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2, w: r.maxX - r.minX, d: r.maxZ - r.minZ, h: r.h ?? 0.6 });

function gardenGeometry() {
  const r = rand(21);
  const wood: BoxSpec[] = [];
  const soil: BoxSpec[] = [];
  const leaves: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = []; // darker greens: tomato plants, herbs, the trees' crowns
  const red: THREE.BufferGeometry[] = [];
  const yellow: THREE.BufferGeometry[] = [];
  const brown: THREE.BufferGeometry[] = []; // stems, canes, trunks, sunflower middles
  GARDEN_BEDS.forEach((bed, i) => {
    const { x, z, w, d, h } = mid(bed);
    // a box of planks with a rim, and soil just below the rim
    wood.push({ size: [w, h - 0.06, d], at: [x, (h - 0.06) / 2, z] });
    wood.push({ size: [w + 0.08, 0.06, d + 0.08], at: [x, h - 0.03, z] });
    soil.push({ size: [w - 0.12, 0.04, d - 0.12], at: [x, h - 0.02, z] });
    const y = h;
    const row = (n: number, fn: (px: number, pz: number, k: number) => void) => {
      for (let k = 0; k < n; k++) fn(x - w / 2 + 0.35 + (k * (w - 0.7)) / Math.max(1, n - 1), z + (r() - 0.5) * 0.25, k);
    };
    if (i === 2) {
      // lettuces in two rows, low, by the telescope
      for (const dz of [-0.22, 0.22])
        row(Math.round(w / 0.55), (px, _pz, k) => leaves.push(new THREE.SphereGeometry(0.17 + (k % 3) * 0.02, 10, 7).scale(1, 0.6, 1).translate(px, y + 0.08, z + dz)));
    } else if (i === 1) {
      // tomatoes on canes
      row(Math.round(w / 0.9), (px, pz) => {
        brown.push(new THREE.CylinderGeometry(0.015, 0.015, 1.1, 5).translate(px, y + 0.55, pz));
        dark.push(new THREE.SphereGeometry(0.28, 10, 8).scale(1, 1.35, 1).translate(px, y + 0.5, pz));
        for (let t = 0; t < 4; t++) red.push(new THREE.SphereGeometry(0.06, 8, 6).translate(px + (r() - 0.5) * 0.4, y + 0.3 + r() * 0.5, pz + (r() < 0.5 ? -0.24 : 0.24)));
      });
    } else {
      // sunflowers along the back, herbs in front: at the west end, clear of the telescope's view
      row(Math.round(w / 0.8), (px, pz) => {
        const tall = 1.2 + r() * 0.5;
        brown.push(new THREE.CylinderGeometry(0.025, 0.03, tall, 6).translate(px, y + tall / 2, pz + 0.2));
        leaves.push(new THREE.SphereGeometry(0.12, 8, 6).scale(1.6, 0.4, 1).translate(px + 0.08, y + tall * 0.5, pz + 0.2));
        // the heads turn to the terrace
        yellow.push(new THREE.CylinderGeometry(0.24, 0.24, 0.04, 14).rotateX(Math.PI / 2).translate(px, y + tall, pz + 0.18));
        brown.push(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 12).rotateX(Math.PI / 2).translate(px, y + tall, pz + 0.21));
        dark.push(new THREE.ConeGeometry(0.12, 0.3, 7).translate(px + 0.25, y + 0.15, pz - 0.22));
      });
    }
  });
  for (const p of TREE_PLANTERS) {
    wood.push({ size: [p.w, p.h - 0.06, p.w], at: [p.x, (p.h - 0.06) / 2, p.z] });
    wood.push({ size: [p.w + 0.08, 0.06, p.w + 0.08], at: [p.x, p.h - 0.03, p.z] });
    soil.push({ size: [p.w - 0.12, 0.04, p.w - 0.12], at: [p.x, p.h - 0.02, p.z] });
    brown.push(new THREE.CylinderGeometry(0.07, 0.1, 1.5, 8).translate(p.x, p.h + 0.75, p.z));
    dark.push(new THREE.SphereGeometry(0.75, 14, 10).translate(p.x, p.h + 1.75, p.z));
    leaves.push(new THREE.SphereGeometry(0.5, 12, 8).translate(p.x + 0.45, p.h + 1.45, p.z + 0.2));
    leaves.push(new THREE.SphereGeometry(0.45, 12, 8).translate(p.x - 0.4, p.h + 1.5, p.z - 0.25));
  }
  return {
    wood: boxesGeometry(wood),
    soil: boxesGeometry(soil),
    leaves: merged(leaves),
    dark: merged(dark),
    red: merged(red),
    yellow: merged(yellow),
    brown: merged(brown),
  };
}

function tankGeometry() {
  const { x, z, r, legs, h } = WATER_TANK;
  const stand: BoxSpec[] = [];
  const s = r * 0.75; // legs at the corners of a square under the tank
  for (const dx of [-s, s]) for (const dz of [-s, s]) stand.push({ size: [0.16, legs, 0.16], at: [x + dx, legs / 2, z + dz] });
  for (const y of [0.5, 1.4]) {
    stand.push({ size: [2 * s, 0.08, 0.08], at: [x, y, z - s] });
    stand.push({ size: [2 * s, 0.08, 0.08], at: [x, y, z + s] });
    stand.push({ size: [0.08, 0.08, 2 * s], at: [x - s, y, z] });
    stand.push({ size: [0.08, 0.08, 2 * s], at: [x + s, y, z] });
  }
  stand.push({ size: [2 * s + 0.4, 0.12, 2 * s + 0.4], at: [x, legs - 0.06, z] });
  // a ladder up the south side
  for (const dx of [-0.22, 0.22]) stand.push({ size: [0.06, legs + h * 0.8, 0.06], at: [x + dx, (legs + h * 0.8) / 2, z + r + 0.12] });
  for (let k = 1; k < 9; k++) stand.push({ size: [0.44, 0.04, 0.04], at: [x, (k * (legs + h * 0.8)) / 9, z + r + 0.12] });
  const tank = new THREE.CylinderGeometry(r, r * 1.04, h, 24).translate(x, legs + h / 2, z);
  const hoops = merged([0.25, 0.55, 0.85].map((k) => new THREE.TorusGeometry(r * 1.03 + 0.02, 0.035, 6, 32).rotateX(Math.PI / 2).translate(x, legs + h * k, z)));
  const hat = new THREE.ConeGeometry(r * 1.12, 0.9, 24).translate(x, legs + h + 0.45, z);
  return { stand: boxesGeometry(stand), tank, hoops, hat };
}

function picnicGeometry() {
  const { x, z, w, d, h } = PICNIC;
  const top: BoxSpec[] = [{ size: [w, 0.07, 0.8], at: [x, h, z] }];
  for (const dz of [-1, 1]) top.push({ size: [w, 0.06, 0.3], at: [x, 0.44, z + dz * (d / 2 - 0.15)] }); // the benches
  const legs: BoxSpec[] = [];
  for (const dx of [-w / 2 + 0.25, w / 2 - 0.25]) {
    legs.push({ size: [0.08, 0.06, d - 0.1], at: [x + dx, 0.38, z] }); // under the benches
    legs.push({ size: [0.08, h, 0.08], at: [x + dx, h / 2, z - 0.3] });
    legs.push({ size: [0.08, h, 0.08], at: [x + dx, h / 2, z + 0.3] });
  }
  return { top: boxesGeometry(top), legs: boxesGeometry(legs) };
}

export function Garden() {
  const g = useMemo(gardenGeometry, []);
  const tank = useMemo(tankGeometry, []);
  const picnic = useMemo(picnicGeometry, []);
  useEffect(() => () => [...Object.values(g), ...Object.values(tank), ...Object.values(picnic)].forEach((x) => x.dispose()), [g, tank, picnic]);
  return (
    <group>
      <mesh geometry={g.wood} material={toon('#b07d4f')} castShadow receiveShadow>
        <Outlines thickness={0.02} color={INK} />
      </mesh>
      <mesh geometry={g.soil} material={toon('#5e4433')} receiveShadow />
      <mesh geometry={g.leaves} material={toon('#80c45c')} castShadow />
      <mesh geometry={g.dark} material={toon('#3f9b4f')} castShadow />
      <mesh geometry={g.red} material={toon('#e63946')} />
      <mesh geometry={g.yellow} material={toon('#ffc93c')} castShadow />
      <mesh geometry={g.brown} material={toon('#7a5a3c')} castShadow />

      <mesh geometry={tank.stand} material={toon('#5e4a3c')} castShadow />
      <mesh geometry={tank.tank} material={toon('#a8744a')} castShadow receiveShadow>
        <Outlines thickness={0.025} color={INK} />
      </mesh>
      <mesh geometry={tank.hoops} material={toon('#495057')} />
      <mesh geometry={tank.hat} material={toon('#6b4a33')} castShadow>
        <Outlines thickness={0.025} color={INK} />
      </mesh>

      <mesh geometry={picnic.top} material={toon('#c9905a')} castShadow receiveShadow>
        <Outlines thickness={0.018} color={INK} />
      </mesh>
      <mesh geometry={picnic.legs} material={toon('#8a5a32')} castShadow />
    </group>
  );
}
