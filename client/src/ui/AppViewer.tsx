import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { PreviewStatus, RepoView } from '../../../shared/types';
import { Panel } from './Overlays';

const STATUS_LABEL: Record<PreviewStatus, string> = {
  unconfigured: 'not set up',
  stopped: 'stopped',
  preparing: 'checking out',
  installing: 'installing',
  starting: 'starting',
  running: 'running',
  error: 'error',
};

const ACTIVE: PreviewStatus[] = ['preparing', 'installing', 'starting', 'running'];

const STEPS: { status: PreviewStatus; label: string }[] = [
  { status: 'preparing', label: 'Check out the code' },
  { status: 'installing', label: 'Install dependencies' },
  { status: 'starting', label: 'Start the app' },
];

// The last width picked, so reopening the viewer keeps it.
let lastWidth: 'desktop' | 'phone' = 'desktop';

// A cross-origin frame never tells us it was refused, so this only catches frames that don't load at all.
const SLOW_LOAD_MS = 12_000;

export function PreviewPill({ status }: { status: PreviewStatus }) {
  return <span className={`status status-${status}`}>{STATUS_LABEL[status]}</span>;
}

// ---------- run settings (also used on the manager's console) ----------

const envText = (env: Record<string, string>) =>
  Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

/** Parse "KEY=value" lines; blank lines and # comments are skipped. */
function parseEnv(text: string): { env: Record<string, string>; error: string | null } {
  const env: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    const key = eq > 0 ? line.slice(0, eq).trim() : '';
    if (!key) return { env, error: `Line ${i + 1}: write it as KEY=value.` };
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return { env, error: `Line ${i + 1}: “${key}” is not a valid variable name.` };
    env[key] = line.slice(eq + 1).trim();
  }
  return { env, error: null };
}

export function PreviewSettings({ repo, saveLabel = 'Save', onSaved }: { repo: RepoView; saveLabel?: string; onSaved?: () => void }) {
  const saved = { command: repo.previewConfig.command ?? '', env: envText(repo.previewConfig.env) };
  const [command, setCommand] = useState(saved.command);
  const [env, setEnv] = useState(saved.env);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setCommand(saved.command);
    setEnv(saved.env);
  }, [saved.command, saved.env]);

  const dirty = command.trim() !== saved.command || env.trim() !== saved.env;
  const unconfigured = repo.preview.status === 'unconfigured';
  return (
    <form
      className="preview-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = parseEnv(env);
        if (parsed.error) return setError(parsed.error);
        setError(null);
        setBusy(true);
        try {
          await api.updateRepo(repo.id, { previewCommand: command.trim() || null, previewEnv: parsed.env });
          onSaved?.();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>Run command</span>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={unconfigured ? 'e.g. python -m http.server {port}' : 'Auto-detected: npm run dev, else npm start, else npm run preview'}
          spellCheck={false}
        />
      </label>
      <label className="field">
        <span>Environment (KEY=value, one per line)</span>
        <textarea value={env} onChange={(e) => setEnv(e.target.value)} rows={3} placeholder={'API_URL=http://localhost:{port}/api\nDATA_DIR={tmp}'} spellCheck={false} />
      </label>
      <p className="muted small">
        Runs from the repo root in the floor's own preview worktree. <code>{'{port}'}</code> is this floor's port ({repo.preview.port}) and <code>PORT</code> is always set;{' '}
        <code>{'{tmp}'}</code> is a scratch folder.{!unconfigured && ' Leave the command empty to use the auto-detected npm script.'}
      </p>
      {error && <div className="term-error">⚠️ {error}</div>}
      <div className="row">
        <button className="btn btn-small btn-good" disabled={busy || (!dirty && !onSaved) || (unconfigured && !command.trim())}>
          {busy ? 'Saving…' : saveLabel}
        </button>
        {dirty && (
          <button
            type="button"
            className="btn btn-small btn-ghost"
            onClick={() => {
              setCommand(saved.command);
              setEnv(saved.env);
              setError(null);
            }}
          >
            Undo changes
          </button>
        )}
      </div>
    </form>
  );
}

// ---------- the viewer ----------

export function AppViewer({ repoId }: { repoId: string }) {
  const repo = useStore((s) => s.repos.find((r) => r.id === repoId));
  const preview = repo?.preview;
  const [picked, setPicked] = useState<number | null>(preview?.pr ?? null);
  const [width, setWidth] = useState(lastWidth);
  const [busy, setBusy] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const toolbar = useRef<HTMLDivElement>(null);

  // Follow runs started elsewhere (a Kanban PR card, another tab).
  useEffect(() => {
    if (preview && ACTIVE.includes(preview.status)) setPicked(preview.pr);
  }, [preview?.pr, preview?.startedAt]);

  const frameKey = `${preview?.url}|${preview?.startedAt}|${reloads}`;
  useEffect(() => {
    setLoaded(false);
    setSlow(false);
    if (preview?.status !== 'running') return;
    const t = setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => clearTimeout(t);
  }, [frameKey, preview?.status]);

  // Start with focus on the toolbar, so Esc closes the panel until the app itself is clicked.
  useEffect(() => {
    toolbar.current?.querySelector<HTMLElement>('select, button')?.focus();
  }, []);

  if (!repo || !preview) {
    return (
      <Panel title="App">
        <p className="muted">This floor no longer exists.</p>
      </Panel>
    );
  }

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      // api() already toasted
    } finally {
      setBusy(false);
    }
  };
  const start = (pr = picked) => run(() => api.startPreview(repo.id, pr ?? undefined));
  const stop = () => run(() => api.stopPreview(repo.id));
  const pickWidth = (w: typeof width) => {
    lastWidth = w;
    setWidth(w);
  };

  const active = ACTIVE.includes(preview.status);
  const openPulls = repo.pulls.filter((p) => p.state === 'OPEN');
  const refLabel = (pr: number | null) => (pr ? `PR #${pr}` : repo.defaultBranch);
  const name = repo.fullName.split('/')[1];

  return (
    <Panel
      wide
      className="panel-app"
      accent={repo.color}
      title={
        <span className="app-title">
          <span className="app-title-name">🖥️ {name}</span>
          <PreviewPill status={preview.status} />
          {preview.ref && preview.status !== 'stopped' && preview.status !== 'unconfigured' && (
            <span className="muted small app-title-ref">
              {preview.ref}
              {preview.commit ? ` · ${preview.commit}` : ''}
            </span>
          )}
        </span>
      }
    >
      <div className="app-toolbar" ref={toolbar} role="toolbar" aria-label="App controls">
        <select
          className="app-ref"
          aria-label="Version to run"
          value={picked ?? ''}
          disabled={busy}
          onChange={(e) => {
            const pr = e.target.value ? Number(e.target.value) : null;
            setPicked(pr);
            if (active) void start(pr);
          }}
        >
          <option value="">{repo.defaultBranch}</option>
          {openPulls.map((p) => (
            <option key={p.number} value={p.number}>
              #{p.number} {p.title}
            </option>
          ))}
          {picked && !openPulls.some((p) => p.number === picked) && <option value={picked}>PR #{picked} (no longer open)</option>}
        </select>
        {active ? (
          <>
            <button className="btn btn-small" disabled={busy} onClick={() => void start()} title={`Restart on ${refLabel(picked)}`}>
              ↻ Restart
            </button>
            <button className="btn btn-small btn-bad" disabled={busy} onClick={() => void stop()}>
              ■ Stop
            </button>
          </>
        ) : (
          <button className="btn btn-small btn-good" disabled={busy || preview.status === 'unconfigured'} onClick={() => void start()}>
            ▶ Start
          </button>
        )}
        <button className="btn btn-small" disabled={preview.status !== 'running'} onClick={() => setReloads((n) => n + 1)} title="Reload the app">
          ⟳ Reload
        </button>
        <div className="seg" role="group" aria-label="Viewport width">
          <button className={`seg-btn ${width === 'desktop' ? 'seg-on' : ''}`} aria-pressed={width === 'desktop'} onClick={() => pickWidth('desktop')}>
            🖥 Desktop
          </button>
          <button className={`seg-btn ${width === 'phone' ? 'seg-on' : ''}`} aria-pressed={width === 'phone'} onClick={() => pickWidth('phone')} title="390px wide">
            📱 Phone
          </button>
        </div>
        <span className="spacer" />
        {preview.url ? (
          <a className="btn btn-small" href={preview.url} target="_blank" rel="noreferrer">
            Open in new tab ↗
          </a>
        ) : (
          <button className="btn btn-small" disabled>
            Open in new tab ↗
          </button>
        )}
      </div>

      {preview.status === 'running' && preview.url ? (
        <>
          <div className={`app-stage ${width === 'phone' ? 'app-stage-phone' : ''}`}>
            <iframe
              key={frameKey}
              className="app-frame"
              src={preview.url}
              title={`${name} app (${refLabel(preview.pr)})`}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-pointer-lock"
              allow="clipboard-read; clipboard-write; fullscreen; autoplay"
              onLoad={() => setLoaded(true)}
              onError={() => setSlow(true)}
            />
            {slow && !loaded && (
              <div className="app-frame-hint" role="status">
                <b>The app isn't showing up here.</b> It may refuse to be shown inside another page (X-Frame-Options or a CSP frame-ancestors rule).{' '}
                <a href={preview.url} target="_blank" rel="noreferrer">
                  Open it in a new tab ↗
                </a>
              </div>
            )}
          </div>
          <p className="muted small app-foot">
            Blank, or “refused to connect”? The app may block being framed: use <b>Open in new tab</b>. Keys typed in the app stay in the app, so <kbd>Esc</kbd> only closes this panel
            when focus is outside it; <b>✕</b> always does.
          </p>
        </>
      ) : active ? (
        <div className="app-state" role="status">
          <div className="app-state-icon app-spin">⚙️</div>
          <h3>Getting {refLabel(preview.pr)} ready…</h3>
          <ol className="app-steps">
            {STEPS.map((s, i) => {
              const at = STEPS.findIndex((x) => x.status === preview.status);
              const cls = i < at ? 'app-step-done' : i === at ? 'app-step-now' : '';
              return (
                <li key={s.status} className={cls}>
                  {i < at ? '✓' : i === at ? '●' : '○'} {s.label}
                  {s.status === 'starting' ? ` on port ${preview.port}` : ''}
                </li>
              );
            })}
          </ol>
          {preview.logTail.length > 0 && <pre className="term app-log">{preview.logTail.slice(-8).join('\n')}</pre>}
        </div>
      ) : preview.status === 'error' ? (
        <div className="app-state app-state-left">
          <h3>⚠️ The app didn't run</h3>
          <div className="term-error">{preview.error ?? 'The app stopped unexpectedly.'}</div>
          <pre className="term app-log" aria-label="Last output">
            {preview.logTail.length ? preview.logTail.join('\n') : '(no output)'}
          </pre>
          <div className="row wrap">
            <button className="btn btn-good" disabled={busy} onClick={() => void start()}>
              ↻ Try again
            </button>
            <button className="btn" aria-expanded={showSettings} onClick={() => setShowSettings((v) => !v)}>
              ⚙️ Run settings
            </button>
          </div>
          {showSettings && <PreviewSettings repo={repo} />}
        </div>
      ) : preview.status === 'unconfigured' ? (
        <div className="app-state app-state-left">
          <h3>🛠️ How should the office run this app?</h3>
          <p className="muted">{preview.error ?? 'This floor has no package.json to fall back on.'} Give it a command that serves the app on the floor's port.</p>
          <PreviewSettings repo={repo} saveLabel="Save & start" onSaved={() => void start()} />
        </div>
      ) : (
        <div className="app-state">
          <div className="app-state-icon">🖥️</div>
          <h3>The app isn't running</h3>
          <p className="muted">
            Start it on <b>{refLabel(picked)}</b> to use it right here. It runs from the floor's own preview worktree on port {preview.port}.
          </p>
          <button className="btn btn-good" disabled={busy} onClick={() => void start()}>
            ▶ Start {refLabel(picked)}
          </button>
          <button className="btn btn-ghost btn-small" aria-expanded={showSettings} onClick={() => setShowSettings((v) => !v)}>
            ⚙️ Run settings
          </button>
          {showSettings && (
            <div className="app-state-left app-settings">
              <PreviewSettings repo={repo} />
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
