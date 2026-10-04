import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { glass, shade, toon } from './materials';
import { Ball, Box, Cyl } from './Toon';
import { MugDispenser } from './toys/mugLook';
import { CoffeeMachine } from './CoffeeMachine';
import { officeNow } from '../officeTime';

type P = [number, number, number];

export function Plant({ position, scale = 1, pot = '#e07a5f' }: { position: P; scale?: number; pot?: string }) {
  return (
    <group position={position} scale={scale}>
      <Cyl r={0.22} rTop={0.28} h={0.5} position={[0, 0.25, 0]} color={pot} outline />
      <Ball r={0.36} position={[0, 0.8, 0]} color="#52b788" outline />
      <Ball r={0.28} position={[0.2, 1.05, 0.08]} color="#40916c" outline />
      <Ball r={0.25} position={[-0.18, 1.12, -0.05]} color="#74c69d" outline />
      <Ball r={0.2} position={[0.02, 1.35, 0]} color="#52b788" outline />
    </group>
  );
}

export function WaterCooler({ position }: { position: P }) {
  return (
    <group position={position}>
      <Box size={[0.45, 1.0, 0.45]} position={[0, 0.5, 0]} color="#f1f3f5" outline />
      <Cyl r={0.18} h={0.5} position={[0, 1.25, 0]} color="#8ecae6" outline />
      <Box size={[0.08, 0.06, 0.06]} position={[0, 0.8, -0.24]} color="#457b9d" />
    </group>
  );
}

export function Couch({ position, rotationY = 0, color = '#6c63ff' }: { position: P; rotationY?: number; color?: string }) {
  const dark = shade(color, -0.12);
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[3, 0.42, 1]} position={[0, 0.25, 0]} color={color} outline />
      <Box size={[3, 0.6, 0.25]} position={[0, 0.7, 0.38]} color={dark} outline />
      <Box size={[0.25, 0.55, 1]} position={[-1.5, 0.45, 0]} color={dark} outline />
      <Box size={[0.25, 0.55, 1]} position={[1.5, 0.45, 0]} color={dark} outline />
      <Box size={[0.5, 0.4, 0.14]} position={[-0.9, 0.62, 0.22]} color="#ffd166" outline />
      <Box size={[0.5, 0.4, 0.14]} position={[0.9, 0.62, 0.22]} color="#ef476f" outline />
    </group>
  );
}

export function CoffeeTable({ position, rotationY = 0 }: { position: P; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[1.3, 0.08, 0.8]} position={[0, 0.42, 0]} color="#f1d19b" outline />
      <Box size={[1.1, 0.38, 0.6]} position={[0, 0.2, 0]} color="#c9a26b" />
      <Cyl r={0.05} h={0.1} position={[0.3, 0.51, 0.1]} color="#ffffff" outline />
      <Box size={[0.3, 0.04, 0.22]} position={[-0.25, 0.48, -0.05]} color="#4cc9f0" outline />
    </group>
  );
}

export function Kitchenette({ position }: { position: P }) {
  return (
    <group position={position}>
      {/* counter runs along z */}
      <Box size={[0.8, 0.9, 4]} position={[0, 0.45, 0]} color="#8ecae6" outline />
      <Box size={[0.9, 0.06, 4.1]} position={[-0.02, 0.93, 0]} color="#f8f9fa" outline />
      <CoffeeMachine position={[0, 0.96, -1.1]} />
      {/* mug dispenser, next to the coffee machine */}
      <MugDispenser position={[0, 0.96, -0.45]} />
      {/* fruit bowl + kettle */}
      <Cyl r={0.2} rTop={0.24} h={0.1} position={[0, 1.01, 0.6]} color="#f4a261" outline />
      <Ball r={0.07} position={[0.05, 1.1, 0.55]} color="#e63946" />
      <Ball r={0.07} position={[-0.06, 1.1, 0.66]} color="#ffd166" />
      <Ball r={0.07} position={[0.07, 1.1, 0.7]} color="#80ed99" />
      <Cyl r={0.1} rTop={0.07} h={0.25} position={[0, 1.08, 1.4]} color="#ced4da" outline />
      {/* fridge */}
      <Box size={[0.8, 2, 0.8]} position={[0, 1, 2.45]} color="#f1f3f5" outline />
      <Box size={[0.04, 0.5, 0.05]} position={[-0.42, 1.3, 2.2]} color="#adb5bd" />
    </group>
  );
}

/** The lobby's coffee corner: a short counter with the kitchenette's coffee machine and mug dispenser. Like the
 * kitchenette, its front faces local -x; position is the middle of the counter's footprint on the floor. */
export function CoffeeCorner({ position, rotationY = 0 }: { position: P; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[0.8, 0.9, 1.4]} position={[0, 0.45, 0]} color="#8ecae6" outline />
      <Box size={[0.9, 0.06, 1.5]} position={[-0.02, 0.93, 0]} color="#f8f9fa" outline />
      <CoffeeMachine position={[0, 0.96, -0.3]} />
      <MugDispenser position={[0, 0.96, 0.4]} />
      {/* sugar jar */}
      <Cyl r={0.06} h={0.12} position={[0.1, 1.02, 0.6]} color="#f1f3f5" outline />
      <Cyl r={0.065} h={0.03} position={[0.1, 1.095, 0.6]} color="#e07a5f" />
    </group>
  );
}

export function Rug({ position, size, color }: { position: P; size: [number, number]; color: string }) {
  return (
    <mesh position={position} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={toon(color)}>
      <planeGeometry args={size} />
    </mesh>
  );
}

export function WallClock({ position, rotationY = 0 }: { position: P; rotationY?: number }) {
  const hour = useRef<THREE.Group>(null);
  const minute = useRef<THREE.Group>(null);
  useFrame(() => {
    const d = new Date(officeNow()); // the replayed time during the time-lapse
    const m = d.getMinutes() + d.getSeconds() / 60;
    const h = (d.getHours() % 12) + m / 60;
    if (minute.current) minute.current.rotation.z = -(m / 60) * Math.PI * 2;
    if (hour.current) hour.current.rotation.z = -(h / 12) * Math.PI * 2;
  });
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Cyl r={0.36} h={0.06} rotation={[Math.PI / 2, 0, 0]} color="#ffffff" outline shadow={false} />
      <group ref={hour} position={[0, 0, 0.04]}>
        <mesh position={[0, 0.1, 0]} material={toon('#1f1d2b')}>
          <boxGeometry args={[0.035, 0.2, 0.01]} />
        </mesh>
      </group>
      <group ref={minute} position={[0, 0, 0.045]}>
        <mesh position={[0, 0.14, 0]} material={toon('#e63946')}>
          <boxGeometry args={[0.025, 0.28, 0.01]} />
        </mesh>
      </group>
    </group>
  );
}

export function Bookshelf({ position, rotationY = 0 }: { position: P; rotationY?: number }) {
  const colors = ['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#9b5de5', '#ffbe0b', '#06d6a0'];
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <Box size={[4.8, 2.2, 0.6]} position={[0, 1.1, 0]} color="#b08968" outline />
      {[0.35, 0.95, 1.55].map((y, row) => (
        <group key={y}>
          <Box size={[4.6, 0.04, 0.55]} position={[0, y - 0.25, 0.04]} color="#9c6644" shadow={false} />
          {Array.from({ length: 14 }, (_, i) => (
            <Box
              key={i}
              size={[0.14 + ((i * row) % 3) * 0.03, 0.34 + ((i + row) % 4) * 0.04, 0.4]}
              position={[-2.1 + i * 0.3, y - 0.05, 0.08]}
              color={colors[(i + row * 3) % colors.length]}
              shadow={false}
            />
          ))}
        </group>
      ))}
    </group>
  );
}

export function GlassWall({ from, to, height = 2.8 }: { from: [number, number]; to: [number, number]; height?: number }) {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const len = Math.hypot(dx, dz);
  const cx = (from[0] + to[0]) / 2;
  const cz = (from[1] + to[1]) / 2;
  const rot = -Math.atan2(dz, dx);
  return (
    <group position={[cx, 0, cz]} rotation={[0, rot, 0]}>
      <mesh position={[0, height / 2, 0]} material={glass}>
        <boxGeometry args={[len, height, 0.04]} />
      </mesh>
      <Box size={[len, 0.08, 0.1]} position={[0, height, 0]} color="#8d99ae" shadow={false} />
      <Box size={[len, 0.08, 0.1]} position={[0, 0.04, 0]} color="#8d99ae" shadow={false} />
      <Box size={[0.08, height, 0.1]} position={[-len / 2, height / 2, 0]} color="#8d99ae" shadow={false} />
      <Box size={[0.08, height, 0.1]} position={[len / 2, height / 2, 0]} color="#8d99ae" shadow={false} />
    </group>
  );
}
