import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { SANS } from './draw';
import { FACES_CAMERA } from './viewTags';

// The "z z z" drifting up from someone who nodded off at their desk: three letters that rise, grow and fade, on one
// texture, geometry and material shared by everyone. Hidden (and skipped) while they're awake.

const INK = '#1f1d2b';
const geometry = new THREE.PlaneGeometry(0.16, 0.16);
let material: THREE.MeshBasicMaterial | null = null;

/** Made on first use, in the browser rather than at import. */
function zMaterial() {
  if (material) return material;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = `700 54px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 9;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.fillStyle = '#ffffff';
  ctx.strokeText('z', 32, 30);
  ctx.fillText('z', 32, 30);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  material = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false });
  return material;
}

/** `on.current` says whether they're asleep; set by Character every frame. */
export function Zzz({ on, position }: { on: { current: boolean }; position: [number, number, number] }) {
  const g = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  const q = useMemo(() => ({ parent: new THREE.Quaternion(), camera: new THREE.Quaternion() }), []);
  useFrame(() => {
    const grp = g.current;
    if (!grp) return;
    grp.visible = on.current;
    if (!on.current || !grp.parent) return;
    // face the camera
    grp.parent.getWorldQuaternion(q.parent);
    grp.quaternion.copy(q.parent.invert().multiply(camera.getWorldQuaternion(q.camera)));
    const t = performance.now() / 1000;
    for (let i = 0; i < grp.children.length; i++) {
      const z = grp.children[i];
      const f = (t * 0.4 + i / 3) % 1;
      const fade = f < 0.15 ? f / 0.15 : f > 0.75 ? (1 - f) / 0.25 : 1;
      z.position.set(f * 0.16 + Math.sin(f * 7 + i) * 0.03, f * 0.38, 0);
      z.scale.setScalar(Math.max(0.001, (0.45 + f * 0.75) * fade));
      z.rotation.z = Math.sin(f * 5 + i) * 0.25;
    }
  });
  return (
    <group ref={g} position={position} visible={false} userData={FACES_CAMERA}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} geometry={geometry} material={zMaterial()} renderOrder={2} />
      ))}
    </group>
  );
}
