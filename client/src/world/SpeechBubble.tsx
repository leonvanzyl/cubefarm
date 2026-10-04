import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { saying } from './people';
import { drawBubble } from './useHitReaction';

// A small emoji speech bubble over someone's head while they chat (people.ts `say`). One texture per emoji, made
// once and shared; the bubble is hidden, and costs nothing, while they say nothing.

const textures = new Map<string, THREE.CanvasTexture>();

function bubbleTexture(text: string) {
  let tex = textures.get(text);
  if (tex) return tex;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 176;
  drawBubble(canvas.getContext('2d')!, 256, 176, text);
  tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  textures.set(text, tex);
  return tex;
}

/** `y` is head height while standing (chats happen on foot). */
export function SpeechBubble({ id, y }: { id: string; y: number }) {
  const g = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const s = saying(id);
    const grp = g.current;
    if (!grp || !mat.current) return;
    grp.visible = !!s;
    if (!s) return;
    const tex = bubbleTexture(s.text);
    if (mat.current.map !== tex) {
      mat.current.map = tex;
      mat.current.needsUpdate = true;
    }
    // pop in with a little overshoot
    const ms = performance.now() - s.at;
    grp.scale.setScalar(ms < 90 ? 0.3 + (ms / 90) * 0.9 : ms < 170 ? 1.2 - ((ms - 90) / 80) * 0.2 : 1);
  });
  return (
    // The group's origin is the tail's tip, beside the head.
    <Billboard position={[0.2, y, 0]}>
      <group ref={g} visible={false}>
        <mesh position={[0.195, 0.156, 0]} renderOrder={2}>
          <planeGeometry args={[0.5, 0.344]} />
          <meshBasicMaterial ref={mat} transparent toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
    </Billboard>
  );
}
