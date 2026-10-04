import { useFrame } from '@react-three/fiber';
import { setListener } from '../ui/sfx';
import { earAtHome } from './camera/rig';
import { EYE_HEIGHT } from './layout';

// Lives inside the Canvas: puts the WebAudio listener where the camera is, facing where it looks, so sounds placed
// in the world pan and fade as you move and turn. Reads the camera's world matrix directly: no allocations per frame.
// From the overview and the building view you still hear the floor from where you're standing (camera/rig.ts).

export function SoundListener() {
  useFrame(({ camera }) => {
    const home = earAtHome();
    if (home) return setListener(home.x, EYE_HEIGHT, home.z, -Math.sin(home.yaw), 0, -Math.cos(home.yaw), 0, 1, 0);
    const e = camera.matrixWorld.elements;
    // Column 3 is the position, column 1 the up axis, and the camera looks down its -Z axis (column 2).
    setListener(e[12], e[13], e[14], -e[8], -e[9], -e[10], e[4], e[5], e[6]);
  });
  return null;
}
