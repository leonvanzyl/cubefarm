import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { snackOf } from './fridge';
import { SnackLook } from './snackLook';
import { sipPose } from './toys/sipping';
import { FIRST_PERSON } from './viewTags';

// A snack from the fridge in your hands, held like the sausage (roof/HeldSausage.tsx): at the lower right of the view,
// raised to your mouth for each sip or bite (sipping.ts times them). A can or bottle tips up to drink; food gets shorter.

const VIEW = { x: 0.17, y: -0.16, z: -0.42 };
const MOUTH = { x: 0.03, y: -0.06, z: -0.24 };

export function HeldSnack() {
  const held = useStore((s) => (s.held?.kind === 'snack' ? s.held : null));
  const root = useRef<THREE.Group>(null);
  const hand = useRef<THREE.Group>(null);
  const drink = held ? snackOf(held.snack)?.kind === 'drink' : false;
  useFrame(({ camera }) => {
    const r = root.current;
    const h = hand.current;
    if (!r || !h) return;
    r.position.copy(camera.position);
    r.quaternion.copy(camera.quaternion);
    const k = sipPose.lift;
    const t = performance.now() / 1000;
    h.position.set(VIEW.x + (MOUTH.x - VIEW.x) * k, VIEW.y + (MOUTH.y - VIEW.y) * k + Math.sin(t * 1.6) * 0.003 * (1 - k), VIEW.z + (MOUTH.z - VIEW.z) * k);
    // a drink tips its top towards you; food turns its bitten end to your mouth
    h.rotation.set(drink ? Math.min(1.7, sipPose.tilt * 0.75) : 0.9 * k - 0.2, -0.4 + 0.4 * k, 0, 'YXZ');
  });
  if (!held) return null;
  return (
    <group ref={root} userData={FIRST_PERSON}>
      <group ref={hand} scale={0.8}>
        {/* the end that's bitten (snackLook.tsx: -z, or the top of a cheese stick) points up at your mouth */}
        <group rotation={drink || held.snack === 'cheese' ? [0, 0, 0] : [Math.PI / 2 - 0.4, 0, 0]}>
          <SnackLook snack={held.snack} left={held.left} />
        </group>
      </group>
    </group>
  );
}
