// Settings → Cloud agents (docs/cloud.md): where new agents work, the Upstash account their Boxes run in, and what
// they sign in with. Keys and tokens are write-only: the browser only sees whether each is there and where it's from.
// Without a key, each cloud agent's coding agent signs in in their own terminal (the 🔑 Sign in on their card).
import { useId, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { BOX_SIZE_INFO, BOX_SIZES, MAX_BOX_LIMIT } from '../../../shared/cloud';
import type { CloudCredentialView, CloudSettings as Cloud, CloudView } from '../../../shared/types';
import { confirmDialog } from './Confirm';

const DOCS = 'https://github.com/leonvanzyl/cubefarm/blob/main/docs/cloud.md';

/** A command to copy, with a Copy button. */
function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="cloud-cmd">
      <code>{text}</code>
      <button
        type="button"
        className="btn btn-small btn-ghost"
        onClick={() =>
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}

/** A write-only key or token: its hint once saved (Replace, Remove), else a field to paste one. */
function SecretField({ label, saved, hint, placeholder, help, save }: { label: string; saved: boolean; hint: string; placeholder: string; help?: string; save: (value: string) => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const errorId = useId();
  const store = async (v: string) => {
    setBusy(true);
    setError('');
    try {
      await save(v);
      setValue(''); // never kept or shown again once saved
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  if (saved && !editing) {
    return (
      <div className="row wrap">
        <span className="grow small">
          🔑 {label} saved{hint && <code> …{hint}</code>}
        </span>
        <button className="btn btn-small btn-ghost" onClick={() => setEditing(true)}>
          Replace
        </button>
        <button
          className="btn btn-small btn-ghost"
          disabled={busy}
          onClick={() =>
            void confirmDialog({ tone: 'danger', title: `Remove the ${label}?`, body: "It's deleted from the office. Cloud agents that need it can't sign in until you add it again.", confirm: 'Remove' }).then((ok) => {
              if (ok) void store('');
            })
          }
        >
          Remove
        </button>
      </div>
    );
  }
  return (
    <form
      className="notify-form"
      onSubmit={(e) => {
        e.preventDefault();
        void store(value);
      }}
    >
      {help && <p className="muted small">{help}</p>}
      <label className="field">
        <span>{label}</span>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
        />
      </label>
      {error && (
        <div id={errorId} className="term-error small" role="alert">
          {error}
        </div>
      )}
      <div className="row">
        <button className="btn btn-small btn-good" disabled={busy || !value.trim()}>
          {busy ? 'Checking…' : 'Save'}
        </button>
        {editing && (
          <button
            type="button"
            className="btn btn-small btn-ghost"
            onClick={() => {
              setEditing(false);
              setValue('');
              setError('');
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/** ✓ or ⚠, and where the credential comes from. */
function Status({ view, what }: { view: CloudCredentialView; what: Partial<Record<NonNullable<CloudCredentialView['source']>, string>> }) {
  return view.ready ? <span className="small notify-ok">✓ {view.source ? what[view.source] : 'Ready'}</span> : <span className="small term-error">⚠ Not set up yet</span>;
}

function Boxes({ cloud }: { cloud: CloudView }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const b = cloud.boxes;
  const test = async () => {
    setBusy(true);
    setNote('');
    try {
      await api.testCloud();
      setNote('✓ Connected');
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row wrap">
      <span className="grow small">
        {b ? `${b.total} Box${b.total === 1 ? '' : 'es'} on your account · this office: ${b.running} running, ${b.paused} paused` : 'Boxes not counted yet.'}
        {cloud.keyError && <span className="term-error"> {cloud.keyError}</span>}
      </span>
      <button className="btn btn-small" disabled={busy} onClick={() => void test()}>
        {busy ? 'Checking…' : 'Test'}
      </button>
      {!!b?.orphans && (
        <button
          className="btn btn-small btn-ghost"
          onClick={() =>
            void confirmDialog({
              tone: 'danger',
              title: `Delete ${b.orphans} orphaned Box${b.orphans === 1 ? '' : 'es'}?`,
              body: "Boxes of this office whose agent is gone. They're deleted for good in your Upstash account.",
              confirm: 'Delete',
            }).then((ok) => ok && void api.deleteCloudOrphans())
          }
        >
          Delete {b.orphans} orphan{b.orphans === 1 ? '' : 's'}
        </button>
      )}
      {note && (
        <span className={`small ${note.startsWith('✓') ? 'notify-ok' : 'term-error'}`} role="status">
          {note}
        </span>
      )}
    </div>
  );
}

export function CloudSettings() {
  const settings = useStore((s) => s.settings.cloud);
  const cloud = useStore((s) => s.cloud);
  const demo = useStore((s) => s.demo);
  const [error, setError] = useState('');
  const save = (patch: Partial<Cloud>) => {
    setError('');
    void api.updateSettings({ cloud: { ...settings, ...patch } }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };
  return (
    <div className="card notify-settings">
      <h3>☁️ Cloud agents</h3>
      <p className="muted small">
        Run agents in <a href="https://upstash.com/docs/box/overall/quickstart">Upstash Boxes</a> instead of on this computer. A cloud agent keeps working on its task when you close the office or shut your laptop, and
        the office catches up when it's back. Agents on this computer stay the default.
      </p>

      <h4 className="notify-h">Upstash account</h4>
      <div className="notify-hook">
        <SecretField
          label="Upstash Box API key"
          saved={cloud.keySet}
          hint={cloud.keyHint}
          placeholder={demo ? 'Any text works in the demo' : 'Your Box API key'}
          help="Create one in the Upstash console (console.upstash.com → Box → API Keys). It stays on the office's computer."
          save={(key) => api.setCloudKey(key)}
        />
        {cloud.keySet && <Boxes cloud={cloud} />}
      </div>

      <h4 className="notify-h">Where new agents work</h4>
      <div className="notify-hook" role="radiogroup" aria-label="Where new agents work">
        <label className="toggle block">
          <input type="radio" name="cloud-kind" checked={settings.machineKind === 'local'} onChange={() => save({ machineKind: 'local' })} />
          <span>🖥️ This computer</span>
        </label>
        <label className="toggle block">
          <input type="radio" name="cloud-kind" checked={settings.machineKind === 'box'} disabled={!cloud.keySet} onChange={() => save({ machineKind: 'box' })} />
          <span>☁️ An Upstash Box each{!cloud.keySet && ' (save your API key first)'}</span>
        </label>
        <p className="muted small">New hires work here; the lobby lets you pick for each one. Move an agent from their settings when they have no task.</p>
        <div className="row wrap">
          <label className="field grow">
            <span>Box size</span>
            <select value={settings.boxSize} onChange={(e) => save({ boxSize: e.target.value as Cloud['boxSize'] })}>
              {BOX_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s} · {BOX_SIZE_INFO[s].spec} · ${BOX_SIZE_INFO[s].usdPerCpuHour.toFixed(2)} per active CPU hour
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Your plan's Box limit</span>
            <input
              type="number"
              min={1}
              max={MAX_BOX_LIMIT}
              value={settings.boxLimit}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                if (n >= 1) save({ boxLimit: n });
              }}
            />
          </label>
        </div>
        {error && (
          <div className="term-error small" role="alert">
            {error}
          </div>
        )}
      </div>

      <h4 className="notify-h">How cloud agents sign in</h4>
      <p className="muted small">
        GitHub is set up once for every Box. Coding agents sign in with your own subscription in each cloud agent's terminal, once per cloud machine, unless you give them a key here.
      </p>
      <div className="notify-hook">
        <div className="row wrap">
          <b className="grow">GitHub</b>
          <Status view={cloud.github} what={{ gh: 'Your gh login', token: 'A token you saved' }} />
        </div>
        <p className="muted small">Your gh login is used unless you save a fine-grained token for your floors' repos (Contents, Pull requests and Issues: read and write), which is safer.</p>
        <SecretField label="GitHub token" saved={cloud.github.source === 'token'} hint={cloud.github.hint} placeholder="github_pat_…" save={(v) => api.setCloudToken('github', v)} />
      </div>
      <div className="notify-hook">
        <div className="row wrap">
          <b className="grow">Claude Code</b>
          <Status view={cloud.claude} what={{ login: 'Your subscription, per agent', subscription: 'Your Claude subscription (CUBEFARM_CLAUDE_TOKEN)', apiKey: 'An Anthropic API key' }} />
        </div>
        {cloud.claude.source === 'login' && (
          <p className="muted small">
            With your Claude subscription (Pro or Max), each cloud agent signs in once, in their own terminal. When one needs it, their desk shows a 🔑 note and their card a 🔑 Sign in: open the link in their
            terminal, approve it and paste the code back there. Their cloud machine keeps the sign-in; if it ever expires, the same steps sign them in again.
          </p>
        )}
        {cloud.claude.source !== 'subscription' && (
          <>
            <p className="muted small">Or pay per token with an API key, which every cloud agent then uses instead:</p>
            <SecretField label="Anthropic API key" saved={cloud.claude.source === 'apiKey'} hint={cloud.claude.hint} placeholder="sk-ant-…" save={(v) => api.setCloudToken('anthropic', v)} />
            <details className="small">
              <summary>Or one subscription token for every cloud agent</summary>
              <ol className="cloud-steps">
                <li>
                  In a terminal: <Command text="claude setup-token" /> and approve it in your browser. It prints a token that lasts a year.
                </li>
                <li>
                  Keep it in your environment as <code>CUBEFARM_CLAUDE_TOKEN</code>. Windows: <Command text={'setx CUBEFARM_CLAUDE_TOKEN "<token>"'} /> macOS or Linux: add{' '}
                  <Command text={'export CUBEFARM_CLAUDE_TOKEN="<token>"'} /> to your shell profile.
                </li>
                <li>Restart the office.</li>
              </ol>
              <p className="muted">The office never writes it down: Anthropic's terms keep apps like this one from storing Claude tokens.</p>
            </details>
          </>
        )}
      </div>
      <div className="notify-hook">
        <div className="row wrap">
          <b className="grow">Codex</b>
          <Status view={cloud.codex} what={{ login: 'Your ChatGPT plan, per agent', apiKey: 'An OpenAI API key' }} />
        </div>
        <p className="muted small">
          With your ChatGPT plan, each cloud agent signs in once in their own terminal: open the link it shows and enter its one-time code. Or an OpenAI API key works in every Box:
        </p>
        <SecretField label="OpenAI API key" saved={cloud.codex.source === 'apiKey'} hint={cloud.codex.hint} placeholder="sk-…" save={(v) => api.setCloudToken('openai', v)} />
      </div>
      {demo && cloud.keySet && (
        <div className="row wrap">
          <span className="grow muted small">Try what happens when a cloud agent's sign-in runs out: every Box is signed out, and its agent asks to be signed in again.</span>
          <button className="btn btn-small btn-ghost" onClick={() => void api.expireSignIns()}>
            🔑 Expire sign-ins (demo)
          </button>
        </div>
      )}
      <p className="muted small">
        Boxes cost what their CPU does while they work (paused Boxes cost nothing but their disk), and the free plan allows 10 Boxes. Setup, costs and what keeps going while the office is closed:{' '}
        <a href={DOCS}>docs/cloud.md</a>.
      </p>
    </div>
  );
}
