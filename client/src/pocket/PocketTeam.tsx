// Pocket mode's Team tab: everyone with their status, and the terminal panel's actions without the terminal: message,
// ■ Stop, ↺ Clear desk and assigning an issue (or a PR to test). The terminal itself is one tap away.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { agentsOnRepo, kanbanFor, useStore, type Agent } from '../store';
import { CEO_ID, type RepoView } from '../../../shared/types';
import { MessageBox } from '../ui/MessageBox';
import { toolVerb } from '../world/draw';
import { agentActions, assignChoices, doing } from './pocketData';

const STATUS_LABEL: Record<string, string> = { idle: 'free', preparing: 'setting up', working: 'working', done: 'done', error: 'needs help', stopped: 'stopped' };

export function Status({ status }: { status: string }) {
  return <span className={`status status-${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

/** Runs one REST call at a time per card; api() already toasts errors. */
function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  };
  return [busy, run] as const;
}

function AgentCard({ agent, repo }: { agent: Agent; repo: RepoView }) {
  const allAgents = useStore((s) => s.agents);
  const qa = useStore((s) => s.qa);
  const openOverlay = useStore((s) => s.openOverlay);
  const cols = useMemo(() => kanbanFor(repo, agentsOnRepo(allAgents, repo.id), qa), [repo, allAgents, qa]);
  const [busy, run] = useBusy();
  const [pick, setPick] = useState('');
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const can = agentActions(agent);
  const isQa = agent.role === 'qa';
  const choices = assignChoices(agent.role, cols);
  const working = agent.status === 'working' || agent.status === 'preparing';
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    if (await run(() => api.message(agent.id, t))) {
      setText('');
      setWriting(false);
    }
  };
  return (
    <div className={`pk-card pk-agent ${agent.status === 'error' ? 'pk-agent-bad' : ''}`}>
      <div className="pk-agent-head">
        <span className="avatar" style={{ background: agent.color }}>
          {agent.name[0]}
        </span>
        <div className="grow">
          <b>{agent.name}</b> <span className="muted small">{agent.title || (isQa ? 'QA tester' : 'Developer')}</span>
          <div className="small pk-ellipsis">
            {doing(agent)}
            {working && agent.currentTool ? <span className="muted"> · {toolVerb(agent.currentTool) || agent.currentTool}…</span> : null}
          </div>
        </div>
        <Status status={agent.status} />
      </div>
      {agent.lastError && !working && <div className="term-error small pk-error">⚠️ {agent.lastError}</div>}
      <div className="pk-actions">
        {can.stop && (
          <button className="btn btn-small btn-bad" disabled={busy} onClick={() => void run(() => api.stop(agent.id))}>
            ■ Stop
          </button>
        )}
        {can.assign && (
          <>
            <select className="pk-assign" value={pick} aria-label={`Give ${agent.name} ${isQa ? 'a pull request to test' : 'an issue'}`} onChange={(e) => setPick(e.target.value)} disabled={busy || choices.length === 0}>
              <option value="">{choices.length ? (isQa ? 'Pick a PR to test…' : 'Pick an issue…') : isQa ? 'Nothing to test' : 'Backlog is empty'}</option>
              {choices.map((c) => (
                <option key={c.key} value={c.number}>
                  {isQa ? 'PR ' : ''}#{c.number} {c.title}
                </option>
              ))}
            </select>
            <button
              className="btn btn-small btn-good"
              disabled={busy || !pick}
              onClick={() => void run(() => (isQa ? api.sendToQa(repo.id, Number(pick)) : api.assign(agent.id, Number(pick)))).then((ok) => ok && setPick(''))}
            >
              {isQa ? '🔍 Test' : '▶ Start'}
            </button>
          </>
        )}
        {can.clear && (
          <button className="btn btn-small" disabled={busy} onClick={() => void run(() => api.reset(agent.id))}>
            ↺ Clear desk
          </button>
        )}
        {can.message && (
          <button className={`btn btn-small ${writing ? 'btn-ghost' : ''}`} aria-expanded={writing} onClick={() => setWriting(!writing)}>
            💬 Message
          </button>
        )}
        <button className="btn btn-small btn-ghost" onClick={() => openOverlay({ kind: 'terminal', agentId: agent.id })}>
          Terminal
        </button>
      </div>
      {writing && can.message && (
        <form
          className="pk-msg"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <MessageBox
            value={text}
            onChange={setText}
            autoFocus
            aria-label={`Message ${agent.name}`}
            placeholder={working ? `Tell ${agent.name} something while they work…` : `Ask ${agent.name} for a follow-up…`}
          />
          <button className="btn btn-small btn-good" disabled={busy || !text.trim()}>
            Send
          </button>
        </form>
      )}
    </div>
  );
}

function CeoCard() {
  const ceo = useStore((s) => s.agents[CEO_ID]);
  const info = useStore((s) => s.ceo);
  const [busy, run] = useBusy();
  if (!ceo) return null;
  const working = ceo.status === 'working';
  return (
    <div className="pk-card pk-agent">
      <div className="pk-agent-head">
        <span className="avatar" style={{ background: ceo.color }}>
          {ceo.name[0]}
        </span>
        <div className="grow">
          <b>{ceo.name}</b> <span className="muted small">CEO</span>
          <div className="small pk-ellipsis">{working ? (info.job?.label ?? 'Working') : info.queue.length ? `Up next: ${info.queue.map((j) => j.label).join(' → ')}` : 'Free'}</div>
        </div>
        <Status status={ceo.status} />
      </div>
      {working && (
        <div className="pk-actions">
          <button className="btn btn-small btn-bad" disabled={busy} onClick={() => void run(() => api.stop(ceo.id))}>
            ■ Stop
          </button>
        </div>
      )}
    </div>
  );
}

export function Team({ focusRepo }: { focusRepo: string | null }) {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const focus = useRef<HTMLElement>(null);
  useEffect(() => focus.current?.scrollIntoView({ block: 'start' }), []);
  return (
    <div className="pk-page">
      <CeoCard />
      {repos.length === 0 && <p className="muted">No floors yet, so no team.</p>}
      {repos.map((repo) => {
        const team = agentsOnRepo(agents, repo.id);
        return (
          <section key={repo.id} ref={repo.id === focusRepo ? focus : undefined} className="pk-section" style={{ ['--accent' as string]: repo.color }}>
            <h3 className="pk-h">
              <span className="floor-badge">{repo.floor}</span> {repo.fullName.split('/')[1]}
              <span className="muted small"> · {team.length} people</span>
            </h3>
            {team.length === 0 && <p className="muted small">Nobody works here yet.</p>}
            {team.map((a) => (
              <AgentCard key={a.id} agent={a} repo={repo} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
