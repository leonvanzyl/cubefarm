// The office's lights, following the time of day (indoor.ts): one shadow-casting key light that is the sun by day
// (moving across the floor, low, long and warm at golden hour) and a faint cool moon at night, a hemisphere and an
// ambient fill that turn warm when the ceiling lamps come on, and the renderer's exposure. Moved through refs in one
// useFrame with no allocations or re-renders, and skipped while the clock, the weather and the floor's evening dim
// stand still (?daytime, 'Always day'). The weather (weather/) dims and greys the light, brings the lamps on earlier
// in heavy weather, and a lightning flash lights the office through the windows on this same rig. A floor winding down
// for the evening (ritualLook.ts) dims them a little on top.
import { useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { DIM_BY, ritualLook } from '../ritualLook';
import { gloomOf, weatherSky } from '../weather/weatherRules';
import { weather } from '../weather/weatherState';
import { indoorLight, newIndoorLight, newShadowBox, shadowBox, type IndoorWeather } from './indoor';
import { setLamps } from './lamps';
import { setSunPatches } from './SunPatches';
import { dayTime, useSkyFrame } from './useDayTime';

/** How far from the office's middle the key light sits (beyond every corner of the floor). */
const DISTANCE = 30;
/** A lightning flash at full brightness: added to the key, the sky's fill and the ambient, in a cold white. */
const FLASH = { key: 2.6, hemi: 1.6, ambient: 0.7, color: 0xdfe8ff };

export function DayLights() {
  const gl = useThree((s) => s.gl);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const ambient = useRef<THREE.AmbientLight>(null);
  const key = useRef<THREE.DirectionalLight>(null);
  const state = useMemo(() => {
    const indoors: IndoorWeather = { gloom: 0, sky: (p) => void weatherSky(p, weather.mix) };
    return { light: newIndoorLight(), box: newShadowBox(), t: -1, version: -1, dim: 0, indoors };
  }, []);

  useSkyFrame(() => {
    const h = hemi.current;
    const a = ambient.current;
    const k = key.current;
    if (!h || !a || !k || (dayTime.t === state.t && weather.version === state.version && ritualLook.dim === state.dim)) return;
    state.t = dayTime.t;
    state.version = weather.version;
    state.dim = ritualLook.dim;
    state.indoors.gloom = gloomOf(weather.mix);
    const L = indoorLight(state.t, state.light, weather.active ? state.indoors : undefined);
    const flash = weather.flash;
    if (flash > 0) {
      L.keyIntensity += FLASH.key * flash;
      L.keyColor = FLASH.color;
      L.hemiIntensity += FLASH.hemi * flash;
      L.ambient += FLASH.ambient * flash;
    }
    // a floor winding down for the evening (Rituals.tsx) turns its main lights down a little
    const down = 1 - DIM_BY * state.dim;

    const [x, y, z] = L.dir;
    k.position.set(x * DISTANCE, y * DISTANCE, z * DISTANCE);
    k.color.setHex(L.keyColor);
    k.intensity = L.keyIntensity * down;
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
    h.intensity = L.hemiIntensity * down;
    a.color.setHex(L.ambientColor);
    a.intensity = L.ambient * down;
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
