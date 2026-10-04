import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../../store';
import { noise, tone } from '../../ui/sfx';
import { useInteractable } from '../interact';
import { Outlines } from '../Outlines';
import { GRILL } from '../layout';
import { glow, toon } from '../materials';
import { BITES, doneness, emptyGrill, grillLabel, grillState, pressGrill, sizzle, type Grill as GrillModel } from './grillRules';
import { useRoofOp, useRoofReport } from './roofOps';
import { useRoof } from './roofState';

// The barbecue by the picnic table (grillRules.ts has the rules): a kettle grill on three legs with its lid propped open,
// glowing coals and a side shelf of buns. E puts a sausage on; it sizzles (a synthesized crackle from the grate), smokes
// and browns, E turns it over, and once it's done E takes it in a bun to eat a bite at a time (HeldSausage.tsx). Left on
// too long it chars, and it's still edible.

const INK = '#1f1d2b';
const GRATE_Y = 0.86;
const RAW = new THREE.Color('#e9a0a0');
const COOKED = new THREE.Color('#b5532c');
const CHARRED = new THREE.Color('#3b2922');
const PUFFS = 14;
const SMOKE_RISE = 2.2; // seconds a puff takes to rise and fade
let sausageSeq = 1;

const at = { x: GRILL.x, y: GRATE_Y, z: GRILL.z };

/** One crackle off the grate: a hiss of fat, now and then a pop. */
function crackle(level: number) {
  noise({ name: 'grill-sizzle', group: 'toys', pos: at, dur: 0.06 + Math.random() * 0.22, peak: (0.012 + Math.random() * 0.03) * level, filter: 'highpass', freq: 2600 + Math.random() * 3800, attack: 0.004 });
  if (Math.random() < 0.18 * level) noise({ name: 'grill-pop', group: 'toys', pos: at, dur: 0.03, peak: 0.05 * level, filter: 'bandpass', freq: 1500 + Math.random() * 1500, q: 2, attack: 0.001 });
}

/** The sausage hitting a hot grate (or being turned over): a big hiss. */
function hiss() {
  noise({ name: 'grill-hiss', group: 'toys', pos: at, dur: 0.9, peak: 0.07, filter: 'highpass', freq: 3200, to: 5200, attack: 0.01 });
}

/** Into a bun: a soft squash and a little "pop" of the tongs. */
function bun() {
  noise({ name: 'grill-bun', group: 'toys', pos: at, dur: 0.12, peak: 0.04, filter: 'lowpass', freq: 700, attack: 0.01 });
  tone({ name: 'grill-bun', group: 'toys', pos: at, freq: 880, to: 1320, type: 'triangle', dur: 0.12, peak: 0.03 });
}

function kettleGeometry() {
  return {
    bowl: new THREE.SphereGeometry(GRILL.r, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    lid: new THREE.SphereGeometry(GRILL.r * 1.02, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    coals: new THREE.CircleGeometry(GRILL.r * 0.85, 24).rotateX(-Math.PI / 2),
    puff: new THREE.SphereGeometry(0.11, 10, 8),
  };
}

export function Grill() {
  const [grill, setGrill] = useState<GrillModel>(emptyGrill);
  const model = useRef(grill);
  model.current = grill;
  const geo = useMemo(kettleGeometry, []);
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);
  const mats = useMemo(
    () => ({
      sausage: new THREE.MeshToonMaterial({ color: RAW.clone() }),
      coals: new THREE.MeshBasicMaterial({ color: '#ff6b2c', toneMapped: false }),
      smoke: new THREE.MeshBasicMaterial({ color: '#e9ecef', transparent: true, opacity: 0.38, depthWrite: false }),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const sausage = useRef<THREE.Group>(null);
  const smoke = useRef<THREE.InstancedMesh>(null);
  const run = useMemo(() => ({ nextCrackle: 0, m: new THREE.Matrix4(), state: '' }), []);

  const now = () => performance.now() / 1000;
  const state = grillState(grill, now());
  const ref = useInteractable<THREE.Group>({ id: 'grill', label: grillLabel(state), action: { kind: 'roof', op: 'grill' } }, 3);

  // The label changes as it cooks: re-render when the state does.
  useFrame(() => {
    const t = now();
    const g = model.current;
    const s = grillState(g, t);
    if (s !== run.state) {
      run.state = s;
      useRoof.setState({ grill: s });
      setGrill({ ...g });
    }
    const done = doneness(g, t);
    if (done <= 1) mats.sausage.color.lerpColors(RAW, COOKED, done);
    else mats.sausage.color.lerpColors(COOKED, CHARRED, done - 1);
    const sz = sizzle(g, t);
    // the coals glow brighter while something's on, flickering
    mats.coals.color.setRGB(1, 0.32 + 0.12 * Math.sin(t * 7) * Math.sin(t * 3.1), 0.08).multiplyScalar(0.55 + 0.45 * Math.max(sz, 0.3));
    if (sausage.current) {
      sausage.current.visible = g.since !== null;
      sausage.current.rotation.x = g.turns * Math.PI + (sz > 0.5 ? Math.sin(t * 9) * 0.03 : 0);
    }
    if (sz > 0 && t >= run.nextCrackle) {
      crackle(sz);
      run.nextCrackle = t + (sz > 0.5 ? 0.06 + Math.random() * 0.1 : 0.25 + Math.random() * 0.5);
    }
    const m = smoke.current;
    if (m) {
      m.visible = sz > 0;
      if (m.visible) {
        for (let i = 0; i < PUFFS; i++) {
          const k = (t / SMOKE_RISE + i / PUFFS) % 1;
          const s2 = (0.4 + k * 1.6) * (i / PUFFS < sz ? 1 : 0); // fewer puffs once it's done
          const drift = k * k * 0.9;
          run.m.makeScale(s2, s2, s2).setPosition(GRILL.x + Math.sin(i * 2.3 + t * 0.7) * 0.12 * k, GRATE_Y + 0.15 + k * 1.6, GRILL.z + drift);
          m.setMatrixAt(i, run.m);
        }
        m.instanceMatrix.needsUpdate = true;
        mats.smoke.opacity = 0.32 * Math.min(1, sz + 0.2);
      }
    }
  });

  /** E at the grill. */
  const press = () => {
    const s = useStore.getState();
    const t = now();
    const { op, grill: next } = pressGrill(model.current, t, s.held !== null);
    if (op === 'full') {
      s.pushToast('info', s.held?.kind === 'sausage' ? '🌭 One at a time: eat that one first (E)' : '🙌 Your hands are full');
      return;
    }
    const was = model.current;
    model.current = next;
    setGrill(next);
    if (op === 'start' || op === 'turn') hiss();
    if (op === 'take') {
      bun();
      s.setHeld({ kind: 'sausage', id: `sausage-${sausageSeq++}`, bites: BITES, charred: grillState(was, t) === 'charred' });
    }
  };
  useRoofOp('grill', press);
  useRoofReport('grill', () => {
    const t = now();
    return { state: grillState(model.current, t), doneness: Math.round(doneness(model.current, t) * 100) / 100, turns: model.current.turns, sizzle: sizzle(model.current, t) };
  });

  return (
    <group>
      <group ref={ref}>
        {/* the kettle on three legs, its lid propped open behind */}
        <group position={[GRILL.x, GRATE_Y, GRILL.z]}>
          <mesh geometry={geo.bowl} material={toon('#2b2d42')} castShadow>
            <Outlines thickness={0.015} color={INK} />
          </mesh>
          <mesh geometry={geo.coals} position={[0, -0.08, 0]} material={mats.coals} />
          <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} material={toon('#adb5bd')}>
            <ringGeometry args={[GRILL.r * 0.88, GRILL.r * 0.95, 24]} />
          </mesh>
          {[-0.24, -0.12, 0, 0.12, 0.24].map((x) => (
            <mesh key={x} position={[x, 0.01, 0]} material={toon('#adb5bd')}>
              <boxGeometry args={[0.012, 0.012, Math.sqrt(GRILL.r * GRILL.r * 0.85 - x * x) * 2]} />
            </mesh>
          ))}
          <group position={[0, 0, GRILL.r]} rotation={[1.75, 0, 0]}>
            <mesh geometry={geo.lid} position={[0, 0, -GRILL.r]} material={toon('#2b2d42')} castShadow>
              <Outlines thickness={0.015} color={INK} />
            </mesh>
          </group>
          {[0, 1, 2].map((k) => {
            const a = (k / 3) * Math.PI * 2 + 0.5;
            return (
              <mesh key={k} position={[Math.cos(a) * 0.28, -GRATE_Y / 2 - 0.05, Math.sin(a) * 0.28]} rotation={[Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25]} material={toon('#495057')} castShadow>
                <cylinderGeometry args={[0.022, 0.022, GRATE_Y + 0.05, 6]} />
              </mesh>
            );
          })}
          {/* the sausage on the grate */}
          <group ref={sausage} position={[0.04, 0.05, 0]} rotation={[0, 0.3, 0]} visible={false}>
            <mesh rotation={[0, 0, Math.PI / 2]} material={mats.sausage} castShadow>
              <capsuleGeometry args={[0.035, 0.2, 4, 10]} />
            </mesh>
            {/* grill marks on the side that's been down */}
            {[-0.06, 0, 0.06].map((x) => (
              <mesh key={x} position={[x, -0.03, 0]} material={toon('#5a2d1a')}>
                <boxGeometry args={[0.012, 0.012, 0.072]} />
              </mesh>
            ))}
          </group>
        </group>
        {/* the side shelf: a basket of buns and the ketchup */}
        <group position={[GRILL.x + GRILL.shelf, 0, GRILL.z]}>
          <mesh position={[0, 0.78, 0]} material={toon('#c9905a')} castShadow>
            <boxGeometry args={[0.6, 0.05, 0.5]} />
            <Outlines thickness={0.012} color={INK} />
          </mesh>
          {[-0.25, 0.25].map((x) =>
            [-0.2, 0.2].map((z) => (
              <mesh key={`${x}${z}`} position={[x, 0.38, z]} material={toon('#8a5a32')}>
                <boxGeometry args={[0.04, 0.76, 0.04]} />
              </mesh>
            )),
          )}
          <mesh position={[-0.08, 0.86, 0]} material={toon('#d4a373')}>
            <boxGeometry args={[0.3, 0.1, 0.22]} />
          </mesh>
          {[-0.05, 0.05].map((z) => (
            <mesh key={z} position={[-0.08, 0.93, z]} rotation={[0, 0, Math.PI / 2]} material={toon('#f2c38b')}>
              <capsuleGeometry args={[0.04, 0.14, 4, 8]} />
            </mesh>
          ))}
          <mesh position={[0.17, 0.89, 0.1]} material={toon('#d62828')} castShadow>
            <cylinderGeometry args={[0.035, 0.04, 0.17, 10]} />
          </mesh>
          <mesh position={[0.17, 0.99, 0.1]} material={glow('#f8f9fa')}>
            <coneGeometry args={[0.02, 0.05, 8]} />
          </mesh>
        </group>
      </group>
      <instancedMesh ref={smoke} args={[geo.puff, mats.smoke, PUFFS]} frustumCulled={false} visible={false} renderOrder={3} />
    </group>
  );
}
