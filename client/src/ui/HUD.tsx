import { useMemo } from 'react';
import { AgentCard } from './AgentCard';
import { floorPrCounts, repoOnFloor, usePhoneBadge, useStore } from '../store';
import { CEO_ID } from '../../../shared/types';
import { HeldHint } from './HeldHint';
import { CareerPeek } from './CareerCard';
import { CoinChip } from './CoinChip';
import './progressProbe';
import { eAction } from '../world/toys/sip';
import { stickyDrop } from '../world/boardHands';
import { WorkersPanel } from './WorkersPanel';
import { officeUpdateChip } from '../officeUpdate';
import { useCameraView } from '../world/camera/rig';
import { CameraHud, OverviewButton } from './CameraHud';
import { useKeyName } from './controls';
import { Key, MoveKeys } from './Key';
import { ROOF } from '../world/layout';
import { useRoof } from '../world/roof/roofState';
import { RoofHud } from './RoofHud';
import { usageChip } from '../ops';
import { togglePhoto, usePhotoGate } from '../photo/gate';

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

/** While Claude's usage holds new work back (pacing or paused); opens Mission control at the usage meter. */
function UsageChip() {
  const usage = useStore((s) => s.usage);
  const sessions = useStore((s) => s.settings.pacingSessions);
  const overlay = useStore((s) => s.overlay);
  const openOverlay = useStore((s) => s.openOverlay);
  const text = usageChip(usage, sessions, Date.now());
  if (!text || overlay?.kind === 'manager') return null;
  return (
    <button className={`office-chip usage-chip usage-chip-${usage.state}`} onClick={() => openOverlay({ kind: 'manager', tab: 'ops', card: 'usage' })} title="Claude's usage is holding new work back. Open Mission control">
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
  const key = useKeyName('phone');
  if (!started || overlay?.kind === 'phone') return null;
  const busy = ceo?.status === 'working';
  return (
    <button className={`phone-btn ${badge ? 'phone-btn-ring' : ''}`} onClick={() => openOverlay({ kind: 'phone' })} title={`Your phone (${key})`}>
      <span className="phone-btn-icon">📱</span>
      {badge > 0 && <span className="badge phone-btn-badge">{badge}</span>}
      <span className="phone-btn-label">
        <Key action="phone" /> {badge ? `${badge} waiting` : busy ? `${ceo.name} is working` : 'Phone'}
      </span>
    </button>
  );
}

/** Photo mode (K by default); a red dot while instant replay keeps the last 15 s (I saves them). */
function PhotoButton() {
  const started = useStore((s) => s.started);
  const replay = usePhotoGate((s) => s.replay);
  const photoKey = useKeyName('photo');
  const replayKey = useKeyName('saveReplay');
  if (!started) return null;
  return (
    <button className="pill pill-photo" onClick={togglePhoto} title={replay ? `Photo mode (${photoKey}). Instant replay is on: ${replayKey} saves the last 15 s` : `Photo mode (${photoKey}): freeze the office, frame a shot, record a clip`}>
      📷 <kbd>{photoKey}</kbd>
      {replay && <span className="pill-photo-rec" aria-label="Instant replay on" />}
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
  const replaying = useStore((s) => s.replaying);
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
  // In the overview, the building view and the follow cam there's no crosshair to aim (camera/rig.ts).
  const onFoot = useCameraView((s) => s.mode) === 'first';

  const roof = floor === ROOF;
  const scope = useRoof((s) => s.telescope); // the telescope's eyepiece has its own crosshair
  const repo = floor === 0 || roof ? null : repoOnFloor(repos, floor);
  const running = useMemo(() => Object.values(agents).filter((a) => a.status === 'working' || a.status === 'preparing').length, [agents]);
  const floorAgents = repo ? Object.values(agents).filter((a) => a.repoId === repo.id) : [];
  const qa = useStore((s) => s.qa);
  const prs = useMemo(() => (repo ? floorPrCounts(repo, qa) : null), [repo, qa]);

  return (
    <div className="hud">
      <div className="hud-floor" style={{ ['--accent' as string]: roof ? '#7cc6fe' : (repo?.color ?? '#ff8a5b') }}>
        <div className="floor-num">{roof ? 'R' : repo ? repo.floor : 'G'}</div>
        <div>
          <div className="floor-name">{roof ? `${settings.companyName || 'cubefarm'} · Roof terrace` : repo ? repo.fullName : `${settings.companyName || 'cubefarm'} · Lobby`}</div>
          <div className="floor-sub">
            {roof
              ? 'deck chairs, the barbecue and the telescope'
              : repo && prs
                ? `${floorAgents.length} agents · ${floorAgents.filter((a) => a.status === 'working' || a.status === 'preparing').length} working · ${prs.inQa} in QA · ${prs.ready} ready to merge${prs.needsYou ? ` · ${prs.needsYou} need${prs.needsYou === 1 ? 's' : ''} you` : ''}`
                : `${repos.length} floor${repos.length === 1 ? '' : 's'} connected`}
          </div>
        </div>
        <OverviewButton />
      </div>

      <div className="hud-status">
        {demo && <span className="pill pill-demo">DEMO</span>}
        <span className={`pill ${replaying ? 'pill-replay' : connected ? 'pill-ok' : restarting ? 'pill-demo' : 'pill-bad'}`}>{replaying ? '▶ replay' : connected ? '● live' : restarting ? '○ restarting' : '○ reconnecting'}</span>
        <span className="pill">
          ⚙️ {settings.sessionLimit ? `${running}/${settings.sessionLimit}` : running} sessions
        </span>
        <CoinChip />
        {user && <span className="pill">🐙 {user}</span>}
        <PhotoButton />
      </div>

      <WorkersPanel />
      <div className="hud-chips">
        <OfficeUpdateChip />
        <UsageChip />
      </div>

      {!ghReady && ghError && <div className="hud-banner">⚠️ {ghError}</div>}

      {started && !overlay && !travel && onFoot && !scope && <div className={`crosshair ${focus ? 'crosshair-hot' : ''}`} />}
      {started && !overlay && !travel && onFoot && <RoofHud />}
      <AgentCard />
      {started && !overlay && onFoot && (focus || sip) && (
        <div className="hud-hint">
          <Key action="interact" /> {!held && <>/ <kbd>Click</kbd> </>}
          {sip ? (held?.kind === 'sausage' ? 'Take a bite' : 'Sip coffee') : (dropLabel ?? focus?.label)}
          {!held && focus?.action.kind === 'card' && focus.action.peel && (
            <>
              {' '}
              · <Key action="drop" /> / hold <kbd>Click</kbd> take it
            </>
          )}
          {!sip && focus?.action.kind === 'jukebox' && (
            <>
              {' '}
              · <Key action="volumeDown" /> <Key action="volumeUp" /> / <kbd>Scroll</kbd> volume
            </>
          )}
        </div>
      )}
      {started && !overlay && !travel && onFoot && <HeldHint />}
      {started && !overlay && !travel && onFoot && <CareerPeek />}
      {started && !overlay && !locked && !travel && onFoot && <div className="hud-resume">Click to look around</div>}
      {started && !(settings.setupDone && settings.tutorialStep >= 0) && (
        <div className="hud-help">
          <MoveKeys joined /> move · <Key action="run" /> run · <Key action="interact" /> / <kbd>Click</kbd> interact · <Key action="phone" /> phone · <Key action="photo" /> photo · <Key action="overview" /> overview · <Key action="workers" /> workers ·{' '}
          <Key action="mute" /> mute · <Key action="help" /> help · <kbd>Esc</kbd> free mouse
        </div>
      )}

      <div className={`fade ${travel?.phase === 'closing' ? 'fade-in' : ''}`}>
        {travel && <div className="fade-label">{travel.to === 0 ? 'Lobby' : travel.to === ROOF ? 'Roof' : `Floor ${travel.to}`}</div>}
      </div>

      <CameraHud />
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
