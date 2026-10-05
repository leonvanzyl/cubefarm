import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../../store';
import { Outlines } from '../Outlines';
import { toon } from '../materials';
import { sipPose } from '../toys/sipping';
import { FIRST_PERSON } from '../viewTags';
import { BITES } from './grillRules';

// The sausage in your hands, held like a mug (toys/MugToys.tsx): in its bun at the lower right of the view, raised to
// your mouth for each bite (sipping.ts times them), a little shorter after every one.

// Where it sits in view (camera space, metres), pointing up and away, and where it goes for a bite.
const VIEW = { x: 0.17, y: -0.15, z: -0.42, tilt: -0.5, turn: 0.7 };
const MOUTH = { x: 0.03, y: -0.07, z: -0.24, tilt: -0.15, turn: 1.35 };
const INK = '#1f1d2b';

export function HeldSausage() {
  const held = useStore((s) => (s.held?.kind === 'sausage' ? s.held : null));
  const root = useRef<THREE.Group>(null);
  const hand = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    const r = root.current;
    const h = hand.current;
    if (!r || !h) return;
    r.position.copy(camera.position);
    r.quaternion.copy(camera.quaternion);
    const k = sipPose.lift;
    const t = performance.now() / 1000;
    h.position.set(VIEW.x + (MOUTH.x - VIEW.x) * k, VIEW.y + (MOUTH.y - VIEW.y) * k + Math.sin(t * 1.6) * 0.003 * (1 - k), VIEW.z + (MOUTH.z - VIEW.z) * k);
    h.rotation.set(VIEW.tilt + (MOUTH.tilt - VIEW.tilt) * k, VIEW.turn + (MOUTH.turn - VIEW.turn) * k, 0, 'YXZ');
  });
  if (!held) return null;
  // Bitten from the end nearest you: what's left shrinks towards the far end.
  const left = Math.max(0.15, held.bites / BITES);
  const len = 0.17 * left;
  return (
    <group ref={root} userData={FIRST_PERSON}>
      <group ref={hand} scale={0.8}>
        <group position={[0, 0, -0.085 + len / 2]}>
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * 0.026, -0.012, 0]} rotation={[Math.PI / 2, 0, 0]} material={toon('#e9b872')}>
              <capsuleGeometry args={[0.026, len, 4, 10]} />
              <Outlines thickness={0.004} color={INK} />
            </mesh>
          ))}
          <mesh position={[0, 0.006, 0]} rotation={[Math.PI / 2, 0, 0]} material={toon(held.charred ? '#3b2922' : '#b5532c')}>
            <capsuleGeometry args={[0.02, len + 0.03, 4, 10]} />
            <Outlines thickness={0.004} color={INK} />
          </mesh>
          {/* a zigzag of ketchup and one of mustard */}
          {Array.from({ length: Math.max(1, Math.round(5 * left)) }, (_, i) => (
            <mesh key={i} position={[(i % 2 ? 1 : -1) * 0.008, 0.027, -len / 2 + 0.02 + i * 0.032]} rotation={[0, (i % 2 ? 1 : -1) * 0.9, 0]} material={toon(i % 3 === 2 ? '#ffc93c' : '#d62828')}>
              <boxGeometry args={[0.006, 0.004, 0.03]} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}
