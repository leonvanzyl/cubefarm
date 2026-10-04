// Settings → Notifications (docs/pocket.md): which events, the office URL messages link to, this device (desktop
// notifications, Web Push) and the chat apps. Webhook URLs and tokens are write-only: the browser sees a hint of them.
import { useEffect, useId, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { NOTIFY_EVENTS } from '../../../shared/notify';
import type { NotifyChannel, NotifySettings as Notify, NotifyWebhook } from '../../../shared/types';
import { confirmDialog } from './Confirm';
import { showTestNote } from '../notifications';
import { currentPush, disablePush, enablePush, pushSupport } from '../pwa';

const DOCS = 'https://github.com/leonvanzyl/cubefarm/blob/main/docs/pocket.md';

type Field = { key: string; label: string; placeholder: string; secret: boolean; optional?: boolean };

const WEBHOOKS: { id: NotifyWebhook; label: string; help: string; fields: Field[] }[] = [
  {
    id: 'discord',
    label: 'Discord',
    help: 'Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.',
    fields: [{ key: 'url', label: 'Webhook URL', placeholder: 'https://discord.com/api/webhooks/…', secret: true }],
  },
  {
    id: 'slack',
    label: 'Slack',
    help: 'A Slack app with Incoming Webhooks on (api.slack.com/apps), added to a channel.',
    fields: [{ key: 'url', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/services/…', secret: true }],
  },
  {
    id: 'telegram',
    label: 'Telegram',
    help: 'Make a bot with @BotFather, send it a message, then use your chat id (docs/pocket.md shows how to find it).',
    fields: [
      { key: 'token', label: 'Bot token', placeholder: '123456789:AA…', secret: true },
      { key: 'chatId', label: 'Chat id', placeholder: '123456789', secret: false },
    ],
  },
  {
    id: 'ntfy',
    label: 'ntfy',
    help: 'Pick a long, hard-to-guess topic and subscribe to it in the ntfy app. Anyone who knows the topic can read it.',
    fields: [
      { key: 'url', label: 'Topic URL', placeholder: 'https://ntfy.sh/my-office-7f3k9q', secret: true },
      { key: 'token', label: 'Access token (optional)', placeholder: 'tk_…', secret: true, optional: true },
    ],
  },
];

type Save = (patch: Partial<Notify>) => void;

/** A Test button's answer, shown beside it. */
function useTest(channel: NotifyChannel) {
  const [state, setState] = useState<{ busy: boolean; result: string | null; ok: boolean }>({ busy: false, result: null, ok: false });
  const run = async () => {
    setState({ busy: true, result: null, ok: false });
    try {
      await api.testNotify(channel);
      setState({ busy: false, result: '✓ Sent', ok: true });
    } catch (err) {
      setState({ busy: false, result: err instanceof Error ? err.message : String(err), ok: false });
    }
  };
  return { ...state, run };
}

function TestResult({ result, ok }: { result: string | null; ok: boolean }) {
  if (!result) return null;
  return (
    <span className={`small ${ok ? 'notify-ok' : 'term-error'}`} role="status">
      {result}
    </span>
  );
}

function WebhookRow({ hook, notify, save }: { hook: (typeof WEBHOOKS)[number]; notify: Notify; save: Save }) {
  const view = useStore((s) => s.notifyChannels.webhooks[hook.id]);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const test = useTest(hook.id);
  const errorId = useId();
  const store = async (body: Record<string, string>) => {
    setBusy(true);
    setError('');
    try {
      await api.setWebhook(hook.id, body);
      setValues({}); // never kept or shown again once saved
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const on = notify.channels[hook.id];
  return (
    <div className="notify-hook">
      <div className="row wrap">
        <b className="grow">{hook.label}</b>
        {view.set && (
          <label className="toggle small">
            <input type="checkbox" checked={on} onChange={(e) => save({ channels: { ...notify.channels, [hook.id]: e.target.checked } })} /> On
          </label>
        )}
      </div>
      {view.set && !editing ? (
        <div className="row wrap">
          <span className="grow small">
            🔑 Saved <code>{view.hint}</code>
          </span>
          <button className="btn btn-small" disabled={test.busy} onClick={() => void test.run()}>
            {test.busy ? 'Sending…' : 'Test'}
          </button>
          <button className="btn btn-small btn-ghost" onClick={() => setEditing(true)}>
            Replace
          </button>
          <button
            className="btn btn-small btn-ghost"
            disabled={busy}
            onClick={() =>
              void confirmDialog({ tone: 'danger', title: `Remove the ${hook.label} settings?`, body: 'They are deleted from the office. Nothing more is sent there until you add them again.', confirm: 'Remove' }).then((ok) => {
                if (ok) void store({});
              })
            }
          >
            Remove
          </button>
          <TestResult result={test.result} ok={test.ok} />
        </div>
      ) : (
        <form
          className="notify-form"
          onSubmit={(e) => {
            e.preventDefault();
            void store(values);
          }}
        >
          <p className="muted small">{hook.help}</p>
          {hook.fields.map((f) => (
            <label key={f.key} className="field">
              <span>{f.label}</span>
              <input
                type={f.secret ? 'password' : 'text'}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!!error}
                aria-describedby={error ? errorId : undefined}
              />
            </label>
          ))}
          {error && (
            <div id={errorId} className="term-error small" role="alert">
              {error}
            </div>
          )}
          <div className="row">
            <button className="btn btn-small btn-good" disabled={busy || hook.fields.some((f) => !f.optional && !values[f.key]?.trim())}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            {editing && (
              <button
                type="button"
                className="btn btn-small btn-ghost"
                onClick={() => {
                  setEditing(false);
                  setValues({});
                  setError('');
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

const permissionNow = (): NotificationPermission | 'unsupported' => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

/** Desktop notifications and Web Push, for the device this page is open on. */
function ThisDevice({ notify, save }: { notify: Notify; save: Save }) {
  const devices = useStore((s) => s.notifyChannels.pushDevices);
  const [permission, setPermission] = useState(permissionNow);
  const [here, setHere] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pushTest = useTest('push');
  const support = typeof window === 'undefined' ? 'unsupported' : pushSupport();
  useEffect(() => {
    if (support === 'ok') void currentPush().then((s) => setHere(!!s), () => setHere(false));
  }, [support, devices]);
  const allow = async () => setPermission(await Notification.requestPermission());
  const togglePush = async (on: boolean) => {
    setBusy(true);
    setError('');
    try {
      if (on) await enablePush();
      else await disablePush();
      setHere(on);
      setPermission(permissionNow());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="notify-hook">
        <div className="row wrap">
          <b className="grow">Desktop notifications</b>
          <label className="toggle small">
            <input type="checkbox" checked={notify.channels.desktop} onChange={(e) => save({ channels: { ...notify.channels, desktop: e.target.checked } })} /> On
          </label>
        </div>
        <p className="muted small">From any browser with the office open in a background tab.</p>
        <div className="row wrap">
          {permission === 'granted' && <span className="small grow">✓ Allowed in this browser</span>}
          {permission === 'denied' && <span className="small grow term-error">Blocked in this browser: allow notifications for this site in its settings.</span>}
          {permission === 'unsupported' && <span className="small grow muted">This browser can't show notifications.</span>}
          {permission === 'default' && (
            <button className="btn btn-small btn-good" onClick={() => void allow()}>
              Allow in this browser
            </button>
          )}
          {permission === 'granted' && (
            <button className="btn btn-small" onClick={() => void showTestNote()}>
              Test
            </button>
          )}
        </div>
      </div>
      <div className="notify-hook">
        <div className="row wrap">
          <b className="grow">Push to my devices</b>
          <label className="toggle small">
            <input type="checkbox" checked={notify.channels.push} onChange={(e) => save({ channels: { ...notify.channels, push: e.target.checked } })} /> On
          </label>
        </div>
        <p className="muted small">
          Reaches a phone or PC even with the office closed. {devices ? `${devices} device${devices === 1 ? '' : 's'} signed up.` : 'No devices signed up yet.'}
        </p>
        {support === 'insecure' && (
          <p className="small term-error">
            Push needs HTTPS (or localhost on the office's own PC). Open the office through an HTTPS address such as Tailscale Serve: see <a href={DOCS}>docs/pocket.md</a>.
          </p>
        )}
        {support === 'unsupported' && <p className="small muted">This browser has no Web Push. On an iPhone, add the office to the home screen first, then turn push on from there.</p>}
        {support === 'dev' && <p className="small muted">Push works in a built office (npm run build), not under the dev server.</p>}
        {support === 'ok' && (
          <div className="row wrap">
            {here ? (
              <button className="btn btn-small btn-ghost" disabled={busy} onClick={() => void togglePush(false)}>
                Stop push to this device
              </button>
            ) : (
              <button className="btn btn-small btn-good" disabled={busy || here === null} onClick={() => void togglePush(true)}>
                {busy ? 'Signing up…' : 'Push to this device'}
              </button>
            )}
            <button className="btn btn-small" disabled={pushTest.busy || !devices} onClick={() => void pushTest.run()}>
              Send test
            </button>
            <TestResult result={pushTest.result} ok={pushTest.ok} />
          </div>
        )}
        {error && (
          <div className="term-error small" role="alert">
            {error}
          </div>
        )}
      </div>
    </>
  );
}

export function NotifySettings() {
  const notify = useStore((s) => s.settings.notify);
  const [url, setUrl] = useState(notify.officeUrl);
  useEffect(() => setUrl(notify.officeUrl), [notify.officeUrl]);
  const save: Save = (patch) => void api.updateSettings({ notify: { ...notify, ...patch } }).catch(() => undefined);
  return (
    <div className="card notify-settings">
      <h3>🔔 Notifications</h3>
      <p className="muted small">What the office tells you when you're not looking. At most one of each kind a minute; a burst arrives as one summary.</p>
      <div className="notify-events" role="group" aria-label="Tell me when">
        {NOTIFY_EVENTS.map((e) => (
          <label key={e.id} className="toggle block">
            <input type="checkbox" checked={notify.events[e.id]} onChange={(ev) => save({ events: { ...notify.events, [e.id]: ev.target.checked } })} />
            <span>{e.label}</span>
          </label>
        ))}
      </div>
      <label className="field">
        <span>Office address for links (optional)</span>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => url.trim() !== notify.officeUrl && save({ officeUrl: url.trim() })}
          placeholder="https://office.your-tailnet.ts.net"
          inputMode="url"
        />
      </label>
      <h4 className="notify-h">This device</h4>
      <ThisDevice notify={notify} save={save} />
      <h4 className="notify-h">Chat apps</h4>
      {WEBHOOKS.map((h) => (
        <WebhookRow key={h.id} hook={h} notify={notify} save={save} />
      ))}
      <p className="muted small">
        Webhook addresses and tokens stay on the office's PC and are never shown again. Setup for each, and how to reach the office from your phone safely: <a href={DOCS}>docs/pocket.md</a>.
      </p>
    </div>
  );
}
