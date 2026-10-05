import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { placeAt, play } from '../../../ui/eventSfx';
import { seeded } from '../director';
import { inOut, sign, type SceneProps } from '../kit';

// A rainbow after the rain (or, now and then, just because): a soft seven-band arc over the city on one side, fading in,
// lingering and fading out, its feet lost in the haze. One mesh and a shader; a little rising chime as it appears.

const VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uInner;
uniform float uOuter;
uniform float uFade;
varying vec2 vP;
vec3 band(float k) {
  // red outside to violet inside
  vec3 c = vec3(0.56, 0.36, 0.95);
  c = mix(c, vec3(0.3, 0.45, 1.0), smoothstep(0.08, 0.2, k));
  c = mix(c, vec3(0.25, 0.8, 0.95), smoothstep(0.22, 0.34, k));
  c = mix(c, vec3(0.35, 0.85, 0.35), smoothstep(0.36, 0.5, k));
  c = mix(c, vec3(1.0, 0.92, 0.3), smoothstep(0.52, 0.64, k));
  c = mix(c, vec3(1.0, 0.6, 0.2), smoothstep(0.66, 0.78, k));
  c = mix(c, vec3(0.98, 0.3, 0.3), smoothstep(0.8, 0.92, k));
  return c;
}
void main() {
  float k = (length(vP) - uInner) / (uOuter - uInner);
  float edge = smoothstep(0.0, 0.08, k) * (1.0 - smoothstep(0.92, 1.0, k));
  // its feet fade into the haze
  float feet = smoothstep(5.0, 70.0, vP.y);
  gl_FragColor = vec4(band(k), 0.5 * edge * feet * uFade);
}`;

export default function Rainbow({ run, elevation }: SceneProps) {
  const s = sign(run.side);
  const bow = useMemo(() => {
    const r = seeded(run.seed);
    const radius = 160 + r() * 30;
    const inner = radius - 16;
    const geo = new THREE.RingGeometry(inner, radius, 128, 1, 0, Math.PI);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uInner: { value: inner }, uOuter: { value: radius }, uFade: { value: 0 } },
    });
    const mesh = new THREE.Mesh(geo, mat);
    // standing in the sky out beyond the city on its side, facing the building
    mesh.position.set(s * (340 + r() * 40), -8, (r() - 0.5) * 80);
    mesh.rotation.y = (-s * Math.PI) / 2;
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    return { geo, mat, mesh, chimed: false };
  }, [run.seed, s]);
  useEffect(
    () => () => {
      bow.geo.dispose();
      bow.mat.dispose();
    },
    [bow],
  );

  useFrame(() => {
    const t = run.t;
    bow.mat.uniforms.uFade.value = inOut(t, run.seconds, 9);
    if (!bow.chimed && t > 1.5) {
      bow.chimed = true;
      const heard = placeAt(bow.mesh.position.x, 60 - elevation, bow.mesh.position.z, 400);
      play('chime', { gain: Math.max(0.5, heard.gain), pan: heard.pan });
    }
  });

  return <primitive object={bow.mesh} />;
}
