import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { SNACKS } from './fridge';
import { SnackLook } from './SnackLook';
import { sipPose } from './toys/sipping';
import { FIRST_PERSON } from './viewTags';

// The snack from the fridge in your hands (fridgeState.ts), held like a mug or the roof's sausage: at the lower right
// of the view, raised to your mouth for each sip or bite (toys/sipping.ts times them). A can or bottle tips up to
// drink; food points up and away and gets shorter with every bite (SnackLook.tsx).

// Where it sits in view (camera space, metres), and where it goes for a sip or a bite.
const DRINK = { x: 0.15, y: -0.14, z: -0.4, tilt: 0.25, turn: -0.4 };
const DRINK_MOUTH = { x: 0.02, y: -0.06, z: -0.25, turn: 0 };
// food tips its far end up, so you see its top (a slice's cheese) rather than its edge
const FOOD = { x: 0.15, y: -0.16, z: -0.4, tilt: 0.75, turn: 0.5 };
const FOOD_MOUTH = { x: 0.03, y: -0.08, z: -0.24, tilt: 0.3, turn: 1.2 };
const TAGS = { ...FIRST_PERSON, moving: true };

export function HeldSnack() {
  const held = useStore((s) => (s.held?.kind === 'snack' ? s.held : null));
  const root = useRef<THREE.Group>(null);
  const hand = useRef<THREE.Group>(null);
  const drink = held ? SNACKS[held.snack].kind === 'drink' : false;
  useFrame(({ camera }) => {
    const r = root.current;
    const h = hand.current;
    if (!r || !h) return;
    r.position.copy(camera.position);
    r.quaternion.copy(camera.quaternion);
    const k = sipPose.lift;
    const bob = Math.sin((performance.now() / 1000) * 1.6) * 0.003 * (1 - k);
    if (drink) {
      h.position.set(DRINK.x + (DRINK_MOUTH.x - DRINK.x) * k, DRINK.y + (DRINK_MOUTH.y - DRINK.y) * k + bob, DRINK.z + (DRINK_MOUTH.z - DRINK.z) * k);
      h.rotation.set(DRINK.tilt + sipPose.tilt, DRINK.turn + (DRINK_MOUTH.turn - DRINK.turn) * k, 0, 'XYZ');
    } else {
      h.position.set(FOOD.x + (FOOD_MOUTH.x - FOOD.x) * k, FOOD.y + (FOOD_MOUTH.y - FOOD.y) * k + bob, FOOD.z + (FOOD_MOUTH.z - FOOD.z) * k);
      h.rotation.set(FOOD.tilt + (FOOD_MOUTH.tilt - FOOD.tilt) * k, FOOD.turn + (FOOD_MOUTH.turn - FOOD.turn) * k, 0, 'YXZ');
    }
  });
  if (!held) return null;
  return (
    <group ref={root} userData={TAGS}>
      <group ref={hand} scale={0.85}>
        <SnackLook snack={held.snack} left={held.left} />
      </group>
    </group>
  );
}
