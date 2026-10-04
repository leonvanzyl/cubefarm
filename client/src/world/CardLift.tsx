// The sticky under the crosshair lifts a little off the whiteboard: a copy of it, drawn as the board draws it, a few
// centimetres out and a touch bigger. Its texture is drawn once per card aimed at; each frame only eases it out.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore, type KanbanColumns } from '../store';
import { drawLiftedNote, kanbanNoteRect } from './draw';
import { boardPose, findCard, type Pose } from './stickies';
import { BOARD_TEX } from './whiteboard';
import { statusLook, useA11y } from '../ui/a11y';

const NOTE = kanbanNoteRect(0, 0, BOARD_TEX.w); // every note is this size on the board's canvas
const PAD = 10; // board pixels around it, for the shadow
const SCALE = 2;
const LIFT = { z: 0.06, grow: 0.08, rate: 14 };

export function CardLift({ repoId, cols }: { repoId: string; cols: KanbanColumns }) {
  const aimed = useStore((s) => (s.focus?.action.kind === 'card' && s.focus.action.repoId === repoId ? s.focus.action.key : null));
  const spot = aimed ? findCard(cols, aimed) : null;
  const mesh = useRef<THREE.Mesh>(null);
  const lift = useRef(0);
  const { tex, pose } = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = (NOTE.w + PAD * 2) * SCALE;
    canvas.height = (NOTE.h + PAD * 2) * SCALE;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const pose: Pose = { x: 0, y: -10, z: 0, yaw: 0, pitch: 0, roll: 0, w: 0, h: 0 };
    return { tex, pose };
  }, []);
  useEffect(() => () => tex.dispose(), [tex]);

  const card = spot?.card;
  const col = spot?.col;
  const index = spot?.index ?? -1;
  const prefs = useA11y((s) => s.prefs);
  useEffect(() => {
    if (!card || !col) return;
    drawLiftedNote((tex.image as HTMLCanvasElement).getContext('2d')!, card, col, NOTE.w, NOTE.h, PAD, SCALE, statusLook(prefs));
    tex.needsUpdate = true;
    boardPose(col, index, card.number, pose);
    lift.current = 0;
  }, [card, col, index, tex, pose, prefs]);

  useFrame((_, dt) => {
    const m = mesh.current;
    if (!m) return;
    const on = !!card;
    lift.current += ((on ? 1 : 0) - lift.current) * Math.min(1, dt * LIFT.rate);
    m.visible = on && lift.current > 0.02;
    if (!m.visible) return;
    const k = lift.current;
    const s = 1 + LIFT.grow * k;
    m.position.set(pose.x, pose.y + 0.01 * k, pose.z - 0.011 + LIFT.z * k); // pose.z is 0.015 off the board's face
    m.scale.set(pose.w * ((NOTE.w + PAD * 2) / NOTE.w) * s, pose.h * ((NOTE.h + PAD * 2) / NOTE.h) * s, 1);
  });

  return (
    <mesh ref={mesh} visible={false} renderOrder={1}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} />
    </mesh>
  );
}
