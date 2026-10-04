import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { playerAt, wallCut } from './camera/rig';
import { ELEVATOR, HALF_D, WALL_H } from './layout';
import { drawSign } from './draw';
import { useCanvasTexture, useInteractable } from './interact';
import { glow, toon } from './materials';
import { bodies } from './people';
import { dogNow } from './toys/dogState';
import { Box } from './Toon';

const METAL = '#b9c2cf';

export function Elevator({ floorLabel, accent }: { floorLabel: string; accent: string }) {
  const left = useRef<THREE.Mesh>(null);
  const right = useRef<THREE.Mesh>(null);
  const open = useRef(0);
  const root = useRef<THREE.Group>(null);
  const { doorHalf, cabinHalf, depth, doorHeight } = ELEVATOR;
  const zDoor = HALF_D + 0.15;

  const frameRef = useInteractable<THREE.Group>({ id: 'elevator', label: 'Use the elevator', action: { kind: 'elevator' } }, 3.5);
  const panelRef = useInteractable<THREE.Group>({ id: 'elevator-panel', label: 'Choose a floor', action: { kind: 'elevator' } }, 2.5);

  const indicator = useCanvasTexture(512, 128, (ctx) => drawSign(ctx, 512, 128, [{ text: floorLabel, size: 56, color: '#7CFFB2' }], '#15151f'), [floorLabel]);

  useFrame((_, dt) => {
    const travel = useStore.getState().travel;
    const dx = playerAt.x;
    const dz = playerAt.z - zDoor;
    let near = Math.hypot(dx, dz) < 2.8;
    // People on foot (a new hire stepping out, someone leaving) open the doors too.
    for (const b of bodies()) if (b.stage !== 'seated' && Math.abs(b.x) < doorHalf + 0.6 && Math.abs(b.z - zDoor) < 2) near = true;
    if (dogNow.drawn && Math.abs(dogNow.x) < doorHalf + 0.6 && Math.abs(dogNow.z - zDoor) < 2) near = true; // and the dog
    const want = travel?.phase === 'closing' ? 0 : near || travel?.phase === 'opening' ? 1 : 0;
    open.current += (want - open.current) * (1 - Math.exp(-dt * 5));
    const slide = open.current * doorHalf * 0.98;
    if (left.current) left.current.position.x = -doorHalf / 2 - slide;
    if (right.current) right.current.position.x = doorHalf / 2 + slide;
    // the overview's cutaway takes the south wall: the frame that stands proud of it goes with it
    if (root.current) root.current.visible = wallCut().z !== 1;
  });

  return (
    <group ref={root}>
      <group ref={frameRef}>
        {/* frame */}
        <Box size={[0.22, doorHeight + 0.1, 0.36]} position={[-doorHalf - 0.05, (doorHeight + 0.1) / 2, HALF_D]} color={METAL} outline />
        <Box size={[0.22, doorHeight + 0.1, 0.36]} position={[doorHalf + 0.05, (doorHeight + 0.1) / 2, HALF_D]} color={METAL} outline />
        <Box size={[doorHalf * 2 + 0.32, 0.22, 0.36]} position={[0, doorHeight + 0.08, HALF_D]} color={METAL} outline />
        {/* doors */}
        <mesh ref={left} position={[-doorHalf / 2, doorHeight / 2, zDoor]} material={toon('#d9dee6')} castShadow>
          <boxGeometry args={[doorHalf, doorHeight, 0.06]} />
        </mesh>
        <mesh ref={right} position={[doorHalf / 2, doorHeight / 2, zDoor]} material={toon('#d9dee6')} castShadow>
          <boxGeometry args={[doorHalf, doorHeight, 0.06]} />
        </mesh>
      </group>

      {/* floor indicator */}
      <mesh position={[0, doorHeight + 0.55, HALF_D - 0.03]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[1.6, 0.4]} />
        <meshBasicMaterial map={indicator} toneMapped={false} />
      </mesh>

      {/* call button */}
      <group position={[doorHalf + 0.55, 1.2, HALF_D - 0.03]} rotation={[0, Math.PI, 0]}>
        <Box size={[0.22, 0.4, 0.04]} position={[0, 0, 0]} color={METAL} outline />
        <mesh position={[0, 0.08, 0.025]} material={glow(accent)}>
          <circleGeometry args={[0.05, 20]} />
        </mesh>
        <mesh position={[0, -0.08, 0.025]} material={glow('#ffffff')}>
          <circleGeometry args={[0.05, 20]} />
        </mesh>
      </group>

      {/* cabin */}
      <group position={[0, 0, HALF_D]}>
        <mesh position={[0, 0.01, depth / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={toon('#8d7b68')}>
          <planeGeometry args={[cabinHalf * 2, depth]} />
        </mesh>
        <mesh position={[0, doorHeight + 0.2, depth / 2]} rotation={[Math.PI / 2, 0, 0]} material={toon('#f1f3f5')}>
          <planeGeometry args={[cabinHalf * 2, depth]} />
        </mesh>
        <mesh position={[0, doorHeight + 0.18, depth / 2]} rotation={[Math.PI / 2, 0, 0]} material={glow('#fff6d6')}>
          <circleGeometry args={[0.45, 32]} />
        </mesh>
        {/* sides: their front starts inside the wall, not on its face, which would flicker beside the doorway */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * (cabinHalf + 0.05), WALL_H / 2, (depth + 0.05) / 2]} material={toon('#c8ced8')}>
            <boxGeometry args={[0.1, WALL_H, depth - 0.05]} />
          </mesh>
        ))}
        <mesh position={[0, WALL_H / 2, depth + 0.05]} material={toon('#c8ced8')}>
          <boxGeometry args={[cabinHalf * 2 + 0.2, WALL_H, 0.1]} />
        </mesh>
        <Box size={[cabinHalf * 2 - 0.2, 0.05, 0.08]} position={[0, 0.95, depth - 0.05]} color="#e9c46a" outline />
        {/* inner panel */}
        <group ref={panelRef} position={[cabinHalf - 0.02, 1.25, 0.9]} rotation={[0, -Math.PI / 2, 0]}>
          <Box size={[0.36, 0.7, 0.04]} position={[0, 0, 0]} color={METAL} outline />
          {[0.22, 0.08, -0.06, -0.2].map((y, i) => (
            <mesh key={y} position={[0, y, 0.025]} material={glow(i === 0 ? accent : '#fdfdfd')}>
              <circleGeometry args={[0.04, 16]} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}
