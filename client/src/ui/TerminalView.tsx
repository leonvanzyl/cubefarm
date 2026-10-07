import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CareerCard } from './CareerCard';
import { api } from '../api';
import { isBusy, kanbanFor, agentsOnRepo, useStore } from '../store';
import { AgentSetup } from './AgentSettings';
import { confirmDialog } from './Confirm';
import { LiveTerminal } from './LiveTerminal';
import { effectiveModel } from '../../../shared/models';
import { assignChoices } from '../pocket/pocketData';
import { agentLabel, workerCli } from './floorRows';
import { MessageBox } from './MessageBox';
import { MicButton } from './MicButton';
import { closeOverlay, Panel } from './Panel';
import { loadScreenshot } from '../screenshot';
import { toolVerb } from '../world/draw';
import { followAgent } from '../world/camera/rig';

const STATUS_LABEL: Record<string, string> = {
  idle: 'free',
  preparing: 'setting up',
  working: 'working',
  done: 'done',
  error: 'needs help',
  stopped: 'stopped',
};

export function StatusPill({ status }: { status: string }) {
  return <span className={`status status-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

function elapsed(from: number | null, to: number | null) {
  if (!from) return '';
  const s = Math.max(0, Math.floor(((to ?? Date.now()) - from) / 1000));
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function TerminalView({ agentId }: { agentId: string }) {
  const agent = useStore((s) => s.agents[agentId]);
  const log = useStore((s) => s.logs[agentId]) ?? [];
  const shotAt = useStore((s) => s.screens[agentId]);
  const repo = useStore((s) => s.repos.find((r) => r.id === s.agents[agentId]?.repoId));
  const allAgents = useStore((s) => s.agents);
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const [text, setText] = useState('');
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showCareer, setShowCareer] = useState(false);
  const [, tick] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // The browser pane shows the last screenshot that loaded, never a broken image. The loaded <img> itself goes in
  // the pane, so showing it never asks the server again.
  const shotView = useRef<HTMLDivElement>(null);
  const [shot, setShot] = useState<{ agentId: string; img: HTMLImageElement } | null>(null);
  const shotTime = agent?.hasScreenshot ? (shotAt ?? agent.screenshotAt) : null;

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(
    () =>
      loadScreenshot(agentId, shotTime, (img) => {
        img.alt = 'Latest browser screenshot from the agent';
        setShot({ agentId, img });
      }),
    [agentId, shotTime],
  );
  useEffect(() => {
    shotView.current?.replaceChildren(...(shot?.agentId === agentId ? [shot.img] : []));
  }, [shot, agentId, agent?.hasScreenshot]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [log.length]);

  const qaRecords = useStore((s) => s.qa);
  const cols = useMemo(() => (repo ? kanbanFor(repo, agentsOnRepo(allAgents, repo.id), qaRecords) : null), [repo, allAgents, qaRecords]);
  // Any free agent takes either: an issue from the backlog, or a pull request waiting for QA.
  const choices = assignChoices(cols);
  const chosen = choices.find((c) => c.key === pick);

  if (!agent || !repo) {
    return (
      <Panel title="Terminal">
        <p className="muted">That agent has left the building.</p>
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
  const working = isBusy(agent);
  const cli = workerCli(agent, settings);
  const issueUrl = agent.issueNumber ? `https://github.com/${repo.fullName}/issues/${agent.issueNumber}` : null;
  const canMessage = working || (agent.task !== 'qa' && !!agent.branch && agent.status !== 'idle');
  const qaRec = agent.prNumber ? qaRecords[`${repo.id}#${agent.prNumber}`] : undefined;
  const send = (t: string) => {
    const body = t.trim();
    if (!body) return;
    setText('');
    void run(() => api.message(agent.id, body));
  };

  return (
    <Panel
      wide
      accent={agent.color}
      title={
        <div className="term-title">
          <span className="avatar" style={{ background: agent.color }}>
            {agent.name[0]}
          </span>
          <span>{agent.name}</span>
          <span className="chip" title="Their coding agent">
            ⌨️ {agentLabel(agent, settings, clis)}
          </span>
          <StatusPill status={agent.status} />
          {working && agent.currentTool && <span className="muted small">{toolVerb(agent.currentTool)}…</span>}
          <span className="spacer" />
          <button className="btn btn-small" title={`Trail ${agent.name} with the camera wherever they go (a movement key or Esc gives you the controls back)`} onClick={() => followAgent(agent.id)}>
            🎥 Follow
          </button>
          {agent.career && (
            <button className={`btn btn-small setup-toggle ${showCareer ? 'setup-toggle-on' : ''}`} aria-expanded={showCareer} title={`${agent.name}'s career on the team`} onClick={() => setShowCareer((v) => !v)}>
              🏅 Career
            </button>
          )}
          <button
            className={`btn btn-small setup-toggle ${showSetup ? 'setup-toggle-on' : ''}`}
            aria-expanded={showSetup}
            aria-controls="agent-setup"
            title={`${agent.name}'s name, look, coding agent, model and effort`}
            onClick={() => setShowSetup((v) => !v)}
          >
            ⚙️ Setup
          </button>
        </div>
      }
    >
      <div className="term-meta">
        {agent.task === 'qa' && agent.status !== 'idle' ? (
          <a href={agent.prUrl ?? '#'} target="_blank" rel="noreferrer">
            Testing PR #{agent.prNumber}: {agent.issueTitle}
          </a>
        ) : agent.task === 'fix' && agent.status !== 'idle' ? (
          <a href={agent.prUrl ?? '#'} target="_blank" rel="noreferrer">
            Fixing PR #{agent.prNumber} after QA: {agent.issueTitle}
          </a>
        ) : agent.issueNumber && agent.status !== 'idle' ? (
          <a href={issueUrl!} target="_blank" rel="noreferrer">
            Issue #{agent.issueNumber}: {agent.issueTitle}
          </a>
        ) : (
          <span className="muted">Nothing assigned</span>
        )}
        {agent.prUrl && agent.task === 'issue' && (
          <a href={agent.prUrl} target="_blank" rel="noreferrer" className="chip chip-good">
            PR #{agent.prNumber}
          </a>
        )}
        {qaRec && agent.status !== 'idle' && (
          <span className={`chip ${qaRec.status === 'passed' ? 'chip-good' : ''}`}>
            QA: {qaRec.status}
            {qaRec.round > 1 ? ` · round ${qaRec.round}` : ''}
          </span>
        )}
        {qaRec?.commentUrl && (
          <a href={qaRec.commentUrl} target="_blank" rel="noreferrer">
            QA report ↗
          </a>
        )}
        {agent.branch && <code>{agent.branch}</code>}
        <span className="muted">
          {(agent.role === 'ceo' ? agent.model : effectiveModel(agent.model, cli, settings, 'claude-opus-5-5')) || 'default model'} ·{' '}
          {agent.effort || settings.defaultEffort} effort
        </span>
        {agent.startedAt && <span className="muted">⏱ {elapsed(agent.startedAt, working ? null : agent.endedAt)}</span>}
        {agent.turns > 0 && <span className="muted">{agent.turns} turns</span>}
        {agent.costUsd > 0 && <span className="muted" title="API-equivalent cost reported by the coding agent; subscription usage is billed by plan">≈${agent.costUsd.toFixed(2)}</span>}
      </div>
      {agent.lastError && agent.status !== 'working' && <div className="term-error">⚠️ {agent.lastError}</div>}
      {showCareer && <CareerCard agent={agent} />}
      {showSetup && (
        <div id="agent-setup" className="setup-wrap">
          <AgentSetup agent={agent} />
        </div>
      )}

      <div className={`term-split ${agent.hasScreenshot ? 'term-split-2' : ''}`}>
        {agent.terminal ? (
          <LiveTerminal agentId={agent.id} />
        ) : (
          <div
            className="term"
            ref={scroller}
            onScroll={(e) => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
          >
            {log.length === 0 && <div className="term-line term-system">(no output yet)</div>}
            {log.map((l) => (
              <div key={l.id} className={`term-line term-${l.kind}`}>
                {l.text || ' '}
              </div>
            ))}
            {working && <div className="term-line term-spin">✻ {agent.status === 'preparing' ? (agent.currentTool ?? 'Setting up worktree') : toolVerb(agent.currentTool) || 'Thinking'}… ({elapsed(agent.startedAt, null)})</div>}
          </div>
        )}
        {agent.hasScreenshot && (
          <div className="browser">
            <div className="browser-bar">🔒 {agent.browserUrl ?? 'about:blank'}</div>
            <div className="browser-view" ref={shotView} />
            <div className="muted small">Latest Playwright screenshot{agent.screenshotAt ? ` · ${new Date(agent.screenshotAt).toLocaleTimeString()}` : ''}</div>
          </div>
        )}
      </div>

      <form
        className="term-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <MessageBox
          value={text}
          onChange={setText}
          aria-label={`Message ${agent.name}`}
          title="Enter sends · Shift+Enter adds a new line"
          placeholder={
            working
              ? `Tell ${agent.name} something while they work${agent.terminal ? ' (typed into their terminal)' : ''}…`
              : canMessage
                ? `Ask ${agent.name} for a follow-up (resumes their session)…`
                : `Give ${agent.name} an issue or a PR to test to get them started`
          }
          disabled={!canMessage}
          autoFocus={!agent.terminal}
        />
        <MicButton kind="agent" value={text} onChange={setText} onSend={send} disabled={!canMessage} />
        <button className="btn" disabled={busy || !canMessage || !text.trim()}>
          Send
        </button>
      </form>

      <div className="term-actions">
        {working ? (
          <button className="btn btn-bad" disabled={busy} onClick={() => run(() => api.stop(agent.id))}>
            ■ Stop
          </button>
        ) : (
          <>
            <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Work to give them">
              <option value="">{choices.length ? 'Pick an issue to build or a PR to test…' : 'Nothing to pick up'}</option>
              {(['issue', 'qa'] as const).map((kind) => {
                const group = choices.filter((c) => c.kind === kind);
                return (
                  group.length > 0 && (
                    <optgroup key={kind} label={kind === 'qa' ? 'Pull requests to test' : 'Issues to build'}>
                      {group.map((c) => (
                        <option key={c.key} value={c.key}>
                          {kind === 'qa' ? 'PR ' : ''}#{c.number} {c.title}
                        </option>
                      ))}
                    </optgroup>
                  )
                );
              })}
            </select>
            <button
              className="btn btn-good"
              disabled={busy || !chosen}
              onClick={() =>
                chosen &&
                run(async () => {
                  if (chosen.kind === 'qa') await api.sendToQa(repo.id, chosen.number, agent.id);
                  else await api.assign(agent.id, chosen.number);
                  setPick('');
                })
              }
            >
              {chosen?.kind === 'qa' ? `🔍 Test PR #${chosen.number}` : '▶ Start issue'}
            </button>
            {agent.status !== 'idle' && (
              <button className="btn" disabled={busy} onClick={() => run(() => api.reset(agent.id))}>
                ↺ Clear desk
              </button>
            )}
          </>
        )}
        <span className="spacer" />
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => {
            void run(async () => {
              const ok = await confirmDialog({
                tone: 'danger',
                icon: '👋',
                title: `Let ${agent.name} go?`,
                body: 'Their worktree is removed. Branches they pushed stay on GitHub.',
                confirm: `Let ${agent.name} go`,
              });
              if (!ok) return;
              await api.fireAgent(agent.id);
              closeOverlay();
            });
          }}
        >
          Let go
        </button>
      </div>
    </Panel>
  );
}
