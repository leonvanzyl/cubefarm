import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useStore } from '../../store';
import { chairCreak } from '../../ui/peopleSounds';
import { useInteractable } from '../interact';
import { Outlines } from '../Outlines';
import { DECK_CHAIRS, SIDE_TABLES, deckChairFront, deckChairSeat } from '../layout';
import { toon } from '../materials';
import { merged } from '../shapes';
import { setPerch } from '../perch';
import { roofVisits, visitStage } from './roofBreaks';
import { useRoofOp, useRoofReport } from './roofOps';
import { useRoof } from './roofState';
import { stripeTexture } from './textures';

// The deck chairs on the decking: striped canvas slung on wooden frames, facing north over the garden to downtown.
// E in a free one sits you down and leans you back, the view tipped up to the sky (perch.ts); walking, Space or E gets you
// up. Visitors on a roof break (RoofPeople.tsx) take the others. Two draw calls for all four, plus the little tables.

type V3 = [number, number, number];

const COLOURS = ['#e63946', '#3a86ff', '#ffb703', '#2a9d8f'];
// Chair-space (origin on the deck under the sitter's hips, facing −z): the canvas hangs from the front bar down to the
// low point of the seat and up to the top bar, tipped back RECLINE from upright.
export const RECLINE = 0.45;
const SEAT_LOW: V3 = [0, 0.22, 0.12];
const FRONT_BAR: V3 = [0, 0.45, -0.42];
const TOP_BAR: V3 = [0, SEAT_LOW[1] + 0.86 * Math.cos(RECLINE + 0.05), SEAT_LOW[2] + 0.86 * Math.sin(RECLINE + 0.05)];
const HALF = 0.28; // half the canvas's width
const SIDE = 0.31; // the frame's sides
/** Where your eye is, sitting back in one (chair-space), and how far the view tips up. */
const EYE: V3 = [0, 0.98, 0.3];
const TIP = 0.42;

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** A square bar `t` thick from a to b. */
function bar(a: V3, b: V3, t = 0.045) {
  const from = new THREE.Vector3(...a);
  const to = new THREE.Vector3(...b);
  const dir = to.clone().sub(from);
  const g = new THREE.BoxGeometry(t, t, dir.length());
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize()));
  return g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}

/** A strip of canvas from a to b, HALF either side, striped across and tinted `colour`. */
function sling(a: V3, b: V3, colour: THREE.Color) {
  const g = new THREE.BufferGeometry();
  const p = [a[0] - HALF, a[1], a[2], a[0] + HALF, a[1], a[2], b[0] - HALF, b[1], b[2], b[0] + HALF, b[1], b[2]];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: 4 }, () => [colour.r, colour.g, colour.b]).flat(), 3));
  g.setIndex([0, 2, 1, 1, 2, 3]);
  g.computeVertexNormals();
  return g;
}

function chairsGeometry() {
  const frame: THREE.BufferGeometry[] = [];
  const canvas: THREE.BufferGeometry[] = [];
  DECK_CHAIRS.xs.forEach((_, i) => {
    const s = deckChairSeat(i);
    const at = (v: V3): V3 => [v[0] + s.x, v[1], v[2] + s.z];
    for (const x of [-SIDE, SIDE]) {
      const o: V3 = [x, 0, 0];
      frame.push(bar(at(add(FRONT_BAR, o)), at(add(SEAT_LOW, o))));
      frame.push(bar(at(add(SEAT_LOW, o)), at(add(TOP_BAR, o))));
      frame.push(bar(at([x, 0, FRONT_BAR[2]]), at([x, FRONT_BAR[1] + 0.02, FRONT_BAR[2]]))); // front leg
      frame.push(bar(at([x, 0, 0.62]), at([x, 0.64, 0.34]))); // the back strut
      frame.push(bar(at([x * 1.07, 0.56, -0.48]), at([x * 1.07, 0.56, 0.2]), 0.07)); // armrest
      frame.push(bar(at([x * 1.07, 0.56, -0.44]), at([x, 0.3, -0.42]))); // its support
    }
    frame.push(bar(at([-SIDE, TOP_BAR[1], TOP_BAR[2]]), at([SIDE, TOP_BAR[1], TOP_BAR[2]]), 0.06));
    frame.push(bar(at([-SIDE, FRONT_BAR[1], FRONT_BAR[2]]), at([SIDE, FRONT_BAR[1], FRONT_BAR[2]]), 0.06));
    const c = new THREE.Color(COLOURS[i % COLOURS.length]);
    canvas.push(sling(at(FRONT_BAR), at(SEAT_LOW), c), sling(at(SEAT_LOW), at(TOP_BAR), c));
  });
  const tables = merged(
    SIDE_TABLES.flatMap((t) => [
      new THREE.CylinderGeometry(t.r, t.r, 0.05, 20).translate(t.x, 0.55, t.z),
      new THREE.CylinderGeometry(0.04, 0.05, 0.53, 8).translate(t.x, 0.27, t.z),
      new THREE.CylinderGeometry(0.2, 0.22, 0.03, 16).translate(t.x, 0.015, t.z),
    ]),
  );
  return { frame: merged(frame), canvas: merged(canvas), tables };
}

/** Whether a visitor is in deck chair i or on their way to it. */
const takenByVisitor = (i: number, now = Date.now()) => roofVisits(now).some((v) => v.kind === 'break' && v.chair === i && visitStage(v, now) !== 'down');

/** A deck chair's aim target: E sits you down in it. */
function ChairTarget({ i }: { i: number }) {
  const s = deckChairSeat(i);
  const ref = useInteractable<THREE.Mesh>({ id: `deckchair-${i}`, label: 'Sit back in the deck chair', action: { kind: 'roof', op: `chair:${i}` } }, 3);
  return (
    <mesh ref={ref} position={[s.x, 0.5, s.z + 0.05]} visible={false}>
      <boxGeometry args={[DECK_CHAIRS.w, 1, DECK_CHAIRS.l]} />
    </mesh>
  );
}

/** Sits the player in deck chair i (from E on it, or the probe). */
function sitIn(i: number) {
  if (i < 0 || i >= DECK_CHAIRS.xs.length) return;
  const s = useStore.getState();
  if (useRoof.getState().sitting === i) return;
  if (takenByVisitor(i)) {
    s.pushToast('info', "🪑 Someone's sitting there: try another chair");
    return;
  }
  const seat = deckChairSeat(i);
  setPerch({
    id: `deckchair-${i}`,
    x: seat.x + EYE[0],
    y: EYE[1],
    z: seat.z + EYE[2],
    tilt: TIP,
    look: 1,
    minPitch: -0.95,
    maxPitch: 1.1,
    exit: deckChairFront(i),
    yaw: 0,
    pitch: 0.05,
    onLeave: () => {
      if (useRoof.getState().sitting === i) useRoof.setState({ sitting: null });
    },
  });
  useRoof.setState({ sitting: i, telescope: false });
  chairCreak({ x: seat.x, y: 0.4, z: seat.z });
}

export function DeckChairs() {
  const geo = useMemo(chairsGeometry, []);
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);
  const canvasMat = useMemo(() => new THREE.MeshToonMaterial({ map: stripeTexture(), vertexColors: true, side: THREE.DoubleSide }), []);
  useEffect(() => () => canvasMat.dispose(), [canvasMat]);
  useRoofOp('chair', (arg) => sitIn(Number(arg)));
  useRoofReport('chairs', () => DECK_CHAIRS.xs.map((_, i) => (useRoof.getState().sitting === i ? 'you' : takenByVisitor(i) ? 'taken' : 'free')));
  return (
    <group>
      <mesh geometry={geo.frame} material={toon('#c08552')} castShadow>
        <Outlines thickness={0.012} color="#1f1d2b" />
      </mesh>
      <mesh geometry={geo.canvas} material={canvasMat} castShadow receiveShadow />
      <mesh geometry={geo.tables} material={toon('#e9ecef')} castShadow receiveShadow />
      {DECK_CHAIRS.xs.map((_, i) => (
        <ChairTarget key={i} i={i} />
      ))}
    </group>
  );
}
