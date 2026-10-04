import { describe, expect, it } from 'vitest';
import { screenStatus } from './screenReply.ts';

describe('screenStatus', () => {
  it('sends the screenshot when there is one', () => {
    expect(screenStatus({ data: Buffer.from('png'), mime: 'image/png' })).toBe(200);
  });

  it('answers 204 for a known agent without a screenshot right now', () => {
    expect(screenStatus(null)).toBe(204);
  });

  it('answers 404 only for an unknown agent', () => {
    expect(screenStatus(undefined)).toBe(404);
  });
});
