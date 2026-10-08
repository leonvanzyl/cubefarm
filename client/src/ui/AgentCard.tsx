import { useEffect, useState } from 'react';
import { ACTIVITY_ICONS, ACTIVITY_LABELS, clipText, recentActions, redact } from '../../../shared/activity';
import { isBusy, qaKey, useStore, type Agent } from '../store';
import { reportCard } from '../world/activityProbe';
import { agentLabel } from './floorRows';

// The card at the left edge (clear of their monitor) when you keep someone in your sights for a moment: who they are,
// what they're on and for how long, what they're doing now and their last few steps, turns and cost on this task, and
// the QA round while they're testing or fixing a PR. It only reads the store: E still opens their terminal.

const AIM_MS = 400;
const STATUS: Record<Agent['status'], string> = { idle: 'free', preparing: 'setting up', working: 'working', done: 'done', error: 'stuck', stopped: 'stopped' };

function elapsed(ms: number) {
  const m = Math.floor(ms / 60_000);
  return m < 1 ? `${Math.max(0, Math.floor(ms / 1000))}s` : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function onWhat(a: Agent): string | null {
  const title = a.issueTitle ? ` · ${a.issueTitle}` : '';
  if (a.role === 'ceo') return a.issueTitle;
  if (a.task === 'qa' && a.prNumber) return `testing PR #${a.prNumber}${title}`;
  if (a.task === 'fix' && a.prNumber) return `fixing PR #${a.prNumber}${title}`;
  if (a.issueNumber) return `#${a.issueNumber}${a.issueTitle ? ` ${a.issueTitle}` : ''}${a.prNumber ? ` · PR #${a.prNumber}` : ''}`;
  return null;
}

export function AgentCard() {
  const aimed = useStore((s) => (s.started && !s.overlay && !s.travel && s.focus?.action.kind === 'terminal' ? s.focus.action.agentId : null));
  const [held, setHeld] = useState<string | null>(null);
  useEffect(() => {
    setHeld(null);
    if (!aimed) return;
    const t = setTimeout(() => setHeld(aimed), AIM_MS);
    return () => clearTimeout(t);
  }, [aimed]);
  // Looking away (or at someone else) hides it at once; the new person's card waits for its own moment.
  const id = held !== null && held === aimed ? held : null;
  const agent = useStore((s) => (id ? s.agents[id] : undefined));
  const log = useStore((s) => (id ? s.logs[id] : undefined));
  const qa = useStore((s) => (agent?.prNumber ? s.qa[qaKey(agent.repoId, agent.prNumber)] : undefined));
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!id) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [id]);

  const actions = agent ? recentActions(log ?? [], 3) : [];
  const actionsKey = actions.join('\n');
  useEffect(() => {
    reportCard(agent ? { agentId: agent.id, name: agent.name, lines: actionsKey ? actionsKey.split('\n') : [] } : null);
  }, [agent, actionsKey]);
  useEffect(() => () => reportCard(null), []);
  if (!agent) return null;

  const busy = isBusy(agent);
  const act = busy ? agent.activity : null;
  const on = onWhat(agent);
  const round = (agent.task === 'fix' || agent.task === 'qa') && qa ? qa.round : null;
  return (
    <div className="agent-card" style={{ ['--who' as string]: agent.color }}>
      <div className="ac-head">
        <span className="ac-dot" />
        <span className="ac-who">
          <span className="ac-name">{agent.name}</span>
          <span className="ac-title">{agentLabel(agent, settings, clis)}</span>
        </span>
        <span className="ac-time">{busy && agent.startedAt ? `⏱ ${elapsed(now - agent.startedAt)}` : STATUS[agent.status]}</span>
      </div>
      {on && <div className="ac-on">{clipText(redact(on), 64)}</div>}
      {act && (
        <div className="ac-now">
          {ACTIVITY_ICONS[act.kind]} {ACTIVITY_LABELS[act.kind]}
          {act.detail && <span className="ac-detail"> · {act.detail}</span>}
        </div>
      )}
      {actions.length > 0 && (
        <ul className="ac-steps">
          {actions.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
      <div className="ac-foot">
        this task so far: {agent.turns} turn{agent.turns === 1 ? '' : 's'} · ${agent.costUsd.toFixed(2)}
        {round ? ` · QA round ${round}` : ''}
      </div>
    </div>
  );
}
