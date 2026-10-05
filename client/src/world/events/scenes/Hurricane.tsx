import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { loop, placeAt } from '../../../ui/eventSfx';
import { setEventWeather } from '../../weather/weatherState';
import { seeded } from '../director';
import { inOut, sign, type SceneProps } from '../kit';

// A hurricane passing offshore (never a tornado, never at the office): its great spiral of cloud wheeling slowly on
// the horizon, while the weather (weather/) turns to driving rain and a gale for as long as it's near, and the park's
// trees sway. When it moves on, the weather blends back to what it was.

const VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uFade;
uniform float uRadius;
uniform vec3 uLit;
uniform vec3 uShade;
varying vec2 vP;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float r = length(vP) / uRadius;
  float a = atan(vP.y, vP.x);
  // two arms winding in to a clear eye, turning slowly anticlockwise
  float arms = sin(a * 2.0 + log(max(r, 0.02)) * 7.0 - uTime * 0.25);
  float cloud = smoothstep(-0.3, 0.6, arms + noise(vP * 0.02 + uTime * 0.02) * 0.8 - 0.3);
  float eye = smoothstep(0.05, 0.12, r);
  float edge = 1.0 - smoothstep(0.75, 1.0, r);
  float wall = 1.0 - smoothstep(0.1, 0.22, abs(r - 0.15));
  float alpha = clamp((cloud * 0.8 + wall * 0.6) * eye * edge, 0.0, 1.0) * uFade * 0.85;
  vec3 col = mix(uShade, uLit, cloud * 0.7 + 0.3 * smoothstep(0.2, 0.9, r));
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}`;

const LIT = new THREE.Color('#eef1f6');
const SHADE = new THREE.Color('#7d8794');

/** Its weather lets go this long before the end, so the sky has blended back by the time it's gone. */
const RELEASE = 22;
const GALE = { kind: 'heavy-rain', wind: 1 } as const;

export default function Hurricane({ run }: SceneProps) {
  const s = sign(run.side);
  const storm = useMemo(() => {
    const r = seeded(run.seed);
    const radius = 230;
    const geo = new THREE.CircleGeometry(radius, 96);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uFade: { value: 0 }, uRadius: { value: radius }, uLit: { value: LIT.clone() }, uShade: { value: SHADE.clone() } },
    });
    const mesh = new THREE.Mesh(geo, mat);
    // lying high over the sea on its side, tipped towards the building so its spiral shows
    mesh.position.set(s * (320 + r() * 30), 140, (r() - 0.5) * 120);
    mesh.rotation.set(-Math.PI / 2, 0, 0);
    mesh.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), s * 0.95);
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    return { geo, mat, mesh };
  }, [run.seed, s]);
  const sound = useMemo(() => ({ gale: null as ReturnType<typeof loop> | null }), []);
  useEffect(() => {
    sound.gale = loop('gale');
    return () => {
      setEventWeather(null);
      sound.gale?.stop(2);
      storm.geo.dispose();
      storm.mat.dispose();
    };
  }, [storm, sound]);

  useFrame(() => {
    const t = run.t;
    storm.mat.uniforms.uTime.value = t;
    storm.mat.uniforms.uFade.value = inOut(t, run.seconds, 15);
    // driving rain and a gale while it's near (render time, so a pause holds it too)
    setEventWeather(t < run.seconds - RELEASE ? GALE : null);
    const heard = placeAt(storm.mesh.position.x, 0, storm.mesh.position.z, 300);
    sound.gale?.set(Math.max(0.4, heard.gain) * inOut(t, run.seconds, 10), heard.pan * 0.5);
  });

  return <primitive object={storm.mesh} />;
}
