import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { BUBBLE, SIGN_SIZE } from './activitySign';
import { SANS, wrap } from './draw';
import { saying } from './people';
import { drawBubble } from './useHitReaction';

// A speech bubble over someone's head (people.ts `say`): a big emoji in a chat, or a short line about their work
// (Chatter.tsx) in one or two lines of text, the bubble as wide as the words. Farther away it grows a little so the
// words stay readable, but its top never passes BUBBLE_TOP, so the activity sign over a busy head (ActivityIcon.tsx)
// still stacks clear above it. Each text's texture is drawn once and shared, the least recently shown dropped past a few dozen; the
// bubble is hidden, and costs nothing, while they say nothing.

const PX_PER_M = 512; // canvas pixels per metre: the emoji bubble's 256 × 176 is 0.5 × 0.344 m
const H = 176;
const PAD = 8;
const TAIL = 34;
const TIP = 28; // the tail's tip, from the canvas's left edge: the group's origin, beside the head
const INK = '#1f1d2b';
const KEEP = 40;
/** The highest a bubble's top may reach (m): the bottom of an activity sign moved up out of a bubble's way. */
export const BUBBLE_TOP = BUBBLE.clear - SIGN_SIZE.h / 2;
/** The bubble's top above its tail's tip (m), at scale 1. */
const RISE = 0.156 + H / PX_PER_M / 2;
/** From this far away (m) a bubble grows with distance, as far as BUBBLE_TOP allows. */
const GROW_FROM = 4.5;
const at = new THREE.Vector3();
let measure: CanvasRenderingContext2D | null = null;

interface BubbleTex {
  tex: THREE.CanvasTexture;
  /** The plane's width (m). */
  w: number;
}

const textures = new Map<string, BubbleTex>();

/** An emoji or two and no words: the big emoji bubble. */
const isEmoji = (text: string) => !/[\p{L}\p{N}]/u.test(text) && [...text].length <= 3;

/** The lines a text fills, and the font size: one big line if it fits, else two of about the same width. */
function layout(ctx: CanvasRenderingContext2D, text: string): { lines: string[]; size: number } {
  ctx.font = `600 60px ${SANS}`;
  if (ctx.measureText(text).width <= 560) return { lines: [text], size: 60 };
  const words = text.split(/\s+/).join(' ');
  for (const size of [48, 42]) {
    ctx.font = `600 ${size}px ${SANS}`;
    const half = ctx.measureText(text).width / 2;
    // as narrow as two lines allow, so they come out about the same width
    for (let w = Math.max(160, half + 24); w <= 600; w += 24) {
      const lines = wrap(ctx, text, w, 2);
      if (lines.join(' ') === words) return { lines, size };
    }
  }
  return { lines: wrap(ctx, text, 600, 2), size: 42 };
}

/** A bubble with words in it: white, inked, the tail down and to the left at the head. */
function drawLine(text: string): HTMLCanvasElement {
  measure ??= document.createElement('canvas').getContext('2d')!;
  const m = measure;
  const { lines, size } = layout(m, text);
  m.font = `600 ${size}px ${SANS}`;
  const textW = Math.max(...lines.map((l) => m.measureText(l).width));
  const w = Math.ceil(Math.max(200, textW + 2 * PAD + 56) / 8) * 8;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const bottom = H - PAD - TAIL;
  ctx.lineWidth = 8;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(PAD, PAD, w - PAD * 2, bottom - PAD, 40);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(62, bottom - 6);
  ctx.lineTo(TIP, H - PAD);
  ctx.lineTo(104, bottom - 6);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(62, bottom);
  ctx.lineTo(TIP, H - PAD);
  ctx.lineTo(104, bottom);
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.font = `600 ${size}px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const mid = (PAD + bottom) / 2 + 3;
  const lh = size * 1.08;
  lines.forEach((l, i) => ctx.fillText(l, w / 2, mid + (i - (lines.length - 1) / 2) * lh));
  return canvas;
}

function bubbleTexture(text: string): BubbleTex {
  let b = textures.get(text);
  if (b) {
    textures.delete(text); // most recently shown last
    textures.set(text, b);
    return b;
  }
  let canvas: HTMLCanvasElement;
  if (isEmoji(text)) {
    canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = H;
    drawBubble(canvas.getContext('2d')!, 256, H, text);
  } else canvas = drawLine(text);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  b = { tex, w: canvas.width / PX_PER_M };
  textures.set(text, b);
  if (textures.size > KEEP) {
    const [oldest, old] = textures.entries().next().value!;
    textures.delete(oldest);
    old.tex.dispose();
  }
  return b;
}

/** `y` is head height while standing (the bubble sits just above the name tag, seated or not). */
export function SpeechBubble({ id, y }: { id: string; y: number }) {
  const camera = useThree((s) => s.camera);
  const g = useRef<THREE.Group>(null);
  const plane = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    const s = saying(id);
    const grp = g.current;
    if (!grp || !mat.current || !plane.current) return;
    grp.visible = !!s;
    if (!s) return;
    const b = bubbleTexture(s.text);
    if (mat.current.map !== b.tex) {
      mat.current.map = b.tex;
      mat.current.needsUpdate = true;
      // The bubble grows to the right of the tail, which stays by the head.
      plane.current.scale.set(b.w, H / PX_PER_M, 1);
      plane.current.position.set(b.w / 2 - TIP / PX_PER_M, 0.156, 0);
    }
    // pop in with a little overshoot, and shrink away at the end of a timed line
    const now = performance.now();
    const ms = now - s.at;
    const left = s.until !== undefined ? s.until - now : Infinity;
    const pop = ms < 90 ? 0.3 + (ms / 90) * 0.9 : ms < 170 ? 1.2 - ((ms - 90) / 80) * 0.2 : left < 150 ? Math.max(0.01, left / 150) : 1;
    grp.getWorldPosition(at);
    const grow = Math.min(Math.max(1, (BUBBLE_TOP - at.y) / RISE), Math.max(1, at.distanceTo(camera.position) / GROW_FROM));
    grp.scale.setScalar(pop * grow);
  });
  return (
    // The group's origin is the tail's tip, beside the head.
    <Billboard position={[0.2, y, 0]}>
      <group ref={g} visible={false}>
        <mesh ref={plane} position={[0.195, 0.156, 0]} scale={[0.5, H / PX_PER_M, 1]} renderOrder={2}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial ref={mat} transparent toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
    </Billboard>
  );
}
