import { useLayoutEffect, type RefObject } from 'react';
import * as THREE from 'three';
import type { AgentLook, AgentRole } from '../../../shared/types';
import { ACCENTS, BUILD_SHAPE, type Appearance } from './appearance';
import { PARTS } from './characterParts';
import { EYES, MORPHS, MORPH_AT, type FaceState } from './face';
import { Piece } from './Batched';
import { mix, shade } from './materials';

// What a person wears and their face, drawn the same by Character.tsx (at their desk, walking about) and by the look
// editor's preview (LookPreview.tsx): the clothes, uniforms and badges on the torso, and the head's parts. Shared
// geometry (characterParts.ts) as Pieces, which a floor draws in instanced batches (Batched.tsx); applyFace writes an
// expression into the face's morph targets.

export const INK = '#1f1d2b';
// Glasses frames, picked by the same accent index as hats and stripes.
const FRAMES = ['#1f1d2b', '#7f5539', '#1f1d2b', '#c1121f', '#355070', '#1f1d2b'];
const WHITE = '#f8f9fa';
const GOLD = '#ffd166';
const SUIT = '#2b2d42';
const COAT_TRIM = '#dee2e6';
const LAPEL = '#1d1f30';

type Who = { role: AgentRole; color: string; look: AgentLook };

/** The shirt (or coat, or suit) colour: QA testers wear a white lab coat, the CEO a navy suit. */
export const shirtColor = (agent: Who) => (agent.role === 'qa' ? WHITE : agent.role === 'ceo' ? SUIT : agent.color);

/** How wide the torso is drawn (the arms hang from its edges). */
export const torsoWidth = (look: Appearance) => BUILD_SHAPE[look.build].width * look.shoulders;

/** Headphones on the head while working; resting round the neck otherwise, and always for audio people. */
const phonesOn = (look: Appearance, busy: boolean) => look.headphones && busy;
const phonesAtNeck = (look: Appearance, busy: boolean) => !phonesOn(look, busy) && (look.headphones || look.accessory === 'neckphones');

function Headphones({ agent }: { agent: Who }) {
  return (
    <>
      <Piece geometry={PARTS.headphones.shell} color={SUIT} castShadow />
      <Piece geometry={PARTS.headphones.covers} color={shade(agent.color, 0.12)} />
    </>
  );
}

/** Torso-space (origin on the seat, facing -Z): the shirt and everything worn over it, scaled for their build. */
export function TorsoWear({ agent, look, busy }: { agent: Who; look: Appearance; busy: boolean }) {
  const isQa = agent.role === 'qa';
  const isCeo = agent.role === 'ceo';
  const shirt = shirtColor(agent);
  const outfit = PARTS.outfit[look.outfit];
  const accent = ACCENTS[look.accent];
  const shape = BUILD_SHAPE[look.build];
  return (
    <group scale={[torsoWidth(look), 1, shape.depth]}>
      <Piece position={[0, 0.3, 0]} geometry={PARTS.torso} color={shirt} castShadow outline={0.015} />
      {look.outfit !== 'sweater' && look.outfit !== 'turtleneck' && (
        <Piece position={[0, 0.5, -0.02]} rotation={[Math.PI / 2, 0, 0]} geometry={PARTS.collar} color={isCeo ? WHITE : shade(agent.color, -0.15)} />
      )}
      {outfit.main && <Piece geometry={outfit.main} color={shade(agent.color, -0.08)} castShadow />}
      {outfit.trim && <Piece geometry={outfit.trim} color={look.outfit === 'stripe' ? accent : look.outfit === 'hoodie' || look.outfit === 'cardigan' ? WHITE : shade(agent.color, -0.14)} />}
      {isCeo && (
        <>
          {/* white shirt front, tie and knot under the blazer; the lanyard over them */}
          <Piece position={[0, 0.36, -0.192]} geometry={PARTS.shirtFront} color={WHITE} />
          <Piece position={[0, 0.33, -0.206]} geometry={PARTS.tie} color={agent.color} />
          <Piece position={[0, 0.445, -0.206]} geometry={PARTS.tieKnot} color={shade(agent.color, -0.2)} />
          <Piece geometry={PARTS.blazer.lapels} color={LAPEL} />
          <Piece geometry={PARTS.blazer.button} color={GOLD} />
          <Piece geometry={PARTS.blazer.square} color={agent.color} />
          <Piece geometry={PARTS.lanyard.strap} color={shade(agent.color, -0.2)} />
          <Piece geometry={PARTS.lanyard.card} color={WHITE} />
        </>
      )}
      {isQa && (
        <>
          {/* the lab coat: tails, pockets and lapels, open over a shirt in their colour, and a magnifier badge */}
          <Piece geometry={PARTS.labCoat} color={shirt} castShadow outline={0.012} />
          <Piece geometry={PARTS.labCoatLapels} color={COAT_TRIM} />
          <Piece position={[0, 0.27, -0.196]} geometry={PARTS.coatOpening} color={agent.color} />
          <Piece geometry={PARTS.magnifierBadge} color={GOLD} />
          <Piece geometry={PARTS.magnifier} color={INK} />
        </>
      )}
      {(look.accessory === 'wrench' || look.accessory === 'padlock') && (
        <>
          <Piece geometry={PARTS.leftBadge} color={look.accessory === 'wrench' ? ACCENTS[3] : ACCENTS[4]} />
          <Piece geometry={look.accessory === 'wrench' ? PARTS.wrench : PARTS.padlock} color={look.accessory === 'wrench' ? INK : WHITE} />
        </>
      )}
      {phonesAtNeck(look, busy) && (
        // resting around the neck
        <group position={[0, 0.49, -0.09]} rotation={[Math.PI / 2 - 0.5, 0, 0]} scale={0.74}>
          <Headphones agent={agent} />
        </group>
      )}
    </group>
  );
}

/** One arm, pointing along -Z from the shoulder: the sleeve and the hand. */
export function Sleeve({ agent, look }: { agent: Who; look: Appearance }) {
  return (
    <>
      <Piece position={[0, 0, -0.24]} rotation={[Math.PI / 2, 0, 0]} geometry={PARTS.sleeve} color={shirtColor(agent)} castShadow outline={0.012} />
      <Piece position={[0, 0, -0.5]} geometry={PARTS.hand} color={look.skin} castShadow />
    </>
  );
}

/** Writes a face's weights into its mesh, the eyelids closed at least `lid` of the way (a blink, or asleep). */
export function applyFace(face: RefObject<THREE.Mesh | null>, f: FaceState, lid: number) {
  const w = face.current?.morphTargetInfluences;
  if (!w) return;
  for (let i = 0; i < MORPHS; i++) w[i] = f.w[i];
  // a closing lid takes over from wide or happy eyes, so the eyes' weights never add up past 1
  for (let i = MORPH_AT.eyes; i < MORPH_AT.brows; i++) w[i] *= 1 - lid;
  w[MORPH_AT.eyes + EYES.closed] += lid;
}

const CLIPPED_HAIR = ['long', 'ponytail', 'bun', 'sidePart', 'curls', 'bob'];

/** Head-space (origin at the middle of the head, facing -Z): the head, hair, face, glasses, hats and headphones. */
export function HeadParts({ agent, look, busy, face }: { agent: Who; look: Appearance; busy: boolean; face: RefObject<THREE.Mesh | null> }) {
  const isQa = agent.role === 'qa';
  const feminine = agent.look === 'feminine';
  const skin = look.skin;
  const hair = look.hair === 'buzz' ? mix(look.hairColor, look.skin, 0.35) : look.hairColor;
  const hairGeo = PARTS.hair[look.hair];
  const facialGeo = PARTS.facialHair[look.facialHair];
  const glassesGeo = PARTS.glasses[look.glasses];
  const hatGeo = PARTS.headwear[look.headwear];
  const outlinedHair = look.hair !== 'buzz' && look.hair !== 'bald';
  const clip = feminine && look.headwear === 'none' && CLIPPED_HAIR.includes(look.hair);
  const faceGeo = feminine ? PARTS.faceLashes : PARTS.face;
  // R3F sets the geometry after making the mesh, so the morph weights are set up here, once per geometry.
  useLayoutEffect(() => face.current?.updateMorphTargets(), [face, faceGeo]);
  return (
    <>
      <Piece geometry={PARTS.head} color={skin} castShadow outline={0.015} />
      {hairGeo && <Piece geometry={hairGeo} color={hair} castShadow={outlinedHair} outline={outlinedHair ? 0.012 : 0} />}
      <Piece geometry={PARTS.ears} color={skin} />
      <Piece ref={face} geometry={faceGeo} color={INK} />
      <Piece position={[0, -0.02, -0.2]} geometry={PARTS.nose} color={shade(look.skin, -0.08)} />
      {facialGeo && <Piece geometry={facialGeo} color={look.facialHair === 'stubble' ? mix(look.skin, look.hairColor, 0.3) : look.hairColor} />}
      {feminine && <Piece geometry={PARTS.cheeks} color="#ff9aa2" />}
      {clip && <Piece position={[0.15, 0.13, -0.08]} rotation={[0, 0, 0.5]} geometry={PARTS.hairClip} color={isQa ? '#ff9f68' : shade(agent.color, 0.15)} />}
      {/* QA's round inspector glasses stay part of the uniform */}
      {isQa && <Piece geometry={PARTS.inspectorGlasses} color={INK} />}
      {glassesGeo && <Piece geometry={glassesGeo} color={FRAMES[look.accent]} />}
      {hatGeo && <Piece geometry={hatGeo} color={look.accent === 0 ? shade(agent.color, -0.2) : ACCENTS[look.accent]} castShadow outline={0.012} />}
      {look.accessory === 'pencil' && !look.headphones && (
        <>
          <Piece geometry={PARTS.pencil.body} color={GOLD} />
          <Piece geometry={PARTS.pencil.tip} color="#f1d19b" />
        </>
      )}
      {phonesOn(look, busy) && <Headphones agent={agent} />}
    </>
  );
}
