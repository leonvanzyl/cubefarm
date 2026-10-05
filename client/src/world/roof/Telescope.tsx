import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { SANS } from '../draw';
import { useInteractable } from '../interact';
import { Outlines } from '../Outlines';
import { TELESCOPE } from '../layout';
import { toon } from '../materials';
import { leavePerch, perch, setPerch } from '../perch';
import { starField } from '../sky/skyLayout';
import { nightFactor } from '../sky/time';
import { dayTime } from '../sky/useDayTime';
import { useRoofOp, useRoofReport } from './roofOps';
import { useRoof, ZOOM } from './roofState';
import { aimAt, moonDirection, skyFigures, skyTurn, starAt, starAxis, STARS } from './stargazing';

// The telescope in the north-east corner. E looks through it (perch.ts): the view narrows 4-8× (the mouse wheel), a
// round eyepiece frames it (ui/RoofHud.tsx) and the mouse aims it, finer the more it magnifies. By day the city's
// billboards (Billboards.tsx) are readable; at night it shows a detailed moon and the constellations among the sky's
// own stars, joined up and named (stargazing.ts). None of that night sky is drawn unless you're looking through it.

/** Game.tsx's camera field of view, put back when you step away. */
const FOV = 72;
/** How far out the telescope's sky is drawn: inside the sky dome, and drawn behind everything like it. */
const SKY_R = 45;
/** The moon's disc a touch bigger than the sky's own (Sky.tsx's), so it covers it. */
const MOON = 2 * SKY_R * Math.tan(0.0358) * 1.25;
const MOUNT_Y = 1.36;
/** Where it points when nobody's touched it: downtown, a little up. */
const START = { yaw: -0.7, pitch: 0.08 };

// Drawn on the far plane (like Sky.tsx's dome), so the telescope's sky only shows where nothing nearer is.
const FAR_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const FAR_FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 color;
uniform float opacity;
uniform bool textured;
varying vec2 vUv;
void main() {
  vec4 t = textured ? texture2D(map, vUv) : vec4(1.0);
  gl_FragColor = vec4(color * t.rgb, t.a * opacity);
  #include <colorspace_fragment>
}`;

// The sky's own stars, magnified: bigger and softer than Sky.tsx draws them, the constellations' brightest of all.
const STAR_VERT = /* glsl */ `
attribute float aSize;
uniform float uPixel;
uniform float uOpacity;
varying float vAlpha;
void main() {
  vAlpha = uOpacity * smoothstep(0.0, 0.08, normalize(mat3(modelMatrix) * position).y);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
  gl_PointSize = aSize * uPixel;
}`;
const STAR_FRAG = /* glsl */ `
varying float vAlpha;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = max(1.0 - smoothstep(0.1, 0.2, r), (1.0 - smoothstep(0.0, 0.5, r)) * 0.4);
  gl_FragColor = vec4(1.0, 0.97, 0.88, vAlpha * a);
  #include <colorspace_fragment>
}`;

function farMaterial(map: THREE.Texture | null, color: string, opacity: number) {
  return new THREE.ShaderMaterial({
    vertexShader: FAR_VERT,
    fragmentShader: FAR_FRAG,
    uniforms: { map: { value: map }, color: { value: new THREE.Color(color) }, opacity: { value: opacity }, textured: { value: !!map } },
    transparent: true,
    depthWrite: false,
  });
}

function canvas(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The moon close up: a soft halo, a cream disc darkening to the limb, grey seas, and craters lit from one side. */
function moonTexture() {
  return canvas(512, 512, (ctx) => {
    const c = 256;
    const R = 205; // the disc; the rest is halo
    let seed = 5;
    const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const halo = ctx.createRadialGradient(c, c, R * 0.9, c, c, 256);
    halo.addColorStop(0, 'rgba(190,205,255,0.25)');
    halo.addColorStop(1, 'rgba(190,205,255,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, 512, 512);
    const disc = ctx.createRadialGradient(c - 40, c - 40, 10, c, c, R);
    disc.addColorStop(0, '#fbf6e6');
    disc.addColorStop(0.8, '#e9e0c6');
    disc.addColorStop(1, '#c9bfa4');
    ctx.fillStyle = disc;
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.clip();
    // the seas (maria): the familiar dark patches, more or less where they are
    const seas: [number, number, number, number, number][] = [
      [-60, -70, 70, 50, 0.3],
      [10, -95, 55, 40, -0.2],
      [60, -40, 60, 45, 0.5],
      [-95, 10, 45, 75, 0.2],
      [-30, 25, 65, 45, -0.4],
      [40, 40, 40, 30, 0.1],
      [-120, -40, 35, 30, 0],
    ];
    ctx.fillStyle = 'rgba(150,143,125,0.55)';
    for (const [x, y, w, h, a] of seas) {
      ctx.beginPath();
      ctx.ellipse(c + x, c + y, w, h, a, 0, Math.PI * 2);
      ctx.fill();
    }
    // craters: a dark bowl with a bright rim on the sunny side
    for (let i = 0; i < 46; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * R * 0.92;
      const x = c + Math.cos(a) * d;
      const y = c + Math.sin(a) * d;
      const s = 3 + r() ** 2 * 18;
      ctx.fillStyle = 'rgba(120,112,96,0.45)';
      ctx.beginPath();
      ctx.arc(x, y, s, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,252,240,0.7)';
      ctx.lineWidth = Math.max(1, s * 0.22);
      ctx.beginPath();
      ctx.arc(x, y, s, Math.PI * 0.6, Math.PI * 1.6);
      ctx.stroke();
    }
    // Tycho, low down, with its bright rays
    ctx.strokeStyle = 'rgba(255,255,250,0.22)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + r() * 0.2;
      ctx.beginPath();
      ctx.moveTo(c - 25, c + 135);
      ctx.lineTo(c - 25 + Math.cos(a) * (80 + r() * 120), c + 135 + Math.sin(a) * (80 + r() * 120));
      ctx.stroke();
    }
    ctx.fillStyle = '#fffdf5';
    ctx.beginPath();
    ctx.arc(c - 25, c + 135, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

/** A constellation's name, soft white with a dark edge so it reads over the sky. */
function labelTexture(name: string) {
  return canvas(512, 96, (ctx) => {
    ctx.font = `600 44px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(8,12,40,0.85)';
    ctx.strokeText(name, 256, 48);
    ctx.fillStyle = '#d7e3ff';
    ctx.fillText(name, 256, 48);
  });
}

/** The night sky through the telescope: the moon and the named constellations. Follows the camera, like the sky. */
function TelescopeSky({ visible }: { visible: RefObject<boolean> }) {
  const group = useRef<THREE.Group>(null);
  const stars = useRef<THREE.Group>(null);
  const moon = useRef<THREE.Mesh>(null);
  const sky = useMemo(() => {
    const field = starField(STARS);
    const figures = skyFigures();
    const dir = (i: number) => new THREE.Vector3(field.positions[i * 3], field.positions[i * 3 + 1], field.positions[i * 3 + 2]);
    const lines = new THREE.BufferGeometry();
    lines.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        figures.flatMap((f) => f.lines.flatMap(([a, b]) => [...dir(a).multiplyScalar(SKY_R).toArray(), ...dir(b).multiplyScalar(SKY_R).toArray()])),
        3,
      ),
    );
    const labels = figures.map((f) => {
      const tex = labelTexture(f.name);
      // in the middle of the figure
      const at = new THREE.Vector3(...f.centre).multiplyScalar(SKY_R);
      return { name: f.name, at, tex, mat: farMaterial(tex, '#ffffff', 0.9) };
    });
    const axis = new THREE.Vector3(...starAxis());
    const inFigure = new Set(figures.flatMap((f) => f.stars));
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(Array.from(field.positions, (v) => v * SKY_R), 3));
    starGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(Array.from(field.sizes, (sz, i) => (inFigure.has(i) ? 6 + sz * 1.5 : sz * 2.6)), 1));
    return {
      figures,
      starGeo,
      starMat: new THREE.ShaderMaterial({ vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, uniforms: { uPixel: { value: 1 }, uOpacity: { value: 0 } }, transparent: true, depthWrite: false }),
      lines,
      lineMat: farMaterial(null, '#9fc3ff', 0.6),
      labels,
      labelGeo: new THREE.PlaneGeometry(3.6, 0.68),
      moonGeo: new THREE.PlaneGeometry(MOON, MOON),
      moonMat: farMaterial(moonTexture(), '#ffffff', 1),
      axis,
      q: new THREE.Quaternion(),
      back: new THREE.Quaternion(),
    };
  }, []);
  useEffect(
    () => () => {
      for (const d of [sky.lines, sky.lineMat, sky.starGeo, sky.starMat, sky.labelGeo, sky.moonGeo, sky.moonMat, sky.moonMat.uniforms.map.value as THREE.Texture]) d.dispose();
      for (const l of sky.labels) {
        l.tex.dispose();
        l.mat.dispose();
      }
    },
    [sky],
  );
  const labelRefs = useRef<(THREE.Mesh | null)[]>([]);

  useFrame(({ camera, gl }) => {
    const g = group.current;
    if (!g) return;
    const t = dayTime.t;
    const night = nightFactor(t);
    g.visible = visible.current && night > 0.3;
    if (!g.visible) return;
    g.position.copy(camera.position);
    // the stars wheel round as Sky.tsx turns them
    sky.q.setFromAxisAngle(sky.axis, skyTurn(t));
    stars.current?.quaternion.copy(sky.q);
    sky.back.copy(sky.q).invert();
    const fade = Math.min(1, (night - 0.3) / 0.4);
    sky.lineMat.uniforms.opacity.value = 0.6 * fade;
    sky.starMat.uniforms.uOpacity.value = fade;
    sky.starMat.uniforms.uPixel.value = gl.getPixelRatio();
    for (const [i, l] of sky.labels.entries()) {
      const mesh = labelRefs.current[i];
      if (!mesh) continue;
      l.mat.uniforms.opacity.value = 0.9 * fade;
      // facing the eye, upright: undo the sky's turn, then turn as the camera is
      mesh.quaternion.copy(sky.back).multiply(camera.quaternion);
    }
    const [mx, my, mz] = moonDirection(t);
    const mm = moon.current;
    if (mm) {
      mm.visible = my > -0.03;
      mm.position.set(mx * SKY_R, my * SKY_R, mz * SKY_R);
      mm.quaternion.copy(camera.quaternion);
      sky.moonMat.uniforms.opacity.value = fade;
    }
  });

  return (
    <group ref={group} visible={false}>
      <mesh ref={moon} geometry={sky.moonGeo} material={sky.moonMat} frustumCulled={false} renderOrder={1001} />
      <group ref={stars}>
        <points geometry={sky.starGeo} material={sky.starMat} frustumCulled={false} renderOrder={1001} />
        <lineSegments geometry={sky.lines} material={sky.lineMat} frustumCulled={false} renderOrder={1001} />
        {sky.labels.map((l, i) => (
          <mesh key={l.name} ref={(m) => void (labelRefs.current[i] = m)} position={l.at} geometry={sky.labelGeo} material={l.mat} frustumCulled={false} renderOrder={1002} />
        ))}
      </group>
    </group>
  );
}

export function Telescope() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const tube = useRef<THREE.Group>(null);
  const aim = useMemo(() => ({ ...START }), []);
  const looking = useRef(false);
  const ref = useInteractable<THREE.Group>({ id: 'telescope', label: 'Look through the telescope', action: { kind: 'roof', op: 'telescope' } }, 3);

  const look = () => {
    if (looking.current) return;
    setPerch({
      id: 'telescope',
      x: TELESCOPE.x,
      y: TELESCOPE.eye,
      z: TELESCOPE.z,
      tilt: 0,
      look: 0.9 / useRoof.getState().zoom,
      minPitch: -0.5,
      maxPitch: 1.45,
      exit: { x: TELESCOPE.x, z: TELESCOPE.z + 1.05 },
      yaw: aim.yaw,
      pitch: aim.pitch,
      onLeave: () => useRoof.setState({ telescope: false }),
    });
    useRoof.setState({ telescope: true, sitting: null });
  };
  const setZoom = (z: number) => {
    if (!Number.isFinite(z)) return;
    useRoof.setState({ zoom: Math.min(ZOOM.max, Math.max(ZOOM.min, Math.round(z / ZOOM.step) * ZOOM.step)) });
  };
  useRoofOp('telescope', look);
  useRoofOp('zoom', (arg) => setZoom(Number(arg)));
  useRoofReport('telescope', () => ({ yaw: Math.round((aim.yaw * 180) / Math.PI), pitch: Math.round((aim.pitch * 180) / Math.PI), fov: Math.round(camera.fov * 10) / 10 }));
  // Where to aim for the night sky's sights, now (for __swarmRoof.aim).
  useRoofReport('sky', () => {
    const t = dayTime.t;
    const moon = moonDirection(t);
    return {
      night: Math.round(nightFactor(t) * 100) / 100,
      moon: { ...aimAt(moon), up: moon[1] > 0 },
      constellations: skyFigures().map((f) => ({ name: f.name, stars: f.stars.length, ...aimAt(starAt(f.centre, t)) })),
    };
  });

  // The wheel zooms while you look: a notch (or a trackpad's worth) per half step.
  useEffect(() => {
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (!looking.current) return;
      acc -= e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      if (Math.abs(acc) < 80) return;
      setZoom(useRoof.getState().zoom + Math.sign(acc) * ZOOM.step);
      acc = 0;
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);

  // Stepping off the roof while looking: back on your feet, the view as it was.
  useEffect(
    () => () => {
      if (perch()?.id === 'telescope') leavePerch();
      camera.fov = FOV;
      camera.updateProjectionMatrix();
    },
    [camera],
  );

  useFrame((_, dt) => {
    const p = perch();
    const r = useRoof.getState();
    looking.current = r.telescope && p?.id === 'telescope';
    if (looking.current && p) {
      aim.yaw = p.yaw;
      aim.pitch = p.pitch;
      p.look = 0.9 / r.zoom; // finer aim the more it magnifies
    }
    const tb = tube.current;
    if (tb) {
      tb.rotation.set(aim.pitch, aim.yaw, 0, 'YXZ');
      tb.visible = !looking.current; // the eye is inside it
    }
    const want = looking.current ? FOV / r.zoom : FOV;
    if (camera.fov !== want) {
      camera.fov = Math.abs(want - camera.fov) < 0.05 ? want : camera.fov + (want - camera.fov) * (1 - Math.exp(-dt * 12));
      camera.updateProjectionMatrix();
    }
  });

  return (
    <group>
      <group ref={ref} position={[TELESCOPE.x, 0, TELESCOPE.z]}>
        {/* the tripod and its tray */}
        {[0, 1, 2].map((k) => {
          const a = (k / 3) * Math.PI * 2 + 0.3;
          return (
            <mesh key={k} position={[Math.cos(a) * 0.2, MOUNT_Y / 2 - 0.05, Math.sin(a) * 0.2]} rotation={[Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3]} material={toon('#6c757d')} castShadow>
              <cylinderGeometry args={[0.025, 0.03, MOUNT_Y + 0.05, 8]} />
            </mesh>
          );
        })}
        <mesh position={[0, 0.55, 0]} material={toon('#adb5bd')}>
          <cylinderGeometry args={[0.16, 0.16, 0.03, 12]} />
        </mesh>
        <mesh position={[0, MOUNT_Y - 0.06, 0]} material={toon('#343a40')} castShadow>
          <boxGeometry args={[0.14, 0.16, 0.14]} />
        </mesh>
        {/* the tube, turned to where it was last aimed */}
        <group ref={tube} position={[0, MOUNT_Y + 0.08, 0]}>
          <mesh position={[0, 0, -0.15]} rotation={[Math.PI / 2, 0, 0]} material={toon('#f8f9fa')} castShadow>
            <cylinderGeometry args={[0.085, 0.085, 1.0, 20]} />
            <Outlines thickness={0.012} color="#1f1d2b" />
          </mesh>
          <mesh position={[0, 0, -0.7]} rotation={[Math.PI / 2, 0, 0]} material={toon('#1d3557')} castShadow>
            <cylinderGeometry args={[0.105, 0.1, 0.22, 20]} />
            <Outlines thickness={0.012} color="#1f1d2b" />
          </mesh>
          <mesh position={[0, 0, 0.0]} rotation={[Math.PI / 2, 0, 0]} material={toon('#d4a373')}>
            <cylinderGeometry args={[0.09, 0.09, 0.05, 20]} />
          </mesh>
          <mesh position={[0, 0.06, 0.4]} rotation={[Math.PI / 2 - 0.6, 0, 0]} material={toon('#343a40')}>
            <cylinderGeometry args={[0.025, 0.03, 0.14, 10]} />
          </mesh>
          <mesh position={[0.08, 0.11, -0.05]} rotation={[Math.PI / 2, 0, 0]} material={toon('#d4a373')}>
            <cylinderGeometry args={[0.022, 0.022, 0.3, 10]} />
          </mesh>
        </group>
      </group>
      <TelescopeSky visible={looking} />
    </group>
  );
}
