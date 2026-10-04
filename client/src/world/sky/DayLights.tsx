// The office's lights, following the time of day (indoor.ts): one shadow-casting key light that is the sun by day
// (moving across the floor, low, long and warm at golden hour) and a faint cool moon at night, a hemisphere and an
// ambient fill that turn warm when the ceiling lamps come on, and the renderer's exposure. Moved through refs in one
// useFrame with no allocations or re-renders, and skipped while the clock stands still (?daytime, 'Always day').
import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { indoorLight, newIndoorLight, newShadowBox, shadowBox } from './indoor';
import { setLamps } from './lamps';
import { setSunPatches } from './SunPatches';
import { dayTime } from './useDayTime';

/** How far from the office's middle the key light sits (beyond every corner of the floor). */
const DISTANCE = 30;

export function DayLights() {
  const gl = useThree((s) => s.gl);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const ambient = useRef<THREE.AmbientLight>(null);
  const key = useRef<THREE.DirectionalLight>(null);
  const state = useMemo(() => ({ light: newIndoorLight(), box: newShadowBox(), t: -1 }), []);

  useFrame(() => {
    const h = hemi.current;
    const a = ambient.current;
    const k = key.current;
    if (!h || !a || !k || dayTime.t === state.t) return;
    state.t = dayTime.t;
    const L = indoorLight(state.t, state.light);

    const [x, y, z] = L.dir;
    k.position.set(x * DISTANCE, y * DISTANCE, z * DISTANCE);
    k.color.setHex(L.keyColor);
    k.intensity = L.keyIntensity;
    const b = shadowBox(L.dir, DISTANCE, state.box);
    const cam = k.shadow.camera;
    cam.left = b.left;
    cam.right = b.right;
    cam.top = b.top;
    cam.bottom = b.bottom;
    cam.near = b.near;
    cam.far = b.far;
    cam.updateProjectionMatrix();

    h.color.setHex(L.hemiSky);
    h.groundColor.setHex(L.hemiGround);
    h.intensity = L.hemiIntensity;
    a.color.setHex(L.ambientColor);
    a.intensity = L.ambient;
    gl.toneMappingExposure = L.exposure;
    setLamps(L.lamps);
    setSunPatches(L.dir, L.keyColor, L.keyIntensity);
  });

  return (
    <>
      <hemisphereLight ref={hemi} args={['#fffaf0', '#a48a6a', 0.95]} />
      <ambientLight ref={ambient} intensity={0.18} />
      <directionalLight
        ref={key}
        position={[9, 14, 7]}
        intensity={1.55}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0006}
        shadow-normalBias={0.03}
      />
    </>
  );
}
