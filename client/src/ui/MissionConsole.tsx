import { useEffect } from 'react';
import { api } from '../api';
import { fmtDuration, fmtPct, fmtUsd, usageMeter } from '../ops';
import { useStore } from '../store';
import type { OpsAlarm, OpsNumbers, RepoView } from '../../../shared/types';
import { confirmDialog } from './Confirm';

// The manager's console → Mission control: Claude's usage with "Resume full speed", what needs you (the alarms the
// lobby wall's beacon rings for), and every floor's numbers from the wall as a table.

async function attempt<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch {
    return undefined; // api() already toasted the error
  }
}

/** "Resume full speed": asks first, then clears pacing. From the console's button and E on the lobby's usage meter. */
export async function confirmResume() {
  const { usage, settings } = useStore.getState();
  if (usage.state !== 'pacing') return;
  if (document.pointerLockElement) document.exitPointerLock();
  const m = usageMeter(usage, Date.now());
  const ok = await confirmDialog({
    icon: '⏩',
    tone: 'warn',
    title: 'Resume full speed?',
    body: (
      <>
        <p>
          Claude warned that usage is getting high{usage.warning ? ` (${m.limit})` : ''}, so until {m.resets} new issues only start while fewer than {settings.pacingSessions} session{settings.pacingSessions === 1 ? '' : 's'} run.
        </p>
        <p>Resume if you've topped up or your usage was reset. If Claude still turns a session away at the limit, the office pauses until it resets.</p>
      </>
    ),
    confirm: 'Resume full speed',
  });
  if (ok) await attempt(() => api.resumeFullSpeed());
}

function UsageCard({ hot }: { hot: boolean }) {
  const usage = useStore((s) => s.usage);
  const sessions = useStore((s) => s.settings.pacingSessions);
  const demo = useStore((s) => s.demo);
  const m = usageMeter(usage, Date.now());
  const why =
    usage.state === 'pacing'
      ? `Until ${m.resets}, new issues only start while fewer than ${sessions} session${sessions === 1 ? '' : 's'} run; QA, fixes and the CEO carry on. Topped up, or was your usage reset? Resume full speed.`
      : usage.state === 'paused'
        ? `Claude turned a session away at the limit, so nothing new starts until ${m.resets}. That can't be cleared early; sessions already running carry on.`
        : 'New work starts at full speed. When Claude warns that usage is getting high, the office paces itself (Settings → Sessions while pacing).';
  return (
    <div id="ops-card-usage" className={`card usage-card usage-${m.tone} ${hot ? 'ops-card-hot' : ''}`}>
      <div className="row wrap">
        <b>🤖 Claude usage</b>
        <span className={`pill usage-pill-${m.tone}`}>{m.state}</span>
        <span className="spacer" />
        <button
          className="btn btn-small btn-good"
          disabled={usage.state !== 'pacing'}
          title={usage.state === 'paused' ? "A pause at the limit can't be cleared early" : usage.state === 'normal' ? 'Already at full speed' : 'Stop pacing new issues now'}
          onClick={() => void confirmResume()}
        >
          ⏩ Resume full speed
        </button>
      </div>
      <div className="usage-gauge" role="meter" aria-label="Claude usage at the last warning" aria-valuemin={0} aria-valuemax={100} aria-valuenow={m.pct ?? 0}>
        <div style={{ width: `${Math.min(100, m.pct ?? 0)}%`, background: (m.pct ?? 0) >= 90 ? 'var(--bad)' : (m.pct ?? 0) >= 75 ? 'var(--warn)' : 'var(--good)' }} />
      </div>
      <div className="small">
        <b>{m.limit}</b>
        {m.resets && ` · resets ${m.resets}`}
      </div>
      <div className="muted small">{why}</div>
      {demo && (
        <div className="row wrap">
          <span className="muted small">Demo:</span>
          <button className="btn btn-small btn-ghost" onClick={() => void attempt(() => api.simulateUsage('warning'))}>
            Simulate a usage warning
          </button>
          <button className="btn btn-small btn-ghost" onClick={() => void attempt(() => api.simulateUsage('limit'))}>
            Simulate reaching the limit
          </button>
        </div>
      )}
    </div>
  );
}

function AlarmCard({ alarm, repo, hot }: { alarm: OpsAlarm; repo: RepoView | undefined; hot: boolean }) {
  const openOverlay = useStore((s) => s.openOverlay);
  const goToFloor = useStore((s) => s.goToFloor);
  const pr = alarm.prNumber !== null ? repo?.pulls.find((p) => p.number === alarm.prNumber) : undefined;
  return (
    <div id={`ops-card-${alarm.id}`} className={`card floor-card alarm-card ${hot ? 'ops-card-hot' : ''}`} style={{ ['--accent' as string]: repo?.color ?? '#ef476f' }}>
      <div className="row">
        <span className="floor-badge">{alarm.floor}</span>
        <div className="grow">
          <b>🚨 {alarm.text}</b>
          <div className="muted small">
            {repo?.fullName ?? alarm.repoId}
            {pr ? ` · ${pr.title}` : ''} · since {new Date(alarm.since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>
      <div className="row wrap">
        {alarm.kind === 'pr' && alarm.prNumber !== null ? (
          <>
            <button className="btn btn-small" onClick={() => openOverlay({ kind: 'kanban', repoId: alarm.repoId })}>
              📋 Open the Kanban
            </button>
            <button className="btn btn-small btn-good" onClick={() => void attempt(() => api.sendToQa(alarm.repoId, alarm.prNumber!))}>
              Retry QA
            </button>
            <button className="btn btn-small" title="Hand it to a developer with QA's findings" onClick={() => void attempt(() => api.sendBack(alarm.repoId, alarm.prNumber!))}>
              Send back to dev
            </button>
            {pr && (
              <a className="small" href={pr.url} target="_blank" rel="noreferrer">
                PR on GitHub ↗
              </a>
            )}
          </>
        ) : (
          alarm.agentId && (
            <>
              <button className="btn btn-small" onClick={() => openOverlay({ kind: 'terminal', agentId: alarm.agentId! })}>
                Terminal
              </button>
              <button className="btn btn-small btn-good" title="Clear their desk so they take new work" onClick={() => void attempt(() => api.reset(alarm.agentId!))}>
                Clear desk
              </button>
            </>
          )
        )}
        <span className="spacer" />
        <button className="btn btn-small btn-ghost" onClick={() => goToFloor(alarm.floor)}>
          Visit floor {alarm.floor}
        </button>
      </div>
    </div>
  );
}

const COLUMNS: [string, (n: OpsNumbers) => string, string?][] = [
  ['Ready', (n) => String(n.ready), 'Backlog issues that can start now'],
  ['Building', (n) => String(n.building)],
  ['In QA', (n) => String(n.inQa)],
  ['Fixing', (n) => String(n.fixing), 'Back with a developer: QA findings, checks or a conflict'],
  ['To merge', (n) => String(n.toMerge)],
  ['Needs you', (n) => `${n.needsYou}${n.triage ? ` (+${n.triage} 🧭)` : ''}`, '🧭: the CEO is looking first'],
  ['Merged today', (n) => `${n.mergedToday} (${n.mergedHour} last hour)`],
  ['Lead time', (n) => fmtDuration(n.leadMs), 'Median issue → merge over the last 24 hours'],
  ['QA wait', (n) => fmtDuration(n.qaWaitMs), 'Median wait for a tester over the last 24 hours'],
  ['CI', (n) => (n.ciRuns ? `${fmtPct(n.ciPass)} · ${fmtDuration(n.ciMs)}` : '—'), "GitHub's checks over 7 days: pass rate · median time"],
  ['Team', (n) => `${n.busy} busy · ${n.idle} idle${n.errors ? ` · ${n.errors} error` : ''}`],
  ['Cost today', (n) => `~${fmtUsd(n.costToday)}`, "An estimate from finished sessions' reported cost"],
];

function OpsTable() {
  const ops = useStore((s) => s.ops);
  const repos = useStore((s) => s.repos);
  const rows: [string, string, OpsNumbers][] = [
    ...ops.floors.map((f): [string, string, OpsNumbers] => {
      const r = repos.find((x) => x.id === f.repoId);
      return [`${f.floor} · ${r?.fullName.split('/')[1] ?? f.repoId}`, r?.color ?? '#ccc', f];
    }),
    ['All floors', '#1f1d2b', ops.total],
  ];
  return (
    <div className="ops-table-wrap">
      <table className="ops-table">
        <thead>
          <tr>
            <th />
            {rows.map(([name, color]) => (
              <th key={name} style={{ ['--accent' as string]: color }} className="ops-col">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COLUMNS.map(([label, value, tip]) => (
            <tr key={label}>
              <th title={tip}>{label}</th>
              {rows.map(([name, , n]) => (
                <td key={name}>{value(n)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {ops.ceoCostToday > 0 && <div className="muted small">The CEO's sessions today: ~{fmtUsd(ops.ceoCostToday)} (in All floors' cost).</div>}
    </div>
  );
}

export function OpsTab({ card }: { card?: string }) {
  const alarms = useStore((s) => s.ops.alarms);
  const repos = useStore((s) => s.repos);
  useEffect(() => {
    if (card) document.getElementById(`ops-card-${card}`)?.scrollIntoView({ block: 'center' });
  }, [card]);
  return (
    <div className="tab-grid">
      <div>
        <UsageCard hot={card === 'usage'} />
        <h3 className="section">🚨 Needs you {alarms.length > 0 && <span className="badge">{alarms.length}</span>}</h3>
        {alarms.length === 0 && <p className="muted small">All clear. The beacon on the lobby's mission control wall spins when a PR needs you or an agent has been stuck on an error for 10 minutes.</p>}
        {alarms.map((a) => (
          <AlarmCard key={a.id} alarm={a} repo={repos.find((r) => r.id === a.repoId)} hot={a.id === card} />
        ))}
      </div>
      <div>
        <h3 className="section">🛰️ The numbers</h3>
        <OpsTable />
      </div>
    </div>
  );
}
