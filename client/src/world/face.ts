// Faces: which expression someone's state calls for, their blinks, and the morph weights that ease from one
// expression to the next. Character.tsx writes the weights into the face: eyes, brows and mouth are one mesh of
// shared geometry with morph targets (characterParts.ts). Pure and allocation-free when stepped: no three.js.

import type { AgentStatus, PullInfo, QaStatus } from '../../../shared/types';
import { hash01 } from './typing';

export const EXPRESSIONS = ['neutral', 'focused', 'puzzled', 'stressed', 'proud', 'joyful', 'sleepy', 'surprised'] as const;
export type Expression = (typeof EXPRESSIONS)[number];

/** Each face part's morph targets, in the order characterParts.ts builds them. */
export const EYES = { closed: 0, wide: 1, happy: 2 } as const;
export const BROWS = { frown: 0, worry: 1, raise: 2, quirk: 3, droop: 4 } as const;
export const MOUTH = { frown: 0, flat: 1, grin: 2, open: 3, wavy: 4, skew: 5 } as const;
const count = (part: object) => Object.keys(part).length;
/** Where each part's targets start among the face's, the eyes' first; MORPHS in all. */
export const MORPH_AT = { eyes: 0, brows: count(EYES), mouth: count(EYES) + count(BROWS) } as const;
export const MORPHS = MORPH_AT.mouth + count(MOUTH);

type Part<K extends Record<string, number>> = Partial<Record<keyof K, number>>;
/** A face's MORPHS weights, as the face mesh takes them. */
export type FaceWeights = readonly number[];

function place<K extends Record<string, number>>(out: number[], at: number, names: K, w: Part<K>) {
  for (const k in w) out[at + names[k]] = w[k] ?? 0;
}
function face(eyes: Part<typeof EYES>, brows: Part<typeof BROWS>, mouth: Part<typeof MOUTH>): FaceWeights {
  const out = new Array<number>(MORPHS).fill(0);
  place(out, MORPH_AT.eyes, EYES, eyes);
  place(out, MORPH_AT.brows, BROWS, brows);
  place(out, MORPH_AT.mouth, MOUTH, mouth);
  return out;
}

/** Each expression as morph weights. The neutral face is the base shape: open eyes, level brows, a small smile. */
export const FACES: Record<Expression, FaceWeights> = {
  neutral: face({}, {}, {}),
  focused: face({ closed: 0.2 }, { frown: 0.7 }, { flat: 0.85 }),
  puzzled: face({ wide: 0.15 }, { quirk: 1 }, { skew: 1 }),
  stressed: face({ wide: 0.35 }, { worry: 1 }, { wavy: 0.85, frown: 0.15 }),
  proud: face({ happy: 0.6 }, { raise: 0.3 }, { grin: 0.35 }),
  joyful: face({ happy: 1 }, { raise: 0.6 }, { grin: 1 }),
  sleepy: face({ closed: 0.6 }, { droop: 1 }, { flat: 0.55, open: 0.25 }),
  surprised: face({ wide: 1 }, { raise: 1 }, { open: 1 }),
};

// ---------- which expression ----------

/** How an agent feels about their own open PR. */
export type PrFace = 'stressed' | 'puzzled' | 'proud';
/** The QA round from which a PR that keeps coming back stresses its author. */
export const STRESS_ROUND = 4;
/** Sat idle at the desk this long (seconds) and they look drowsy; they nod off a little later (fidgets.ts DOZE_AFTER). */
export const DROWSY_AFTER = 45;
/** Or this long (seconds) since their last task ended, wherever their errands take them. */
export const LONG_IDLE = 180;

/** Drowsy: sat idle `seatedIdle` seconds, or `sinceTask` seconds without a task (0 while they have one). */
export const isDrowsy = (seatedIdle: number, sinceTask: number) => seatedIdle >= DROWSY_AFTER || sinceTask >= LONG_IDLE;
/** How long (seconds) the author of a merged PR stays proud of it once the cheering is over. */
export const PROUD_FOR = 90;

/**
 * QA gave up on it or it's on its STRESS_ROUND-th round (stressed), its checks are red or QA failed it (puzzled),
 * QA passed it (proud), else nothing to show.
 */
export function prFace(checks: PullInfo['checks'] | null, qa: { status: QaStatus; round: number } | null | undefined): PrFace | null {
  if (qa && (qa.status === 'needs-human' || (qa.round >= STRESS_ROUND && qa.status !== 'passed'))) return 'stressed';
  if (checks === 'failing' || qa?.status === 'failed') return 'puzzled';
  if (qa?.status === 'passed') return 'proud';
  return null;
}

type Pull = Pick<PullInfo, 'number' | 'state' | 'checks'>;

/**
 * An agent's own open PR as their face shows it; `qa` is QA's record of that PR, if any. The PR an agent is testing
 * isn't theirs, and the CEO has none.
 */
export function prFaceOf(
  agent: { role: string; task: string | null; repoId: string; prNumber: number | null },
  repos: readonly { id: string; pulls: readonly Pull[] }[],
  qa: { status: QaStatus; round: number } | null | undefined,
): PrFace | null {
  if (agent.role === 'ceo' || agent.task === 'qa' || agent.prNumber == null) return null;
  const pr = repos.find((r) => r.id === agent.repoId)?.pulls.find((p) => p.number === agent.prNumber);
  if (pr && pr.state !== 'OPEN') return null;
  return prFace(pr?.checks ?? null, qa);
}

export interface FaceInputs {
  status: AgentStatus;
  /** Hit by a toy a moment ago (useHitReaction.tsx). */
  hit: boolean;
  /** Cheering a merge: their floor's party, or their own PR just done. */
  cheering: boolean;
  /** Nodded off at the desk (the Zzz). */
  asleep: boolean;
  /** Idle a long time (isDrowsy). */
  drowsy: boolean;
  pr: PrFace | null;
  /** Their PR merged within PROUD_FOR seconds. */
  justMerged: boolean;
}

/** The expression for someone's state, strongest first. */
export function expressionFor(i: FaceInputs): Expression {
  if (i.hit) return 'surprised';
  if (i.cheering) return 'joyful';
  if (i.asleep) return 'sleepy';
  if (i.status === 'error' || i.pr === 'stressed') return 'stressed';
  if (i.pr === 'puzzled') return 'puzzled';
  if (i.justMerged || i.pr === 'proud') return 'proud';
  if (i.drowsy) return 'sleepy';
  if (i.status === 'working' || i.status === 'preparing') return 'focused';
  return 'neutral';
}

// ---------- blinking and blending ----------

/** A blink every BLINK.slot seconds or so, at a different moment in each slot (now and then a double one). */
export const BLINK = { slot: 4, half: 0.075 };

/** How far closed the eyelids are at time t (seconds) for a blink, 0 to 1. `seed` keeps neighbours apart. */
export function blink(t: number, seed: number) {
  const k = Math.floor(t / BLINK.slot);
  const h = hash01(k * 7919 + seed);
  const at = k * BLINK.slot + 0.3 + h * (BLINK.slot - 0.9);
  let d = Math.abs(t - at);
  if (h > 0.8) d = Math.min(d, Math.abs(t - at - 0.32));
  return d < BLINK.half ? 1 - d / BLINK.half : 0;
}

/** Seconds for a new expression to (all but 5% of the way) replace the last one. */
export const BLEND_S = 0.2;
const RATE = 3 / BLEND_S; // e^-3 ≈ 5% left after BLEND_S

export interface FaceState {
  expression: Expression;
  w: Float32Array;
}

export const newFace = (expression: Expression = 'neutral'): FaceState => ({ expression, w: Float32Array.from(FACES[expression]) });

/** Eases the weights `dt` seconds toward expression `e`. Mutates and returns `s`. */
export function stepFace(s: FaceState, e: Expression, dt: number): FaceState {
  s.expression = e;
  const k = 1 - Math.exp(-Math.max(0, dt) * RATE);
  const to = FACES[e];
  for (let i = 0; i < MORPHS; i++) s.w[i] += (to[i] - s.w[i]) * k;
  return s;
}
