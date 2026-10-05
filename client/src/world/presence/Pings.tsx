import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../../store';
import { tone } from '../../ui/sfx';
import { SANS, roundRect } from '../draw';
import { useCanvasTexture } from '../interact';
import { activePings, ping, presenceVersion, subscribePresence, type Ping } from './presenceState';
import { pingNoun } from './presenceMath';

// Pings: "look here". Middle-click (or the ping key, X) drops a short-lived marker where you aim, on a spot or a
// thing; everyone on the floor sees it through walls, with who dropped it and what it is ("look here: the whiteboard").

const LIFE_MS = 5000;
const noRaycast = () => undefined;

let caster: ((ndc: THREE.Vector2 | null) => THREE.Vector3 | null) | null = null;

/** Visible all the way up: hidden things (a toy's spare, someone on another floor) can't be pinged. */
function shown(o: THREE.Object3D | null) {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/**
 * Pings where you aim: the crosshair (`ndc` null), or a spot on the screen (-1 to 1) when the mouse is free. Says
 * what's there from the crosshair's target. False when there's nothing to ping (the sky, a panel in the way).
 */
export function pingHere(ndc: THREE.Vector2 | null = null): boolean {
  const s = useStore.getState();
  if (!s.started || s.overlay || s.travel || !caster) return false;
  const at = caster(ndc);
  if (!at) return false;
  const noun = ndc ? '' : pingNoun(s.focus, (id) => s.agents[id]?.name);
  ping(Math.round(at.x * 100) / 100, Math.round(at.y * 100) / 100, Math.round(at.z * 100) / 100, noun);
  return true;
}

/** The pings on this floor, and the raycaster pingHere uses. */
export function Pings() {
  useSyncExternalStore(subscribePresence, presenceVersion);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  useEffect(() => {
    const center = new THREE.Vector2(0, 0);
    caster = (ndc) => {
      ray.setFromCamera(ndc ?? center, camera);
      ray.far = 30;
      for (const h of ray.intersectObjects(scene.children, true)) {
        const o = h.object as THREE.Mesh;
        if (!o.isMesh || !shown(o)) continue;
        const mat = o.material as THREE.Material | THREE.Material[];
        if (!Array.isArray(mat) && mat.transparent && !mat.depthWrite) continue; // glows, tags, bubbles
        return h.point.clone();
      }
      // nothing in reach: the floor ahead, if you look down at it
      const { origin, direction } = ray.ray;
      if (direction.y > -0.05) return null;
      const t = -origin.y / direction.y;
      return t <= 30 ? origin.clone().addScaledVector(direction, t) : null;
    };
    return () => {
      caster = null;
    };
  }, [camera, scene, ray]);
  return (
    <>
      {activePings().map((p) => (
        <PingMarker key={p.key} ping={p} />
      ))}
    </>
  );
}

function drawLabel(ctx: CanvasRenderingContext2D, w: number, h: number, p: Ping) {
  ctx.clearRect(0, 0, w, h);
  const text = p.label ? `look here: ${p.label}` : 'look here';
  ctx.font = `700 34px ${SANS}`;
  const nameW = Math.min(w - 40, ctx.measureText(p.name).width + 40);
  ctx.font = `600 38px ${SANS}`;
  const textW = Math.min(w - 8, ctx.measureText(text).width + 44);
  // who, on a chip of their colour, over what
  roundRect(ctx, (w - nameW) / 2, 4, nameW, 46, 23);
  ctx.fillStyle = p.color;
  ctx.fill();
  roundRect(ctx, (w - textW) / 2, 56, textW, 64, 32);
  ctx.fillStyle = 'rgba(20,22,34,0.86)';
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 34px ${SANS}`;
  ctx.fillText(p.name, w / 2, 28, w - 60);
  ctx.font = `600 38px ${SANS}`;
  ctx.fillText(text, w / 2, 89, w - 40);
}

function PingMarker({ ping: p }: { ping: Ping }) {
  const camera = useThree((s) => s.camera);
  const tex = useCanvasTexture(640, 128, (ctx) => drawLabel(ctx, 640, 128, p), [p.key]);
  const pin = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const mats = useMemo(
    () => ({
      pin: new THREE.MeshBasicMaterial({ color: p.color, depthTest: false, transparent: true, toneMapped: false }),
      ring: new THREE.MeshBasicMaterial({ color: p.color, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
      label: new THREE.MeshBasicMaterial({ map: tex, depthTest: false, transparent: true, toneMapped: false }),
    }),
    [p.color, tex],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  useEffect(() => {
    // a bright two-note blip from the spot
    const pos = { x: p.x, y: p.y, z: p.z };
    tone({ name: 'visitor:ping', group: 'alerts', pos, freq: 988, type: 'triangle', dur: 0.16, peak: 0.1 });
    tone({ name: 'visitor:ping', group: 'alerts', pos, freq: 1480, type: 'triangle', at: 0.1, dur: 0.22, peak: 0.08 });
  }, [p]);
  useFrame(() => {
    const age = performance.now() - p.at;
    const fade = Math.min(1, Math.max(0, (LIFE_MS - age) / 600));
    const pop = Math.min(1, age / 160);
    if (pin.current) {
      // about the same size on screen near or far, so a ping across the floor still catches the eye
      const far = Math.min(3, Math.max(1, camera.position.distanceTo(pin.current.position) / 6));
      pin.current.position.y = p.y + 0.42 * far + Math.sin(age / 180) * 0.05 * far;
      pin.current.scale.setScalar((0.4 + pop * 0.6) * far);
    }
    if (ring.current) {
      const k = (age % 1200) / 1200;
      ring.current.scale.setScalar(0.3 + k * 1.1);
      mats.ring.opacity = (1 - k) * 0.7 * fade;
    }
    mats.pin.opacity = fade;
    mats.label.opacity = fade;
  });
  return (
    <group>
      <group ref={pin} position={[p.x, p.y + 0.42, p.z]}>
        <mesh material={mats.pin} renderOrder={20} raycast={noRaycast} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.1, 0.26, 16]} />
        </mesh>
        <mesh material={mats.pin} renderOrder={20} raycast={noRaycast} position={[0, 0.17, 0]}>
          <sphereGeometry args={[0.1, 16, 12]} />
        </mesh>
        <Billboard position={[0, 0.62, 0]}>
          <mesh material={mats.label} renderOrder={21} raycast={noRaycast}>
            <planeGeometry args={[1.5, 0.3]} />
          </mesh>
        </Billboard>
      </group>
      <mesh ref={ring} material={mats.ring} position={[p.x, p.y + 0.02, p.z]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast}>
        <ringGeometry args={[0.32, 0.4, 32]} />
      </mesh>
    </group>
  );
}
