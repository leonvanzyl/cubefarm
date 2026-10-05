import { describe, expect, it } from 'vitest';
import {
  due,
  nextDue,
  note,
  NOTE_WINDOW_MS,
  noteText,
  ntfyPayload,
  ntfyTarget,
  offer,
  parseWebhook,
  plainText,
  redact,
  secretValues,
  STUCK_ERROR_MS,
  stuckAgents,
  summarize,
  webhookHint,
  type Gates,
  type Note,
} from './notify.ts';

const merge = (n: number) => note('merge', `Merged PR #${n}`, `pixel-todo: Change ${n}`, `pixel-todo #${n} Change ${n}`);

/** Offers every note at its time, then runs the summary timer up to `until`; returns what went out, with when. */
function run(notes: [number, Note][], until: number) {
  let gates: Gates = {};
  const sent: [number, Note][] = [];
  const tick = (t: number) => {
    const r = due(gates, t);
    gates = r.gates;
    for (const n of r.send) sent.push([t, n]);
  };
  for (const [t, n] of notes) {
    tick(t);
    const r = offer(gates, n, t);
    gates = r.gates;
    if (r.send) sent.push([t, r.send]);
  }
  for (let t = 0; t <= until; t += 1000) tick(t);
  return { sent, gates };
}

describe('the rate limit', () => {
  it('holds under a burst of 10 merges: one at once, one summary of the other 9 a minute later, nothing in between', () => {
    const burst: [number, Note][] = Array.from({ length: 10 }, (_, i) => [i * 100, merge(i + 1)]);
    const { sent } = run(burst, 5 * 60_000);
    expect(sent).toHaveLength(2);
    expect(sent[0][0]).toBe(0);
    expect(sent[0][1].title).toBe('🔀 Merged PR #1');
    expect(sent[1][0]).toBe(NOTE_WINDOW_MS);
    expect(sent[1][1].title).toBe('🔀 9 more merges');
    expect(sent[1][1].body.split('\n')).toEqual(['• pixel-todo #2 Change 2', '• pixel-todo #3 Change 3', '• pixel-todo #4 Change 4', '• pixel-todo #5 Change 5', '• pixel-todo #6 Change 6', '…and 4 more']);
  });

  it('never sends more than one per event type in any minute', () => {
    // A merge every 7 seconds for 10 minutes.
    const steady: [number, Note][] = Array.from({ length: 86 }, (_, i) => [i * 7000, merge(i + 1)]);
    const { sent } = run(steady, 12 * 60_000);
    const times = sent.map(([t]) => t);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(NOTE_WINDOW_MS);
    const covered = sent.reduce((n, [, s]) => n + (s.title.match(/(\d+) more/) ? Number(s.title.match(/(\d+) more/)![1]) : 1), 0);
    expect(covered).toBe(86); // nothing lost: every merge is in a notification or a summary
  });

  it('limits each event type on its own', () => {
    const { sent } = run(
      [
        [0, merge(1)],
        [10, note('needsHuman', 'PR #4 needs you', 'x')],
        [20, merge(2)],
        [30, note('ceoMessage', 'Morgan', 'Hi')],
      ],
      NOTE_WINDOW_MS,
    );
    expect(sent.map(([t, n]) => [t, n.title])).toEqual([
      [0, '🔀 Merged PR #1'],
      [10, '⚠️ PR #4 needs you'],
      [30, '💬 Morgan'],
      [NOTE_WINDOW_MS, '🔀 Merged PR #2'], // a single held note goes out as itself
    ]);
  });

  it('sends a quiet event straight away once its minute is over', () => {
    const { sent } = run(
      [
        [0, merge(1)],
        [NOTE_WINDOW_MS + 5, merge(2)],
      ],
      3 * NOTE_WINDOW_MS,
    );
    expect(sent.map(([t]) => t)).toEqual([0, NOTE_WINDOW_MS + 5]);
  });

  it('knows when the next summary is due', () => {
    let gates: Gates = {};
    expect(nextDue(gates)).toBeNull();
    gates = offer(gates, merge(1), 1000).gates;
    expect(nextDue(gates)).toBeNull();
    gates = offer(gates, merge(2), 2000).gates;
    expect(nextDue(gates)).toBe(1000 + NOTE_WINDOW_MS);
  });

  it('keeps counting what it had no room to keep', () => {
    let gates: Gates = offer({}, merge(0), 0).gates;
    for (let i = 1; i <= 80; i++) gates = offer(gates, merge(i), i).gates;
    const [s] = due(gates, NOTE_WINDOW_MS).send;
    expect(s.title).toBe('🔀 80 more merges');
    expect(s.body).toMatch(/…and 75 more$/);
  });
});

describe('what a note says', () => {
  const n = note('needsHuman', 'PR #12 needs you', 'pixel-todo: Add login. Stuck because it failed QA 3 times.');

  it('reads the same everywhere, short, with the link to the office when there is one', () => {
    expect(noteText(n)).toBe('⚠️ PR #12 needs you\npixel-todo: Add login. Stuck because it failed QA 3 times.');
    expect(noteText(n, 'https://office.example.ts.net/')).toBe('⚠️ PR #12 needs you\npixel-todo: Add login. Stuck because it failed QA 3 times.\nhttps://office.example.ts.net/');
    expect(note('merge', 'x', 'y'.repeat(1000)).body.length).toBeLessThanOrEqual(300);
  });

  it('fits ntfy', () => {
    expect(ntfyPayload(n, 'my-topic', 'https://o.example/')).toEqual({ topic: 'my-topic', title: n.title, message: n.body, priority: 4, click: 'https://o.example/' });
    expect(ntfyPayload(note('merge', 'm', 'b'), 't')).toEqual({ topic: 't', title: '🔀 m', message: 'b', priority: 3 });
  });

  it("turns a CEO's markdown into one plain line", () => {
    expect(plainText('## Update\n- **Ada** shipped [#12](https://github.com/x/y/pull/12)\n- `npm test` passes')).toBe('Update Ada shipped #12 npm test passes');
    expect(plainText('Both are *easy to get wrong* for _keyboard_ users; snake_case stays.')).toBe('Both are easy to get wrong for keyboard users; snake_case stays.');
  });

  it('summarises a burst, and leaves a single note alone', () => {
    const one = merge(1);
    expect(summarize([one])).toBe(one);
    expect(summarize([note('ceoMessage', 'Morgan', 'a', 'Morgan: a'), note('ceoMessage', 'Morgan', 'b', 'Morgan: b')])).toEqual({
      event: 'ceoMessage',
      title: '💬 2 more messages from the CEO',
      body: '• Morgan: a\n• Morgan: b',
      line: '2 more messages from the CEO',
    });
  });
});

describe('chat app settings', () => {
  it('takes real-looking topic URLs and refuses the rest', () => {
    expect(parseWebhook('ntfy', { url: ' https://ntfy.sh/my-office-a8f3/ ' })).toEqual({ url: 'https://ntfy.sh/my-office-a8f3' });
    expect(parseWebhook('ntfy', { url: 'http://ntfy.lan/office', token: 'tk_abcdefgh123' })).toEqual({ url: 'http://ntfy.lan/office', token: 'tk_abcdefgh123' });
    expect(() => parseWebhook('ntfy', { url: 'https://ntfy.sh/' })).toThrow(/topic URL/);
    expect(() => parseWebhook('ntfy', { url: 'ftp://ntfy.sh/office' })).toThrow(/ntfy topic URL/);
    expect(() => parseWebhook('ntfy', { url: 'not a url' })).toThrow(/ntfy topic URL/);
    expect(() => parseWebhook('ntfy', { url: 'https://ntfy.sh/office', token: 'no spaces allowed' })).toThrow(/access token/);
  });

  it('removes a chat app with an empty url or token', () => {
    expect(parseWebhook('ntfy', { url: '' })).toBeNull();
    expect(parseWebhook('ntfy', {})).toBeNull();
    expect(parseWebhook('ntfy', null)).toBeNull();
  });

  it('publishes to the ntfy server root with the topic in the body', () => {
    expect(ntfyTarget('https://ntfy.sh/my-office')).toEqual({ root: 'https://ntfy.sh/', topic: 'my-office' });
  });

  it('hints at a saved webhook without giving it away', () => {
    const secrets = { ntfy: { url: 'https://ntfy.sh/secret-topic-q7r8', token: 'tk_secret_token_1' } };
    expect(webhookHint('ntfy', secrets.ntfy)).toBe('ntfy.sh/…q7r8 · with a token');
    expect(webhookHint('ntfy', { url: 'https://ntfy.sh/secret-topic-q7r8' })).toBe('ntfy.sh/…q7r8');
    expect(webhookHint('ntfy', undefined)).toBe('');
    for (const v of secretValues(secrets)) expect(webhookHint('ntfy', secrets.ntfy)).not.toContain(v);
  });

  it('redacts secrets and URL paths from anything logged', () => {
    expect(redact('failed: token tk_abc123 posted to https://ntfy.sh/secret-topic', ['tk_abc123'])).toBe('failed: token •••• posted to https://ntfy.sh/••••');
  });
});

describe('stuck agents', () => {
  const now = 1_000_000_000;
  const agent = (id: string, status: string, endedAt: number | null) => ({ id, status, endedAt });

  it('finds agents in an error for 10 minutes, once per error', () => {
    const agents = [agent('a', 'error', now - STUCK_ERROR_MS), agent('b', 'error', now - STUCK_ERROR_MS + 1), agent('c', 'idle', now - 3_600_000), agent('d', 'error', null)];
    expect(stuckAgents(agents, now, new Set()).map((s) => s.key)).toEqual([`a:${now - STUCK_ERROR_MS}`]);
    expect(stuckAgents(agents, now, new Set([`a:${now - STUCK_ERROR_MS}`]))).toEqual([]);
    // A new error (a later endedAt) is a new key.
    expect(stuckAgents([agent('a', 'error', now - STUCK_ERROR_MS - 5)], now + 5, new Set([`a:${now - STUCK_ERROR_MS}`]))).toHaveLength(1);
  });
});
