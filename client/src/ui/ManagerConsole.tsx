import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TeamStats } from './CareerCard';
import { api } from '../api';
import { PreviewPill, PreviewSettings } from './AppViewer';
import { agentsOnRepo, pendingRequests, useStore, type ManagerTab } from '../store';
import { CEO_ID, type AgentCli, type EffortLevel, type OfficeUpdateView, type RepoView } from '../../../shared/types';
import { CLAUDE_MODELS } from '../../../shared/models';
import { BriefEditor, CliOptions, CliSelect, cliName, EFFORTS, EffortSelect, LookSelect, ModelInput, NameInput, PromptPreview, SpecialtyInput, TitleInput } from './AgentSettings';
import { canPostpone, canUpdateNow, drainDeadline, officeUpdateText } from '../officeUpdate';
import { confirmDialog } from './Confirm';
import { IssueForm } from './KanbanView';
import { LiveTerminal } from './LiveTerminal';
import { MicButton } from './MicButton';
import { OpsTab } from './MissionConsole';
import { NotifySettings } from './NotifySettings';
import { ProfileSettings } from './ProfileSettings';
import { Panel } from './Overlays';
import { Resume } from './Phone';
import { ProjectPicker } from './ProjectPicker';
import { StatusPill } from './TerminalView';
import { ThemeSettings } from './ThemeSettings';
import { TimeLapseTab } from './TimeLapse';
import { VoiceSettings } from './VoiceSettings';
import { AccessibilitySettings } from './AccessibilitySettings';
import { OutsideSettings } from './OutsideSettings';

async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined; // api() already toasted the error
  }
}

// ---------- floors ----------

const NO_LAUNCHER = 'Start the office with npm run dev or npm start so it can install updates and restart itself.';

/** The office itself: the commit it runs and its own update. Hidden on servers that can't update themselves. */
function OfficeRow({ update }: { update: OfficeUpdateView }) {
  const commit = useStore((s) => s.officeCommit);
  const autoUpdate = useStore((s) => s.settings.autoUpdate);
  const [busy, setBusy] = useState(false);
  const act = (action: 'now' | 'later') => {
    setBusy(true);
    void attempt(() => api.updateOffice(action)).finally(() => setBusy(false));
  };
  const deadline = drainDeadline(update);
  const pending = update.state !== 'none';
  const tone = update.state === 'failed' ? 'office-state-bad' : update.state === 'none' ? 'office-state-ok' : 'office-state-busy';
  const tip = (enabled: boolean, text: string) => (update.launcher ? (enabled ? text : undefined) : NO_LAUNCHER);
  return (
    <div className="card office-card">
      <div className="row wrap">
        <span className="floor-badge office-badge" aria-hidden>
          🏢
        </span>
        <div className="grow">
          <b>Office</b> <span className="muted small">running {commit ? <code>{commit}</code> : 'an unknown commit'}</span>
          <div className={`small office-state ${tone}`} role="status">
            {officeUpdateText(update)}
          </div>
        </div>
        {pending && (
          <div className="office-actions" title={update.launcher ? undefined : NO_LAUNCHER}>
            <button
              className="btn btn-small btn-good"
              disabled={busy || !canUpdateNow(update)}
              title={tip(canUpdateNow(update), 'Start nothing new, let running sessions finish, then update and restart the office')}
              onClick={() => act('now')}
            >
              Update now
            </button>
            <button className="btn btn-small btn-ghost" disabled={busy || !canPostpone(update)} title={tip(canPostpone(update), 'Keep working; ask again in 2 hours or when a newer commit lands')} onClick={() => act('later')}>
              Later
            </button>
          </div>
        )}
      </div>
      {update.detail && update.state !== 'failed' && <div className="muted small">{update.detail}</div>}
      {deadline && update.running > 0 && (
        <div className="muted small">Sessions still running at {new Date(deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} are stopped, and their work goes back to the queue.</div>
      )}
      {!update.launcher && pending && <div className="muted small">{NO_LAUNCHER}</div>}
      {typeof autoUpdate === 'boolean' && (
        <label className="toggle" title="When an update is ready, start nothing new, let running sessions finish, then update and restart the office">
          <input type="checkbox" checked={autoUpdate} onChange={(e) => void attempt(() => api.updateSettings({ autoUpdate: e.target.checked }))} /> Update automatically
        </label>
      )}
    </div>
  );
}

function FloorRow({ repo, all }: { repo: RepoView; all: RepoView[] }) {
  const agents = useStore((s) => s.agents);
  const goToFloor = useStore((s) => s.goToFloor);
  const openOverlay = useStore((s) => s.openOverlay);
  // The office's own folder isn't fast-forwarded; its update is on the Office row instead.
  const officeFolder = useStore((s) => !!s.officeUpdate) && !!repo.folderSync?.startsWith('update ready');
  const team = agentsOnRepo(agents, repo.id);
  const others = all.filter((r) => r.id !== repo.id);
  const patch = (p: Parameters<typeof api.updateRepo>[1]) => void attempt(() => api.updateRepo(repo.id, p));
  return (
    <div className="card floor-card" style={{ ['--accent' as string]: repo.color }}>
      <div className="row">
        <span className="floor-badge">{repo.floor}</span>
        <div className="grow">
          <a href={repo.url} target="_blank" rel="noreferrer">
            <b>{repo.fullName}</b>
          </a>
          {repo.summary && <div className="small">🧠 {repo.summary}</div>}
          <div className="muted small">
            {team.length} agents · {repo.issues.length} open issues · {repo.pulls.filter((p) => p.state === 'OPEN').length} open PRs · default branch <code>{repo.defaultBranch}</code>
            {repo.cloneStatus !== 'ready' && ` · checkout: ${repo.cloneStatus}`}
          </div>
          <div className="muted small" title={repo.localPath ? 'Your own project folder' : 'A clone the office manages'}>
            📁 <code>{repo.checkoutPath}</code>
            {officeFolder ? " · the office's own folder, updated from the Office row" : repo.folderSync && <span title={repo.folderSync}> · {repo.folderSync}</span>}{' '}
            <button className="btn btn-small btn-ghost" title="Fast-forward it to GitHub's default branch, when that's safe" onClick={() => void attempt(() => api.syncFolder(repo.id))}>
              ⟳ Sync now
            </button>
          </div>
          {repo.cloneError && <div className="term-error small">clone failed: {repo.cloneError}</div>}
          {repo.syncError && <div className="term-error small">sync failed: {repo.syncError}</div>}
        </div>
        <input type="color" value={repo.color} onChange={(e) => patch({ color: e.target.value })} title="Floor colour" aria-label={`Floor ${repo.floor} colour`} />
        <button className="btn btn-small" onClick={() => goToFloor(repo.floor)}>
          Visit
        </button>
      </div>
      <div className="row wrap">
        <label className="toggle">
          <input type="checkbox" checked={repo.autoAssign} onChange={(e) => patch({ autoAssign: e.target.checked })} /> ⚡ Auto-assign issues
        </label>
        <label className="toggle" title="Merge a PR as soon as QA has signed off on its latest commit and GitHub's checks are green">
          <input type="checkbox" checked={repo.autoMerge} onChange={(e) => patch({ autoMerge: e.target.checked })} /> 🔀 Auto-merge
        </label>
        <label className="toggle">
          <input type="checkbox" checked={repo.browserTesting} onChange={(e) => patch({ browserTesting: e.target.checked })} /> 🌐 Browser testing (Playwright MCP)
        </label>
        <span className="spacer" />
        <button
          className="btn btn-small btn-ghost"
          onClick={() => {
            void confirmDialog({
              tone: 'danger',
              title: `Disconnect ${repo.fullName}?`,
              body: `Everyone on this floor is let go. Nothing is deleted on GitHub, and ${repo.localPath ? 'your folder stays exactly as it is' : 'the local clone stays on disk'}.`,
              confirm: 'Disconnect',
            }).then((ok) => ok && attempt(() => api.disconnectRepo(repo.id)));
          }}
        >
          Disconnect
        </button>
      </div>
      {others.length > 0 && (
        <div className="row wrap links">
          <span className="muted small">🔗 Agents here may read:</span>
          {others.map((o) => (
            <label key={o.id} className="toggle small">
              <input
                type="checkbox"
                checked={repo.links.includes(o.id)}
                onChange={(e) => patch({ links: e.target.checked ? [...repo.links, o.id] : repo.links.filter((l) => l !== o.id) })}
              />
              {o.fullName}
            </label>
          ))}
        </div>
      )}
      <details className="small preview-details">
        <summary>
          🖥️ App preview · <PreviewPill status={repo.preview.status} />
          {repo.previewConfig.command ? (
            <>
              {' '}
              <code>{repo.previewConfig.command}</code>
            </>
          ) : (
            ' auto-detected command'
          )}
        </summary>
        <PreviewSettings repo={repo} />
        <button className="btn btn-small" onClick={() => openOverlay({ kind: 'app', repoId: repo.id })}>
          Open the app viewer
        </button>
      </details>
    </div>
  );
}

function FloorsTab() {
  const repos = useStore((s) => s.repos);
  const officeUpdate = useStore((s) => s.officeUpdate);
  return (
    <div className="tab-grid">
      <div>
        {officeUpdate && <OfficeRow update={officeUpdate} />}
        <h3 className="section">🏢 Floors</h3>
        {repos.length === 0 && <p className="muted">No floors yet. Add a project →</p>}
        {[...repos].sort((a, b) => a.floor - b.floor).map((r) => (
          <FloorRow key={r.id} repo={r} all={repos} />
        ))}
      </div>
      <div className="card">
        <h3>➕ Add a project</h3>
        <ProjectPicker />
      </div>
    </div>
  );
}

// ---------- CEO ----------

function FloorBrief({ repo }: { repo: RepoView }) {
  const [mission, setMission] = useState(repo.mission);
  useEffect(() => setMission(repo.mission), [repo.mission]);
  return (
    <div className="card floor-card" style={{ ['--accent' as string]: repo.color }}>
      <div className="row">
        <span className="floor-badge">{repo.floor}</span>
        <div className="grow">
          <b>{repo.fullName}</b>
          <div className="muted small">{repo.summary ? `🧠 ${repo.summary}` : 'The CEO has not studied this floor yet.'}</div>
        </div>
        <button className="btn btn-small btn-ghost" onClick={() => void attempt(() => api.onboardFloor(repo.id))} title="Study the repo again and rethink the team">
          Re-study
        </button>
      </div>
      <textarea value={mission} onChange={(e) => setMission(e.target.value)} rows={2} placeholder="Brief: what should this floor build next? The CEO turns it into issues and a team." />
      <div className="row">
        <button className="btn btn-small" disabled={mission === repo.mission} onClick={() => void attempt(() => api.updateRepo(repo.id, { mission }))}>
          Save brief
        </button>
        <span className="spacer" />
        <button className="btn btn-small btn-good" disabled={!mission.trim()} onClick={() => void attempt(() => api.planFloor(repo.id, mission))}>
          🧠 Ask the CEO to plan it
        </button>
      </div>
      <details className="small">
        <summary>QA brief{repo.qaBrief ? '' : ' (none yet)'}</summary>
        <textarea
          key={repo.qaBrief}
          rows={4}
          defaultValue={repo.qaBrief}
          placeholder="What QA testers must check on every PR for this project."
          onBlur={(e) => e.target.value !== repo.qaBrief && void attempt(() => api.updateRepo(repo.id, { qaBrief: e.target.value }))}
        />
      </details>
    </div>
  );
}

function CeoTab() {
  const ceo = useStore((s) => s.agents[CEO_ID]);
  const log = useStore((s) => s.logs[CEO_ID]) ?? [];
  const info = useStore((s) => s.ceo);
  const repos = useStore((s) => s.repos);
  const requests = useStore((s) => s.requests);
  const openOverlay = useStore((s) => s.openOverlay);
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);
  if (!ceo) return <p className="muted">The corner office is empty.</p>;
  const working = ceo.status === 'working';
  const pending = pendingRequests(requests);
  const send = (t: string) => {
    if (!t.trim()) return;
    setText('');
    void attempt(() => api.messageCeo(t));
  };
  const decided = requests.filter((r) => r.status !== 'pending').slice(-6).reverse();
  return (
    <div className="tab-grid">
      <div>
        <div className="card">
          <div className="row">
            <span className="avatar" style={{ background: ceo.color }}>
              {ceo.name[0]}
            </span>
            <NameInput agent={ceo} style={{ maxWidth: 140, fontWeight: 700 }} />
            <span className="muted small">CEO</span>
            <StatusPill status={ceo.status} />
            <span className="spacer" />
            <ModelInput agent={ceo} style={{ maxWidth: 150 }} />
            <EffortSelect agent={ceo} style={{ width: 'auto' }} />
          </div>
          <div className="small">
            <b>Now:</b> {working ? info.job?.label : 'free'}
            {info.queue.length > 0 && (
              <>
                {' '}
                · <b>Up next:</b> {info.queue.map((j) => j.label).join(' → ')}
              </>
            )}
          </div>
          <div className="muted small">
            {info.nextReviewAt ? `Next company review around ${new Date(info.nextReviewAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (skipped if nothing changed).` : 'Periodic reviews are off (Settings).'}
          </div>
          <PromptPreview agent={ceo} />
          {ceo.terminal ? (
            <LiveTerminal agentId={ceo.id} className="ceo-term" />
          ) : (
            <div className="term ceo-term" ref={scroller}>
              {log.length === 0 && <div className="term-line term-system">(nothing yet)</div>}
              {log.map((l) => (
                <div key={l.id} className={`term-line term-${l.kind}`}>
                  {l.text || ' '}
                </div>
              ))}
            </div>
          )}
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${ceo.name} (or press P anywhere for your phone)…`} />
            <MicButton kind="console" value={text} onChange={setText} onSend={send} />
            <button className="btn" disabled={!text.trim()}>
              Send
            </button>
          </form>
          <div className="row">
            {working && (
              <button className="btn btn-small btn-bad" onClick={() => void attempt(() => api.stop(ceo.id))}>
                ■ Stop
              </button>
            )}
            <button className="btn btn-small" disabled={repos.length === 0} onClick={() => void attempt(() => api.ceoReview())}>
              🔎 Review the company now
            </button>
            <button className="btn btn-small" onClick={() => openOverlay({ kind: 'phone', tab: 'chat' })}>
              📱 Open the phone
            </button>
          </div>
        </div>
      </div>
      <div>
        <h3 className="section">📄 Hiring {pending.length > 0 && <span className="badge">{pending.length}</span>}</h3>
        {pending.length === 0 && <p className="muted small">No proposals waiting. The CEO proposes hires when they study a floor or notice the team can't cover the work.</p>}
        {pending.map((r) => (
          <Resume key={r.id} req={r} />
        ))}
        {decided.length > 0 && (
          <details className="small" style={{ marginBottom: 12 }}>
            <summary>Recent decisions</summary>
            {decided.map((r) => (
              <Resume key={r.id} req={r} />
            ))}
          </details>
        )}
        <h3 className="section">🗺️ Project briefs</h3>
        {repos.length === 0 && <p className="muted small">Connect a repo first.</p>}
        {[...repos].sort((a, b) => a.floor - b.floor).map((r) => (
          <FloorBrief key={r.id} repo={r} />
        ))}
      </div>
    </div>
  );
}

// ---------- team ----------

function TeamTab() {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const settings = useStore((s) => s.settings);
  const openOverlay = useStore((s) => s.openOverlay);
  const terminal = settings.runtime === 'terminal';
  const [names, setNames] = useState<Record<string, string>>({});
  const [openBrief, setOpenBrief] = useState<string | null>(null);
  if (repos.length === 0) return <p className="muted">Connect a repo first; agents need a floor to sit on.</p>;
  return (
    <div>
      <TeamStats />
      {[...repos].sort((a, b) => a.floor - b.floor).map((repo) => {
        const team = agentsOnRepo(agents, repo.id);
        return (
          <div key={repo.id} className="card floor-card" style={{ ['--accent' as string]: repo.color }}>
            <div className="row">
              <span className="floor-badge">{repo.floor}</span>
              <b className="grow">{repo.fullName}</b>
              <input value={names[repo.id] ?? ''} onChange={(e) => setNames({ ...names, [repo.id]: e.target.value })} placeholder="Name (optional)" style={{ maxWidth: 160 }} />
              <button
                className="btn btn-small btn-good"
                disabled={team.filter((a) => a.role === 'dev').length >= 12}
                onClick={() =>
                  void attempt(() => api.hireAgent(repo.id, { name: names[repo.id] || undefined, role: 'dev' })).then(() => setNames({ ...names, [repo.id]: '' }))
                }
              >
                + Developer
              </button>
              <button
                className="btn btn-small"
                disabled={team.filter((a) => a.role === 'qa').length >= 3}
                onClick={() =>
                  void attempt(() => api.hireAgent(repo.id, { name: names[repo.id] || undefined, role: 'qa' })).then(() => setNames({ ...names, [repo.id]: '' }))
                }
              >
                + QA tester
              </button>
            </div>
            {team.length === 0 && <div className="muted small">No one works here yet.</div>}
            <table className="team">
              <tbody>
                {team.map((a) => (
                  <Fragment key={a.id}>
                  <tr>
                    <td>
                      <span className="dot" style={{ background: a.color }} />
                    </td>
                    <td>
                      <NameInput agent={a} />
                    </td>
                    <td className="nowrap">
                      <span className="chip" title={a.hiredBy === 'ceo' ? 'Hired on the CEO\'s proposal' : undefined}>
                        {a.role === 'qa' ? '🔍 QA' : '💻 Dev'}
                        {a.hiredBy === 'ceo' ? ' · 🧠' : ''}
                      </span>
                    </td>
                    <td>
                      <TitleInput agent={a} />
                    </td>
                    <td>
                      <SpecialtyInput agent={a} style={{ width: 96 }} />
                    </td>
                    <td>
                      <button className="btn btn-small btn-ghost" title="Job description and look" onClick={() => setOpenBrief(openBrief === a.id ? null : a.id)}>
                        📝{a.brief ? '' : ' +'}
                      </button>
                    </td>
                    <td>
                      <StatusPill status={a.status} />
                    </td>
                    <td className="small">{a.status === 'idle' ? <span className="muted">—</span> : a.task === 'qa' ? `testing PR #${a.prNumber}` : a.task === 'fix' ? `fixing PR #${a.prNumber}` : `#${a.issueNumber ?? ''} ${a.issueTitle ?? ''}`.slice(0, 40)}</td>
                    {terminal && (
                      <td>
                        <CliSelect agent={a} style={{ width: 112 }} />
                      </td>
                    )}
                    <td>
                      <ModelInput agent={a} style={{ minWidth: 110 }} />
                    </td>
                    <td>
                      <EffortSelect agent={a} style={{ width: 124 }} />
                    </td>
                    <td className="nowrap">
                      <button className="btn btn-small" onClick={() => openOverlay({ kind: 'terminal', agentId: a.id })}>
                        Terminal
                      </button>{' '}
                      <button
                        className="btn btn-small btn-ghost"
                        onClick={() =>
                          void confirmDialog({ tone: 'danger', icon: '👋', title: `Let ${a.name} go?`, body: 'Their worktree is removed. Branches they pushed stay on GitHub.', confirm: `Let ${a.name} go` }).then(
                            (ok) => ok && attempt(() => api.fireAgent(a.id)),
                          )
                        }
                      >
                        Let go
                      </button>
                    </td>
                  </tr>
                  {openBrief === a.id && (
                    <tr>
                      <td />
                      <td colSpan={terminal ? 11 : 10}>
                        <label className="row small">
                          <span>Drawn as</span>
                          <LookSelect agent={a} />
                        </label>
                        <BriefEditor agent={a} compact />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

// ---------- issues ----------

function IssuesTab({ initialRepo }: { initialRepo?: string }) {
  const repos = useStore((s) => s.repos);
  const allAgents = useStore((s) => s.agents);
  const [repoId, setRepoId] = useState(initialRepo ?? repos[0]?.id ?? '');
  const repo = repos.find((r) => r.id === repoId);
  const agents = useMemo(() => agentsOnRepo(allAgents, repoId), [allAgents, repoId]);
  if (repos.length === 0) return <p className="muted">Connect a repo first.</p>;
  return (
    <div className="tab-grid">
      <div className="card">
        <h3>📝 File a new issue</h3>
        <select value={repoId} onChange={(e) => setRepoId(e.target.value)} aria-label="Floor">
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              Floor {r.floor} · {r.fullName}
            </option>
          ))}
        </select>
        {repo && <IssueForm key={repo.id} repoId={repo.id} agents={agents} />}
      </div>
      <div className="card">
        <h3>Open issues on {repo?.fullName}</h3>
        <div className="repo-list tall">
          {repo?.issues.length === 0 && <div className="muted small">None. Nice.</div>}
          {repo?.issues.map((i) => {
            const holder = agents.find((a) => a.role === 'dev' && a.issueNumber === i.number && a.status !== 'idle');
            return (
              <div key={i.number} className="repo-row">
                <div>
                  <a href={i.url} target="_blank" rel="noreferrer">
                    #{i.number}
                  </a>{' '}
                  {i.title}
                  {i.labels.length > 0 && <div className="muted small">{i.labels.join(', ')}</div>}
                </div>
                <span className="repo-row-actions">
                  {holder ? (
                    <span className="agent-chip">
                      <span className="dot" style={{ background: holder.color }} />
                      {holder.name}
                    </span>
                  ) : (
                    <select value="" onChange={(e) => e.target.value && void attempt(() => api.assign(e.target.value, i.number))} aria-label={`Assign issue #${i.number}`}>
                      <option value="">Assign…</option>
                      {agents
                        .filter((a) => a.role === 'dev' && a.status !== 'working' && a.status !== 'preparing')
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  )}
                  <button
                    className="btn btn-small btn-ghost"
                    title="Close it on GitHub as not planned"
                    onClick={() =>
                      void confirmDialog({
                        tone: 'danger',
                        title: `Close #${i.number}?`,
                        body: `“${i.title}” will be closed on GitHub as not planned${holder ? `, and ${holder.name} stops working on it` : ''}.`,
                        confirm: 'Close issue',
                      }).then((ok) => ok && attempt(() => api.closeIssue(repo.id, i.number)))
                    }
                  >
                    Close
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------- settings ----------

function SettingsTab() {
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const user = useStore((s) => s.user);
  const workspaceRoot = useStore((s) => s.workspaceRoot);
  const demo = useStore((s) => s.demo);
  const set = (p: Parameters<typeof api.updateSettings>[0]) => void attempt(() => api.updateSettings(p));
  const terminal = settings.runtime === 'terminal';
  const defaultCli = terminal ? settings.defaultCli : 'claude';
  return (
    <div className="tab-grid">
      <div className="card">
        <h3>🧠 Agents</h3>
        {terminal && (
          <label className="field">
            <span>Default coding agent</span>
            <select value={settings.defaultCli} onChange={(e) => set({ defaultCli: e.target.value as AgentCli })}>
              <CliOptions clis={clis} />
            </select>
          </label>
        )}
        <label className="field">
          <span>Default model{terminal ? ` for ${cliName(clis, settings.defaultCli)}` : ''}</span>
          <input
            key={`${settings.defaultCli}:${settings.defaultModel}`}
            list={defaultCli === 'claude' ? 'models-s' : undefined}
            defaultValue={settings.defaultModel}
            placeholder="the agent's own default"
            onBlur={(e) => e.target.value !== settings.defaultModel && set({ defaultModel: e.target.value })}
          />
          <datalist id="models-s">
            {CLAUDE_MODELS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Default effort</span>
          <select value={settings.defaultEffort} onChange={(e) => set({ defaultEffort: e.target.value as EffortLevel })}>
            {EFFORTS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">
          {terminal
            ? 'Each worker can use their own coding agent, model and effort (Team tab); the CEO always runs Claude Code. Claude Code reports every step; Codex and OpenCode are experimental: the office sees their task rather than each step.'
            : 'The Agent SDK runs Claude Code. Each worker can use their own model and effort (Team tab).'}
        </p>
        <label className="field">
          <span>Session limit</span>
          <input type="number" min={0} placeholder="No limit" defaultValue={settings.sessionLimit || ''} onBlur={(e) => set({ sessionLimit: Number(e.target.value) || 0 })} />
        </label>
        <p className="muted small">
          Leave empty so every agent with work runs at once. Agents on the same coding agent share its subscription's usage limits, and each one is its own process on this PC, so set a limit if
          you hit either.
        </p>
        <label className="field">
          <span>Sessions while pacing</span>
          <input
            key={settings.pacingSessions}
            type="number"
            min={1}
            max={32}
            defaultValue={settings.pacingSessions}
            onBlur={(e) => Number(e.target.value) !== settings.pacingSessions && set({ pacingSessions: Number(e.target.value) || 3 })}
          />
        </label>
        <p className="muted small">When Claude warns that usage is getting high, new issues only start while fewer sessions than this are running. QA, fixes and the CEO carry on.</p>
        <h3>🧠 The CEO</h3>
        <label className="toggle block">
          <input type="radio" checked={settings.hiring === 'approve'} onChange={() => set({ hiring: 'approve' })} />
          <span>
            <b>I approve every hire</b> (recommended): the CEO's proposals wait on your phone.
          </span>
        </label>
        <label className="toggle block">
          <input type="radio" checked={settings.hiring === 'auto'} onChange={() => set({ hiring: 'auto' })} />
          <span>
            <b>Auto-approve</b> while a floor has fewer people than the team cap. Anything beyond the cap still waits for you.
          </span>
        </label>
        <label className="field">
          <span>Team cap per floor</span>
          <input type="number" min={1} max={15} defaultValue={settings.teamCap} onBlur={(e) => set({ teamCap: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Company review every (minutes, 0 = off)</span>
          <input type="number" min={0} max={1440} defaultValue={settings.ceoHeartbeatMin} onBlur={(e) => set({ ceoHeartbeatMin: Number(e.target.value) })} />
        </label>
        <p className="muted small">A review is skipped when nothing changed since the last one. The CEO's own model and effort are on the CEO tab.</p>
      </div>
      <div className="card">
        <h3>⌨️ How agents run</h3>
        <label className="toggle block">
          <input type="radio" checked={settings.runtime === 'terminal'} onChange={() => set({ runtime: 'terminal' })} />
          <span>
            <b>Real terminals</b> (recommended): every agent is its actual coding agent running in its own terminal. Open a desk to watch it live or type into it.
          </span>
        </label>
        <label className="toggle block">
          <input type="radio" checked={settings.runtime === 'sdk'} onChange={() => set({ runtime: 'sdk' })} />
          <span>
            <b>Agent SDK</b>: Claude Code through the Claude Agent SDK, shown as a log of its steps. Claude Code only.
          </span>
        </label>
        <p className="muted small">
          Agents work like your own coding agents in a terminal, with your skills, MCP servers and settings, and don't stop to ask. The office's workflow (branches, pull requests, QA reporting
          back) is in their instructions.
        </p>
        <h3>🏢 Company</h3>
        <label className="field">
          <span>Your name</span>
          <input defaultValue={settings.managerName} placeholder={user ?? 'Boss'} onBlur={(e) => e.target.value !== settings.managerName && set({ managerName: e.target.value })} />
        </label>
        <label className="field">
          <span>Company name</span>
          <input defaultValue={settings.companyName} placeholder="cubefarm" onBlur={(e) => e.target.value !== settings.companyName && set({ companyName: e.target.value })} />
        </label>
        <label className="field">
          <span>The office dog's name</span>
          <input key={settings.dogName} defaultValue={settings.dogName} placeholder="Biscuit" maxLength={24} onBlur={(e) => e.target.value.trim() !== settings.dogName && set({ dogName: e.target.value })} />
        </label>
        <label className="field">
          <span>Projects folder (new projects are created here)</span>
          <input key={settings.projectsDir} defaultValue={settings.projectsDir} onBlur={(e) => e.target.value.trim() && e.target.value !== settings.projectsDir && set({ projectsDir: e.target.value })} />
        </label>
        <label className="field">
          <span>Free idle desks after (minutes, 0 = never)</span>
          <input
            key={settings.trimIdleDesksMin}
            type="number"
            min={0}
            max={10080}
            defaultValue={settings.trimIdleDesksMin}
            onBlur={(e) => e.target.value !== '' && Number(e.target.value) !== settings.trimIdleDesksMin && set({ trimIdleDesksMin: Number(e.target.value) })}
          />
        </label>
        <p className="muted small">A desk left idle this long loses its node_modules and build output to save disk space. Its next task installs them again.</p>
        <div className="row">
          <button className="btn btn-small" onClick={() => set({ tutorialStep: 0 })}>
            🧭 Replay the tour
          </button>
        </div>
        <h3>ℹ️ Environment</h3>
        <div className="small">
          GitHub: <b>{user ?? 'not signed in'}</b>
          {demo && ' (demo)'}
          <br />
          Agent desks: <code>{workspaceRoot}</code>
        </div>
      </div>
      <ProfileSettings />
      <VoiceSettings />
      <OutsideSettings />
      <NotifySettings />
      <ThemeSettings />
    </div>
  );
}

/** card: open Mission control at this card (an alarm's id, or 'usage'). */
export function ManagerConsole({ initialTab, initialRepo, card }: { initialTab?: ManagerTab; initialRepo?: string; card?: string }) {
  const [tab, setTab] = useState<ManagerTab>(initialTab ?? 'floors');
  const pending = useStore((s) => pendingRequests(s.requests).length);
  const alarms = useStore((s) => s.ops.alarms.length);
  const tabs: [ManagerTab, string][] = [
    ['floors', '🏢 Floors & repos'],
    ['ops', `🛰️ Mission control${alarms ? ` (${alarms})` : ''}`],
    ['ceo', `🧠 CEO & hiring${pending ? ` (${pending})` : ''}`],
    ['team', '👩‍💻 Team'],
    ['issues', '📝 Issues'],
    ['settings', '⚙️ Settings'],
    ['timelapse', '📼 Time-lapse'],
    ['access', '♿ Accessibility'],
  ];
  return (
    <Panel wide title="🧑‍💼 Manager's console">
      <div className="tabs" role="tablist" aria-label="Console">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'tab-on' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="tab-body" role="tabpanel" aria-label={tabs.find(([k]) => k === tab)?.[1]}>
        {tab === 'floors' && <FloorsTab />}
        {tab === 'ops' && <OpsTab card={card} />}
        {tab === 'ceo' && <CeoTab />}
        {tab === 'team' && <TeamTab />}
        {tab === 'issues' && <IssuesTab initialRepo={initialRepo} />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'timelapse' && <TimeLapseTab />}
        {tab === 'access' && (
          <div className="tab-grid a11y-grid">
            <AccessibilitySettings />
          </div>
        )}
      </div>
    </Panel>
  );
}
