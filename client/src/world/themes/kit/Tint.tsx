import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { nightFactor } from '../../sky/time';
import { dayTime } from '../../sky/useDayTime';
import type { ThemeDef } from '../themes';

// A theme's mood without touching the sky or the lights' own code: after Sky.tsx and DayLights.tsx have set this
// frame's fog, background and light colours (this mounts later, so its frame callback runs after theirs), it mixes the
// theme's colour in. The sky dome itself gets a see-through tint drawn just after it, only where nothing else is.
// DayLights skips frames while the clock stands still, so each light's own colour is remembered and the tint is
// applied to that, never compounded.

const DOME_VERT = /* glsl */ `
void main() {
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const DOME_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAmount;
void main() {
  gl_FragColor = vec4(uColor, uAmount);
  #include <colorspace_fragment>
}`;

/** How strongly an evening-and-night tint shows at time of day t: a little by day, fully after dusk. */
export const eveningWeight = (t: number) => 0.25 + 0.75 * Math.max(nightFactor(t), Math.max(0, 1 - Math.abs(t - 0.75) / 0.08) * 0.8);

interface LightMemo {
  light: THREE.Light & { color: THREE.Color; groundColor?: THREE.Color };
  base: THREE.Color;
  baseGround: THREE.Color;
  last: THREE.Color;
}

export function Tint({ def }: { def: ThemeDef }) {
  const scene = useThree((s) => s.scene);
  const dome = useRef<THREE.Mesh>(null);
  const st = useMemo(
    () => ({
      tint: new THREE.Color(def.tint.color),
      sky: new THREE.Color(def.sky?.color ?? '#000000'),
      lights: [] as LightMemo[],
      dome: new THREE.ShaderMaterial({
        vertexShader: DOME_VERT,
        fragmentShader: DOME_FRAG,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        uniforms: { uColor: { value: new THREE.Color(def.sky?.color ?? '#000000') }, uAmount: { value: 0 } },
      }),
      domeGeo: new THREE.SphereGeometry(49, 24, 12),
      fogNear: -1,
    }),
    [def],
  );

  useEffect(() => {
    scene.traverse((o) => {
      if ((o as THREE.HemisphereLight).isHemisphereLight || (o as THREE.AmbientLight).isAmbientLight) {
        const l = o as LightMemo['light'];
        st.lights.push({ light: l, base: l.color.clone(), baseGround: l.groundColor?.clone() ?? new THREE.Color(), last: new THREE.Color(-1, -1, -1) });
      }
    });
    return () => {
      for (const m of st.lights) {
        m.light.color.copy(m.base);
        m.light.groundColor?.copy(m.baseGround);
      }
      st.lights.length = 0;
      st.dome.dispose();
      st.domeGeo.dispose();
    };
  }, [scene, st]);

  useFrame(({ camera }) => {
    dome.current?.position.copy(camera.position);
    for (const m of st.lights) {
      if (!m.light.color.equals(m.last)) {
        m.base.copy(m.light.color);
        if (m.light.groundColor) m.baseGround.copy(m.light.groundColor);
      }
      m.light.color.copy(m.base).lerp(st.tint, def.tint.amount);
      m.light.groundColor?.copy(m.baseGround).lerp(st.tint, def.tint.amount * 0.6);
      m.last.copy(m.light.color);
    }
    const sky = def.sky;
    if (!sky) return;
    const k = sky.amount * eveningWeight(dayTime.t);
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      fog.color.lerp(st.sky, k * 0.6);
      // the fog comes in closer at night
      const night = nightFactor(dayTime.t);
      if (st.fogNear < 0) st.fogNear = fog.near;
      fog.far *= 1 - sky.fog * night;
      fog.near = st.fogNear * (1 - sky.fog * night * 0.8);
    }
    if (scene.background instanceof THREE.Color) scene.background.lerp(st.sky, k * 0.6);
    st.dome.uniforms.uAmount.value = k * 0.55;
  });

  useEffect(
    () => () => {
      const fog = scene.fog as THREE.Fog | null;
      if (fog && st.fogNear >= 0) fog.near = st.fogNear;
    },
    [scene, st],
  );

  if (!def.sky) return null;
  return <mesh ref={dome} geometry={st.domeGeo} material={st.dome} frustumCulled={false} renderOrder={1001} />;
}
