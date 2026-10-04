import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { DEFAULT_NOTIFY, notifySettings } from '../shared/notify.ts';
import type { NoteView, NotifySettings } from '../shared/types.ts';
import { createDemoBackend } from './demo.ts';
import { Notifier, type NotifyRequest } from './notifier.ts';
import { Swarm } from './swarm.ts';

const SECRETS = {
  discord: { url: 'https://discord.com/api/webhooks/999/discordSECRET4242' },
  slack: { url: 'https://hooks.slack.com/services/T1/B1/slackSECRET4242' },
  telegram: { token: '987654:telegramSECRETtoken4242abc', chatId: '424242' },
  ntfy: { url: 'https://ntfy.sh/ntfySECRETtopic4242', token: 'tk_ntfySECRET4242' },
};
const SECRET_STRINGS = ['discordSECRET4242', 'slackSECRET4242', 'telegramSECRETtoken4242abc', 'ntfySECRETtopic4242', 'tk_ntfySECRET4242', 'pushSECRETendpoint4242'];

/** A browser's push subscription, with a real P-256 key so the office can encrypt for it. */
function subscription(endpoint = 'https://push.example.net/push/pushSECRETendpoint4242') {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  return { endpoint, keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
}

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-notify-'));
const settle = () => new Promise((r) => setTimeout(r, 30));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('notification secrets', () => {
  it('never reach the snapshot, a broadcast, an API answer or the log', async () => {
    const out: string[] = [];
    for (const m of ['log', 'warn', 'error', 'info'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void out.push(a.map(String).join(' ')));
    const swarm = new Swarm(createDemoBackend());
    const sent: string[] = [];
    swarm.addClient({ OPEN: 1, readyState: 1, send: (m: string) => sent.push(m), on: () => undefined } as unknown as WebSocket);
    await swarm.notifier.init();

    const answers: unknown[] = [];
    for (const [c, body] of Object.entries(SECRETS)) answers.push(await swarm.notifier.setWebhook(c, body));
    answers.push(await swarm.notifier.pushKey());
    answers.push(await swarm.notifier.subscribe(subscription()));
    swarm.updateSettings({ notify: { ...DEFAULT_NOTIFY, events: { ...DEFAULT_NOTIFY.events, merge: true }, officeUrl: 'https://office.example.ts.net/' } });

    out.length = 0;
    swarm.notifier.notify('needsHuman', 'PR #4 needs you', 'pixel-todo: Add login.');
    for (const c of ['desktop', 'push', 'discord', 'slack', 'telegram', 'ntfy']) answers.push(await swarm.notifier.test(c));
    await settle();

    // The demo shows what each channel would get: one formatted line per chat app and device for the PR.
    const pr = out.filter((l) => l.includes('⚠️ PR #4 needs you'));
    expect(pr.map((l) => l.match(/demo (\w+)/)?.[1]).sort()).toEqual(['discord', 'ntfy', 'push', 'slack', 'telegram']);
    expect(pr[0]).toContain('pixel-todo: Add login. ⏎ https://office.example.ts.net/');
    expect(sent.filter((m) => JSON.parse(m).type === 'notify').map((m) => (JSON.parse(m).note as NoteView).title)).toEqual(['⚠️ PR #4 needs you', '🔔 Test from cubefarm']);

    const snap = swarm.snapshot();
    expect(snap.notifyChannels.webhooks.discord).toEqual({ set: true, hint: 'discord.com/…4242' });
    expect(snap.notifyChannels.pushDevices).toBe(1);
    const vapid = JSON.parse(fs.readFileSync(path.join(process.env.SWARM_HOME!, 'demo-push.json'), 'utf8')).vapid.privateKey as string;
    const everything = [JSON.stringify(snap), ...sent, ...out, JSON.stringify(answers)].join('\n');
    for (const s of [...SECRET_STRINGS, vapid]) expect(everything).not.toContain(s);
  });

  it('say why a test failed without the address', async () => {
    const out: string[] = [];
    for (const m of ['log', 'warn'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void out.push(a.map(String).join(' ')));
    const swarm = new Swarm(createDemoBackend());
    await swarm.notifier.setWebhook('discord', { url: 'https://discord.com/api/webhooks/1/badSECRETtoken77' });
    await expect(swarm.notifier.test('discord')).rejects.toThrow("The test didn't arrive: Discord doesn't know that webhook (HTTP 404).");
    expect(out.join('\n')).not.toContain('badSECRETtoken77');
  });

  it('keep the ElevenLabs key in the same file', async () => {
    const dir = tmpDir();
    const secretsFile = path.join(dir, 'secrets.json');
    fs.writeFileSync(secretsFile, JSON.stringify({ elevenlabsKey: 'sk_keep_me' }));
    const n = notifier(dir, () => 200).n;
    await n.init();
    await n.setWebhook('slack', SECRETS.slack);
    expect(JSON.parse(fs.readFileSync(secretsFile, 'utf8'))).toEqual({ elevenlabsKey: 'sk_keep_me', notify: { slack: SECRETS.slack } });
    await n.setWebhook('slack', { url: '' });
    expect(JSON.parse(fs.readFileSync(secretsFile, 'utf8'))).toEqual({ elevenlabsKey: 'sk_keep_me', notify: {} });
  });

  it('are never handled by the browser code', () => {
    // The client gets hints over REST and the websocket; nothing under client/ may read the server's secrets files or import its code.
    const root = path.resolve(import.meta.dirname, '..', 'client');
    const files = (fs.readdirSync(root, { recursive: true }) as string[]).filter((f) => /\.(tsx?|js|html|json|webmanifest)$/.test(f));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const text = fs.readFileSync(path.join(root, f), 'utf8');
      expect(text, f).not.toMatch(/secrets\.json|push\.json|from '(\.\.\/)+server\//);
    }
  });
});

function notifier(dir: string, status: (req: NotifyRequest) => number, settings: NotifySettings = notifySettings(DEFAULT_NOTIFY, { events: { merge: true } })) {
  const posts: NotifyRequest[] = [];
  const notes: NoteView[] = [];
  const n = new Notifier({
    transport: { post: async (req) => (posts.push(req), status(req)) },
    secretsFile: path.join(dir, 'secrets.json'),
    pushFile: path.join(dir, 'push.json'),
    settings: () => settings,
    broadcast: (note) => notes.push(note),
    channelsChanged: () => undefined,
    log: () => undefined,
  });
  return { n, posts, notes };
}

describe('the notifier', () => {
  it('sends a burst of 10 merges as one notification now and one summary a minute later, on every channel', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 4, 12) });
    const { n, posts, notes } = notifier(tmpDir(), () => 200);
    await n.init();
    await n.setWebhook('discord', SECRETS.discord);
    await n.setWebhook('telegram', SECRETS.telegram);
    for (let i = 1; i <= 10; i++) n.notify('merge', `Merged PR #${i}`, `pixel-todo: Change ${i}`, `#${i} Change ${i}`);
    await vi.advanceTimersByTimeAsync(10);
    expect(posts.map((p) => p.channel)).toEqual(['discord', 'telegram']);
    expect(posts[1].url).toBe(`https://api.telegram.org/bot${SECRETS.telegram.token}/sendMessage`);
    expect(JSON.parse(String(posts[1].body))).toMatchObject({ chat_id: '424242', text: '🔀 Merged PR #1\npixel-todo: Change 1' });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(posts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(posts).toHaveLength(4);
    expect(posts[2].text).toMatch(/^🔀 9 more merges\n• #2 Change 2/);
    expect(notes.map((x) => x.title)).toEqual(['🔀 Merged PR #1', '🔀 9 more merges']);
    expect(notes[0].url).toBe('/?tab=company');
  });

  it('says nothing about events or channels that are off', async () => {
    const settings = notifySettings(DEFAULT_NOTIFY, { channels: { desktop: false, slack: false } });
    const { n, posts, notes } = notifier(tmpDir(), () => 200, settings);
    await n.setWebhook('slack', SECRETS.slack);
    await n.setWebhook('discord', SECRETS.discord);
    n.notify('merge', 'Merged PR #1', 'x'); // merges are off by default
    n.notify('hire', 'New candidate for floor 1', 'Ada');
    await settle();
    expect(notes).toEqual([]);
    expect(posts.map((p) => [p.channel, p.text])).toEqual([['discord', '📄 New candidate for floor 1\nAda']]);
  });

  it('pushes an encrypted note to each device and forgets one its push service says is gone', async () => {
    const dir = tmpDir();
    const { n, posts } = notifier(dir, (req) => (req.url.includes('gone') ? 410 : 201));
    await n.pushKey();
    await n.subscribe(subscription('https://push.example.net/push/alive'));
    await n.subscribe(subscription('https://push.example.net/push/gone'));
    expect(n.channelsView().pushDevices).toBe(2);
    n.notify('ceoMessage', 'Morgan', 'Floor 2 is done.');
    await settle();
    expect(posts.map((p) => [p.channel, p.url])).toEqual([
      ['push', 'https://push.example.net/push/alive'],
      ['push', 'https://push.example.net/push/gone'],
    ]);
    expect(posts[0].headers).toMatchObject({ 'Content-Encoding': 'aes128gcm' });
    expect(Buffer.isBuffer(posts[0].body) && posts[0].body.includes(Buffer.from('Floor 2'))).toBe(false); // encrypted
    expect(n.channelsView().pushDevices).toBe(1);
    // Kept on disk across a restart, with the same keys.
    const again = notifier(dir, () => 201).n;
    await again.init();
    expect(again.channelsView().pushDevices).toBe(1);
    expect((await again.pushKey()).publicKey).toBe((await n.pushKey()).publicKey);
  });

  it('refuses a test of a channel that is not set up', async () => {
    const { n } = notifier(tmpDir(), () => 200);
    await expect(n.test('discord')).rejects.toThrow('Save the Discord settings first.');
    await expect(n.test('push')).rejects.toThrow(/No device gets push yet/);
    await expect(n.test('carrier-pigeon')).rejects.toThrow(/no notification channel/);
    await expect(n.setWebhook('carrier-pigeon', {})).rejects.toThrow(/no chat app/);
  });
});
