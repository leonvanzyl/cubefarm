// Careers (#226) in the HUD and the panels: an agent's career card (portrait, title, badges, stats, last merged PRs and
// what they're known for), the card that pops up when you look at a desk for a moment, and the Team tab's table.
import { useEffect, useRef, useState } from 'react';
import { avgFixRounds, knownFor, mergesThisWeek, passRate, rank, stickerFor, tenureDays, topSpecialty, type CareerView } from '../../../shared/careers';
import { useStore, type Agent } from '../store';
import { drawPortrait } from './portrait';

const PEEK_MS = 700;
const LAST = 5;

export const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
export const fixed1 = (x: number | null) => (x === null ? '—' : x.toFixed(1));

/** "3 days", "5 hours", "12 minutes" on the team. */
export function tenureText(c: CareerView, now: number) {
  const d = tenureDays(c, now);
  if (d >= 1) return `${Math.floor(d)} day${Math.floor(d) === 1 ? '' : 's'}`;
  const h = d * 24;
  if (h >= 1) return `${Math.floor(h)} hour${Math.floor(h) === 1 ? '' : 's'}`;
  const m = Math.max(1, Math.round(h * 60));
  return `${m} minute${m === 1 ? '' : 's'}`;
}

function ago(at: number, now: number) {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 60) return m <= 1 ? 'just now' : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function Portrait({ agent, size }: { agent: Agent; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (ctx) drawPortrait(ctx, size * 2, agent);
  }, [agent.id, agent.look, agent.role, agent.color, agent.hair, agent.skin, size]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} className="career-portrait" width={size * 2} height={size * 2} style={{ width: size, height: size }} aria-label={`${agent.name}'s portrait`} />;
}

function Stat({ label, value, title }: { label: string; value: string | number; title?: string }) {
  return (
    <div className="career-stat" title={title}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

export function CareerCard({ agent, compact = false }: { agent: Agent; compact?: boolean }) {
  const repo = useStore((s) => s.repos.find((r) => r.id === agent.repoId));
  const now = Date.now();
  const c = agent.career;
  if (!c) return <div className="career-card muted small">{agent.name} runs the company; their record is the whole office.</div>;
  const qa = agent.role === 'qa';
  const badges = [...new Set([agent.specialty, ...Object.entries(c.bySpecialty).filter(([k, n]) => k && n > 0).sort((a, b) => b[1] - a[1]).map(([k]) => k)])].filter(Boolean).slice(0, 4);
  return (
    <div className={`career-card ${compact ? 'career-compact' : ''}`} style={{ ['--accent' as string]: agent.color }}>
      <div className="career-head">
        <Portrait agent={agent} size={compact ? 64 : 88} />
        <div className="career-who">
          <div className="career-name">{agent.name}</div>
          <div className="career-title">
            {rank(c, agent.role)} · {agent.title || (qa ? 'QA tester' : 'Developer')}
            {repo ? ` · floor ${repo.floor}` : ''}
          </div>
          <div className="career-badges">
            {badges.map((b) => (
              <span key={b} className="career-badge" style={{ background: stickerFor(b).color }}>
                {stickerFor(b).text} {b}
              </span>
            ))}
            {c.firstPass >= 10 && <span className="career-badge career-star">⭐ 10 first-time passes</span>}
          </div>
          <div className="career-known">“{knownFor(c, agent.role)}”</div>
        </div>
      </div>
      <div className="career-stats">
        <Stat label="PRs merged" value={c.merged} />
        <Stat label="PRs opened" value={c.opened} />
        <Stat label="first-time QA" value={c.firstPass} title="PRs that passed QA on their first round" />
        <Stat label="QA pass rate" value={pct(passRate(c))} title={`${c.qaPass} of ${c.qaPass + c.qaFail} QA rounds on their PRs passed`} />
        <Stat label="fix rounds / PR" value={fixed1(avgFixRounds(c))} />
        <Stat label="QA reviews" value={c.reviews} />
        <Stat label="longest streak" value={c.best} title="PRs in a row that passed QA first time" />
        <Stat label="on the team" value={tenureText(c, now)} />
        {!compact && <Stat label="est. cost" value={`$${c.costUsd.toFixed(2)}`} title="What the coding agents report, API-equivalent; subscription usage is billed by plan" />}
        {!compact && <Stat label="turns" value={c.turns} />}
      </div>
      {c.recent.length > 0 && (
        <div className="career-recent">
          <div className="muted small">Last merged</div>
          {c.recent.slice(0, compact ? 3 : LAST).map((r) => (
            <div key={r.n} className="career-pr">
              {repo ? (
                <a href={`https://github.com/${repo.fullName}/pull/${r.n}`} target="_blank" rel="noreferrer">
                  #{r.n}
                </a>
              ) : (
                <b>#{r.n}</b>
              )}{' '}
              <span className="career-pr-title">{r.title || 'untitled'}</span> <span className="muted">{ago(r.at, now)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Look at someone's desk for a moment and their card pops up beside the crosshair. */
export function CareerPeek() {
  const id = useStore((s) => (s.focus?.id.startsWith('agent-') ? s.focus.id.slice(6) : null));
  const agent = useStore((s) => (id ? s.agents[id] : undefined));
  const overlay = useStore((s) => s.overlay);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return setShown(null);
    const t = setTimeout(() => setShown(id), PEEK_MS);
    return () => clearTimeout(t);
  }, [id]);
  if (!agent || shown !== agent.id || overlay || !agent.career) return null;
  return (
    <div className="career-peek" aria-live="polite">
      <CareerCard agent={agent} compact />
    </div>
  );
}

// ---------- the Team tab ----------

type Col = { key: string; label: string; title?: string; value: (a: Agent, c: CareerView, now: number) => number | string; show?: (a: Agent, c: CareerView, now: number) => string };

const COLS: Col[] = [
  { key: 'merged', label: 'Merged', value: (_a, c) => c.merged },
  { key: 'opened', label: 'Opened', value: (_a, c) => c.opened },
  { key: 'firstPass', label: '1st-time QA', title: 'PRs that passed QA on their first round', value: (_a, c) => c.firstPass },
  { key: 'rate', label: 'Pass rate', value: (_a, c) => passRate(c) ?? -1, show: (_a, c) => pct(passRate(c)) },
  { key: 'fixes', label: 'Fixes / PR', title: 'Fix rounds per merged PR', value: (_a, c) => avgFixRounds(c) ?? -1, show: (_a, c) => fixed1(avgFixRounds(c)) },
  { key: 'reviews', label: 'Reviews', title: 'QA reviews done', value: (_a, c) => c.reviews },
  { key: 'best', label: 'Streak', title: 'Longest run of PRs passing QA first time', value: (_a, c) => c.best },
  { key: 'week', label: 'This week', value: (_a, c, now) => mergesThisWeek(c, now) },
  { key: 'top', label: 'Mostly', title: 'The specialty they merged most', value: (_a, c) => topSpecialty(c)?.slug ?? '', show: (_a, c) => topSpecialty(c)?.slug ?? '—' },
  { key: 'since', label: 'On the team', value: (_a, c) => -c.since, show: (_a, c, now) => tenureText(c, now) },
  { key: 'cost', label: 'Cost', title: 'Estimated, as the coding agents report it', value: (_a, c) => c.costUsd, show: (_a, c) => `$${c.costUsd.toFixed(2)}` },
  { key: 'turns', label: 'Turns', value: (_a, c) => c.turns },
];

/** Everyone's stats in one sortable table (click a heading; again to flip it). */
export function TeamStats() {
  const agents = useStore((s) => s.agents);
  const repos = useStore((s) => s.repos);
  const openOverlay = useStore((s) => s.openOverlay);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'merged', dir: -1 });
  const now = Date.now();
  const col = COLS.find((c) => c.key === sort.key);
  const floor = (a: Agent) => repos.find((r) => r.id === a.repoId)?.floor ?? 0;
  const rows = Object.values(agents)
    .filter((a): a is Agent & { career: CareerView } => a.role !== 'ceo' && !!a.career)
    .sort((a, b) => {
      if (sort.key === 'name') return a.name.localeCompare(b.name) * sort.dir;
      if (sort.key === 'floor') return (floor(a) - floor(b)) * sort.dir;
      const va = col!.value(a, a.career, now);
      const vb = col!.value(b, b.career, now);
      const d = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return d * sort.dir || a.name.localeCompare(b.name);
    });
  if (!rows.length) return null;
  const head = (key: string, label: string, title?: string) => (
    <th key={key} title={title} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="sort-btn" onClick={() => setSort({ key, dir: sort.key === key ? (-sort.dir as 1 | -1) : key === 'name' || key === 'floor' ? 1 : -1 })}>
        {label}
        {sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );
  return (
    <div className="card team-stats">
      <div className="row">
        <b className="grow">🏅 Careers</b>
        <span className="muted small">Counted from what the office sees: PRs, QA rounds, fixes and merges. Look at a desk for a moment to see its card.</span>
      </div>
      <div className="team-stats-scroll">
        <table className="team stats-table">
          <thead>
            <tr>
              {head('name', 'Name')}
              {head('floor', 'Floor')}
              {COLS.map((c) => head(c.key, c.label, c.title))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="nowrap">
                  <span className="dot" style={{ background: a.color }} />{' '}
                  <button className="link-btn" title="Open their desk" onClick={() => openOverlay({ kind: 'terminal', agentId: a.id })}>
                    {a.name}
                  </button>{' '}
                  <span className="muted small">{a.role === 'qa' ? '🔍' : '💻'}</span>
                </td>
                <td>{repos.find((r) => r.id === a.repoId)?.floor ?? '—'}</td>
                {COLS.map((c) => (
                  <td key={c.key} className="num">
                    {c.show ? c.show(a, a.career, now) : c.value(a, a.career, now)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
