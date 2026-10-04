// The lamps at night: a warm halo spreads over the ceiling round every ceiling lamp as dusk falls, and the balcony
// bulbs switch on with halos of their own. Shared materials that DayLights turns up (no lamp updates itself) and one
// instanced mesh per set of lamps, hidden by day.
import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';

/** The halos' brightest (additive) at full night. */
const HALO = 0.5;

function haloTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  // a bright core with a clear edge, then a faint outer ring: a cartoon glow rather than a soft blur
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.8)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(0.8, 'rgba(255,255,255,0.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const lampHalo = new THREE.MeshBasicMaterial({
  map: haloTexture(),
  color: '#ffcf85',
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
  fog: false,
  visible: false,
});

// Facing down, just under the ceiling (and above the lamp's own panel, which hides the middle).
const haloGeometry = {
  ceiling: new THREE.PlaneGeometry(3.2, 2).rotateX(Math.PI / 2),
  bulb: new THREE.PlaneGeometry(1.5, 1.5).rotateX(Math.PI / 2),
};

const BULB_OFF = new THREE.Color('#d6d0c2');
const BULB_ON = new THREE.Color('#fffbe8');
/** The balcony lamps' bulbs: a dull diffuser by day, lit at night. */
export const balconyBulb = new THREE.MeshBasicMaterial({ color: BULB_OFF, toneMapped: false });

let lampLevel = 0;

/** How far the lamps are on, 0..1 (the roof's string lights follow it). */
export const lampsOn = () => lampLevel;

/** How far the lamps are on, 0..1: called by DayLights when the time of day moves. */
export function setLamps(level: number) {
  lampLevel = level;
  lampHalo.opacity = level * HALO;
  lampHalo.visible = level > 0.01;
  balconyBulb.color.lerpColors(BULB_OFF, BULB_ON, level);
}

/** The halos round the lamps at `positions` (the lamps' centres): one draw call, none by day. */
export function LampHalos({ positions, size = 'ceiling' }: { positions: [number, number, number][]; size?: keyof typeof haloGeometry }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    positions.forEach(([x, y, z], i) => m.setMatrixAt(i, mat.makeTranslation(x, y + 0.02, z)));
    m.instanceMatrix.needsUpdate = true;
  }, [positions]);
  return <instancedMesh ref={ref} args={[haloGeometry[size], lampHalo, positions.length]} frustumCulled={false} />;
}
