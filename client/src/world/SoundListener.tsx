import { useFrame } from '@react-three/fiber';
import { setListener } from '../ui/sfx';

// Lives inside the Canvas: puts the WebAudio listener where the camera is, facing where it looks, so sounds placed
// in the world pan and fade as you move and turn. Reads the camera's world matrix directly: no allocations per frame.

export function SoundListener() {
  useFrame(({ camera }) => {
    const e = camera.matrixWorld.elements;
    // Column 3 is the position, column 1 the up axis, and the camera looks down its -Z axis (column 2).
    setListener(e[12], e[13], e[14], -e[8], -e[9], -e[10], e[4], e[5], e[6]);
  });
  return null;
}
