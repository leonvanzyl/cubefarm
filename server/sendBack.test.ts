import { describe, expect, it } from 'vitest';
import { HttpError } from './httpError.ts';
import { MAX_SEND_BACK_NOTE, parseSendBackNote, sendBackPatch, type SendBackRecord } from './sendBack.ts';

const open = { state: 'OPEN', mergeable: 'MERGEABLE', mergeState: 'CLEAN' } as const;
const record = (r: Partial<SendBackRecord> = {}): SendBackRecord => ({ status: 'needs-human', fixInstructions: 'Make the toolbar wrap below 480px.', retests: 1, ...r });

const status = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof HttpError ? err.status : 'not an HttpError';
  }
  return 'no error';
};

describe('sendBackPatch', () => {
  it('turns a needs-human PR into a failed one with QA’s instructions plus the note, and one more QA round', () => {
    expect(sendBackPatch(108, open, record(), '  merge main and keep both e2e tests ')).toEqual({
      status: 'failed',
      fixReason: 'qa',
      fixInstructions: 'Make the toolbar wrap below 480px.\n\nFrom the manager: merge main and keep both e2e tests',
      sessionFailures: 0,
      retests: 2,
      mergeNote: null,
    });
  });

  it('keeps the instructions as they are without a note, and uses the note alone when QA left none', () => {
    expect(sendBackPatch(108, open, record()).fixInstructions).toBe('Make the toolbar wrap below 480px.');
    expect(sendBackPatch(108, open, record(), '   ').fixInstructions).toBe('Make the toolbar wrap below 480px.');
    expect(sendBackPatch(108, open, record({ fixInstructions: null }), 'Rebase it').fixInstructions).toBe('From the manager: Rebase it');
    expect(sendBackPatch(108, open, record({ fixInstructions: null })).fixInstructions).toBeNull();
  });

  it('also takes a PR that failed QA and is waiting for a developer', () => {
    expect(sendBackPatch(108, open, record({ status: 'failed' }), 'Check the README too').status).toBe('failed');
  });

  it('says conflict when the PR conflicts now, and qa otherwise', () => {
    expect(sendBackPatch(108, { ...open, mergeable: 'CONFLICTING' }, record()).fixReason).toBe('conflict');
    expect(sendBackPatch(108, { ...open, mergeState: 'DIRTY' }, record()).fixReason).toBe('conflict');
    expect(sendBackPatch(108, { ...open, mergeable: 'UNKNOWN', mergeState: 'UNKNOWN' }, record()).fixReason).toBe('qa');
  });

  it('is a 404 for an unknown or closed PR', () => {
    expect(status(() => sendBackPatch(108, undefined, record()))).toBe(404);
    expect(status(() => sendBackPatch(108, { ...open, state: 'CLOSED' }, record()))).toBe(404);
    expect(status(() => sendBackPatch(108, { ...open, state: 'MERGED' }, record()))).toBe(404);
  });

  it('is a 409 while the PR is being tested or fixed, or when nobody is waiting on it', () => {
    for (const s of ['testing', 'fixing', 'queued', 'passed'] as const) expect(status(() => sendBackPatch(108, open, record({ status: s })))).toBe(409);
    expect(status(() => sendBackPatch(108, open, undefined))).toBe(409);
  });
});

describe('parseSendBackNote', () => {
  it('reads an optional one-line note', () => {
    expect(parseSendBackNote({ note: ' keep both tests ' })).toBe('keep both tests');
    expect(parseSendBackNote({ note: '' })).toBeUndefined();
    expect(parseSendBackNote({})).toBeUndefined();
    expect(parseSendBackNote(undefined)).toBeUndefined();
  });

  it('refuses a note that is too long or not text', () => {
    expect(parseSendBackNote({ note: 'x'.repeat(MAX_SEND_BACK_NOTE) })).toHaveLength(MAX_SEND_BACK_NOTE);
    expect(status(() => parseSendBackNote({ note: 'x'.repeat(MAX_SEND_BACK_NOTE + 1) }))).toBe(400);
    expect(status(() => parseSendBackNote({ note: 42 }))).toBe(400);
  });
});
