import { useEffect } from 'react';
import { useStore } from '../store';
import { ROOF } from '../world/layout';
import { Panel } from './Overlays';

export function ElevatorPanel() {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const floor = useStore((s) => s.floor);
  const goToFloor = useStore((s) => s.goToFloor);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'g' || e.key === '0') goToFloor(0);
      else if (e.key.toLowerCase() === 'r') goToFloor(ROOF);
      else if (/^[1-9]$/.test(e.key) && repos.some((r) => r.floor === Number(e.key))) goToFloor(Number(e.key));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [repos, goToFloor]);

  const floors = [...repos].sort((a, b) => b.floor - a.floor);
  return (
    <Panel title="🛗 Elevator">
      <div className="elevator">
        {/* the roof: always the top stop, however many floors there are */}
        <button className={`floor-btn ${floor === ROOF ? 'floor-btn-here' : ''}`} style={{ ['--accent' as string]: '#7cc6fe' }} onClick={() => goToFloor(ROOF)}>
          <span className="floor-btn-num">R</span>
          <span className="floor-btn-name">Roof terrace</span>
          <span className="floor-btn-meta">garden · deck chairs · telescope · barbecue</span>
        </button>
        {floors.map((r) => {
          const team = Object.values(agents).filter((a) => a.repoId === r.id);
          const busy = team.filter((a) => a.status === 'working' || a.status === 'preparing').length;
          const prs = r.pulls.filter((p) => p.state === 'OPEN').length;
          return (
            <button key={r.id} className={`floor-btn ${r.floor === floor ? 'floor-btn-here' : ''}`} style={{ ['--accent' as string]: r.color }} onClick={() => goToFloor(r.floor)}>
              <span className="floor-btn-num">{r.floor}</span>
              <span className="floor-btn-name">{r.fullName}</span>
              <span className="floor-btn-meta">
                {busy}/{team.length} busy · {r.issues.length} issues · {prs} PR{prs === 1 ? '' : 's'}
              </span>
            </button>
          );
        })}
        <button className={`floor-btn ${floor === 0 ? 'floor-btn-here' : ''}`} style={{ ['--accent' as string]: '#ff8a5b' }} onClick={() => goToFloor(0)}>
          <span className="floor-btn-num">G</span>
          <span className="floor-btn-name">Lobby &amp; manager's office</span>
          <span className="floor-btn-meta">connect repos · hire · file issues</span>
        </button>
        {repos.length === 0 && <p className="muted">No floors yet. Head to the manager's office to connect a GitHub repo or start a new project.</p>}
        <p className="muted small">Tip: press a floor number (or G, or R for the roof) while this panel is open.</p>
      </div>
    </Panel>
  );
}
