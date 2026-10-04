// Notifications, the sending part (docs/pocket.md): the rate-limited fan-out of a note to this office's open tabs
// (desktop notifications), Web Push to the manager's devices and the chat apps' webhooks. Webhook URLs and tokens live
// in the secrets file next to the ElevenLabs key; the VAPID keys and push subscriptions in <SWARM_HOME>/push.json.
// None of it is ever logged or sent to a browser, except the VAPID public key a browser subscribes with.
import fs from 'node:fs/promises';
import path from 'node:path';
import { NOTIFY_WEBHOOKS, noteTab } from '../shared/notify.ts';
import type { NoteView, NotifyChannel, NotifyChannelsView, NotifyEvent, NotifySettings, NotifyWebhook } from '../shared/types.ts';
import { HttpError } from './httpError.ts';
import {
  discordPayload,
  due,
  nextDue,
  note,
  noteText,
  ntfyPayload,
  ntfyTarget,
  offer,
  parseWebhook,
  redact,
  secretValues,
  slackPayload,
  telegramPayload,
  webhookHint,
  type Gates,
  type Note,
  type WebhookSecrets,
} from './notify.ts';
import { mergeSecrets, readSecrets } from './secrets.ts';
import { checkSubscription, checkVapidKeys, generateVapidKeys, pushRequest, type PushSub, type VapidKeys } from './webPush.ts';

/** One POST to a chat app or a push service; resolves with the HTTP status. `text` is the note as plain text. */
export interface NotifyRequest {
  channel: NotifyChannel;
  url: string;
  headers: Record<string, string>;
  body: string | Buffer;
  text: string;
}

/** The real one is fetch (httpTransport); the demo's only logs what it would send. */
export interface NotifyTransport {
  post(req: NotifyRequest): Promise<number>;
  /** Chat apps a demo office starts with (fake, never called), so its log shows what each would be sent. */
  demoWebhooks?: WebhookSecrets;
}

const SEND_TIMEOUT_MS = 10_000;

export const httpTransport: NotifyTransport = {
  async post(req) {
    const body = typeof req.body === 'string' ? req.body : new Uint8Array(req.body);
    const res = await fetch(req.url, { method: 'POST', headers: req.headers, body, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
    await res.arrayBuffer().catch(() => undefined);
    return res.status;
  },
};

export interface NotifierDeps {
  transport: NotifyTransport;
  secretsFile: string;
  pushFile: string;
  settings(): NotifySettings;
  /** Desktop notifications: the note goes to every open office tab, which shows it if it's hidden. */
  broadcast(note: NoteView): void;
  channelsChanged(view: NotifyChannelsView): void;
  /** Server log lines (a send failed), never a secret. */
  log(line: string): void;
  now?(): number;
}

const LABEL: Record<NotifyChannel, string> = { desktop: 'Desktop', push: 'Push', discord: 'Discord', slack: 'Slack', telegram: 'Telegram', ntfy: 'ntfy' };
const MAX_DEVICES = 20;
/** VAPID's contact for push services: the project, as no email address is configured. */
const SUBJECT = 'https://github.com/leonvanzyl/cubefarm';

interface Device extends PushSub {
  addedAt: number;
}

interface PushStore {
  vapid: VapidKeys | null;
  devices: Device[];
}

/** Why a send failed, in words the settings can show; never the URL or the token. */
export function sendError(channel: NotifyChannel, status: number): string {
  const name = LABEL[channel];
  if (status === 0) return `couldn't reach ${name}`;
  if (status === 401 || status === 403) return `${name} refused it (HTTP ${status}): check the ${channel === 'telegram' || channel === 'ntfy' ? 'token' : 'webhook URL'}`;
  if (status === 404 || status === 410) return `${name} doesn't know that ${channel === 'push' ? 'device any more' : channel === 'telegram' ? 'bot' : 'webhook'} (HTTP ${status})`;
  if (status === 400 && channel === 'telegram') return 'Telegram rejected it (HTTP 400): check the chat id, and send your bot a message first';
  if (status === 429) return `${name} is rate-limiting the office (HTTP 429)`;
  return `${name} answered HTTP ${status}`;
}

export class Notifier {
  private webhooks: WebhookSecrets = {};
  private push: PushStore = { vapid: null, devices: [] };
  private gates: Gates = {};
  private timer: NodeJS.Timeout | null = null;
  private seq = 0;
  private pushWrites: Promise<unknown> = Promise.resolve();

  constructor(private deps: NotifierDeps) {}

  async init() {
    const s = await readSecrets(this.deps.secretsFile);
    if (s.notify === undefined && this.deps.transport.demoWebhooks) {
      this.webhooks = { ...this.deps.transport.demoWebhooks };
      await mergeSecrets(this.deps.secretsFile, { notify: this.webhooks }).catch(() => undefined);
    } else this.webhooks = loadWebhooks(s.notify);
    try {
      const raw = JSON.parse(await fs.readFile(this.deps.pushFile, 'utf8')) as { vapid?: unknown; devices?: unknown };
      const devices = Array.isArray(raw.devices) ? raw.devices : [];
      this.push = {
        vapid: checkVapidKeys(raw.vapid),
        devices: devices.flatMap((d) => {
          const sub = checkSubscription(d);
          return sub ? [{ ...sub, addedAt: Number((d as Device).addedAt) || 0 }] : [];
        }),
      };
    } catch {
      // no devices yet
    }
  }

  /** The snapshot's notifyChannels: which chat apps are set up (a hint of each) and how many devices get push. */
  channelsView(): NotifyChannelsView {
    const webhooks = Object.fromEntries(NOTIFY_WEBHOOKS.map((c) => [c, { set: !!this.webhooks[c], hint: webhookHint(c, this.webhooks[c]) }])) as NotifyChannelsView['webhooks'];
    return { webhooks, pushDevices: this.push.devices.length };
  }

  /** Something happened: tell the manager on every channel that's on, unless the event is off or had its minute. */
  notify(event: NotifyEvent, title: string, body: string, line?: string) {
    if (!this.deps.settings().events[event]) return;
    const r = offer(this.gates, note(event, title, body, line), this.now());
    this.gates = r.gates;
    if (r.send) void this.deliver(r.send);
    this.arm();
  }

  /** Sends the summaries whose minute is up. The timer calls it. */
  flush() {
    const r = due(this.gates, this.now());
    this.gates = r.gates;
    const events = this.deps.settings().events;
    for (const n of r.send) if (n.event === 'test' || events[n.event]) void this.deliver(n);
    this.arm();
  }

  /** POST /api/notify/test: a test note on one channel, whatever the toggles say. Throws what went wrong. */
  async test(channel: string): Promise<{ ok: true; sent: number }> {
    if (!isChannel(channel)) throw new HttpError(400, `There's no notification channel called "${channel}".`);
    if (isWebhook(channel) && !this.webhooks[channel]) throw new HttpError(409, `Save the ${LABEL[channel]} settings first.`);
    if (channel === 'push' && !this.push.devices.length) throw new HttpError(409, 'No device gets push yet: turn push on on a device first.');
    const n = note('test', 'Test from cubefarm', channel === 'desktop' ? 'Desktop notifications work in this browser.' : `${LABEL[channel]} notifications from the office work.`);
    const results = await this.deliver(n, channel);
    const failed = results.filter((r) => r !== null);
    if (results.length && failed.length === results.length) throw new HttpError(502, `The test didn't arrive: ${failed[0]}.`);
    return { ok: true, sent: results.length - failed.length };
  }

  /** PUT /api/notify/webhooks/:channel: saves (or with an empty url / token removes) a chat app's settings. */
  async setWebhook(channel: string, body: unknown): Promise<NotifyChannelsView> {
    if (!isWebhook(channel)) throw new HttpError(404, `There's no chat app called "${channel}".`);
    const w = parseWebhook(channel, body);
    const next: WebhookSecrets = { ...this.webhooks };
    if (w) Object.assign(next, { [channel]: w });
    else delete next[channel];
    await mergeSecrets(this.deps.secretsFile, { notify: next });
    this.webhooks = next;
    return this.changed();
  }

  /** GET /api/notify/push/key: the VAPID public key browsers subscribe with, made on first use. */
  async pushKey(): Promise<{ publicKey: string }> {
    if (!this.push.vapid) {
      this.push.vapid = generateVapidKeys();
      await this.savePush();
    }
    return { publicKey: this.push.vapid.publicKey };
  }

  /** POST /api/notify/push/devices: this device's PushSubscription. The newest MAX_DEVICES are kept. */
  async subscribe(raw: unknown): Promise<NotifyChannelsView> {
    const sub = checkSubscription(raw);
    if (!sub) throw new HttpError(400, "That isn't a push subscription from a browser.");
    if (!this.push.vapid) throw new HttpError(409, 'Ask for the push key first.');
    const devices = this.push.devices.filter((d) => d.endpoint !== sub.endpoint);
    this.push.devices = [...devices, { ...sub, addedAt: this.now() }].slice(-MAX_DEVICES);
    await this.savePush();
    return this.changed();
  }

  /** DELETE /api/notify/push/devices: this device stops getting push. */
  async unsubscribe(endpoint: string): Promise<NotifyChannelsView> {
    this.push.devices = this.push.devices.filter((d) => d.endpoint !== endpoint);
    await this.savePush();
    return this.changed();
  }

  // ---------- sending ----------

  private arm() {
    if (this.timer) return;
    const at = nextDue(this.gates);
    if (at === null) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.flush();
      },
      Math.max(0, at - this.now()),
    );
    this.timer.unref?.();
  }

  /** Fans `n` out to the channels that are on (or just `only`). One entry per send: null when it arrived, else why not. */
  private async deliver(n: Note, only?: NotifyChannel): Promise<(string | null)[]> {
    const s = this.deps.settings();
    const on = (c: NotifyChannel) => (only ? c === only : s.channels[c]);
    const at = this.now();
    const view: NoteView = { id: `${at.toString(36)}-${++this.seq}`, event: n.event, title: n.title, body: n.body, at, url: `/?tab=${noteTab(n.event)}` };
    if (on('desktop')) this.deps.broadcast(view);
    const sends: Promise<string | null>[] = [];
    for (const c of NOTIFY_WEBHOOKS) if (on(c) && this.webhooks[c]) sends.push(this.send(this.webhookRequest(c, n, s.officeUrl)));
    if (on('push') && this.push.vapid) {
      const payload = JSON.stringify({ title: view.title, body: view.body, tag: `cubefarm-${view.id}`, url: view.url });
      for (const d of [...this.push.devices]) sends.push(this.sendPush(d, payload, noteText(n)));
    }
    return Promise.all(sends);
  }

  private webhookRequest(c: NotifyWebhook, n: Note, officeUrl: string): NotifyRequest {
    const json = { 'Content-Type': 'application/json' };
    const text = noteText(n, officeUrl);
    const w = this.webhooks;
    if (c === 'telegram') return { channel: c, url: `https://api.telegram.org/bot${w.telegram!.token}/sendMessage`, headers: json, body: JSON.stringify(telegramPayload(n, w.telegram!.chatId, officeUrl)), text };
    if (c === 'ntfy') {
      const { root, topic } = ntfyTarget(w.ntfy!.url);
      return { channel: c, url: root, headers: { ...json, ...(w.ntfy!.token ? { Authorization: `Bearer ${w.ntfy!.token}` } : {}) }, body: JSON.stringify(ntfyPayload(n, topic, officeUrl)), text };
    }
    const body = c === 'discord' ? discordPayload(n, officeUrl) : slackPayload(n, officeUrl);
    return { channel: c, url: w[c]!.url, headers: json, body: JSON.stringify(body), text };
  }

  private async send(req: NotifyRequest): Promise<string | null> {
    const status = await this.deps.transport.post(req).catch(() => 0);
    if (status >= 200 && status < 300) return null;
    const why = sendError(req.channel, status);
    this.deps.log(redact(`notify: ${LABEL[req.channel]} failed: ${why}`, this.secrets()));
    return why;
  }

  private async sendPush(d: Device, payload: string, text: string): Promise<string | null> {
    const req = pushRequest(d, payload, this.push.vapid!, SUBJECT, this.now());
    const why = await this.send({ channel: 'push', ...req, text });
    // The browser dropped the subscription (unsubscribed, or site data cleared): stop pushing to it.
    if (why && /HTTP (404|410)/.test(why)) await this.unsubscribe(d.endpoint).catch(() => undefined);
    return why;
  }

  private secrets(): string[] {
    return [...secretValues(this.webhooks), ...this.push.devices.map((d) => d.endpoint), ...(this.push.vapid ? [this.push.vapid.privateKey] : [])];
  }

  private changed(): NotifyChannelsView {
    const view = this.channelsView();
    this.deps.channelsChanged(view);
    return view;
  }

  /** push.json: owner-only where the OS has file modes, written whole, one write after another. */
  private savePush(): Promise<void> {
    const file = this.deps.pushFile;
    const data = JSON.stringify({ vapid: this.push.vapid, devices: this.push.devices }, null, 2);
    const write = this.pushWrites.then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(`${file}.tmp`, data, { mode: 0o600 });
      await fs.rename(`${file}.tmp`, file);
      await fs.chmod(file, 0o600).catch(() => undefined);
    });
    this.pushWrites = write.catch(() => undefined);
    return write;
  }

  private now() {
    return this.deps.now?.() ?? Date.now();
  }
}

const isWebhook = (c: string): c is NotifyWebhook => (NOTIFY_WEBHOOKS as string[]).includes(c);
const isChannel = (c: string): c is NotifyChannel => c === 'desktop' || c === 'push' || isWebhook(c);

/** The chat apps' settings read back from the secrets file, each checked again; anything malformed is dropped. */
export function loadWebhooks(raw: unknown): WebhookSecrets {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: WebhookSecrets = {};
  for (const c of NOTIFY_WEBHOOKS) {
    try {
      const w = parseWebhook(c, r[c]);
      if (w) Object.assign(out, { [c]: w });
    } catch {
      // dropped
    }
  }
  return out;
}
