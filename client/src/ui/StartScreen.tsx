import { usePhoneBadge, useStore } from '../store';
import { requestLook } from '../world/Player';
import { setMode } from '../pocket/mode';
import { CEO_ID } from '../../../shared/types';
import { keyName, useKeyName } from './controls';
import { Key } from './Key';
import { SetupWizard } from './SetupWizard';
import { unlockAudio } from './sfx';
import { announce } from './announce';

export function StartScreen() {
  const started = useStore((s) => s.started);
  const loaded = useStore((s) => s.loaded);
  const connected = useStore((s) => s.connected);
  const demo = useStore((s) => s.demo);
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const settings = useStore((s) => s.settings);
  const start = useStore((s) => s.start);
  const waiting = usePhoneBadge();
  const phoneKey = useKeyName('phone');
  if (started) return null;
  if (loaded && !settings.setupDone) return <SetupWizard />;

  const enter = () => {
    start();
    unlockAudio();
    requestLook();
    announce(
      `You're in the office. Press ${keyName('phone')} for your phone: its Company tab opens the console, the Kanban, a list view of this floor and the accessibility settings. ${keyName('help')} opens help.`,
    );
  };
  const ceo = agents[CEO_ID];
  const staff = Object.values(agents).filter((a) => a.role !== 'ceo').length;

  return (
    <div className="start">
      <div className="start-card">
        <div className="start-logo">✻</div>
        <h1>{settings.companyName || 'cubefarm'}</h1>
        <p className="start-tag">{settings.managerName ? `Welcome back, ${settings.managerName}.` : 'A cartoon office where a team of AI coding agents works through your GitHub issues.'}</p>
        <ul className="start-list">
          <li>
            🏢 {repos.length} project{repos.length === 1 ? '' : 's'}, {staff} {staff === 1 ? 'person' : 'people'} on staff{ceo ? `, and ${ceo.name} in the corner office` : ''}.
          </li>
          <li>{waiting ? `📱 ${waiting} thing${waiting === 1 ? '' : 's'} waiting on your phone. Press ${phoneKey} once you're in.` : `📱 Press ${phoneKey} anywhere for your phone.`}</li>
          <li>
            💻 Walk up behind anyone to watch their screen, or press <Key action="interact" /> (or click) on things to use them. <Key action="help" /> for help.
          </li>
        </ul>
        <button className="btn btn-big" onClick={enter} disabled={!loaded}>
          {loaded ? 'Enter the office' : connected ? 'Loading…' : 'Connecting to the swarm server…'}
        </button>
        <div className="start-meta">
          <button className="linkish start-pocket" onClick={() => setMode('pocket')} title="The office without the 3D building: tabs for the company, the CEO chat, the board, the team and approvals">
            📱 Pocket mode, for phones and touch screens
          </button>
          {demo && <span className="pill pill-demo">DEMO MODE: fake repos, fake agents</span>}
        </div>
      </div>
    </div>
  );
}
