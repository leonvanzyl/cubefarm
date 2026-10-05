import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getA11y, reduceMotion } from '../../../ui/a11y';
import { placeAt, play } from '../../../ui/eventSfx';
import { outsideAt } from '../../layout';
import { cityLayout } from '../../outside/cityLayout';
import { cityWaterTowers, setTowerDown } from '../../outside/City';
import { BOARD_RANGE } from '../../roof/billboardLayout';
import { seeded } from '../director';
import { clamp01, sign, span, toonOut, type SceneProps } from '../kit';

// The rare one: a friendly cartoon kaiju, big-eyed and pink-cheeked, wading through the city out towards the horizon.
// It stomps along (a thump with every step, and the gentlest camera shake when you're out on a balcony, none at all for
// reduced motion), roars a goofy roar now and then, and bumps a rooftop water tower over on its way, with a crash and
// an "oops"; the tower is rebuilt a while after it's gone. Never anywhere near the office.

const HEIGHT = 70;
const STEP = 1.15; // seconds per step
const SPEED = 4.6; // m/s
const ROARS = [9, 33, 62];
const ROAR = 2.6;
/** The knocked-over tower is back up this long after the kaiju has gone. */
const REBUILD_MS = 90_000;

export default function Kaiju({ run, elevation }: SceneProps) {
  const kaiju = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const mouth = useRef<THREE.Mesh>(null);
  const legs = useRef<(THREE.Group | null)[]>([]);
  const arms = useRef<(THREE.Group | null)[]>([]);
  const tail = useRef<THREE.Group>(null);
  const fallen = useRef<THREE.Group>(null);
  const s = sign(run.side);
  const p = useMemo(() => {
    const r = seeded(run.seed);
    const dir = r() < 0.5 ? 1 : -1;
    // a city water tower in its way, out on our side: beyond the roof's billboards (within BOARD_RANGE of the office,
    // and never on a roof with a tower anyway) and nowhere near our own roof and its water tank
    const towers = cityWaterTowers()
      .map((t, i) => ({ ...t, i }))
      .filter((t) => s * t.x > BOARD_RANGE.max + 10 && s * t.x < 260 && Math.abs(t.z) < 160);
    // the one most in front of the windows, at a good distance
    const away = (t: { x: number; z: number }) => Math.abs(s * t.x - 175) + Math.abs(t.z) * 0.8;
    towers.sort((a, b) => away(a) - away(b));
    const tower = towers[0] ?? null;
    const layout = tower ? cityLayout() : null;
    const tank = tower && layout ? layout.cylinders[tower.cylinder] : null;
    const x = tower ? tower.x + s * 19 : s * 190;
    const zMid = tower ? tower.z : (r() - 0.5) * 60;
    // it reaches the tower about half way through
    const z0 = zMid - dir * SPEED * 40;
    return { dir, x, z0, tower, tankR: tank ? tank.w / 2 : 1.5 };
  }, [run.seed, s]);
  const live = useMemo(() => ({ shake: 0, lastStep: -1, roared: -1, knocked: -1, crashed: false }), []);

  // the tower it knocks over comes back a while after it has gone
  useEffect(() => {
    const t = p.tower;
    return () => {
      if (t && live.knocked >= 0) setTimeout(() => setTowerDown(t.i, false), REBUILD_MS);
      else if (t) setTowerDown(t.i, false);
    };
  }, [p, live]);

  useFrame(({ camera }, delta) => {
    const t = run.t;
    const g = kaiju.current;
    if (!g) return;
    const z = p.z0 + p.dir * SPEED * t;
    const phase = (t / STEP) * Math.PI;
    let roarK = 0;
    let roarNow = -1;
    for (let i = 0; i < ROARS.length; i++) {
      roarK = Math.max(roarK, span(t, ROARS[i], ROARS[i] + 0.4) * (1 - span(t, ROARS[i] + ROAR - 0.5, ROARS[i] + ROAR)));
      if (t >= ROARS[i] && t < ROARS[i] + 0.5) roarNow = i;
    }
    // waddle: a bob with every step and a sway side to side; it stands still to roar
    const walking = 1 - roarK * 0.8;
    g.position.set(p.x, Math.abs(Math.sin(phase)) * 0.7 * walking, z);
    // turned a little towards the building, so you see its face
    g.rotation.set(0, (p.dir > 0 ? 0 : Math.PI) - s * p.dir * 0.35, Math.sin(phase) * 0.04 * walking);
    for (let i = 0; i < 2; i++) {
      const leg = legs.current[i];
      if (leg) leg.rotation.x = Math.sin(phase + i * Math.PI) * 0.45 * walking;
      const arm = arms.current[i];
      if (arm) arm.rotation.x = -0.6 - roarK * 1.2 + Math.sin(phase * 2 + i) * 0.15;
    }
    if (tail.current) tail.current.rotation.y = Math.sin(phase * 0.5) * 0.35;
    const h = head.current;
    if (h) {
      // looks about, throws its head back to roar, and turns to the tower it just bumped
      const oops = p.tower && live.knocked >= 0 ? span(t, live.knocked + 0.6, live.knocked + 1.4) * (1 - span(t, live.knocked + 4, live.knocked + 5)) : 0;
      h.rotation.set(-roarK * 0.55 + oops * 0.15, -s * p.dir * 0.3 + Math.sin(t * 0.4) * 0.25 + oops * -s * p.dir * 0.6, oops * 0.25);
    }
    if (mouth.current) mouth.current.scale.y = 0.25 + roarK * 1.6;

    // every footfall: a stomp, and the faintest shake out on a balcony
    const step = Math.floor(t / STEP);
    if (step !== live.lastStep && walking > 0.5) {
      live.lastStep = step;
      const heard = placeAt(p.x, -elevation, z, 200);
      play('stomp', { gain: heard.gain, pan: heard.pan, pitch: 0.9 + Math.random() * 0.2 });
      live.shake = 1;
    }
    if (roarNow >= 0 && live.roared !== roarNow) {
      live.roared = roarNow;
      const heard = placeAt(p.x, HEIGHT * 0.9 - elevation, z, 200);
      play('roar', { gain: heard.gain, pan: heard.pan });
    }
    live.shake *= Math.exp(-6 * Math.min(0.1, delta));
    if (live.shake > 0.01 && getA11y().cameraShake && !reduceMotion() && outsideAt(camera.position.x)) {
      camera.rotation.x += live.shake * 0.0035 * Math.sin(t * 41);
      camera.rotation.z += live.shake * 0.0025 * Math.sin(t * 33);
    }

    // the water tower: a bump as it passes, a topple and a crash
    const tw = p.tower;
    const f = fallen.current;
    if (tw && f) {
      if (live.knocked < 0 && p.dir * (z - tw.z) > -7) {
        live.knocked = t;
        setTowerDown(tw.i, true);
      }
      f.visible = live.knocked >= 0;
      if (live.knocked >= 0) {
        const k = clamp01((t - live.knocked) / 1.3);
        // tipping over the roof's edge towards us, faster as it goes, with a little bounce at the end
        f.rotation.z = (s * Math.PI * 0.5 * k * k) - (k >= 1 ? s * 0.06 * Math.sin((t - live.knocked - 1.3) * 12) * Math.exp(-(t - live.knocked - 1.3) * 4) : 0);
        if (k >= 1 && !live.crashed) {
          live.crashed = true;
          const heard = placeAt(tw.x, tw.y - elevation, tw.z, 180);
          play('crash', { gain: heard.gain, pan: heard.pan });
        }
      }
    }
  });

  const green = toonOut('#6abf69');
  const cream = toonOut('#f6e7a1');
  const spike = toonOut('#ff9f1c');
  const ink = toonOut('#1f1d2b');
  const white = toonOut('#ffffff');
  return (
    <group>
      <group ref={kaiju}>
        <group scale={HEIGHT}>
          <mesh material={green} position={[0, 0.5, 0]} scale={[1, 1.25, 1.1]}>
            <sphereGeometry args={[0.28, 20, 14]} />
          </mesh>
          <mesh material={cream} position={[0, 0.47, 0.13]} scale={[0.85, 1.15, 0.7]}>
            <sphereGeometry args={[0.22, 16, 12]} />
          </mesh>
          {[0, 1].map((i) => (
            <group key={i} ref={(g) => void (legs.current[i] = g)} position={[i ? 0.13 : -0.13, 0.3, 0]}>
              <mesh material={green} position={[0, -0.14, 0]}>
                <cylinderGeometry args={[0.085, 0.1, 0.3, 10]} />
              </mesh>
              <mesh material={green} position={[0, -0.29, 0.04]} scale={[1, 0.5, 1.4]}>
                <sphereGeometry args={[0.1, 10, 8]} />
              </mesh>
            </group>
          ))}
          {[0, 1].map((i) => (
            <group key={i} ref={(g) => void (arms.current[i] = g)} position={[i ? 0.22 : -0.22, 0.64, 0.1]}>
              <mesh material={green} position={[0, -0.05, 0.06]} rotation-x={0.6}>
                <capsuleGeometry args={[0.035, 0.1, 4, 8]} />
              </mesh>
            </group>
          ))}
          <group ref={tail} position={[0, 0.36, -0.24]}>
            {[0, 1, 2, 3].map((i) => (
              <mesh key={i} material={green} position={[0, -i * 0.05, -0.1 - i * 0.12]} scale={1 - i * 0.2}>
                <sphereGeometry args={[0.12, 12, 8]} />
              </mesh>
            ))}
          </group>
          {[0, 1, 2, 3, 4].map((i) => (
            <mesh key={i} material={spike} position={[0, 0.84 - i * 0.12, -0.1 - i * 0.06]} rotation-x={-0.5 - i * 0.12} scale={1 - i * 0.12}>
              <coneGeometry args={[0.05, 0.12, 6]} />
            </mesh>
          ))}
          <group ref={head} position={[0, 0.86, 0.1]}>
            <mesh material={green}>
              <sphereGeometry args={[0.17, 18, 14]} />
            </mesh>
            <mesh material={green} position={[0, -0.04, 0.15]} scale={[1, 0.72, 1.15]}>
              <sphereGeometry args={[0.11, 14, 10]} />
            </mesh>
            {[-1, 1].map((x) => (
              <group key={x}>
                <mesh material={white} position={[x * 0.075, 0.06, 0.12]}>
                  <sphereGeometry args={[0.055, 12, 10]} />
                </mesh>
                <mesh material={ink} position={[x * 0.075, 0.065, 0.168]}>
                  <sphereGeometry args={[0.027, 10, 8]} />
                </mesh>
                <mesh material={toonOut('#ff8fab')} position={[x * 0.11, -0.03, 0.12]} scale={[1, 0.6, 0.4]}>
                  <sphereGeometry args={[0.03, 8, 6]} />
                </mesh>
              </group>
            ))}
            <mesh ref={mouth} material={toonOut('#7a1f3d')} position={[0, -0.08, 0.255]} scale={[1, 0.25, 0.5]}>
              <sphereGeometry args={[0.06, 12, 8]} />
            </mesh>
          </group>
        </group>
      </group>
      {p.tower && (
        // the toppling copy of the city's tower, pivoting on the roof under it
        <group ref={fallen} position={[p.tower.x - s * p.tankR, p.tower.y, p.tower.z]} visible={false}>
          <group position={[s * p.tankR, 0, 0]}>
            <mesh material={toonOut('#5e4a3c')} position={[0, 0.8, 0]}>
              <boxGeometry args={[2.6, 1.6, 2.6]} />
            </mesh>
            <mesh material={toonOut('#a0704a')} position={[0, 3.1, 0]}>
              <cylinderGeometry args={[1.5, 1.5, 3, 12]} />
            </mesh>
            <mesh material={toonOut('#6b4a33')} position={[0, 5.3, 0]}>
              <coneGeometry args={[1.8, 1.4, 12]} />
            </mesh>
          </group>
        </group>
      )}
    </group>
  );
}
