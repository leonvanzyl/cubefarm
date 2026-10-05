import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../../../store';
import { loop, placeAt } from '../../../ui/eventSfx';
import { HELIPAD, ROOF, roofElevation } from '../../layout';
import { seeded } from '../director';
import { eyeAbove, inOut, lerp, sign, smooth, span, toonOut, type SceneProps } from '../kit';

// A news helicopter flying in, circling the block a few times just above the rooftops (banked into the turn, its
// rotor a blur), and flying off again, with the chop of its rotor coming and going as it rounds the building. About
// half the time (and always when you're up on the roof to see it) it lands on the roof's helipad for a few seconds
// on the way, its rotor slowing, then lifts off again.

const IN = 8; // seconds flying in, and out at the end
const LAP = 19; // seconds per circle
/** A landing: circling until `approach`, over the pad by `over`, down by `down`, up again from `lift` to `up`. */
const LAND = { approach: 20, over: 27, down: 31, lift: 42, up: 46 };
/** The skids' depth below the body's middle (scaled), so it sits on the pad. */
const SKIDS = 1.62 * 1.6;

export default function Helicopter({ run, elevation }: SceneProps) {
  const body = useRef<THREE.Group>(null);
  const rotor = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Mesh>(null);
  const s = sign(run.side);
  const p = useMemo(() => {
    const r = seeded(run.seed);
    const st = useStore.getState();
    const top = st.repos.reduce((m, x) => Math.max(m, x.floor), 0);
    const land = st.floor === ROOF || r() < 0.5;
    const pad = { x: HELIPAD.x, y: roofElevation(top) + SKIDS, z: HELIPAD.z };
    return { cx: s * (85 + r() * 20), cz: (r() - 0.5) * 40, radius: 42 + r() * 10, y: eyeAbove(elevation) + 9 + r() * 8, dir: r() < 0.5 ? 1 : -1, phase: r() * Math.PI * 2, far: { x: s * 420, z: (r() - 0.5) * 500 }, land, pad, from: new THREE.Vector3(), fromSet: false, heading: 0 };
  }, [run.seed, s, elevation]);
  const sound = useMemo(() => ({ rotor: null as ReturnType<typeof loop> | null, prev: new THREE.Vector3(), first: true, spin: 0 }), []);
  useEffect(() => {
    sound.rotor = loop('rotor');
    return () => sound.rotor?.stop(1);
  }, [sound]);

  useFrame((_, delta) => {
    const t = run.t;
    const g = body.current;
    if (!g) return;
    const a = p.phase + (p.dir * (t * Math.PI * 2)) / LAP;
    let x = p.cx + Math.cos(a) * p.radius;
    let z = p.cz + Math.sin(a) * p.radius;
    let y = p.y;
    // in from far away, out to far away at the end
    const arrive = smooth(t / IN);
    const leave = smooth((t - (run.seconds - IN)) / IN);
    x = lerp(p.far.x, x, arrive);
    z = lerp(-p.far.z, z, arrive);
    y += (1 - arrive) * 40;
    // the landing: across to hover over the pad, down onto it, a rest, and up again before flying off
    let landed = 0;
    if (p.land && t >= LAND.approach && t < run.seconds - IN) {
      if (!p.fromSet) p.from.set(x, y, z);
      p.fromSet = true;
      const hover = p.pad.y + 14;
      const k = span(t, LAND.approach, LAND.over);
      x = lerp(p.from.x, p.pad.x, k);
      z = lerp(p.from.z, p.pad.z, k);
      y = lerp(p.from.y, hover, k);
      y = lerp(y, p.pad.y, span(t, LAND.over, LAND.down) - span(t, LAND.lift, LAND.up));
      landed = span(t, LAND.down - 0.5, LAND.down) * (1 - span(t, LAND.lift, LAND.lift + 1));
    }
    if (p.land && t >= run.seconds - IN) {
      x = p.pad.x;
      z = p.pad.z;
      y = p.pad.y + 14;
    }
    x = lerp(x, p.far.x, leave);
    z = lerp(z, p.far.z, leave);
    y += leave * 40;
    if (sound.first) sound.prev.set(x, y, z);
    sound.first = false;
    // nose along the way it's going, banked into the turn (level while it hovers and sits)
    const dx = x - sound.prev.x;
    const dz = z - sound.prev.z;
    if (dx * dx + dz * dz > 1e-5) p.heading = Math.atan2(dx, dz);
    g.rotation.y = p.heading;
    const circling = p.land ? 1 - span(t, LAND.approach, LAND.approach + 3) + span(t, run.seconds - IN, run.seconds - IN + 2) : 1;
    g.rotation.z = -p.dir * 0.22 * arrive * (1 - leave) * Math.min(1, circling);
    g.rotation.x = 0.12 * (1 - landed);
    g.position.set(x, y, z);
    sound.prev.set(x, y, z);
    // the rotor winds down while it sits on the pad
    sound.spin += Math.min(delta, 0.1) * (31 - 22 * landed);
    if (rotor.current) rotor.current.rotation.y = sound.spin;
    if (tail.current) tail.current.rotation.x = sound.spin * 1.3;
    const heard = placeAt(x, y - elevation, z, 60);
    sound.rotor?.set(heard.gain * inOut(t, run.seconds, 2) * (1 - 0.6 * landed), heard.pan, 1 - 0.35 * landed);
  });

  const red = toonOut('#d62828');
  const dark = toonOut('#2b2d42');
  return (
    <group ref={body} scale={1.6}>
      <mesh material={red} scale={[1, 0.95, 1.5]}>
        <sphereGeometry args={[1.6, 14, 10]} />
      </mesh>
      <mesh material={toonOut('#8ecae6')} position={[0, 0.35, 1.25]} scale={[1, 0.7, 0.8]}>
        <sphereGeometry args={[1.05, 12, 8]} />
      </mesh>
      <mesh material={red} position={[0, 0.3, -3.2]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.28, 0.45, 4.2, 8]} />
      </mesh>
      <mesh material={toonOut('#f1faee')} position={[0, 1, -5.1]}>
        <boxGeometry args={[0.15, 1.4, 0.9]} />
      </mesh>
      <mesh ref={tail} material={dark} position={[0.2, 0.9, -5.2]}>
        <boxGeometry args={[0.05, 1.6, 0.18]} />
      </mesh>
      {[-0.9, 0.9].map((x) => (
        <mesh key={x} material={dark} position={[x, -1.55, 0]}>
          <boxGeometry args={[0.12, 0.12, 3.4]} />
        </mesh>
      ))}
      <mesh material={dark} position={[0, 1.55, 0]}>
        <cylinderGeometry args={[0.18, 0.18, 0.5, 8]} />
      </mesh>
      <group ref={rotor} position={[0, 1.85, 0]}>
        <mesh material={dark}>
          <boxGeometry args={[11, 0.06, 0.35]} />
        </mesh>
        <mesh material={dark} rotation-y={Math.PI / 2}>
          <boxGeometry args={[11, 0.06, 0.35]} />
        </mesh>
      </group>
    </group>
  );
}
