import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Outlines } from '@react-three/drei';
import * as THREE from 'three';
import { gongState, hitGong, setGongHere } from './gongState';
import { flashLevel, swingAngle, twistAngle } from './gongRules';
import { malletHolder, pumpGongRuns, resetGongRuns } from './gongRunner';
import { useInteractable } from './interact';
import { GONG } from './layout';
import { toon } from './materials';
import { Ball, Box, Cyl } from './Toon';
import { onPoke } from './toys/poke';

// The merge gong on every office floor: a big bronze disc hanging in a wooden frame, with a padded mallet on a hook.
// A merge on this floor (store.ts) or E at the gong strikes it (gongState.ts); this draws the swing and the flash on the
// disc, read from gongState.ts each frame without allocating. A merge's confetti over the gong is MergeConfetti.tsx's.

const INK = '#1f1d2b';
const WOOD = '#a0522d';
const WOOD_DARK = '#7f3b1d';
const BRONZE = '#e0a53a';
const BRONZE_DARK = '#b5752a';
const BRONZE_LIGHT = '#f7d27a';

const { w, d, h, r, y } = GONG;
const POST = 0.14;
const POST_X = w / 2 - POST / 2;
const HANG_Y = h - 0.18; // the crossbar's underside, where the disc's ropes hang from
const DROP = HANG_Y - y; // pivot to the disc's centre

// Shared by every floor's gong (only one is drawn at a time), so nothing is made per strike.
const glowMat = new THREE.MeshBasicMaterial({ color: '#fff3b0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
const ringMat = glowMat.clone();
const discGeo = new THREE.CylinderGeometry(r, r, 0.07, 40);
const faceGeo = new THREE.CylinderGeometry(r * 0.86, r * 0.86, 0.09, 40);
const grooveGeo = new THREE.TorusGeometry(r * 0.55, 0.014, 6, 40);
const bossGeo = new THREE.SphereGeometry(r * 0.24, 20, 12);
const glowGeo = new THREE.CircleGeometry(r * 0.9, 40);
const ringGeo = new THREE.RingGeometry(0.88, 1, 48);

/** The disc, its ropes and the flash, on a pivot under the crossbar. */
function Disc() {
  const pivot = useRef<THREE.Group>(null);
  const glow = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const still = useRef(true);
  useFrame(() => {
    const p = pivot.current;
    if (!p || !glow.current || !ring.current) return;
    const t = (performance.now() - gongState.hitAt) / 1000;
    const level = flashLevel(t);
    if (level === 0) {
      if (still.current) return;
      still.current = true;
      p.rotation.set(0, 0, 0);
      glow.current.visible = ring.current.visible = false;
      return;
    }
    still.current = false;
    const twist = twistAngle(t);
    p.rotation.set(swingAngle(t), twist * 0.6, twist);
    glow.current.visible = true;
    glowMat.opacity = 0.7 * level;
    // one bright ring sweeping out across the face right after the hit
    const sweep = Math.min(1, t / 0.45);
    ring.current.visible = sweep < 1;
    ring.current.scale.setScalar(r * (0.25 + sweep * 0.8));
    ringMat.opacity = 0.9 * (1 - sweep);
  });
  return (
    <group ref={pivot} position={[0, HANG_Y, 0]}>
      {[-1, 1].map((s) => (
        <Cyl key={s} r={0.018} h={DROP - r * 0.92} position={[s * r * 0.3, -(DROP - r * 0.92) / 2, 0]} color="#e9d8a6" shadow={false} />
      ))}
      <group position={[0, -DROP, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <mesh geometry={discGeo} material={toon(BRONZE_DARK)} castShadow>
          <Outlines thickness={0.02} color={INK} />
        </mesh>
        <mesh geometry={faceGeo} material={toon(BRONZE)} />
      </group>
      <group position={[0, -DROP, 0.046]}>
        <mesh geometry={grooveGeo} material={toon(BRONZE_DARK)} />
        <mesh geometry={bossGeo} material={toon(BRONZE_LIGHT)} scale={[1, 1, 0.35]}>
          <Outlines thickness={0.012} color={INK} />
        </mesh>
        <mesh ref={glow} geometry={glowGeo} material={glowMat} position={[0, 0, 0.04]} visible={false} />
        <mesh ref={ring} geometry={ringGeo} material={ringMat} position={[0, 0, 0.05]} visible={false} />
      </group>
    </group>
  );
}

export function Gong({ repoId }: { repoId: string }) {
  const ref = useInteractable<THREE.Group>({ id: 'gong', label: 'Bang the gong', action: { kind: 'poke', toyId: 'gong' } }, 3.4);
  const mallet = useRef<THREE.Group>(null);
  useEffect(() => {
    setGongHere(repoId);
    const off = onPoke('gong', () => void hitGong());
    return () => {
      off();
      resetGongRuns();
      if (gongState.here === repoId) setGongHere(null);
    };
  }, [repoId]);
  // Moves anyone running to the gong along; the mallet leaves its hook while a runner has it.
  useFrame(() => {
    pumpGongRuns(performance.now());
    if (mallet.current) mallet.current.visible = malletHolder() === null;
  });

  return (
    <group ref={ref} position={[GONG.x, 0, GONG.z]}>
      {/* the frame: two posts on splayed feet, a crossbar with red-capped ends */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * POST_X, 0, 0]}>
          <Box size={[POST, h - 0.1, POST]} position={[0, (h - 0.1) / 2, 0]} color={WOOD} outline />
          <Box size={[0.24, 0.14, d]} position={[0, 0.07, 0]} color={WOOD_DARK} outline />
          <Box size={[0.2, 0.08, 0.2]} position={[0, 0.18, 0]} color={WOOD_DARK} shadow={false} />
        </group>
      ))}
      <Box size={[w + 0.2, 0.17, 0.2]} position={[0, h - 0.085, 0]} color={WOOD} outline />
      {[-1, 1].map((s) => (
        <Box key={s} size={[0.1, 0.21, 0.24]} position={[s * (w / 2 + 0.1), h - 0.085, 0]} color="#d62828" outline shadow={false} />
      ))}
      <Box size={[w - POST * 2, 0.08, 0.1]} position={[0, 0.42, 0]} color={WOOD_DARK} shadow={false} />
      <Disc />
      {/* the padded mallet, hanging on a hook on the right-hand post */}
      <group ref={mallet} position={[POST_X, 1.45, POST / 2 + 0.05]}>
        <Box size={[0.05, 0.05, 0.1]} position={[0, 0, -0.03]} color="#495057" shadow={false} />
        <Cyl r={0.025} h={0.72} position={[0, -0.36, 0.03]} color="#f1d19b" outline />
        <Ball r={0.13} position={[0, -0.78, 0.03]} color="#e76f51" outline />
        <Cyl r={0.135} h={0.05} position={[0, -0.78, 0.03]} color="#f4a261" shadow={false} />
      </group>
    </group>
  );
}
