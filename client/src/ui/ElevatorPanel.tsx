import { useEffect } from 'react';
import { useStore } from '../store';
import { requestLook } from '../world/Player';
import { Panel } from './Overlays';

/** Choose a floor and grab the mouse again, so you can look and walk as soon as the doors open.
 *  Must run inside the click/keydown handler: pointer lock needs a user gesture. */
function chooseFloor(n: number) {
  useStore.getState().goToFloor(n); // clears the overlay first; requestLook refuses while one is open
  requestLook(); // if the browser refuses, the "Click to look around" hint remains
}

export function ElevatorPanel() {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const floor = useStore((s) => s.floor);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'g' || e.key === '0') chooseFloor(0);
      else if (/^[1-9]$/.test(e.key) && repos.some((r) => r.floor === Number(e.key))) chooseFloor(Number(e.key));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [repos]);

  const floors = [...repos].sort((a, b) => b.floor - a.floor);
  return (
    <Panel title="🛗 Elevator">
      <div className="elevator">
        {floors.map((r) => {
          const team = Object.values(agents).filter((a) => a.repoId === r.id);
          const busy = team.filter((a) => a.status === 'working' || a.status === 'preparing').length;
          const prs = r.pulls.filter((p) => p.state === 'OPEN').length;
          return (
            <button key={r.id} className={`floor-btn ${r.floor === floor ? 'floor-btn-here' : ''}`} style={{ ['--accent' as string]: r.color }} onClick={() => chooseFloor(r.floor)}>
              <span className="floor-btn-num">{r.floor}</span>
              <span className="floor-btn-name">{r.fullName}</span>
              <span className="floor-btn-meta">
                {busy}/{team.length} busy · {r.issues.length} issues · {prs} PR{prs === 1 ? '' : 's'}
              </span>
            </button>
          );
        })}
        <button className={`floor-btn ${floor === 0 ? 'floor-btn-here' : ''}`} style={{ ['--accent' as string]: '#ff8a5b' }} onClick={() => chooseFloor(0)}>
          <span className="floor-btn-num">G</span>
          <span className="floor-btn-name">Lobby &amp; manager's office</span>
          <span className="floor-btn-meta">connect repos · hire · file issues</span>
        </button>
        {repos.length === 0 && <p className="muted">No floors yet. Head to the manager's office to connect a GitHub repo or start a new project.</p>}
        <p className="muted small">Tip: press a floor number (or G) while this panel is open.</p>
      </div>
    </Panel>
  );
}
