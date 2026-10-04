import { z } from 'zod';
import type { PullInfo, QaView } from '../shared/types.ts';
import { HttpError } from './httpError.ts';
import { conflictFixInstructions } from './qaOutcome.ts';

// The manager's "send back to the developer" on a PR that needs a human (or failed QA): QA's findings are already
// clear, so a developer fixes it straight away, with the manager's note, instead of spending another QA round first.

/** A note for the developer longer than this is refused. */
export const MAX_SEND_BACK_NOTE = 1000;

const body = z.object({ note: z.string().max(MAX_SEND_BACK_NOTE).optional() });

/** The optional note from a request body; blank means none. Throws HttpError(400) for anything else. */
export function parseSendBackNote(input: unknown): string | undefined {
  const parsed = body.safeParse(input ?? {});
  if (!parsed.success) throw new HttpError(400, `note must be text of at most ${MAX_SEND_BACK_NOTE} characters`);
  return parsed.data.note?.trim() || undefined;
}

/** The parts of a QA record a send-back reads. */
export interface SendBackRecord {
  status: QaView['status'];
  fixInstructions: string | null;
  retests: number;
  passedSha: string | null;
}

export interface SendBackPatch {
  status: 'failed';
  fixReason: 'qa' | 'conflict';
  fixInstructions: string | null;
  sessionFailures: number;
  retests: number;
  mergeNote: null;
}

/**
 * What sending PR #n back to a developer does to its QA record. Throws HttpError: 404 for an unknown or closed PR,
 * 409 while it is being tested or fixed, or when it isn't waiting on anyone. The scheduler hands a failed record to
 * its author, or any free developer. The extra QA round is counted as a retest, so the round numbers stay honest.
 * A conflicting PR QA never passed goes out as a QA fix, so its instructions add the merge with base.
 */
export function sendBackPatch(
  prNumber: number,
  pr: Pick<PullInfo, 'state' | 'mergeable' | 'mergeState'> | undefined,
  rec: SendBackRecord | undefined,
  base: string,
  note?: string,
  from = 'the manager', // who wrote the note
): SendBackPatch {
  if (!pr || pr.state !== 'OPEN') throw new HttpError(404, `PR #${prNumber} is not open`);
  if (rec?.status === 'testing' || rec?.status === 'fixing') throw new HttpError(409, `PR #${prNumber} is already ${rec.status}`);
  if (!rec || (rec.status !== 'needs-human' && rec.status !== 'failed')) {
    throw new HttpError(409, `PR #${prNumber} isn't waiting on you: only a PR that failed QA or needs a human can go back to a developer`);
  }
  const conflict = pr.mergeable === 'CONFLICTING' || pr.mergeState === 'DIRTY';
  const findings = [rec.fixInstructions?.trim(), note?.trim() && `From ${from}: ${note.trim()}`].filter(Boolean).join('\n\n');
  const addMerge = conflict && !rec.passedSha && !findings.includes(`conflicts with ${base}`);
  const fixInstructions = (addMerge ? conflictFixInstructions(findings, base) : findings) || null;
  return { status: 'failed', fixReason: conflict ? 'conflict' : 'qa', fixInstructions, sessionFailures: 0, retests: rec.retests + 1, mergeNote: null };
}
