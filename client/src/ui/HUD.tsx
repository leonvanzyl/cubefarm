import { useMemo } from 'react';
import { floorPrCounts, repoOnFloor, usePhoneBadge, useStore } from '../store';
import { CEO_ID } from '../../../shared/types';
import { HeldHint } from './HeldHint';
import { eAction } from '../world/toys/sip';
import { stickyDrop } from '../world/boardHands';
import { WorkersPanel } from './WorkersPanel';
import { officeUpdateChip } from '../officeUpdate';

/** While the office is on its way to updating itself (or restarting to do it); opens the console's Office row. */
function OfficeUpdateChip() {
  const text = useStore((s) => (s.restarting ? '⟳ Office restarting…' : officeUpdateChip(s.officeUpdate)));
  const overlay = useStore((s) => s.overlay);
  const openOverlay = useStore((s) => s.openOverlay);
  if (!text || overlay?.kind === 'manager') return null;
  return (
    <button className="office-chip" onClick={() => openOverlay({ kind: 'manager', tab: 'floors' })} title="The office is updating itself. Open the manager's console">
      {text}
    </button>
  );
}

/** The phone in your pocket: always one key (or click) away, with a badge when the CEO is waiting on you. */
function PhoneButton() {
  const badge = usePhoneBadge();
  const started = useStore((s) => s.started);
  const overlay = useStore((s) => s.overlay);
  const openOverlay = useStore((s) => s.openOverlay);
  const ceo = useStore((s) => s.agents[CEO_ID]);
  if (!started || overlay?.kind === 'phone') return null;
  const busy = ceo?.status === 'working';
  return (
    <button className={`phone-btn ${badge ? 'phone-btn-ring' : ''}`} onClick={() => openOverlay({ kind: 'phone' })} title="Your phone (P)">
      <span className="phone-btn-icon">📱</span>
      {badge > 0 && <span className="badge phone-btn-badge">{badge}</span>}
      <span className="phone-btn-label">
        <kbd>P</kbd> {badge ? `${badge} waiting` : busy ? `${ceo.name} is working` : 'Phone'}
      </span>
    </button>
  );
}

/** On the phone icon while a message is read aloud (ui/voiceMessages.ts); a click stops it. */
function VoiceIndicator() {
  const speaking = useStore((s) => s.voiceSpeaking);
  const started = useStore((s) => s.started);
  if (!started || speaking === null) return null;
  return (
    <button className="voice-speaking" onClick={() => void import('./voiceMessages').then((v) => v.stopSpeaking())} title="Reading a message aloud. Click to stop" aria-label="Stop reading the message aloud">
      🔊
    </button>
  );
}

export function HUD() {
  const floor = useStore((s) => s.floor);
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const settings = useStore((s) => s.settings);
  const connected = useStore((s) => s.connected);
  const restarting = useStore((s) => s.restarting);
  const demo = useStore((s) => s.demo);
  const user = useStore((s) => s.user);
  const ghReady = useStore((s) => s.ghReady);
  const ghError = useStore((s) => s.ghError);
  const focus = useStore((s) => s.focus);
  const held = useStore((s) => s.held);
  // With coffee in hand, E sips whatever you aim at (except the coffee machine).
  const sip = eAction(held, focus?.action.kind ?? null) === 'sip';
  // With a sticky in hand, the hint says what E does with it here.
  const drop = stickyDrop(focus);
  const dropLabel = !drop || drop.kind === 'none' ? null : drop.kind === 'refuse' ? `⚠️ ${drop.label}` : drop.label;
  const overlay = useStore((s) => s.overlay);
  const locked = useStore((s) => s.locked);
  const started = useStore((s) => s.started);
  const travel = useStore((s) => s.travel);
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  const repo = floor === 0 ? null : repoOnFloor(repos, floor);
  const running = useMemo(() => Object.values(agents).filter((a) => a.status === 'working' || a.status === 'preparing').length, [agents]);
  const floorAgents = repo ? Object.values(agents).filter((a) => a.repoId === repo.id) : [];
  const qa = useStore((s) => s.qa);
  const prs = useMemo(() => (repo ? floorPrCounts(repo, qa) : null), [repo, qa]);

  return (
    <div className="hud">
      <div className="hud-floor" style={{ ['--accent' as string]: repo?.color ?? '#ff8a5b' }}>
        <div className="floor-num">{repo ? repo.floor : 'G'}</div>
        <div>
          <div className="floor-name">{repo ? repo.fullName : `${settings.companyName || 'cubefarm'} · Lobby`}</div>
          <div className="floor-sub">
            {repo && prs
              ? `${floorAgents.length} agents · ${floorAgents.filter((a) => a.status === 'working' || a.status === 'preparing').length} working · ${prs.inQa} in QA · ${prs.ready} ready to merge${prs.needsYou ? ` · ${prs.needsYou} need${prs.needsYou === 1 ? 's' : ''} you` : ''}`
              : `${repos.length} floor${repos.length === 1 ? '' : 's'} connected`}
          </div>
        </div>
      </div>

      <div className="hud-status">
        {demo && <span className="pill pill-demo">DEMO</span>}
        <span className={`pill ${connected ? 'pill-ok' : restarting ? 'pill-demo' : 'pill-bad'}`}>{connected ? '● live' : restarting ? '○ restarting' : '○ reconnecting'}</span>
        <span className="pill">
          ⚙️ {settings.sessionLimit ? `${running}/${settings.sessionLimit}` : running} sessions
        </span>
        {user && <span className="pill">🐙 {user}</span>}
      </div>

      <WorkersPanel />
      <OfficeUpdateChip />

      {!ghReady && ghError && <div className="hud-banner">⚠️ {ghError}</div>}

      {started && !overlay && !travel && <div className={`crosshair ${focus ? 'crosshair-hot' : ''}`} />}
      {started && !overlay && (focus || sip) && (
        <div className="hud-hint">
          <kbd>E</kbd> {!held && <>/ <kbd>Click</kbd> </>}
          {sip ? 'Sip coffee' : (dropLabel ?? focus?.label)}
          {!held && focus?.action.kind === 'card' && focus.action.peel && (
            <>
              {' '}
              · <kbd>G</kbd> / hold <kbd>Click</kbd> take it
            </>
          )}
          {!sip && focus?.action.kind === 'jukebox' && (
            <>
              {' '}
              · <kbd>−</kbd> <kbd>+</kbd> / <kbd>Scroll</kbd> volume
            </>
          )}
        </div>
      )}
      {started && !overlay && !travel && <HeldHint />}
      {started && !overlay && !locked && !travel && <div className="hud-resume">Click to look around</div>}
      {started && !(settings.setupDone && settings.tutorialStep >= 0) && (
        <div className="hud-help">
          <kbd>WASD</kbd> move · <kbd>Shift</kbd> run · <kbd>E</kbd> / <kbd>Click</kbd> interact · <kbd>P</kbd> phone · <kbd>Tab</kbd> workers · <kbd>M</kbd> mute · <kbd>H</kbd> help · <kbd>Esc</kbd> free mouse
        </div>
      )}

      <div className={`fade ${travel?.phase === 'closing' ? 'fade-in' : ''}`}>
        {travel && <div className="fade-label">{travel.to === 0 ? 'Lobby' : `Floor ${travel.to}`}</div>}
      </div>

      <PhoneButton />
      <VoiceIndicator />
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.level}`} onClick={() => dismiss(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
