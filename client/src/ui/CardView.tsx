import { useMemo } from 'react';
import { blockers } from '../../../shared/issues';
import { agentsOnRepo, kanbanFor, useStore, type Agent, type KanbanCard } from '../store';
import { elapsedLabel } from '../qaCard';
import { bodyExcerpt, cardLabel, canPeel, locateCard } from '../world/whiteboard';
import type { Col } from '../world/stickies';
import { Key } from './Key';
import { Markdown } from './Markdown';
import { Panel } from './Panel';

// One whiteboard card up close (E on a sticky): the issue and the first lines of its body, who has it and since when,
// what it waits for, and for a PR its QA round, QA's latest report and checks, and CI. It reads the office's state as
// it stands (and follows the card as it moves); nothing here asks the server for more.

const COLUMN: Record<Col, string> = { backlog: '📋 Backlog', progress: '🔨 In progress', qa: '🔍 In QA', ready: '✅ Ready to merge', merged: '🎉 Merged' };
const QA_ICON = { pass: '✓', fail: '✗', skip: '–' } as const;

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const since = (t: number | null | undefined) => (t && Number.isFinite(t) ? `since ${clock(t)} (${elapsedLabel(Date.now() - t)})` : '');
const ago = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? `${elapsedLabel(Date.now() - t)} ago` : '';
};

function Who({ agent, children }: { agent?: Agent; children: React.ReactNode }) {
  return (
    <div className="cardview-who">
      {agent && <span className="dot" style={{ background: agent.color }} />}
      <span>{children}</span>
    </div>
  );
}

export function CardView({ repoId, cardKey, number, pr }: { repoId: string; cardKey: string; number: number; pr: boolean }) {
  const repo = useStore((s) => s.repos.find((r) => r.id === repoId));
  const allAgents = useStore((s) => s.agents);
  const qaRecords = useStore((s) => s.qa);
  const agents = useMemo(() => agentsOnRepo(allAgents, repoId), [allAgents, repoId]);
  const cols = useMemo(() => (repo ? kanbanFor(repo, agents, qaRecords) : null), [repo, agents, qaRecords]);
  const at = cols ? locateCard(cols, cardKey, number, pr) : null;

  if (!repo || !at) {
    return (
      <Panel title={`📌 ${cardLabel({ number, pr })}`} className="cardview">
        <p className="muted">That card isn't on the board any more.</p>
      </Panel>
    );
  }
  const { card, col } = at;
  const pull = card.prNumber ? repo.pulls.find((p) => p.number === card.prNumber) : undefined;
  const issueNumber = pull ? pull.closesIssues[0] : card.number;
  const issue = issueNumber ? repo.issues.find((i) => i.number === issueNumber) : undefined;
  const open = new Set(repo.issues.map((i) => i.number));
  const waits = issue ? blockers(issue.body, open) : [];
  const waiters = issue ? repo.issues.filter((i) => blockers(i.body, open).includes(issue.number)).map((i) => i.number) : [];
  const excerpt = issue ? bodyExcerpt(issue.body) : null;
  const url = card.url ?? pull?.url ?? issue?.url;

  return (
    <Panel
      className="cardview"
      accent={repo.color}
      title={
        <span>
          📌 {cardLabel(card)} {card.title}
        </span>
      }
    >
      <div className="cardview-tags">
        <span className="pill">{COLUMN[col]}</span>
        {card.note && <span className={`pill ${card.tone ? `cardview-${card.tone}` : ''}`}>{card.note}</span>}
        {waits.length > 0 && <span className="pill cardview-warn">⏳ waits for #{waits.join(', #')}</span>}
        {waiters.length > 0 && <span className="pill">🔗 #{waiters.join(', #')} wait{waiters.length === 1 ? 's' : ''} for this</span>}
        {issue?.labels.map((l) => (
          <span key={l} className="pill cardview-label">
            {l}
          </span>
        ))}
      </div>

      <WhoHasIt card={card} col={col} filed={issue?.createdAt} opened={pull?.createdAt} mergedAt={pull?.mergedAt} />

      {pull && issue && (
        <h4 className="cardview-h">
          Closes #{issue.number}: {issue.title}
        </h4>
      )}
      {excerpt?.text ? (
        <div className="cardview-body">
          <Markdown text={excerpt.text} />
          {excerpt.more && <div className="muted small">…</div>}
        </div>
      ) : (
        !pull && <p className="muted small">The issue has no description.</p>
      )}

      {card.prNumber && <PrDetails card={card} pull={pull} />}

      <div className="cardview-foot">
        {url && (
          <a href={url} target="_blank" rel="noreferrer">
            Open {cardLabel(card)} on GitHub ↗
          </a>
        )}
        {card.qa?.commentUrl && (
          <a href={card.qa.commentUrl} target="_blank" rel="noreferrer">
            QA report ↗
          </a>
        )}
        <span className="spacer" />
        <span className="muted small">
          {canPeel(col, card) && (
            <>
              <Key action="drop" /> on the sticky takes it {col === 'backlog' ? "to a developer's desk" : 'to the QA lab'} ·{' '}
            </>
          )}
          <kbd>Esc</kbd> closes
        </span>
      </div>
    </Panel>
  );
}

function WhoHasIt({ card, col, filed, opened, mergedAt }: { card: KanbanCard; col: Col; filed?: string; opened?: string; mergedAt?: string | null }) {
  const a = card.agent;
  if (col === 'backlog') return <Who>Nobody has it yet{filed ? ` · filed ${ago(filed)}` : ''}</Who>;
  if (col === 'progress') return <Who agent={a}>{a ? `${a.name} has it ${since(a.startedAt)}` : 'Someone has it'}</Who>;
  if (col === 'merged') return <Who agent={a}>{`Merged${mergedAt ? ` ${ago(mergedAt)}` : ''}${a ? ` · written by ${a.name}` : ''}`}</Who>;
  if (card.qa?.status === 'testing') {
    return <Who agent={a}>{`🔍 ${a?.name ?? 'QA'} is testing it · round ${card.qa.round} ${since(card.qa.updatedAt)}`}</Who>;
  }
  if (card.qa?.status === 'fixing') return <Who agent={a}>{`🔧 ${a?.name ?? 'A developer'} is fixing it ${since(card.qa.updatedAt)}`}</Who>;
  return <Who agent={a}>{`${a ? `${a.name} wrote it` : 'Opened outside the office'}${opened ? ` · opened ${ago(opened)}` : ''}`}</Who>;
}

function PrDetails({ card, pull }: { card: KanbanCard; pull?: { checks: string; failedChecks: { name: string; url: string | null }[]; pendingChecks: string[]; mergeable: string; isDraft: boolean } }) {
  const q = card.qa;
  return (
    <div className="cardview-pr">
      <div className="cardview-section">
        <h4 className="cardview-h">🔍 QA{q ? ` · round ${q.round}` : ''}</h4>
        {!q && <p className="muted small">Not sent to QA yet.</p>}
        {q?.summary && <Markdown text={q.summary} className="cardview-summary" />}
        {q && !q.summary && <p className="muted small">No report yet{q.status === 'testing' ? ': the test is running' : ''}.</p>}
        {q && q.checks.length > 0 && (
          <ul className="cardview-checks">
            {q.checks.map((c, i) => (
              <li key={i} className={`cardview-check cardview-check-${c.result}`}>
                <b>{QA_ICON[c.result]}</b> {c.name}
                {c.details && <span className="muted"> · {c.details}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {pull && (
        <div className="cardview-section">
          <h4 className="cardview-h">⚙️ CI</h4>
          <div className="small">
            {pull.checks === 'passing' ? '✓ All checks pass' : pull.checks === 'failing' ? '✗ Checks failing' : pull.checks === 'pending' ? '… Checks running' : 'No checks'}
            {pull.mergeable === 'CONFLICTING' && <span className="cardview-bad-text"> · conflicts with the base branch</span>}
            {pull.isDraft && <span className="muted"> · draft</span>}
          </div>
          {pull.failedChecks.length > 0 && (
            <ul className="cardview-checks">
              {pull.failedChecks.map((c) => (
                <li key={c.name} className="cardview-check cardview-check-fail">
                  <b>✗</b>{' '}
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noreferrer">
                      {c.name}
                    </a>
                  ) : (
                    c.name
                  )}
                </li>
              ))}
            </ul>
          )}
          {pull.pendingChecks.length > 0 && <div className="muted small">Running: {pull.pendingChecks.join(', ')}</div>}
        </div>
      )}
    </div>
  );
}
