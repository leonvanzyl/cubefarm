// The sky outside, following the office's time of day (time.ts): a gradient dome with the sun (big and amber at
// golden hour) and the moon, puffy toon clouds drifting with the wind, stars at night, and the scene's fog and
// background colour. Three draw calls (the stars only at night), everything updated through refs and uniforms in
// one useFrame with no allocations. The whole sky moves with the camera and sits at the far end of the depth
// range, so it is drawn only where nothing else is and never cuts through the building or the city.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BLOOM_AT_NIGHT } from '../gfx/bloomMarks';
import { cloudScale, cloudZ, makeClouds, starField } from './skyLayout';
import { nightFactor, skyAt, sunDirection, type SkyPalette } from './time';
import { dayTime } from './useDayTime';

const STARS = 700;
const FOG_NEAR = 30;
const FOG_FAR_DAY = 70;
const FOG_FAR_NIGHT = 62;
const NIGHT_CLOUD = new THREE.Color(0x5d6788);

// On the far plane (z = w): drawn after the building, only where nothing else is.
const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const DOME_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uFog;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uNight;
varying vec3 vDir;

float disc(float c, float cosR) {
  float aa = fwidth(c);
  return smoothstep(cosR - aa, cosR + aa, c);
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.65, h));
  // haze where the sky meets the ground (and the fogged city), a little darker below the horizon
  col = mix(col, uFog, 0.55 * (1.0 - smoothstep(-0.03, 0.14, h)));
  col *= 1.0 - 0.15 * (1.0 - smoothstep(-0.3, 0.0, h));
  float aboveHorizon = smoothstep(-0.012, 0.008, h);

  // the sun: a soft glow and a hard cartoon disc, both bigger and warmer near the horizon
  float sunUp = smoothstep(-0.12, 0.04, uSunDir.y);
  float low = 1.0 - smoothstep(0.02, 0.45, uSunDir.y);
  float c = dot(d, uSunDir);
  float cp = max(c, 0.0);
  col += uSunColor * sunUp * low * pow(cp, 3.0) * (1.0 - smoothstep(-0.05, 0.4, h)) * 0.5;
  col += uSunColor * sunUp * (pow(cp, 300.0) * 0.3 + pow(cp, 24.0) * (0.12 + 0.25 * low));
  vec3 sunCore = mix(vec3(1.0, 0.36, 0.06), vec3(1.0, 0.93, 0.66), 1.0 - low); // linear: amber low, pale gold high
  col = mix(col, sunCore, disc(c, mix(0.99925, 0.9976, low)) * sunUp * aboveHorizon);

  // the moon, opposite the sun: a cream disc with a few craters and a cool halo
  vec3 m = -uSunDir;
  float mc = dot(d, m);
  float moonUp = uNight * smoothstep(-0.02, 0.06, m.y) * aboveHorizon;
  col += vec3(0.5, 0.58, 0.9) * moonUp * (pow(max(mc, 0.0), 260.0) * 0.4 + pow(max(mc, 0.0), 40.0) * 0.08);
  vec3 tx = normalize(cross(m, vec3(0.0, 1.0, 0.0)) + vec3(0.0001));
  vec3 ty = cross(tx, m);
  vec2 q = vec2(dot(d, tx), dot(d, ty)) / 0.034;
  float crater = max(max(1.0 - smoothstep(0.2, 0.26, length(q - vec2(0.3, 0.28))),
                          1.0 - smoothstep(0.15, 0.2, length(q - vec2(-0.35, -0.08)))),
                      1.0 - smoothstep(0.11, 0.15, length(q - vec2(0.12, -0.45))));
  vec3 moonCol = mix(vec3(0.95, 0.88, 0.66), vec3(0.6, 0.56, 0.46), crater);
  col = mix(col, moonCol, disc(mc, 0.99942) * moonUp);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

// Clouds sit just in front of the dome in depth (nearer puffs in front), behind anything closer than ~75 m.
const CLOUD_VERT = /* glsl */ `
varying vec3 vN;
void main() {
  vN = normalize(mat3(instanceMatrix) * normal);
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vec4 p = projectionMatrix * mv;
  p.z = (0.9998 + 0.00018 * clamp(length(mv.xyz) / 100.0, 0.0, 1.0)) * p.w;
  gl_Position = p;
}`;

const CLOUD_FRAG = /* glsl */ `
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uLight;
varying vec3 vN;
void main() {
  float f = dot(normalize(vN), uLight);
  // three flat steps, like the office's toon ramp
  float tone = f > 0.3 ? 1.0 : (f > -0.25 ? 0.55 : 0.0);
  gl_FragColor = vec4(mix(uShade, uLit, tone), 1.0);
  #include <colorspace_fragment>
}`;

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute float aPhase;
uniform float uTime;
uniform float uOpacity;
uniform float uPixel;
varying float vAlpha;
void main() {
  float up = normalize(mat3(modelMatrix) * position).y;
  float twinkle = 0.65 + 0.35 * sin(uTime * (1.2 + aPhase * 2.0) + aPhase * 6.2832);
  vAlpha = uOpacity * twinkle * smoothstep(0.02, 0.15, up);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
  gl_PointSize = aSize * uPixel;
}`;

const STAR_FRAG = /* glsl */ `
varying float vAlpha;
void main() {
  float r = length(gl_PointCoord - 0.5);
  gl_FragColor = vec4(1.0, 0.97, 0.86, vAlpha * (1.0 - smoothstep(0.32, 0.5, r)));
  #include <colorspace_fragment>
}`;

const reducedMotionQuery = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null);

export function Sky() {
  const scene = useThree((s) => s.scene);
  const group = useRef<THREE.Group>(null);
  const clouds = useRef<THREE.InstancedMesh>(null);
  const stars = useRef<THREE.Points>(null);

  // Everything the frame loop touches is allocated once here.
  const sky = useMemo(() => {
    const layout = makeClouds();
    const field = starField(STARS);
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(field.positions, 3));
    starGeometry.setAttribute('aSize', new THREE.BufferAttribute(field.sizes, 1));
    starGeometry.setAttribute('aPhase', new THREE.BufferAttribute(field.phases, 1));
    const sun = sunDirection(0.5);
    // the stars wheel round the same axis as the sun
    const axis = new THREE.Vector3().crossVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(sun[0], sun[1], sun[2])).normalize();
    return {
      layout,
      puffs: layout.reduce((n, c) => n + c.puffs.length, 0),
      palette: {} as SkyPalette,
      sun: [0, 0, 0] as [number, number, number],
      axis,
      matrix: new THREE.Matrix4(),
      tmp: new THREE.Color(),
      fog: new THREE.Fog(0xf3ece2, FOG_NEAR, FOG_FAR_DAY),
      background: new THREE.Color(0xbfe3ff),
      drift: 0,
      lastDrift: -1,
      motion: reducedMotionQuery(),
      domeGeometry: new THREE.SphereGeometry(50, 32, 16),
      dome: new THREE.ShaderMaterial({
        vertexShader: DOME_VERT,
        fragmentShader: DOME_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uZenith: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uFog: { value: new THREE.Color() },
          uSunColor: { value: new THREE.Color() },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uNight: { value: 0 },
        },
        // the moon blooms after dusk (the dark sky round it is too dim to), and so do the stars
        userData: BLOOM_AT_NIGHT,
      }),
      cloudGeometry: new THREE.SphereGeometry(1, 14, 10),
      cloud: new THREE.ShaderMaterial({
        vertexShader: CLOUD_VERT,
        fragmentShader: CLOUD_FRAG,
        uniforms: {
          uLit: { value: new THREE.Color(0xffffff) },
          uShade: { value: new THREE.Color(0xd8e4f4) },
          uLight: { value: new THREE.Vector3(0, 1, 0) },
        },
      }),
      starGeometry,
      star: new THREE.ShaderMaterial({
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uPixel: { value: 1 } },
        userData: BLOOM_AT_NIGHT,
      }),
    };
  }, []);

  useEffect(() => {
    const prevFog = scene.fog;
    const prevBackground = scene.background;
    scene.fog = sky.fog;
    scene.background = sky.background;
    return () => {
      scene.fog = prevFog;
      scene.background = prevBackground;
      for (const d of [sky.domeGeometry, sky.dome, sky.cloudGeometry, sky.cloud, sky.starGeometry, sky.star]) d.dispose();
    };
  }, [scene, sky]);

  // Clouds start hidden (zero-size puffs) until the first frame places them.
  useLayoutEffect(() => {
    const m = clouds.current;
    if (!m) return;
    sky.matrix.makeScale(0, 0, 0);
    for (let i = 0; i < sky.puffs; i++) m.setMatrixAt(i, sky.matrix);
    m.instanceMatrix.needsUpdate = true;
  }, [sky]);

  useFrame(({ camera, clock, gl }, delta) => {
    const g = group.current;
    if (!g) return;
    g.position.copy(camera.position);

    const t = dayTime.t;
    const p = skyAt(t, sky.palette);
    const sun = sunDirection(t, sky.sun);
    const night = nightFactor(t);

    const u = sky.dome.uniforms;
    (u.uZenith.value as THREE.Color).setHex(p.zenith);
    (u.uHorizon.value as THREE.Color).setHex(p.horizon);
    (u.uFog.value as THREE.Color).setHex(p.fog);
    (u.uSunColor.value as THREE.Color).setHex(p.sunColor);
    (u.uSunDir.value as THREE.Vector3).set(sun[0], sun[1], sun[2]);
    u.uNight.value = night;
    sky.fog.color.setHex(p.fog);
    sky.fog.far = FOG_FAR_DAY + (FOG_FAR_NIGHT - FOG_FAR_DAY) * night;
    sky.background.setHex(p.horizon);

    // Clouds: white at noon, gold and pink at golden hour (the sun's and the horizon's colours), dim blue-grey at night.
    const cu = sky.cloud.uniforms;
    const lit = cu.uLit.value as THREE.Color;
    const shade = cu.uShade.value as THREE.Color;
    const low = 1 - Math.min(1, Math.max(0, sun[1] / 0.45));
    lit.setRGB(1, 1, 1).lerp(sky.tmp.setHex(p.sunColor), 0.4).lerp(sky.tmp.setHex(p.horizon), 0.35 * low).lerp(NIGHT_CLOUD, night * 0.85);
    shade.copy(lit).multiplyScalar(0.8).lerp(sky.tmp.setHex(p.horizon), 0.3);
    // lit from above, leaning towards the sun (or the moon at night), side-lit when it's low
    const s = sun[1] >= 0 ? 1 : -1;
    const lean = 0.6 + 1.4 * low;
    (cu.uLight.value as THREE.Vector3).set(sun[0] * s * lean, 1, sun[2] * s * lean).normalize();

    // Drift with real time, so a frozen ?daytime still has moving clouds; still for prefers-reduced-motion.
    if (!sky.motion?.matches) sky.drift += Math.min(delta, 0.1);
    const m = clouds.current;
    if (m && sky.drift !== sky.lastDrift) {
      sky.lastDrift = sky.drift;
      let i = 0;
      for (const c of sky.layout) {
        const z = cloudZ(c, sky.drift);
        const k = cloudScale(c.x, z) * c.size;
        for (const f of c.puffs) {
          const r = f.r * k;
          // flat-bottomed puffs: squashed a little in y
          sky.matrix.set(r, 0, 0, c.x + f.dx * k, 0, r * 0.8, 0, c.y + f.dy * k, 0, 0, r, z + f.dz * k, 0, 0, 0, 1);
          m.setMatrixAt(i++, sky.matrix);
        }
      }
      m.instanceMatrix.needsUpdate = true;
    }

    const st = stars.current;
    if (st) {
      st.visible = p.starsOpacity > 0.01;
      if (st.visible) {
        st.quaternion.setFromAxisAngle(sky.axis, 2 * Math.PI * (t - 0.5));
        const su = sky.star.uniforms;
        su.uOpacity.value = p.starsOpacity;
        su.uTime.value = clock.elapsedTime;
        su.uPixel.value = gl.getPixelRatio();
      }
    }
  });

  return (
    <group ref={group}>
      <mesh geometry={sky.domeGeometry} material={sky.dome} frustumCulled={false} renderOrder={1000} />
      <instancedMesh ref={clouds} args={[sky.cloudGeometry, sky.cloud, sky.puffs]} frustumCulled={false} renderOrder={999} />
      <points ref={stars} geometry={sky.starGeometry} material={sky.star} frustumCulled={false} renderOrder={-1} />
    </group>
  );
}
