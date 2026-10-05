import { useMemo, useState } from 'react';
import { api } from '../api';
import { agentsOnRepo, kanbanFor, useStore, type Agent, type KanbanCard } from '../store';
import { confirmDialog } from './Confirm';
import { Panel } from './Panel';

function AgentChip({ agent }: { agent?: Agent }) {
  if (!agent) return null;
  return (
    <span className="agent-chip">
      <span className="dot" style={{ background: agent.color }} />
      {agent.name}
      {agent.role === 'qa' && <span className="chip">QA</span>}
    </span>
  );
}

export function IssueForm({ repoId, agents, onDone }: { repoId: string; agents: Agent[]; onDone?: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [busy, setBusy] = useState(false);
  const free = agents.filter((a) => a.role === 'dev' && a.status !== 'working' && a.status !== 'preparing');
  return (
    <form
      className="issue-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        setBusy(true);
        try {
          await api.createIssue(repoId, title, body, assignTo || undefined);
          setTitle('');
          setBody('');
          setAssignTo('');
          onDone?.();
        } catch {
          // toasted
        } finally {
          setBusy(false);
        }
      }}
    >
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Issue title, e.g. Add a dark mode toggle" aria-label="Issue title" autoFocus />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Describe what you want. Acceptance criteria help the developer and the QA tester a lot." aria-label="Issue description" rows={5} />
      <div className="row">
        <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} aria-label="Who works on it">
          <option value="">Leave in backlog (auto-assign picks it up if enabled)</option>
          {free.map((a) => (
            <option key={a.id} value={a.id}>
              Give it to {a.name} right away
            </option>
          ))}
        </select>
        <button className="btn btn-good" disabled={busy || !title.trim()}>
          {busy ? 'Filing…' : 'File issue on GitHub'}
        </button>
      </div>
    </form>
  );
}

/** The board's frame: a panel over the office, or (in pocket mode) a plain section of the page. */
function Frame({ embedded, ...props }: Parameters<typeof Panel>[0] & { embedded?: boolean }) {
  if (!embedded) return <Panel {...props} />;
  return (
    <section className="kanban-embedded" style={{ ['--accent' as string]: props.accent }}>
      <h2 className="kanban-embedded-title">{props.title}</h2>
      {props.children}
    </section>
  );
}

function QaLink({ card }: { card: KanbanCard }) {
  if (!card.qa?.commentUrl) return null;
  return (
    <a className="small" href={card.qa.commentUrl} target="_blank" rel="noreferrer" title={card.qa.summary ?? ''}>
      QA report ↗
    </a>
  );
}

export function KanbanView({ repoId, embedded }: { repoId: string; embedded?: boolean }) {
  const repo = useStore((s) => s.repos.find((r) => r.id === repoId));
  const allAgents = useStore((s) => s.agents);
  const qaRecords = useStore((s) => s.qa);
  const usageState = useStore((s) => s.usage.state);
  const openOverlay = useStore((s) => s.openOverlay);
  const agents = useMemo(() => agentsOnRepo(allAgents, repoId), [allAgents, repoId]);
  const cols = useMemo(() => (repo ? kanbanFor(repo, agents, qaRecords, { state: usageState }) : null), [repo, agents, qaRecords, usageState]);
  const [showForm, setShowForm] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  if (!repo || !cols) {
    return (
      <Frame title="Kanban" embedded={embedded}>
        <p className="muted">This floor no longer exists.</p>
      </Frame>
    );
  }

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setPending(key);
    try {
      await fn();
    } catch {
      // toasted
    } finally {
      setPending(null);
    }
  };
  const devs = agents.filter((a) => a.role === 'dev');
  const free = devs.filter((a) => a.status === 'idle' || a.status === 'done' || a.status === 'stopped' || a.status === 'error');
  const merge = async (c: KanbanCard) => {
    const passed = c.qa?.status === 'passed';
    const ok = await confirmDialog(
      passed
        ? { icon: '🎉', title: `Merge PR #${c.number}?`, body: `“${c.title}” passed QA. It will be squash-merged into ${repo.defaultBranch}.`, confirm: 'Squash & merge' }
        : {
            tone: 'warn',
            title: `Merge PR #${c.number} without QA?`,
            body: `“${c.title}” has not passed QA yet. Merge it into ${repo.defaultBranch} anyway?`,
            confirm: 'Merge anyway',
          },
    );
    if (ok) void act(c.key, () => api.mergePull(repo.id, c.number));
  };
  const sendBack = async (c: KanbanCard) => {
    let note = '';
    const ok = await confirmDialog({
      icon: '🔧',
      title: `Send PR #${c.number} back to a developer?`,
      body: (
        <>
          <p>Its author, or any free developer, fixes it with QA's findings, then QA tests it once more.</p>
          <input
            maxLength={1000}
            placeholder="Optional note, e.g. merge main and keep both e2e tests"
            aria-label="Note for the developer"
            ref={(el) => void (el && setTimeout(() => el.focus(), 0))}
            onChange={(e) => (note = e.target.value)}
          />
        </>
      ),
      confirm: 'Send back',
    });
    if (ok) void act(c.key, () => api.sendBack(repo.id, c.number, note.trim() || undefined));
  };
  const closePr = async (c: KanbanCard) => {
    const ok = await confirmDialog({
      tone: 'danger',
      title: `Close PR #${c.number}?`,
      body: `“${c.title}” will be closed without merging, and any QA or fix work on it stops. Its issue stays open and waits for you to assign it again. The branch stays on GitHub.`,
      confirm: 'Close PR',
    });
    if (ok) void act(c.key, () => api.closePull(repo.id, c.number));
  };
  const closeButton = (c: KanbanCard) => (
    <button className="btn btn-small btn-ghost" disabled={pending === c.key} onClick={() => void closePr(c)}>
      Close
    </button>
  );
  const previewButton = (c: KanbanCard) => (
    <button className="btn btn-small" title={`Run PR #${c.number} beside ${repo.defaultBranch} and open it in the app viewer`} onClick={() => openOverlay({ kind: 'app', repoId: repo.id, pr: c.number })}>
      Preview
    </button>
  );
  const terminalButton = (c: KanbanCard) =>
    c.agent && (
      <button className="btn btn-small" onClick={() => openOverlay({ kind: 'terminal', agentId: c.agent!.id })}>
        Terminal
      </button>
    );

  const column = (title: string, cls: string, cards: KanbanCard[], render: (c: KanbanCard) => React.ReactNode, empty: string) => (
    <div className={`kcol ${cls}`}>
      <div className="kcol-head">
        {title} <span className="count">{cards.length}</span>
      </div>
      <div className="kcol-body">
        {cards.length === 0 && <div className="muted small kempty">{empty}</div>}
        {cards.map((c) => (
          <div key={c.key} className={`kcard ${c.tone ? `kcard-${c.tone}` : ''}`}>
            <div className="kcard-title">
              {c.url ? (
                <a href={c.url} target="_blank" rel="noreferrer">
                  {c.prNumber ? 'PR ' : ''}#{c.number}
                </a>
              ) : (
                <b>#{c.number}</b>
              )}{' '}
              {c.title}
            </div>
            {render(c)}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <Frame
      embedded={embedded}
      wide
      accent={repo.color}
      title={
        <span>
          📋 {repo.fullName}{' '}
          <a className="small" href={repo.url} target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
        </span>
      }
    >
      <div className="kanban-toolbar">
        <button className="btn btn-good" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ New issue'}
        </button>
        <label className="toggle">
          <input type="checkbox" checked={repo.autoAssign} onChange={(e) => void api.updateRepo(repo.id, { autoAssign: e.target.checked }).catch(() => undefined)} />
          ⚡ Auto-assign backlog to free developers
        </label>
        <label className="toggle" title="Merge a PR as soon as QA has signed off on its latest commit and GitHub's checks are green">
          <input type="checkbox" checked={repo.autoMerge} onChange={(e) => void api.updateRepo(repo.id, { autoMerge: e.target.checked }).catch(() => undefined)} />
          🔀 Auto-merge when QA and checks pass
        </label>
        <span className="spacer" />
        <button className="btn" onClick={() => openOverlay({ kind: 'app', repoId: repo.id })} title="Open this floor's running app">
          🖥️ View app
        </button>
        <span className="muted small">{repo.lastSync ? `Synced ${new Date(repo.lastSync).toLocaleTimeString()}` : 'Syncing…'}</span>
        <button className="btn" disabled={pending === 'sync'} onClick={() => act('sync', () => api.syncRepo(repo.id))}>
          ⟳ Sync
        </button>
      </div>
      {repo.syncError && <div className="term-error">⚠️ {repo.syncError}</div>}
      {showForm && <IssueForm repoId={repo.id} agents={devs} onDone={() => setShowForm(false)} />}

      <div className="kanban kanban-5">
        {column(
          '📋 Backlog',
          'kcol-backlog',
          cols.backlog,
          (c) => (
            <div className="kcard-foot">
              {c.note && <span className="muted small">{c.note}</span>}
              <select
                value=""
                disabled={pending === c.key || free.length === 0}
                onChange={(e) => e.target.value && act(c.key, () => api.assign(e.target.value, c.number))}
                aria-label={`Assign issue #${c.number}`}
              >
                <option value="">{free.length ? 'Assign to…' : 'Everyone is busy'}</option>
                {free.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          ),
          'No open issues. File one above!',
        )}
        {column(
          '🔨 In progress',
          'kcol-progress',
          cols.progress,
          (c) => (
            <div className="kcard-foot">
              <AgentChip agent={c.agent} />
              <span className="muted small">{c.note}</span>
              <span className="spacer" />
              {terminalButton(c)}
            </div>
          ),
          'Nobody is coding right now.',
        )}
        {column(
          '🔍 In QA',
          'kcol-qa',
          cols.qa,
          (c) => {
            const st = c.qa?.status;
            return (
              <div className="kcard-foot kcard-foot-wrap">
                <AgentChip agent={c.agent} />
                <span className="muted small">{c.note}</span>
                <span className="spacer" />
                <QaLink card={c} />
                {previewButton(c)}
                {(st === 'testing' || st === 'fixing') && terminalButton(c)}
                {(!st || st === 'needs-human') && (
                  <button className="btn btn-small btn-good" disabled={pending === c.key} onClick={() => act(c.key, () => api.sendToQa(repo.id, c.number))}>
                    {st === 'needs-human' ? 'Retry QA' : 'Send to QA'}
                  </button>
                )}
                {(st === 'needs-human' || st === 'failed') && (
                  <button className="btn btn-small" disabled={pending === c.key} title="Hand it to a developer with QA's findings and your note, without another QA round first" onClick={() => sendBack(c)}>
                    Send back to dev
                  </button>
                )}
                {st === 'needs-human' && (
                  <button className="btn btn-small btn-ghost" disabled={pending === c.key} onClick={() => merge(c)}>
                    Merge anyway
                  </button>
                )}
                {closeButton(c)}
              </div>
            );
          },
          'Nothing waiting for testing.',
        )}
        {column(
          '✅ Ready to merge',
          'kcol-review',
          cols.ready,
          (c) => {
            const pr = repo.pulls.find((p) => p.number === c.prNumber);
            return (
              <div className="kcard-foot kcard-foot-wrap">
                <AgentChip agent={c.agent} />
                <span className="muted small">
                  {c.note}
                  {pr ? ` · +${pr.additions} −${pr.deletions}` : ''}
                </span>
                <span className="spacer" />
                <QaLink card={c} />
                {previewButton(c)}
                <button className="btn btn-small btn-good" disabled={pending === c.key || pr?.isDraft} onClick={() => merge(c)}>
                  Merge
                </button>
                {closeButton(c)}
              </div>
            );
          },
          'No tested pull requests yet.',
        )}
        {column(
          '🎉 Merged',
          'kcol-merged',
          cols.merged,
          (c) => (
            <div className="kcard-foot">
              <AgentChip agent={c.agent} />
            </div>
          ),
          'Nothing merged yet.',
        )}
      </div>
    </Frame>
  );
}
