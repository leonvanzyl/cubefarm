import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Outlines } from '../Outlines';
import { BuildingBelow } from '../Outside';
import { DECKING, ELEVATOR, HALF_D, HELIPAD, ROOF_EDGE, ROOF_HUT, WINDSOCK, roofElevation } from '../layout';
import { toon } from '../materials';
import { boxesGeometry, merged, type BoxSpec } from '../shapes';
import { balconyBulb } from '../sky/lamps';
import { deckingTexture, helipadTexture, pavingTexture, windsockTexture } from './textures';

// The roof itself: the paving, the lounge's decking and the painted helipad, the parapet and railing all round, the hut
// over the elevator and the stairs (the elevator's doors are Elevator.tsx's, as on every floor), the windsock, and the
// building under it all (every floor's balconies, the outer walls and the elevator shaft down to the street).

const INK = '#1f1d2b';
const { x: X, z: Z, t: T, parapet: P, h: H } = ROOF_EDGE;
const HUT = ROOF_HUT;
const PAVER = 1.2; // metres per paving texture repeat (and per decking repeat)

/** A plane lying flat at height y, its UVs in units of `per` metres so a repeating texture keeps its scale. */
function flat(w: number, d: number, per: number) {
  const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / per, (uv.getY(i) * d) / per);
  return g;
}

/** The parapet's runs round the edge (south: either side of the hut), as [x0, x1, z0, z1]. */
const RUNS: [number, number, number, number][] = [
  [-X, X, -Z, -Z + T],
  [-X, -X + T, -Z + T, Z - T],
  [X - T, X, -Z + T, Z - T],
  [-X, HUT.minX, Z - T, Z],
  [HUT.maxX, X, Z - T, Z],
];

function edgeGeometry() {
  const wall: BoxSpec[] = [];
  const cap: BoxSpec[] = [];
  const metal: BoxSpec[] = [];
  for (const [x0, x1, z0, z1] of RUNS) {
    const w = x1 - x0;
    const d = z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    wall.push({ size: [w, P, d], at: [cx, P / 2, cz] });
    cap.push({ size: [w + 0.06, 0.07, d + 0.06], at: [cx, P + 0.035, cz] });
    // a rail on posts along the parapet's middle
    const along = w > d;
    const len = along ? w : d;
    const n = Math.max(1, Math.round(len / 1.6));
    for (let k = 0; k <= n; k++) {
      const u = -len / 2 + (k * len) / n;
      metal.push({ size: [0.06, H - P, 0.06], at: [along ? cx + u : cx, P + (H - P) / 2, along ? cz : cz + u] });
    }
    metal.push({ size: along ? [w, 0.07, 0.09] : [0.09, 0.07, d], at: [cx, H, cz] });
    metal.push({ size: along ? [w, 0.035, 0.035] : [0.035, 0.035, d], at: [cx, (P + H) / 2 + 0.05, cz] });
  }
  return { wall: boxesGeometry(wall), cap: boxesGeometry(cap), metal: boxesGeometry(metal) };
}

const STAIR_DOOR = { half: 0.5, h: 2.2 };

function hutGeometry(elevation: number) {
  const { doorHalf, doorHeight } = ELEVATOR;
  const f = HUT.front;
  const zf = HALF_D + f / 2;
  const s0 = HUT.stairX - STAIR_DOOR.half;
  const s1 = HUT.stairX + STAIR_DOOR.half;
  const piece = (x0: number, x1: number, y0: number, y1: number): BoxSpec => ({ size: [x1 - x0, y1 - y0, f], at: [(x0 + x1) / 2, (y0 + y1) / 2, zf] });
  const walls: BoxSpec[] = [
    piece(HUT.minX, s0, 0, HUT.h),
    piece(s0, s1, STAIR_DOOR.h, HUT.h),
    piece(s1, -doorHalf, 0, HUT.h),
    piece(-doorHalf, doorHalf, doorHeight, HUT.h),
    piece(doorHalf, HUT.maxX, 0, HUT.h),
    // sides and back: they carry on down the building as the shaft
    { size: [0.25, HUT.h + elevation, HUT.maxZ - HALF_D], at: [HUT.minX + 0.125, (HUT.h - elevation) / 2, (HALF_D + HUT.maxZ) / 2] },
    { size: [0.25, HUT.h + elevation, HUT.maxZ - HALF_D], at: [HUT.maxX - 0.125, (HUT.h - elevation) / 2, (HALF_D + HUT.maxZ) / 2] },
    { size: [HUT.maxX - HUT.minX, HUT.h + elevation, 0.25], at: [(HUT.minX + HUT.maxX) / 2, (HUT.h - elevation) / 2, HUT.maxZ - 0.125] },
  ];
  const roof: BoxSpec[] = [
    { size: [HUT.maxX - HUT.minX + 0.3, 0.2, HUT.maxZ - HALF_D + 0.3], at: [(HUT.minX + HUT.maxX) / 2, HUT.h + 0.1, (HALF_D + HUT.maxZ) / 2] },
    { size: [1.4, 0.7, 1.1], at: [HUT.minX + 1.4, HUT.h + 0.55, HUT.maxZ - 1] }, // the lift's machine-room vent
    { size: [0.9, 0.5, 0.9], at: [HUT.maxX - 0.9, HUT.h + 0.45, HALF_D + 0.9] }, // an air-con unit
  ];
  const trim: BoxSpec[] = [
    { size: [HUT.maxX - HUT.minX + 0.04, 0.22, 0.04], at: [(HUT.minX + HUT.maxX) / 2, HUT.h - 0.5, HALF_D - 0.02] }, // a band round the top
    { size: [0.08, STAIR_DOOR.h + 0.08, 0.08], at: [s0 - 0.04, STAIR_DOOR.h / 2, HALF_D - 0.02] }, // the stair door's frame
    { size: [0.08, STAIR_DOOR.h + 0.08, 0.08], at: [s1 + 0.04, STAIR_DOOR.h / 2, HALF_D - 0.02] },
    { size: [STAIR_DOOR.half * 2 + 0.16, 0.08, 0.08], at: [HUT.stairX, STAIR_DOOR.h + 0.04, HALF_D - 0.02] },
    { size: [0.05, 1.6, 0.05], at: [HUT.maxX - 0.6, HUT.h + 0.2 + 0.8, HALF_D + 0.5] }, // an aerial
  ];
  const door: BoxSpec[] = [{ size: [STAIR_DOOR.half * 2, STAIR_DOOR.h, 0.05], at: [HUT.stairX, STAIR_DOOR.h / 2, HALF_D + 0.06] }];
  const handle: BoxSpec[] = [
    { size: [0.05, 0.05, 0.08], at: [HUT.stairX + STAIR_DOOR.half - 0.14, 1.05, HALF_D + 0.0] },
    { size: [0.5, 0.04, 0.04], at: [HUT.stairX, 1.0, HALF_D + 0.01] }, // a push bar
  ];
  return { walls: boxesGeometry(walls), roof: boxesGeometry(roof), trim: boxesGeometry(trim), door: boxesGeometry(door), handle: boxesGeometry(handle) };
}

/** The lamp over the stairs' door and the helipad's edge lights: lit at night with the balcony bulbs. */
function bulbGeometry() {
  const parts: THREE.BufferGeometry[] = [new THREE.BoxGeometry(0.3, 0.14, 0.12).translate(HUT.stairX, STAIR_DOOR.h + 0.35, HALF_D - 0.06)];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    parts.push(new THREE.SphereGeometry(0.09, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(HELIPAD.x + Math.cos(a) * (HELIPAD.r + 0.25), 0, HELIPAD.z + Math.sin(a) * (HELIPAD.r + 0.25)));
  }
  return merged(parts);
}

/** The windsock: a striped sock on a pole that swings round and droops as the wind gusts. */
function Windsock() {
  const sock = useRef<THREE.Group>(null);
  const geo = useMemo(() => new THREE.CylinderGeometry(0.2, 0.09, 1.3, 16, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.65), []);
  useEffect(() => () => geo.dispose(), [geo]);
  const mat = useMemo(() => new THREE.MeshToonMaterial({ map: windsockTexture(), side: THREE.DoubleSide }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(({ clock }) => {
    const s = sock.current;
    if (!s) return;
    const t = clock.elapsedTime;
    const gust = 0.5 + 0.5 * Math.sin(t * 0.35) * Math.sin(t * 0.13 + 1);
    // the wind blows the clouds towards +z (south): the sock points that way, give or take
    s.rotation.set(0.55 * (1 - gust) + Math.sin(t * 3.1) * 0.04, Math.sin(t * 0.27) * 0.5 + Math.sin(t * 1.7) * 0.06, 0, 'YXZ');
  });
  return (
    <group position={[WINDSOCK.x, 0, WINDSOCK.z]}>
      <mesh position={[0, WINDSOCK.h / 2, 0]} material={toon('#adb5bd')} castShadow>
        <cylinderGeometry args={[0.045, 0.06, WINDSOCK.h, 10]} />
      </mesh>
      <group ref={sock} position={[0, WINDSOCK.h - 0.12, 0]}>
        <mesh geometry={geo} material={mat} castShadow />
      </group>
    </group>
  );
}

/** The deck, the parapet, the hut and the building underneath. `top` is the highest floor. */
export function RoofDeck({ top }: { top: number }) {
  const elevation = roofElevation(top);
  const ground = useMemo(() => {
    const deckW = DECKING.maxX - DECKING.minX;
    const deckD = DECKING.maxZ - DECKING.minZ;
    return {
      paving: flat(2 * X, 2 * Z, PAVER).translate(0, 0, 0),
      decking: (() => {
        const g = new THREE.BoxGeometry(deckW, 0.06, deckD);
        // the top face's UVs in metres, so the boards keep their width
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * deckW) / PAVER, (uv.getY(i) * deckD) / PAVER);
        return g.translate((DECKING.minX + DECKING.maxX) / 2, 0.03, (DECKING.minZ + DECKING.maxZ) / 2);
      })(),
      helipad: new THREE.CircleGeometry(HELIPAD.r, 64).rotateX(-Math.PI / 2).translate(HELIPAD.x, 0.005, HELIPAD.z),
      bulbs: bulbGeometry(),
    };
  }, []);
  const edge = useMemo(edgeGeometry, []);
  const hut = useMemo(() => hutGeometry(elevation), [elevation]);
  useEffect(() => () => [...Object.values(ground), ...Object.values(edge)].forEach((g) => g.dispose()), [ground, edge]);
  useEffect(() => () => Object.values(hut).forEach((g) => g.dispose()), [hut]);
  const mats = useMemo(
    () => ({
      paving: new THREE.MeshToonMaterial({ map: pavingTexture() }),
      decking: new THREE.MeshToonMaterial({ map: deckingTexture() }),
      helipad: new THREE.MeshToonMaterial({ map: helipadTexture(), transparent: true, polygonOffset: true, polygonOffsetFactor: -2 }),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  return (
    <group>
      <mesh geometry={ground.paving} material={mats.paving} receiveShadow />
      <mesh geometry={ground.decking} material={mats.decking} receiveShadow />
      <mesh geometry={ground.helipad} material={mats.helipad} receiveShadow />
      <mesh geometry={ground.bulbs} material={balconyBulb} />
      <mesh geometry={edge.wall} material={toon('#c9c2b4')} receiveShadow castShadow>
        <Outlines thickness={0.02} color={INK} />
      </mesh>
      <mesh geometry={edge.cap} material={toon('#ece6da')} receiveShadow />
      <mesh geometry={edge.metal} material={toon('#5c677d')} castShadow />
      <mesh geometry={hut.walls} material={toon('#efe3cc')} receiveShadow castShadow>
        <Outlines thickness={0.02} color={INK} />
      </mesh>
      <mesh geometry={hut.roof} material={toon('#8d99ae')} castShadow receiveShadow>
        <Outlines thickness={0.02} color={INK} />
      </mesh>
      <mesh geometry={hut.trim} material={toon('#ff8a5b')} />
      <mesh geometry={hut.door} material={toon('#2a9d8f')} />
      <mesh geometry={hut.handle} material={toon('#dee2e6')} />
      <Windsock />
      <BuildingBelow top={top} />
    </group>
  );
}
