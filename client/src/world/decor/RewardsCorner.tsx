// The lobby's rewards corner (#210): the catalogue kiosk, where floors spend their coins on decorations, and the
// trophy shelf, where every achievement the office unlocks stands as a little gold cup. E on a cup says what it was for.
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ACHIEVEMENTS, type AchievementView } from '../../../../shared/progress';
import { useStore } from '../../store';
import { useKeyName } from '../../ui/controls';
import { roundRect, SANS } from '../draw';
import { useCanvasTexture, useInteractable } from '../interact';
import { KIOSK, TROPHY_SHELF } from '../layout';
import * as M from './models';
import { box, cyl, model, torus, vertexToon, type Part } from './parts';

// ---------- the kiosk ----------

export function Kiosk() {
  const coins = useStore((s) => Object.values(s.progress.floors).reduce((n, f) => n + f.coins, 0));
  const floors = useStore((s) => s.repos.length);
  const use = useKeyName('interact');
  const ref = useInteractable<THREE.Group>({ id: 'kiosk', label: 'Browse the decoration catalogue', action: { kind: 'catalogue' } }, 3.5);
  const tex = useCanvasTexture(
    512,
    360,
    (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 360);
      g.addColorStop(0, '#3a0ca3');
      g.addColorStop(1, '#7209b7');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 512, 360);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd166';
      ctx.font = `700 52px ${SANS}`;
      ctx.fillText('🛍️ Catalogue', 256, 64);
      ctx.fillStyle = '#ffffff';
      ctx.font = `600 34px ${SANS}`;
      ctx.fillText('Decorate your floors', 256, 132);
      roundRect(ctx, 96, 176, 320, 70, 35);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fill();
      ctx.fillStyle = '#ffe066';
      ctx.font = `700 40px ${SANS}`;
      ctx.fillText(`🪙 ${coins}`, 256, 212);
      ctx.fillStyle = '#c9c9ee';
      ctx.font = `500 26px ${SANS}`;
      ctx.fillText(floors ? `across ${floors} floor${floors === 1 ? '' : 's'} · press ${use}` : 'merges earn coins', 256, 300);
    },
    [coins, floors, use],
  );
  return (
    <group ref={ref} position={[KIOSK.x, 0, KIOSK.z]}>
      <mesh geometry={M.kioskModel()} material={vertexToon} castShadow receiveShadow />
      <mesh position={[0, 1.3, 0.106]} rotation={[-0.2, 0, 0]}>
        <planeGeometry args={[0.8, 0.56]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ---------- the trophy shelf ----------

const COLS = 5;
const ROWS_Y = [1.66, 1.06, 0.46]; // shelf boards' tops, top shelf first
const S = TROPHY_SHELF;

/** Where trophy `i` (its achievement's place in ACHIEVEMENTS) stands on the shelf, in the shelf's frame. */
const trophySpot = (i: number) => ({ x: -S.w / 2 + 0.24 + (i % COLS) * ((S.w - 0.48) / (COLS - 1)), y: ROWS_Y[Math.floor(i / COLS)], z: 0.02 });

const shelfModel = () =>
  model('trophy-shelf', () => {
    const wood = '#8d5a3b';
    const parts: Part[] = [
      box(0.06, S.h, S.d, wood, [-S.w / 2 + 0.03, S.h / 2, 0]),
      box(0.06, S.h, S.d, wood, [S.w / 2 - 0.03, S.h / 2, 0]),
      box(S.w, S.h, 0.04, '#d4b48c', [0, S.h / 2, -S.d / 2 + 0.02]), // a light back, so the gold stands out
      box(S.w, 0.06, S.d, wood, [0, S.h - 0.03, 0]),
      box(S.w, 0.12, S.d, '#6f4530', [0, 0.06, 0]),
    ];
    for (const y of ROWS_Y) parts.push(box(S.w - 0.1, 0.04, S.d - 0.04, '#b08968', [0, y - 0.02, 0.02]));
    return parts;
  });

const cupModel = () =>
  model('trophy-cup', () => [
    box(0.12, 0.05, 0.12, '#2b2d42', [0, 0.025, 0]),
    cyl(0.02, 0.03, 0.08, '#e9c46a', [0, 0.09, 0]),
    cyl(0.085, 0.04, 0.13, '#ffd43b', [0, 0.195, 0]),
    torus(0.04, 0.008, '#ffd43b', [-0.085, 0.2, 0], [0, Math.PI / 2, 0]),
    torus(0.04, 0.008, '#ffd43b', [0.085, 0.2, 0], [0, Math.PI / 2, 0]),
  ]);

/** The plaque strip on a shelf's lip: the icon and name of each trophy that's been won there. */
function Plaques({ row, won }: { row: number; won: Map<string, AchievementView> }) {
  const defs = ACHIEVEMENTS.slice(row * COLS, row * COLS + COLS);
  const key = defs.map((d) => (won.has(d.id) ? d.id : '')).join(',');
  const tex = useCanvasTexture(
    1024,
    64,
    (ctx) => {
      ctx.fillStyle = '#e9d8a6';
      ctx.fillRect(0, 0, 1024, 64);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      defs.forEach((d, c) => {
        const x = ((0.24 + c * ((S.w - 0.48) / (COLS - 1))) / S.w) * 1024;
        ctx.fillStyle = won.has(d.id) ? '#5c3d2e' : 'rgba(92,61,46,0.35)';
        ctx.font = `700 22px ${SANS}`;
        ctx.fillText(won.has(d.id) ? `${d.icon} ${d.name}` : '🔒 ???', x, 33);
      });
    },
    [key],
  );
  return (
    <mesh position={[0, ROWS_Y[row] - 0.05, S.d / 2 + 0.002]}>
      <planeGeometry args={[S.w - 0.1, 0.0625]} />
      <meshToonMaterial map={tex} />
    </mesh>
  );
}

const Trophy = memo(function Trophy({ a, i }: { a: AchievementView; i: number }) {
  const def = ACHIEVEMENTS[i];
  const p = trophySpot(i);
  const ref = useInteractable<THREE.Group>({ id: `trophy:${a.id}`, label: `${def.icon} ${def.name}: what it was for, and when`, action: { kind: 'trophy', id: a.id } }, 3.5);
  return (
    <group ref={ref} position={[p.x, p.y + 0.14, p.z]}>
      <mesh visible={false}>
        <boxGeometry args={[0.3, 0.32, 0.3]} />
      </mesh>
    </group>
  );
});

export function TrophyShelf() {
  const achievements = useStore((s) => s.progress.achievements);
  const won = useMemo(() => new Map(achievements.map((a) => [a.id, a])), [achievements]);
  const cups = useRef<THREE.InstancedMesh>(null);
  const spots = useMemo(() => ACHIEVEMENTS.map((d, i) => (won.has(d.id) ? i : -1)).filter((i) => i >= 0), [won]);
  useLayoutEffect(() => {
    const m = cups.current;
    if (!m) return;
    const o = new THREE.Object3D();
    spots.forEach((i, k) => {
      const p = trophySpot(i);
      o.position.set(p.x, p.y, p.z);
      o.rotation.set(0, (i % 3) * 0.3 - 0.3, 0);
      o.updateMatrix();
      m.setMatrixAt(k, o.matrix);
    });
    m.count = spots.length;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [spots]);
  const sign = useCanvasTexture(
    768,
    128,
    (ctx) => {
      roundRect(ctx, 0, 0, 768, 128, 26);
      ctx.fillStyle = '#ffd166';
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#5c3d2e';
      ctx.font = `700 58px ${SANS}`;
      ctx.fillText(`🏆 Trophies · ${won.size}/${ACHIEVEMENTS.length}`, 384, 68);
    },
    [won.size],
  );
  return (
    // against the south wall, facing into the lobby
    <group position={[S.x, 0, S.z]} rotation={[0, Math.PI, 0]}>
      <mesh geometry={shelfModel()} material={vertexToon} castShadow receiveShadow />
      <instancedMesh key={Math.max(1, spots.length)} ref={cups} args={[cupModel(), vertexToon, Math.max(1, spots.length)]} />
      {ROWS_Y.map((_, row) => (
        <Plaques key={row} row={row} won={won} />
      ))}
      {spots.map((i) => (
        <Trophy key={ACHIEVEMENTS[i].id} a={won.get(ACHIEVEMENTS[i].id)!} i={i} />
      ))}
      <mesh position={[0, S.h + 0.38, -S.d / 2 + 0.05]}>
        <planeGeometry args={[1.9, 0.32]} />
        <meshBasicMaterial map={sign} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}
