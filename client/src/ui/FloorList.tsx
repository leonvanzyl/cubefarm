// The list view (Settings → Accessibility, or the phone): a floor as a table of who is there, their status and what
// they're doing, with the panels you'd otherwise walk to. For anyone who can't use the 3D view; works by keyboard
// and screen reader. In the lobby it lists the CEO and every floor.
import { useMemo, useState } from 'react';
import { agentsOnRepo, floorPrCounts, useStore } from '../store';
import { CEO_ID } from '../../../shared/types';
import { floorRows, type FloorRow } from './floorRows';
import { Panel } from './Panel';

function People({ rows, caption }: { rows: FloorRow[]; caption: string }) {
  const openOverlay = useStore((s) => s.openOverlay);
  if (!rows.length) return <p className="muted">Nobody works here yet.</p>;
  return (
    <table className="floor-table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Job</th>
          <th scope="col">Status</th>
          <th scope="col">Doing</th>
          <th scope="col">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <th scope="row">{r.name}</th>
            <td>{r.role}</td>
            <td>
              <span className={`status-kind status-kind-${r.kind}`}>
                <span aria-hidden>{r.icon}</span> {r.status}
              </span>
            </td>
            <td>{r.doing}</td>
            <td>
              <button className="btn btn-small" onClick={() => openOverlay({ kind: 'terminal', agentId: r.id })} aria-label={`Open ${r.name}'s terminal`}>
                Terminal
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function FloorList() {
  const floor = useStore((s) => s.floor);
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const qa = useStore((s) => s.qa);
  const openOverlay = useStore((s) => s.openOverlay);
  const goToFloor = useStore((s) => s.goToFloor);
  const [shown, setShown] = useState(floor);
  const repo = repos.find((r) => r.floor === shown) ?? null;
  const rows = useMemo(() => (repo ? floorRows(agentsOnRepo(agents, repo.id)) : floorRows(agents[CEO_ID] ? [agents[CEO_ID]] : [])), [repo, agents]);
  const counts = repo ? floorPrCounts(repo, qa) : null;
  const busy = rows.filter((r) => r.kind === 'busy' || r.kind === 'waiting').length;

  return (
    <Panel title={repo ? `👥 Floor ${repo.floor}: ${repo.fullName}` : '👥 Lobby'} className="floor-list">
      <div className="row wrap">
        <label className="field-inline">
          <span>Floor</span>
          <select value={shown} onChange={(e) => setShown(Number(e.target.value))}>
            <option value={0}>Lobby</option>
            {repos.map((r) => (
              <option key={r.id} value={r.floor}>
                {r.floor} · {r.fullName}
              </option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        {shown !== floor && (
          <button className="btn btn-small" onClick={() => goToFloor(shown)}>
            🛗 Go there
          </button>
        )}
        {repo && (
          <>
            <button className="btn btn-small" onClick={() => openOverlay({ kind: 'kanban', repoId: repo.id })}>
              📋 Kanban
            </button>
            <button className="btn btn-small" onClick={() => openOverlay({ kind: 'app', repoId: repo.id })}>
              🖥️ App
            </button>
          </>
        )}
      </div>
      {repo && counts && (
        <p className="floor-summary">
          {rows.length} {rows.length === 1 ? 'person' : 'people'}, {busy} busy · {repo.issues.length} open issue{repo.issues.length === 1 ? '' : 's'} · {counts.inQa} in QA · {counts.ready} ready to merge
          {counts.needsYou ? ` · ${counts.needsYou} need${counts.needsYou === 1 ? 's' : ''} you` : ''}
        </p>
      )}
      <People rows={rows} caption={repo ? `Who is on floor ${repo.floor}` : 'Who is in the lobby'} />
      {!repo && repos.length > 0 && (
        <>
          <h3>Floors</h3>
          <ul className="floor-floors">
            {repos.map((r) => {
              const team = agentsOnRepo(agents, r.id);
              const working = team.filter((a) => a.status === 'working' || a.status === 'preparing').length;
              return (
                <li key={r.id}>
                  <button className="linkish" onClick={() => setShown(r.floor)}>
                    Floor {r.floor}: {r.fullName}
                  </button>{' '}
                  <span className="muted">
                    · {team.length} people, {working} working
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Panel>
  );
}
