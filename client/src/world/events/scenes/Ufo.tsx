import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { loop, placeAt, play } from '../../../ui/eventSfx';
import { cityLayout, CITY, CORRIDOR_HALF, LANE } from '../../outside/cityLayout';
import { seeded } from '../director';
import { clamp01, glowOut, lerp, sign, smooth, span, toonOut, type SceneProps } from '../kit';

// A UFO zips in, hovers over a rooftop with its lights chasing round the rim, drifts over the street next door, shines
// its beam down on a parked car and lifts it, spinning, up into the saucer, wobbles happily and zips away. Built from a
// few spheres, a cone of light and a little car; humming throughout, with a beam's whine and a zip.

const T = { arrive: 4, hover: 12, glide: 16, beam: 17.5, lift: 19, gone: 28, leave: 30, away: 34 };
const LIGHTS = 10;

export default function Ufo({ run, elevation }: SceneProps) {
  const ufo = useRef<THREE.Group>(null);
  const lights = useRef<THREE.Group>(null);
  const beam = useRef<THREE.Group>(null);
  const car = useRef<THREE.Group>(null);
  const s = sign(run.side);
  const p = useMemo(() => {
    const r = seeded(run.seed);
    // the street beyond our block's neighbours, a lane of it, somewhere along the view
    const street = CITY.homeHalfX + CORRIDOR_HALF + CITY.pitch;
    const carAt = { x: s * (street + LANE * (r() < 0.5 ? 1 : -1)), z: (r() - 0.5) * 70 };
    // the nearest low rooftop beyond it
    const roofs = cityLayout().buildings.filter((b) => b.y === 0 && b.h < 34 && s * b.x > street + 4 && s * b.x < street + 70);
    roofs.sort((a, b) => Math.hypot(a.x - carAt.x, a.z - carAt.z) - Math.hypot(b.x - carAt.x, b.z - carAt.z));
    const roof = roofs[0] ?? { x: carAt.x + s * 25, z: carAt.z, h: 18 };
    return {
      roof: { x: roof.x, y: roof.h + 11, z: roof.z },
      over: { x: carAt.x, y: Math.max(roof.h + 8, 24), z: carAt.z },
      car: carAt,
      from: { x: s * 380, y: 160, z: -carAt.z * 2 - 150 },
      to: { x: s * 300, y: 260, z: carAt.z + 400 },
      carColor: ['#e85d75', '#4a90d9', '#f2c94c', '#6fcf97'][Math.floor(r() * 4)],
    };
  }, [run.seed, s]);
  const sound = useMemo(() => ({ hum: null as ReturnType<typeof loop> | null, beamed: false, zipped: false, came: false }), []);
  useEffect(() => {
    sound.hum = loop('hum');
    return () => sound.hum?.stop(0.5);
  }, [sound]);

  useFrame(() => {
    const t = run.t;
    const g = ufo.current;
    if (!g) return;
    let x: number;
    let y: number;
    let z: number;
    if (t < T.arrive) {
      const k = smooth(t / T.arrive);
      x = lerp(p.from.x, p.roof.x, k);
      y = lerp(p.from.y, p.roof.y, k);
      z = lerp(p.from.z, p.roof.z, k);
    } else if (t < T.hover) {
      x = p.roof.x;
      y = p.roof.y;
      z = p.roof.z;
    } else if (t < T.leave) {
      const k = span(t, T.hover, T.glide);
      x = lerp(p.roof.x, p.over.x, k);
      y = lerp(p.roof.y, p.over.y, k);
      z = lerp(p.roof.z, p.over.z, k);
    } else {
      // away: slow at first, then gone in a flash
      const k = clamp01((t - T.leave) / (T.away - T.leave)) ** 3;
      x = lerp(p.over.x, p.to.x, k);
      y = lerp(p.over.y, p.to.y, k);
      z = lerp(p.over.z, p.to.z, k);
    }
    const bob = Math.sin(t * 2.1) * 0.6;
    g.position.set(x, y + bob, z);
    g.visible = t < T.away;
    // a wobble when it arrives and a happy one once it has the car
    const wobble = (t < T.arrive + 1 ? 0.15 * (1 - t / (T.arrive + 1)) : 0) + (t > T.gone && t < T.leave ? 0.14 * Math.sin((t - T.gone) * 9) : 0);
    g.rotation.set(wobble * Math.sin(t * 7), t * 0.8, wobble * Math.cos(t * 6));
    const ring = lights.current?.children;
    if (ring) for (let i = 0; i < ring.length; i++) ring[i].visible = (Math.floor(t * 8) + i) % 3 !== 0;

    const on = t > T.beam && t < T.gone + 0.6;
    const b = beam.current;
    if (b) {
      b.visible = on;
      if (on) {
        const reach = y + bob - 2;
        b.position.set(x, (y + bob) / 2 - 1, z);
        b.scale.set(1 + Math.sin(t * 20) * 0.04, reach, 1 + Math.sin(t * 20) * 0.04);
      }
    }
    // the car: parked, then lifted spinning into the saucer
    const c = car.current;
    if (c) {
      const k = span(t, T.lift, T.gone);
      c.visible = t < T.gone;
      c.position.set(p.car.x, lerp(0, y + bob - 3, k * k), p.car.z);
      c.rotation.set(Math.sin(t * 2) * 0.3 * k, k * 9, Math.cos(t * 1.7) * 0.25 * k);
      const shrink = 1 - 0.5 * span(t, T.gone - 2, T.gone);
      c.scale.setScalar(shrink);
    }

    const heard = placeAt(x, y - elevation, z, 80);
    sound.hum?.set(heard.gain * (t < T.away ? 1 : 0), heard.pan, 1 + (t > T.leave ? (t - T.leave) * 0.6 : 0));
    if (!sound.came && t > 0.1) {
      sound.came = true;
      play('zip', { gain: 0.6, pan: heard.pan, pitch: 0.7 });
    }
    if (!sound.beamed && t > T.beam) {
      sound.beamed = true;
      play('beam', { gain: heard.gain, pan: heard.pan });
    }
    if (!sound.zipped && t > T.leave) {
      sound.zipped = true;
      play('zip', { gain: heard.gain, pan: heard.pan });
    }
  });

  const hull = toonOut('#b8c0cc');
  return (
    <group>
      <group ref={ufo}>
        <mesh material={hull} scale={[1, 0.26, 1]}>
          <sphereGeometry args={[7, 28, 14]} />
        </mesh>
        <mesh material={toonOut('#8ecae6', { emissive: '#3a86ff', emissiveIntensity: 0.4 })} position={[0, 1.2, 0]}>
          <sphereGeometry args={[2.6, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
        <mesh material={toonOut('#8d99ae')} position={[0, -1.3, 0]} scale={[1, 0.35, 1]}>
          <sphereGeometry args={[3, 18, 8]} />
        </mesh>
        <mesh material={glowOut('#b6ff9e')} position={[0, -2.25, 0]} rotation-x={Math.PI / 2}>
          <circleGeometry args={[1.6, 18]} />
        </mesh>
        <group ref={lights}>
          {Array.from({ length: LIGHTS }, (_, i) => {
            const a = (i / LIGHTS) * Math.PI * 2;
            return (
              <mesh key={i} material={glowOut(['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#ff70a6'][i % 5])} position={[Math.cos(a) * 6.3, -0.3, Math.sin(a) * 6.3]}>
                <sphereGeometry args={[0.38, 8, 6]} />
              </mesh>
            );
          })}
        </group>
      </group>
      {/* the beam: a unit-tall cone scaled to reach the street */}
      <group ref={beam} visible={false}>
        <mesh material={glowOut('#b6ff9e', { opacity: 0.22, add: true })}>
          <cylinderGeometry args={[1.4, 4.2, 1, 20, 1, true]} />
        </mesh>
        <mesh material={glowOut('#eaffd0', { opacity: 0.25, add: true })}>
          <cylinderGeometry args={[0.6, 2.2, 1, 16, 1, true]} />
        </mesh>
      </group>
      <group ref={car}>
        <mesh material={toonOut(p.carColor)} position={[0, 0.5, 0]}>
          <boxGeometry args={[1.9, 0.6, 4.2]} />
        </mesh>
        <mesh material={toonOut('#2b3a55')} position={[0, 1.05, -0.2]}>
          <boxGeometry args={[1.6, 0.5, 2.2]} />
        </mesh>
      </group>
    </group>
  );
}
