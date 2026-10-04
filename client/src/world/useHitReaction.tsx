import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { boop } from '../ui/sfx';
import { SANS } from './draw';
import { useCanvasTexture } from './interact';
import { REACTION, flinch, onAgentHit, reactionWeight, registerTarget, turnToward } from './toys/hits';

// A seated character hit by a toy (toys/hits.ts): a flinch, a look at the player and a "hey!" bubble, laid over
// whatever pose their status gives them, so they ease straight back into it. Visual only: no store, no server.

export interface HitPose {
  /** How much of the reaction shows, 0 to 1: blend the head towards headYaw/headPitch by this much. */
  w: number;
  /** The flinch jolt, 0 to 1. */
  flinch: number;
  /** Head angles (radians, in the torso's frame) that look at the player, and the upper-body twist that helps. */
  headYaw: number;
  headPitch: number;
  twist: number;
}

const HEAD_Y = 1.16; // roughly where the head is above the floor, for looking up at the player
const INK = '#1f1d2b';

export function drawBubble(ctx: CanvasRenderingContext2D, w: number, h: number, text: string) {
  const pad = 8;
  const tail = 34;
  const bottom = h - pad - tail;
  ctx.lineWidth = 8;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(pad, pad, w - pad * 2, bottom - pad, 40);
  ctx.fill();
  ctx.stroke();
  // the tail points down and left, at the head
  ctx.beginPath();
  ctx.moveTo(62, bottom - 6);
  ctx.lineTo(28, h - pad);
  ctx.lineTo(104, bottom - 6);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(62, bottom);
  ctx.lineTo(28, h - pad);
  ctx.lineTo(104, bottom);
  ctx.stroke();
  ctx.fillStyle = '#e63946';
  ctx.font = `700 ${text.length > 2 ? 84 : 100}px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, (pad + bottom) / 2 + 4);
}

/** The speech bubble beside the head: pops in, and shrinks away at the end of the reaction. */
function Bubble({ text, since }: { text: string; since: number }) {
  const g = useRef<THREE.Group>(null);
  const tex = useCanvasTexture(256, 176, (ctx) => drawBubble(ctx, 256, 176, text), [text]);
  useFrame(() => {
    if (!g.current) return;
    const ms = performance.now() - since;
    const end = REACTION.ms - ms;
    const s = ms < 90 ? 0.3 + (ms / 90) * 0.9 : ms < 170 ? 1.2 - ((ms - 90) / 80) * 0.2 : end < 150 ? Math.max(0.01, end / 150) : 1;
    g.current.scale.setScalar(s);
  });
  return (
    // The group's origin is the tail's tip, beside the head, so the bubble pops out of it.
    <Billboard position={[0.18, 1.45, 0]}>
      <group ref={g} scale={0.3}>
        <mesh position={[0.195, 0.156, 0]} renderOrder={2}>
          <planeGeometry args={[0.5, 0.344]} />
          <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
    </Billboard>
  );
}

/**
 * Makes the character whose root group (origin under the chair, facing -Z) is `root` a target for toys, and
 * returns `pose(now)`, this frame's reaction to lay over the status pose, and the bubble to render in the root.
 */
export function useHitReaction(id: string, root: RefObject<THREE.Object3D | null>) {
  const camera = useThree((s) => s.camera);
  const at = useRef(-Infinity);
  const [bubble, setBubble] = useState<{ text: string; since: number } | null>(null);
  const out = useMemo<HitPose>(() => ({ w: 0, flinch: 0, headYaw: 0, headPitch: 0, twist: 0 }), []);
  const local = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const obj = root.current;
    return obj ? registerTarget(id, obj) : undefined;
  }, [id, root]);

  useEffect(
    () =>
      onAgentHit(id, () => {
        const now = performance.now();
        at.current = now;
        const p = root.current?.getWorldPosition(new THREE.Vector3());
        boop(p && { x: p.x, y: p.y + HEAD_Y, z: p.z });
        setBubble({ text: Math.random() < 0.65 ? 'hey!' : '!', since: now });
      }),
    [id, root],
  );

  useEffect(() => {
    if (!bubble) return;
    const t = setTimeout(() => setBubble(null), REACTION.ms);
    return () => clearTimeout(t);
  }, [bubble]);

  const pose = (now: number): HitPose => {
    const ms = now - at.current;
    out.w = reactionWeight(ms);
    out.flinch = flinch(ms);
    const obj = root.current;
    if (out.w === 0 || !obj) {
      out.w = out.flinch = out.headYaw = out.headPitch = out.twist = 0;
      return out;
    }
    obj.worldToLocal(local.copy(camera.position));
    const turn = turnToward(local.x, local.z);
    out.headYaw = turn.head;
    out.twist = turn.twist;
    out.headPitch = Math.min(0.45, Math.max(-0.3, Math.atan2(local.y - HEAD_Y, Math.hypot(local.x, local.z))));
    return out;
  };

  return { pose, bubble: bubble && <Bubble key={bubble.since} text={bubble.text} since={bubble.since} /> };
}
