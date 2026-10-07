import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { floorPrCounts, isBusy, pendingRequests, unreadMessages, useStore, type PhoneTab } from '../store';
import { CEO_ID, type AgentCli, type CliView, type EffortLevel, type HireRequestView, type PhoneMessage, type SwarmSettings } from '../../../shared/types';
import { Markdown } from './Markdown';
import { MessageBox } from './MessageBox';
import { MicButton } from './MicButton';
import { handsFreeProblem, setHandsFree } from './mic';
import { closeOverlay } from './Panel';
import { useDialogFocus } from './dialogFocus';
import { isKey } from './controls';
import { Key } from './Key';
import { Games, type GameId } from './games/Games';
import { HolidayStrip } from './HolidayStrip';
import { replayKind } from './voiceQueue';
import { CLAUDE_MODELS, effectiveModel, modelSuggestions } from '../../../shared/models';

// The manager's phone: text the CEO, decide on team changes, see the whole company at a glance
// without walking anywhere, and play a game while the team works. Press P anywhere in the office.

async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined; // api() already toasted the error
  }
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function Avatar({ name, color, size = 34 }: { name: string; color: string; size?: number }) {
  return (
    <span className="avatar" style={{ background: color, width: size, height: size, fontSize: size * 0.45 }}>
      {name[0]}
    </span>
  );
}

// ---------- team changes ----------

/** Every reasoning effort, lowest first ('' = the office default). */
const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** A coding agent's name, as the office lists it. */
export const cliLabel = (clis: CliView[], id: AgentCli) => clis.find((c) => c.id === id)?.label ?? id;

/** The coding agent a new agent will run: their own pick, else the office default; the Agent SDK runtime is Claude Code for everyone. */
export const hireCli = (cli: AgentCli | '', settings: Pick<SwarmSettings, 'runtime' | 'defaultCli'>): AgentCli =>
  settings.runtime !== 'terminal' ? 'claude' : cli || settings.defaultCli;

/** What the manager can set up on a new agent before hiring them: the CEO's picks to start with ('' = the office default). */
export interface HireSetup {
  name: string;
  cli: AgentCli | '';
  model: string;
  effort: EffortLevel | '';
}

export const setupOf = (r: HireRequestView): HireSetup => ({ name: r.name, cli: r.cli, model: r.model, effort: r.effort });

/** The approval's overrides: the setup as the manager left it, an emptied name back to the CEO's pick. */
export const hireOverrides = (r: HireRequestView, s: HireSetup) => ({ name: s.name.trim() || r.name, cli: s.cli, model: s.model.trim(), effort: s.effort });

/** "Claude Code · claude-opus-5-5 · medium effort": what they'll run, the office defaults filled in. */
export function setupLine(s: Pick<HireSetup, 'cli' | 'model' | 'effort'>, settings: SwarmSettings, clis: CliView[]) {
  const cli = hireCli(s.cli, settings);
  return `${cliLabel(clis, cli)} · ${effectiveModel(s.model, cli, settings, CLAUDE_MODELS[0]) || 'its default model'} · ${s.effort || settings.defaultEffort} effort`;
}

/** A new agent's settings, edited before they're created: the lobby's card and the phone's both use these. */
export function HireSetupFields({ value, onChange, disabled }: { value: HireSetup; onChange: (v: HireSetup) => void; disabled?: boolean }) {
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const id = useId();
  const sdk = settings.runtime !== 'terminal';
  const cli = hireCli(value.cli, settings);
  const set = (patch: Partial<HireSetup>) => onChange({ ...value, ...patch });
  return (
    <div className="hire-setup">
      <label className="field" htmlFor={`${id}-name`}>
        <span>Name</span>
        <input id={`${id}-name`} value={value.name} maxLength={24} disabled={disabled} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label className="field" htmlFor={`${id}-cli`}>
        <span>Coding agent</span>
        <select
          id={`${id}-cli`}
          value={sdk ? '' : value.cli}
          disabled={disabled || sdk}
          title={sdk ? 'The Agent SDK runs Claude Code for every agent (Settings → How agents run)' : undefined}
          onChange={(e) => set({ cli: e.target.value as AgentCli | '' })}
        >
          <option value="">{sdk ? 'Claude Code' : `${cliLabel(clis, settings.defaultCli)} (default)`}</option>
          {[...clis]
            .sort((a, b) => Number(b.installed) - Number(a.installed))
            .map((c) => (
              <option key={c.id} value={c.id} disabled={!c.installed}>
                {c.label}
                {c.installed ? '' : ' (not installed)'}
              </option>
            ))}
        </select>
      </label>
      <label className="field" htmlFor={`${id}-model`}>
        <span>Model</span>
        <input
          id={`${id}-model`}
          list={`${id}-models`}
          value={value.model}
          disabled={disabled}
          placeholder={effectiveModel('', cli, settings, CLAUDE_MODELS[0]) || 'agent default'}
          title="Empty: the default for their coding agent"
          onChange={(e) => set({ model: e.target.value })}
        />
        <datalist id={`${id}-models`}>
          {modelSuggestions(cli).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      <label className="field" htmlFor={`${id}-effort`}>
        <span>Effort</span>
        <select id={`${id}-effort`} value={value.effort} disabled={disabled} onChange={(e) => set({ effort: e.target.value as EffortLevel | '' })}>
          <option value="">default ({settings.defaultEffort})</option>
          {EFFORTS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/**
 * One team change as a card (the phone, the console, pocket mode): a new agent, with what they'll run and a way to
 * change it before hiring them, or an agent the CEO would let go. The CEO's reason either way.
 */
export function Resume({ req, highlight }: { req: HireRequestView; highlight?: boolean }) {
  const repo = useStore((s) => s.repos.find((r) => r.id === req.repoId));
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const [setup, setSetup] = useState(() => setupOf(req));
  const [editing, setEditing] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: 'center' });
  }, [highlight]);
  const pending = req.status === 'pending';
  const hire = req.kind === 'hire';
  const name = (hire && pending && setup.name.trim()) || req.name;
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    await attempt(fn);
    setBusy(false);
  };
  const outcome = req.status === 'approved' ? (hire ? '✅ hired' : '👋 left') : hire ? '✋ declined' : '🤝 kept';
  return (
    <div ref={ref} className={`resume ${hire ? '' : 'resume-letgo'} ${highlight ? 'resume-hot' : ''} ${pending ? '' : 'resume-done'}`}>
      <div className="resume-head">
        <Avatar name={name} color={req.color} size={42} />
        <div className="grow">
          <div className="resume-name">{hire ? name : `Let ${req.name} go?`}</div>
          <div className="resume-title">{hire ? 'A new agent' : 'Leaving the team'}</div>
        </div>
        {!pending && <span className={`chip ${req.status === 'approved' ? 'chip-good' : ''}`}>{outcome}</span>}
      </div>
      <div className="resume-meta">
        <span className="chip" style={{ background: repo?.color }}>
          Floor {repo?.floor ?? '?'}
        </span>
        <span className="muted small">{repo?.fullName.split('/')[1] ?? 'removed floor'}</span>
      </div>
      {req.reason && <Markdown className="resume-reason" text={req.reason} />}
      {hire && (
        <div className="resume-meta small">
          <span className="grow">⚙️ {setupLine(pending ? setup : req, settings, clis)}</span>
          {pending && (
            <button className="linkish small" aria-expanded={editing} onClick={() => setEditing(!editing)}>
              {editing ? 'Done' : 'Change'}
            </button>
          )}
        </div>
      )}
      {hire && pending && editing && <HireSetupFields value={setup} onChange={setSetup} disabled={busy} />}
      {!pending && req.note && <div className="muted small">Your note: “{req.note}”</div>}
      {pending && !declining && (
        <div className="row">
          <button className="btn btn-small btn-ghost" disabled={busy} onClick={() => setDeclining(true)}>
            {hire ? 'Decline' : 'Keep them'}
          </button>
          <span className="spacer" />
          <button className="btn btn-small btn-good" disabled={busy} onClick={() => act(() => api.approveRequest(req.id, hire ? hireOverrides(req, setup) : {}))}>
            {hire ? `Hire ${name}` : `Let ${req.name} go`}
          </button>
        </div>
      )}
      {pending && declining && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => api.rejectRequest(req.id, note));
          }}
        >
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why not? (optional, the CEO reads it)" autoFocus />
          <button className="btn btn-small btn-bad" disabled={busy}>
            {hire ? 'Decline' : 'Keep'}
          </button>
        </form>
      )}
    </div>
  );
}

/** New agents waiting in the lobby to be set up and hired, with a way down to meet them (unless you're there already). */
function LobbyNudge() {
  const n = useStore((s) => pendingRequests(s.requests).filter((r) => r.kind === 'hire').length);
  const inLobby = useStore((s) => s.floor === 0);
  const goToFloor = useStore((s) => s.goToFloor);
  if (!n) return null;
  return (
    <div className="phone-nudge" role="status">
      <span>🪑</span>
      <span className="grow">
        {n} new agent{n === 1 ? ' is' : 's are'} waiting in the lobby
      </span>
      {!inLobby && (
        <button className="btn btn-small" onClick={() => goToFloor(0)}>
          Meet them
        </button>
      )}
    </div>
  );
}

function TeamChanges({ focusId }: { focusId?: string }) {
  const requests = useStore((s) => s.requests);
  const demo = useStore((s) => s.demo);
  const pending = pendingRequests(requests);
  const decided = requests.filter((r) => r.status !== 'pending').slice(-8).reverse();
  return (
    <div className="phone-scroll">
      <h3 className="phone-h">👥 Waiting on you {pending.length > 0 && <span className="badge">{pending.length}</span>}</h3>
      {pending.length === 0 && <p className="muted small phone-empty">Nothing waiting. When the CEO wants a floor's team to grow or shrink, the change shows up here for your OK.</p>}
      {pending.map((r) => (
        <Resume key={r.id} req={r} highlight={r.id === focusId} />
      ))}
      {demo && (
        <div className="row wrap">
          <span className="muted small">Demo:</span>
          <button className="btn btn-small btn-ghost" onClick={() => void attempt(() => api.demoPropose('hire'))}>
            👥 Grow a floor
          </button>
          <button className="btn btn-small btn-ghost" onClick={() => void attempt(() => api.demoPropose('let-go'))}>
            ✉️ Shrink a floor
          </button>
        </div>
      )}
      {decided.length > 0 && (
        <>
          <h3 className="phone-h">Earlier</h3>
          {decided.map((r) => (
            <Resume key={r.id} req={r} />
          ))}
        </>
      )}
    </div>
  );
}

// ---------- chat ----------

/** Replays a CEO message from its saved clip (or the browser's voice); stops it while it plays. */
function ReplayButton({ m }: { m: PhoneMessage }) {
  const saved = useStore((s) => s.voiceCache.saved.includes(m.id));
  const playing = useStore((s) => s.voiceSpeaking === m.id);
  const kind = replayKind(m, saved, typeof speechSynthesis !== 'undefined');
  if (!kind) return null;
  const gone = kind === 'gone';
  return (
    <button
      type="button"
      className={`bubble-play ${playing ? 'bubble-play-on' : ''}`}
      disabled={gone && !playing}
      title={gone ? 'Audio no longer saved' : undefined}
      aria-label={playing ? 'Stop this message' : 'Play this message'}
      onClick={() => void import('./voiceMessages').then((v) => (playing ? v.stopSpeaking() : kind !== 'gone' && v.replayMessage(m, kind)))}
    >
      {playing ? '⏹' : '▶'}
    </button>
  );
}

const QUICK = ["What's everyone working on?", 'Should a team grow?', 'Plan the next milestone for the busiest floor.'];

/** The hands-free conversation's switch: after the CEO's spoken reply, the phone listens for up to 8 s. */
function HandsFreeToggle({ ceoName }: { ceoName: string }) {
  const listen = useStore((s) => s.settings.listen);
  useStore((s) => `${s.voiceKeySet}:${s.settings.voice.provider}`); // handsFreeProblem() follows the key and the voice
  if (!listen || listen.provider === 'off') return null;
  const on = listen.handsFree;
  const why = handsFreeProblem(ceoName);
  return (
    <button
      type="button"
      className={`hands-free ${on ? 'hands-free-on' : ''}`}
      aria-pressed={on}
      title={on ? `Hands-free is on: after ${ceoName}'s spoken reply the phone listens for up to 8 s and sends what you say. Esc or M closes the mic.` : why || `Hands-free: talk with ${ceoName} without touching anything`}
      onClick={() => void setHandsFree(!on, ceoName)}
    >
      🎧 {on ? 'Hands-free on' : 'Hands-free'}
    </button>
  );
}

function Bubble({ m, ceoName }: { m: PhoneMessage; ceoName: string }) {
  const req = useStore((s) => (m.requestId ? s.requests.find((r) => r.id === m.requestId) : undefined));
  if (m.from === 'office') return <div className="bubble-office">{m.text}</div>;
  const mine = m.from === 'manager';
  return (
    <div className={`bubble-row ${mine ? 'bubble-row-me' : ''}`}>
      <div className={`bubble ${mine ? 'bubble-me' : 'bubble-them'}`}>
        {!mine && <div className="bubble-from">{ceoName}</div>}
        {mine ? <div className="bubble-text">{m.text}</div> : <Markdown className="bubble-md" text={m.text} />}
        {req && req.status === 'pending' && m.from === 'ceo' && <Resume req={req} />}
        <div className="bubble-time">
          {!mine && <ReplayButton m={m} />}
          {clock(m.at)}
        </div>
      </div>
    </div>
  );
}

/** The thread with the CEO; pocket mode shows it as its Chat tab, where the keyboard waits for a tap. */
export function Chat({ autoFocus = true }: { autoFocus?: boolean }) {
  const messages = useStore((s) => s.messages);
  const readAt = useStore((s) => s.phoneReadAt);
  const ceo = useStore((s) => s.agents[CEO_ID]);
  const info = useStore((s) => s.ceo);
  const settings = useStore((s) => s.settings);
  const running = useStore((s) => Object.values(s.agents).filter(isBusy).length);
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  // Reading the thread marks it read.
  useEffect(() => {
    const last = [...messages].reverse().find((m) => m.from === 'ceo');
    if (last && last.at > readAt) void attempt(() => api.phoneRead(last.at));
  }, [messages, readAt]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, info.job?.kind]);

  if (!ceo) return <p className="muted phone-empty">The corner office is empty.</p>;
  const send = (t: string) => {
    const body = t.trim();
    if (!body) return;
    setText('');
    void attempt(() => api.messageCeo(body));
  };
  const replying = ceo.status === 'working' && info.job?.kind === 'chat';
  const chatQueued = info.queue.some((j) => j.kind === 'chat');
  const presence =
    ceo.status === 'working'
      ? replying
        ? 'typing…'
        : `busy: ${info.job?.label ?? 'working'}`
      : chatQueued
        ? settings.sessionLimit && running >= settings.sessionLimit
          ? `will reply when a session slot frees up (${running}/${settings.sessionLimit} busy)`
          : 'reading your message…'
        : info.queue.length
          ? `next up: ${info.queue[0].label}`
          : 'available';

  return (
    <div className="phone-chat">
      <div className="chat-head">
        <Avatar name={ceo.name} color={ceo.color} />
        <div className="grow">
          <b>{ceo.name}</b> <span className="muted small">CEO</span>
          <div className={`small ${ceo.status === 'working' ? 'presence-busy' : 'muted'}`}>{presence}</div>
        </div>
        <HandsFreeToggle ceoName={ceo.name} />
      </div>
      <div className="chat-log" ref={scroller} aria-label={`Messages with ${ceo.name}`} tabIndex={0}>
        {messages.length === 0 && (
          <p className="muted small phone-empty">
            Say hi to {ceo.name}. Ask how things are going, hand over a project brief, or ask whether a team should grow. Replies land here, and the phone buzzes when {ceo.name} needs you.
          </p>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} ceoName={ceo.name} />
        ))}
        {replying && (
          <div className="bubble-row">
            <div className="bubble bubble-them bubble-typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>
      <div className="quick">
        {QUICK.map((q) => (
          <button key={q} className="quick-chip" onClick={() => send(q)}>
            {q}
          </button>
        ))}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <MessageBox value={text} onChange={setText} placeholder={`Message ${ceo.name}…`} aria-label={`Message ${ceo.name}`} title="Enter sends · Shift+Enter adds a new line" autoFocus={autoFocus} />
        <MicButton kind="phone" value={text} onChange={setText} onSend={send} />
        <button className="btn btn-small btn-good" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

// ---------- company at a glance ----------

function useCompany() {
  const repos = useStore((s) => s.repos);
  const agents = useStore((s) => s.agents);
  const qa = useStore((s) => s.qa);
  const requests = useStore((s) => s.requests);
  const settings = useStore((s) => s.settings);
  const info = useStore((s) => s.ceo);
  return useMemo(() => {
    const staff = Object.values(agents).filter((a) => a.role !== 'ceo');
    const ceo = agents[CEO_ID];
    const running = Object.values(agents).filter(isBusy).length;
    const floors = repos.map((r) => {
      const team = staff.filter((a) => a.repoId === r.id);
      const counts = floorPrCounts(r, qa);
      return {
        repo: r,
        team: team.length,
        working: team.filter(isBusy).length,
        idle: team.filter((a) => !isBusy(a)).length,
        issues: r.issues.length,
        prs: r.pulls.filter((p) => p.state === 'OPEN').length,
        inQa: counts.inQa,
        ready: counts.ready,
        stuck: counts.needsYou,
        merged: r.pulls.filter((p) => p.state === 'MERGED').length,
      };
    });
    const sum = (k: 'issues' | 'prs' | 'ready' | 'stuck' | 'inQa') => floors.reduce((n, f) => n + f[k], 0);
    const pending = pendingRequests(requests).length;

    // The report: a few plain sentences, most urgent first.
    const report: { icon: string; text: string; tone?: 'good' | 'warn' }[] = [];
    const readyList = floors.filter((f) => f.ready > 0);
    if (readyList.length)
      report.push({
        icon: '✅',
        text: `${sum('ready')} pull request${sum('ready') === 1 ? ' passed' : 's passed'} QA and ${sum('ready') === 1 ? 'is' : 'are'} ready for you to merge (${readyList.map((f) => `${f.repo.fullName.split('/')[1]}: ${f.ready}`).join(', ')}).`,
        tone: 'good',
      });
    if (sum('stuck')) report.push({ icon: '⚠️', text: `${sum('stuck')} pull request${sum('stuck') === 1 ? '' : 's'} need${sum('stuck') === 1 ? 's' : ''} your call: the team can't move ${sum('stuck') === 1 ? 'it' : 'them'} on alone.`, tone: 'warn' });
    if (pending) report.push({ icon: '👥', text: `${pending} team change${pending === 1 ? ' is' : 's are'} waiting in Team.`, tone: 'warn' });
    report.push({
      icon: '⚙️',
      text: settings.sessionLimit
        ? running
          ? `${running} of ${settings.sessionLimit} session slots are busy right now.`
          : `Nobody is working at the moment (${settings.sessionLimit} session slots free).`
        : running
          ? `${running} session${running === 1 ? ' is' : 's are'} running right now.`
          : 'Nobody is working at the moment.',
    });
    for (const f of floors) {
      if (f.issues > 0 && !f.repo.autoAssign && f.working === 0 && f.idle > 0) {
        report.push({ icon: '💤', text: `${f.repo.fullName.split('/')[1]} has ${f.issues} open issue${f.issues === 1 ? '' : 's'} and free agents, but auto-assign is off.` });
      }
    }
    const busiest = [...floors].sort((a, b) => b.issues + b.prs - (a.issues + a.prs))[0];
    if (busiest && busiest.issues + busiest.prs > 0 && floors.length > 1) {
      report.push({ icon: '🔥', text: `Most work in flight: ${busiest.repo.fullName.split('/')[1]} (${busiest.issues} issues, ${busiest.prs} PRs).` });
    }
    if (ceo) {
      report.push({
        icon: '🧠',
        text:
          ceo.status === 'working'
            ? `${ceo.name} is ${(info.job?.label ?? 'working').replace(/^\w/, (c) => c.toLowerCase())}.`
            : info.nextReviewAt
              ? `${ceo.name} reviews the company next at ${clock(info.nextReviewAt)}.`
              : `${ceo.name}'s periodic reviews are off.`,
      });
    }
    if (floors.length === 0) report.splice(0, report.length, { icon: '👋', text: "No projects yet. Connect a repo in the manager's office (lobby, back left) and the CEO will staff it." });
    return { floors, staff: staff.length, running, max: settings.sessionLimit, issues: sum('issues'), prs: sum('prs'), report };
  }, [repos, agents, qa, requests, settings, info]);
}

/** Every panel, a key press away: the phone is where keyboard and screen reader users reach the rest of the office. */
function Shortcuts() {
  const openOverlay = useStore((s) => s.openOverlay);
  const repoId = useStore((s) => s.repos.find((r) => r.floor === s.floor)?.id);
  return (
    <nav className="phone-links" aria-label="Open a panel">
      <button className="btn btn-small" onClick={() => openOverlay({ kind: 'manager' })}>
        🧑‍💼 Console
      </button>
      {repoId && (
        <button className="btn btn-small" onClick={() => openOverlay({ kind: 'kanban', repoId })}>
          📋 Kanban
        </button>
      )}
      <button className="btn btn-small" onClick={() => openOverlay({ kind: 'floorList' })}>
        👥 Floor list
      </button>
      <button className="btn btn-small" onClick={() => openOverlay({ kind: 'help' })}>
        ❓ Help
      </button>
      <button className="btn btn-small" onClick={() => openOverlay({ kind: 'manager', tab: 'access' })}>
        ♿ Accessibility
      </button>
    </nav>
  );
}

function Company() {
  const c = useCompany();
  const goToFloor = useStore((s) => s.goToFloor);
  const tiles: [string, string | number, string][] = [
    ['🏢', c.floors.length, c.floors.length === 1 ? 'project' : 'projects'],
    ['📋', c.issues, 'open issues'],
    ['🔀', c.prs, 'open PRs'],
    ['👥', c.staff, 'on staff'],
    ['⚙️', c.max ? `${c.running}/${c.max}` : `${c.running}`, 'working now'],
  ];
  return (
    <div className="phone-scroll">
      <div className="tiles">
        {tiles.map(([icon, value, label]) => (
          <div key={label} className="tile">
            <div className="tile-value">
              {icon} {value}
            </div>
            <div className="tile-label">{label}</div>
          </div>
        ))}
      </div>
      <Shortcuts />
      <h3 className="phone-h">Today's report</h3>
      <ul className="report">
        {c.report.map((r, i) => (
          <li key={i} className={r.tone ? `report-${r.tone}` : ''}>
            <span>{r.icon}</span>
            <span>{r.text}</span>
          </li>
        ))}
      </ul>
      {c.floors.length > 0 && <h3 className="phone-h">Projects</h3>}
      {c.floors.map((f) => (
        <div key={f.repo.id} className="proj" style={{ ['--accent' as string]: f.repo.color }}>
          <div className="row">
            <span className="floor-badge">{f.repo.floor}</span>
            <div className="grow" style={{ minWidth: 0 }}>
              <b className="proj-name">{f.repo.fullName.split('/')[1]}</b>
              <div className="muted small proj-sum">{f.repo.summary || f.repo.description || f.repo.fullName}</div>
            </div>
            <button className="btn btn-small" onClick={() => goToFloor(f.repo.floor)}>
              Go
            </button>
          </div>
          <div className="proj-stats small">
            <span>
              👥 {f.team}
              {f.working ? ` (${f.working} busy)` : ''}
            </span>
            <span>📋 {f.issues}</span>
            <span>🔍 {f.inQa}</span>
            <span className={f.ready ? 'proj-ready' : ''}>✅ {f.ready}</span>
            <span>🎉 {f.merged}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- the phone ----------

// Put the phone away mid-game and it opens on that (paused) game next time, unless something new came in meanwhile.
let resumeGames: { game: GameId | null; waiting: number } | null = null;

const waitingNow = () => {
  const s = useStore.getState();
  return pendingRequests(s.requests).length + unreadMessages(s.messages, s.phoneReadAt);
};

export function Phone({ tab: initialTab, requestId }: { tab?: PhoneTab; requestId?: string }) {
  const [tab, setTab] = useState<PhoneTab>(() =>
    resumeGames && !requestId && waitingNow() <= resumeGames.waiting ? 'games' : (initialTab ?? (requestId ? 'hires' : 'chat')),
  );
  const [game, setGame] = useState<GameId | null>(() => (tab === 'games' ? (resumeGames?.game ?? null) : null));
  const where = useRef({ tab, game });
  useEffect(() => {
    where.current = { tab, game };
  });
  useEffect(
    () => () => {
      resumeGames = where.current.tab === 'games' ? { game: where.current.game, waiting: waitingNow() } : null;
    },
    [],
  );
  const openOverlay = useStore((s) => s.openOverlay);
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box);
  const requests = useStore((s) => s.requests);
  const messages = useStore((s) => s.messages);
  const readAt = useStore((s) => s.phoneReadAt);
  const ceoName = useStore((s) => s.agents[CEO_ID]?.name ?? 'CEO');
  const listenOn = useStore((s) => (s.settings.listen?.provider ?? 'off') !== 'off');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);
  // Keep the overlay's tab in sync so new messages know whether the chat is on screen (during a game it isn't,
  // so the CEO's texts still pop up).
  useEffect(() => {
    openOverlay({ kind: 'phone', tab, requestId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
      if (e.key === 'Escape' || (!typing && isKey('phone', e.code))) {
        e.preventDefault();
        closeOverlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pending = pendingRequests(requests).length;
  const unread = unreadMessages(messages, readAt);
  const tabs: [PhoneTab, string, string, number][] = [
    ['chat', '💬', ceoName, tab === 'chat' ? 0 : unread],
    ['hires', '👥', 'Team', pending],
    ['company', '📊', 'Company', 0],
    ['games', '🎮', 'Games', 0],
  ];
  return (
    <div className="overlay phone-overlay" onMouseDown={(e) => e.target === e.currentTarget && closeOverlay()}>
      <div className="phone" ref={box} role="dialog" aria-modal="true" aria-label="Your phone" tabIndex={-1}>
        <div className="phone-status" aria-hidden>
          <span>{clock(now)}</span>
          <span className="phone-notch" />
          <span>📶 🔋</span>
        </div>
        <HolidayStrip />
        <div className="phone-screen">
          {tab !== 'games' && <LobbyNudge />}
          {tab === 'chat' && <Chat />}
          {tab === 'hires' && <TeamChanges focusId={requestId} />}
          {tab === 'company' && <Company />}
          {tab === 'games' && <Games game={game} onGame={setGame} />}
        </div>
        <nav className="phone-tabs" role="tablist" aria-label="Phone">
          {tabs.map(([k, icon, label, badge]) => (
            // Tapping Games again while in a game goes back to the list.
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              aria-label={badge > 0 ? `${label}, ${badge} new` : label}
              className={`phone-tab ${tab === k ? 'phone-tab-on' : ''}`}
              onClick={() => (k === 'games' && tab === 'games' ? setGame(null) : setTab(k))}
            >
              <span className="phone-tab-icon" aria-hidden>
                {icon}
                {badge > 0 && <span className="badge badge-dot">{badge}</span>}
              </span>
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="phone-hint">
          {tab === 'chat' && (
            <>
              <kbd>Shift</kbd>+<kbd>Enter</kbd> new line ·{' '}
              {listenOn && (
                <>
                  <Key action="talk" /> to talk ·{' '}
                </>
              )}
            </>
          )}
          {tab === 'games' && game && (
            <>
              <kbd>Backspace</kbd> games ·{' '}
            </>
          )}
          <Key action="phone" /> or <kbd>Esc</kbd> to put it away
        </div>
      </div>
    </div>
  );
}
