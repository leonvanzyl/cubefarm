import { create } from 'zustand';
import { CEO_ID, type AgentView, type CeoInfo, type CliView, type HireRequestView, type LogLine, type OfficeUpdateView, type PhoneMessage, type QaView, type RepoView, type ServerEvent, type SwarmSettings, type UsageView, type VoiceCacheView, type WorldSnapshot } from '../../shared/types';
import { blockers } from '../../shared/issues';
import { needsManager, qaCardNote, type CardTone } from './qaCard';
import { audioUnlocked, chirp, cue } from './ui/sfx';
import { claimVoice } from './ui/voiceClaim';
import { speakable } from './ui/voiceQueue';
import { emitMerge, mergeBursts, recentQaRecord, rememberQa } from './world/confetti';
import { gongForMerge } from './world/gongRunner';

export type Agent = Omit<AgentView, 'log'>;

export type PhoneTab = 'chat' | 'hires' | 'company' | 'games';

export type Overlay =
  | { kind: 'terminal'; agentId: string }
  | { kind: 'kanban'; repoId: string }
  /** One whiteboard card up close (CardView.tsx). `peel`: its sticky can come off the board (G). */
  | { kind: 'card'; repoId: string; key: string; number: number; pr: boolean; peel?: boolean }
  | { kind: 'app'; repoId: string }
  | { kind: 'elevator' }
  | { kind: 'manager'; tab?: ManagerTab; repoId?: string }
  | { kind: 'phone'; tab?: PhoneTab; requestId?: string }
  | { kind: 'help' };

export type ManagerTab = 'floors' | 'ceo' | 'team' | 'issues' | 'settings';

export interface Focus {
  id: string;
  label: string;
  action: Overlay | { kind: 'hire'; repoId: string; role: 'dev' | 'qa' } | { kind: 'pickup'; toyId: string } | { kind: 'poke'; toyId: string } | { kind: 'coffee'; op: 'place' | 'brew' | 'take' } | { kind: 'jukebox'; op: 'next' | 'toggle' | 'vol+' | 'vol-' };
}

/** What the player is carrying. Other items (a blaster, say) join the union with their own kind. */
export type Held =
  | { kind: 'ball'; id: string }
  /** A foam blaster: darts left in the magazine, and performance.now() when a reload started (null when not reloading). */
  | { kind: 'blaster'; id: string; ammo: number; reloadAt: number | null }
  /** A coffee mug: sips of coffee left, 0 (empty) to 3 (full). */
  | { kind: 'mug'; id: string; sips: number }
  /** A sticky peeled off the whiteboard (boardHands.ts): an issue for a developer's desk, or a PR for the QA lab. */
  | { kind: 'sticky'; id: string; repoId: string; key: string; number: number; pr: boolean };

export interface Toast {
  id: number;
  level: 'info' | 'success' | 'error';
  text: string;
}

interface State {
  connected: boolean;
  loaded: boolean;
  user: string | null;
  ghReady: boolean;
  ghError?: string;
  demo: boolean;
  workspaceRoot: string;
  settings: SwarmSettings;
  clis: CliView[]; // the coding-agent CLIs installed where the office runs
  repos: RepoView[];
  agents: Record<string, Agent>;
  logs: Record<string, LogLine[]>;
  screens: Record<string, number>; // agentId -> screenshot timestamp (cache buster)
  qa: Record<string, QaView>; // `${repoId}#${prNumber}`
  requests: HireRequestView[];
  ceo: CeoInfo;
  messages: PhoneMessage[];
  phoneReadAt: number;
  officeCommit?: string | null; // undefined: the server can't update itself
  officeUpdate?: OfficeUpdateView;
  usage: UsageView; // Claude's subscription usage: normal, pacing after a warning, or paused at the limit
  voiceKeySet: boolean; // an ElevenLabs key is saved on the server
  voiceKeyHint: string; // its last 4 characters
  voiceCache: VoiceCacheView; // the voice's saved clips: Settings → Voice, and which messages the phone's ▶ replays
  voiceSpeaking: number | null; // the phone message being read aloud in this tab (ui/voiceMessages.ts)
  restarting: boolean; // the connection dropped because the office is restarting to update

  floor: number; // 0 = lobby
  travel: { to: number; phase: 'closing' | 'opening' } | null;
  overlay: Overlay | null;
  focus: Focus | null;
  locked: boolean;
  started: boolean;
  toasts: Toast[];
  held: Held | null;
  /** performance.now() when the player started charging a throw; null when they aren't. */
  chargeAt: number | null;

  apply(ev: ServerEvent): void;
  setConnected(v: boolean): void;
  setRestarting(v: boolean): void;
  setOfficeUpdate(u: OfficeUpdateView): void;
  openOverlay(o: Overlay | null): void;
  setFocus(f: Focus | null): void;
  /** Pick something up (or swap), or let go of it with null. Always ends a charge. */
  setHeld(h: Held | null): void;
  setCharge(at: number | null): void;
  setLocked(v: boolean): void;
  start(): void;
  goToFloor(n: number): void;
  finishTravel(phase: 'arrived' | 'done'): void;
  pushToast(level: Toast['level'], text: string): void;
  dismissToast(id: number): void;
}

let toastSeq = 1;

// Where the viewer was standing, so a refresh puts them back on the same floor and spot.
export interface SavedView {
  floor: number;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}
const VIEW_KEY = 'cubefarm:view';

export function loadView(): SavedView | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as SavedView | null;
    return v && [v.floor, v.x, v.z, v.yaw, v.pitch].every(Number.isFinite) ? v : null;
  } catch {
    return null;
  }
}

export function saveView(v: SavedView) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    // storage may be unavailable (private mode); the view just won't be remembered
  }
}
const LOG_KEEP = 600;

export const useStore = create<State>((set, get) => ({
  connected: false,
  loaded: false,
  user: null,
  ghReady: true,
  demo: false,
  workspaceRoot: '',
  // Until the server's snapshot arrives; setupDone stays true so the wizard doesn't flash while loading.
  settings: {
    sessionLimit: 0,
    defaultModel: 'claude-opus-5-5',
    defaultEffort: 'medium',
    runtime: 'terminal',
    defaultCli: 'claude',
    hiring: 'approve',
    teamCap: 6,
    ceoHeartbeatMin: 60,
    managerName: '',
    companyName: '',
    projectsDir: '',
    setupDone: true,
    tutorialStep: -1,
    pacingSessions: 3,
    trimIdleDesksMin: 120,
    voice: { provider: 'off', voiceId: '', voiceName: '', model: '', speakOffice: false, keepDays: 7 },
  },
  clis: [],
  repos: [],
  agents: {},
  logs: {},
  screens: {},
  qa: {},
  requests: [],
  ceo: { queue: [], job: null, lastReviewAt: null, nextReviewAt: null },
  messages: [],
  phoneReadAt: 0,
  usage: { state: 'normal', until: null },
  voiceKeySet: false,
  voiceKeyHint: '',
  voiceCache: { clips: 0, bytes: 0, saved: [] },
  voiceSpeaking: null,
  restarting: false,

  floor: loadView()?.floor ?? 0,
  travel: null,
  overlay: null,
  focus: null,
  locked: false,
  started: false,
  toasts: [],
  held: null,
  chargeAt: null,

  apply(ev) {
    // Cues compare the old state with the new, so each change sounds once; snapshots (page load,
    // reconnect) never do, and nothing sounds before the first snapshot.
    const live = get().loaded;
    switch (ev.type) {
      case 'snapshot': {
        const d: WorldSnapshot = ev.data;
        const agents: Record<string, Agent> = {};
        const logs: Record<string, LogLine[]> = {};
        const screens: Record<string, number> = {};
        for (const { log, ...a } of d.agents) {
          agents[a.id] = a;
          logs[a.id] = log;
          if (a.screenshotAt) screens[a.id] = a.screenshotAt;
        }
        const qa: Record<string, QaView> = {};
        for (const q of d.qa) qa[qaKey(q.repoId, q.prNumber)] = q;
        // Stay on the current (or remembered) floor if it still exists; otherwise go to the lobby.
        const floorExists = d.repos.some((r) => r.floor === get().floor);
        set({
          loaded: true,
          user: d.user,
          ghReady: d.ghReady,
          ghError: d.ghError,
          demo: d.demo,
          workspaceRoot: d.workspaceRoot,
          settings: d.settings,
          repos: d.repos.sort((a, b) => a.floor - b.floor),
          agents,
          logs,
          screens,
          qa,
          requests: d.requests,
          ceo: d.ceo,
          messages: d.messages,
          phoneReadAt: d.phoneReadAt,
          officeCommit: d.officeCommit,
          officeUpdate: d.officeUpdate,
          usage: d.usage,
          clis: d.clis ?? [],
          voiceKeySet: d.voiceKeySet ?? false,
          voiceKeyHint: d.voiceKeyHint ?? '',
          voiceCache: d.voiceCache ?? { clips: 0, bytes: 0, saved: [] },
          restarting: false,
          floor: floorExists ? get().floor : 0,
        });
        break;
      }
      case 'repo': {
        const before = get().repos.find((r) => r.id === ev.repo.id);
        const qaFor = (n: number) => get().qa[qaKey(ev.repo.id, n)] ?? recentQaRecord(qaKey(ev.repo.id, n));
        const bursts = mergeBursts(live, before, ev.repo, qaFor, Object.values(get().agents));
        // A merge on the player's floor sends its author running to bang the gong (or it bangs by itself) and the
        // floor celebrates; anywhere else it's the chime.
        const covered = coversView(get().overlay);
        if (bursts.map((b) => gongForMerge(b, covered)).includes('absent')) cue('merged');
        const repos = get().repos.filter((r) => r.id !== ev.repo.id);
        repos.push(ev.repo);
        set({ repos: repos.sort((a, b) => a.floor - b.floor) });
        for (const b of bursts) emitMerge(b);
        break;
      }
      case 'repoRemoved': {
        const repos = get().repos.filter((r) => r.id !== ev.repoId);
        const floor = get().floor > repos.length ? 0 : get().floor;
        set({ repos, floor });
        break;
      }
      case 'agent': {
        const prev = get().agents[ev.agent.id];
        if (live && !prev && ev.agent.role !== 'ceo') cue('welcome');
        if (live && prev && prev.status !== 'error' && ev.agent.status === 'error') cue('error');
        set({ agents: { ...get().agents, [ev.agent.id]: ev.agent } });
        break;
      }
      case 'agentRemoved': {
        const { [ev.agentId]: _gone, ...agents } = get().agents;
        set({ agents });
        break;
      }
      case 'log': {
        const prev = get().logs[ev.agentId] ?? [];
        const next = prev.concat(ev.lines);
        set({ logs: { ...get().logs, [ev.agentId]: next.length > LOG_KEEP ? next.slice(-LOG_KEEP) : next } });
        break;
      }
      case 'screen': {
        const a = get().agents[ev.agentId];
        set({
          screens: { ...get().screens, [ev.agentId]: ev.at },
          agents: a ? { ...get().agents, [ev.agentId]: { ...a, hasScreenshot: true, screenshotAt: ev.at, browserUrl: ev.url ?? a.browserUrl } } : get().agents,
        });
        break;
      }
      case 'qa': {
        const prev = get().qa[qaKey(ev.qa.repoId, ev.qa.prNumber)]?.status;
        const failed = (st?: QaView['status']) => st === 'failed' || st === 'needs-human';
        if (live && ev.qa.status === 'passed' && prev !== 'passed') cue('ready');
        if (live && failed(ev.qa.status) && !failed(prev)) cue('qaFailed');
        set({ qa: { ...get().qa, [qaKey(ev.qa.repoId, ev.qa.prNumber)]: ev.qa } });
        break;
      }
      case 'qaRemoved': {
        const { [qaKey(ev.repoId, ev.prNumber)]: gone, ...qa } = get().qa;
        if (gone) rememberQa(qaKey(ev.repoId, ev.prNumber), gone);
        set({ qa });
        break;
      }
      case 'settings':
        set({ settings: ev.settings });
        break;
      case 'clis':
        set({ clis: ev.clis });
        break;
      case 'request': {
        const prev = get().requests.find((r) => r.id === ev.request.id);
        if (live && ev.request.kind === 'hire' && ev.request.status === 'approved' && prev?.status === 'pending') cue('welcome');
        const requests = get().requests.filter((r) => r.id !== ev.request.id);
        requests.push(ev.request);
        set({ requests: requests.sort((a, b) => a.createdAt - b.createdAt) });
        break;
      }
      case 'ceo':
        set({ ceo: ev.ceo });
        break;
      case 'message': {
        set({ messages: [...get().messages.slice(-199), ev.message] });
        const o = get().overlay;
        const reading = o?.kind === 'phone' && (o.tab ?? 'chat') === 'chat';
        // Read aloud, in this tab or another; the voice plays the chirp itself if it can't. Locked audio can't speak.
        const speak = live && audioUnlocked() && speakable(ev.message, get().settings.voice, Date.now());
        if (speak) {
          const arrived = Date.now();
          const wait = claimVoice(ev.message.id);
          void import('./ui/voiceMessages').then((v) => v.speakMessage(ev.message, arrived, wait));
        }
        if (ev.message.from === 'ceo' && !reading) {
          if (!speak) chirp();
          const ceo = get().agents[CEO_ID]?.name ?? 'CEO';
          const text = ev.message.text.replace(/\s+/g, ' ');
          get().pushToast('info', `📱 ${ceo}: ${text.length > 110 ? `${text.slice(0, 109)}…` : text}`);
        }
        break;
      }
      case 'phoneRead':
        set({ phoneReadAt: Math.max(get().phoneReadAt, ev.at) });
        break;
      case 'toast':
        get().pushToast(ev.level, ev.text);
        break;
      case 'officeUpdate':
        set({ officeUpdate: ev.officeUpdate });
        break;
      case 'usage':
        set({ usage: ev.usage });
        break;
      case 'voiceKey':
        set({ voiceKeySet: ev.voiceKeySet, voiceKeyHint: ev.voiceKeyHint });
        break;
      case 'voiceCache':
        set({ voiceCache: ev.voiceCache });
        break;
    }
  },

  setConnected: (connected) => set({ connected }),
  setRestarting: (restarting) => set({ restarting }),
  setOfficeUpdate: (officeUpdate) => set({ officeUpdate }),
  openOverlay(overlay) {
    // Opening any panel drops whatever you're carrying, so nothing is left floating behind it.
    set(overlay ? { overlay, focus: null, held: null, chargeAt: null } : { overlay });
    if (overlay && document.pointerLockElement) document.exitPointerLock();
  },
  setFocus: (focus) => {
    const cur = get().focus;
    if (cur?.id === focus?.id && cur?.label === focus?.label) return;
    set({ focus });
  },
  setHeld: (held) => set({ held, chargeAt: null }),
  setCharge: (chargeAt) => set({ chargeAt }),
  setLocked: (locked) => set({ locked }),
  start: () => set({ started: true }),
  goToFloor(n) {
    if (n === get().floor || get().travel) {
      set({ overlay: null });
      return;
    }
    set({ overlay: null, held: null, chargeAt: null, travel: { to: n, phase: 'closing' } });
  },
  finishTravel(phase) {
    const t = get().travel;
    if (!t) return;
    if (phase === 'arrived') set({ floor: t.to, travel: { ...t, phase: 'opening' } });
    else set({ travel: null });
  },
  pushToast(level, text) {
    const id = toastSeq++;
    set({ toasts: [...get().toasts.slice(-4), { id, level, text }] });
    setTimeout(() => get().dismissToast(id), level === 'error' ? 9000 : 5000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

// ---------- derived helpers ----------

export const qaKey = (repoId: string, prNumber: number) => `${repoId}#${prNumber}`;

export const repoOnFloor = (repos: RepoView[], floor: number) => repos.find((r) => r.floor === floor) ?? null;

export const agentsOnRepo = (agents: Record<string, Agent>, repoId: string) =>
  Object.values(agents)
    .filter((a) => a.repoId === repoId)
    .sort((a, b) => (a.role === b.role ? a.desk - b.desk : a.role === 'dev' ? -1 : 1));

/**
 * Panels that hide the whole office (the wide ones: Kanban, terminals and the manager's console), so the
 * 3D view can stop drawing behind them. The phone, help, elevator panel and confirm dialogs are see-through.
 */
export const coversView = (o: Overlay | null) => o?.kind === 'kanban' || o?.kind === 'terminal' || o?.kind === 'manager';

export const isBusy = (a: Agent) => a.status === 'preparing' || a.status === 'working';

/** CEO messages the manager hasn't seen yet (proposals are counted by pendingRequests instead). */
export const unreadMessages = (messages: PhoneMessage[], readAt: number) => messages.filter((m) => m.from === 'ceo' && !m.requestId && m.at > readAt).length;

export const pendingRequests = (requests: HireRequestView[]) => requests.filter((r) => r.status === 'pending');

/** The red dot on the phone: decisions waiting on the manager plus unread messages. */
export function usePhoneBadge() {
  const requests = useStore((s) => s.requests);
  const messages = useStore((s) => s.messages);
  const readAt = useStore((s) => s.phoneReadAt);
  return pendingRequests(requests).length + unreadMessages(messages, readAt);
}

export interface KanbanCard {
  key: string;
  number: number;
  title: string;
  url?: string;
  agent?: Agent;
  note?: string;
  tone?: CardTone;
  prNumber?: number;
  qa?: QaView;
  /** The 3D board draws it as an outline: its sticky is off the board, with a QA tester (StickyNotes.tsx). */
  ghost?: boolean;
}

export interface KanbanColumns {
  backlog: KanbanCard[];
  progress: KanbanCard[];
  qa: KanbanCard[];
  ready: KanbanCard[];
  merged: KanbanCard[];
}

/** Sort a floor's GitHub state and QA pipeline into the five office Kanban columns. */
export function kanbanFor(repo: RepoView, agents: Agent[], qaRecords: Record<string, QaView>): KanbanColumns {
  const openPulls = repo.pulls.filter((p) => p.state === 'OPEN');
  const byId = new Map(agents.map((a) => [a.id, a]));
  const devs = agents.filter((a) => a.role === 'dev');
  const authorOf = (n: number, head: string) => devs.find((a) => a.prNumber === n) ?? devs.find((a) => a.branch && a.branch === head);

  const progress: KanbanCard[] = [];
  for (const a of devs) {
    if (a.issueNumber == null || a.task !== 'issue' || a.status === 'idle') continue;
    if (a.prNumber != null && openPulls.some((p) => p.number === a.prNumber)) continue;
    const note =
      a.status === 'preparing' ? 'setting up' : a.status === 'working' ? 'working' : a.status === 'error' ? 'needs help' : a.status === 'stopped' ? 'stopped' : 'finished · no PR';
    progress.push({
      key: `a-${a.id}`,
      number: a.issueNumber,
      title: a.issueTitle ?? '',
      agent: a,
      note,
      tone: a.status === 'error' ? 'bad' : a.status === 'stopped' || a.status === 'done' ? 'warn' : undefined,
    });
  }

  const qa: KanbanCard[] = [];
  const ready: KanbanCard[] = [];
  for (const p of openPulls) {
    const rec = qaRecords[qaKey(repo.id, p.number)];
    const dev = (rec?.devAgentId ? byId.get(rec.devAgentId) : undefined) ?? authorOf(p.number, p.headRefName);
    const tester = rec?.qaAgentId ? byId.get(rec.qaAgentId) : undefined;
    const base = { key: `pr-${p.number}`, number: p.number, prNumber: p.number, title: p.title, url: p.url, qa: rec };
    const card = { ...base, ...qaCardNote(rec, p, repo.autoMerge) };
    if (rec?.status === 'passed') ready.push({ ...card, agent: dev });
    else qa.push({ ...card, agent: rec?.status === 'testing' ? tester : dev });
  }

  const claimed = new Set<number>([...progress.map((c) => c.number), ...openPulls.flatMap((p) => p.closesIssues)]);
  const open = new Set(repo.issues.map((i) => i.number));
  const backlog: KanbanCard[] = repo.issues
    .filter((i) => !claimed.has(i.number))
    .map((i) => {
      const waits = blockers(i.body, open);
      const labels = i.labels.map((l) => l.replace(/^swarm:/i, '🎯 ')).slice(0, 2).join(', ');
      return { key: `i-${i.number}`, number: i.number, title: i.title, url: i.url, note: waits.length ? `⏳ after #${waits.join(', #')}` : labels || undefined };
    });

  const merged: KanbanCard[] = repo.pulls
    .filter((p) => p.state === 'MERGED')
    .sort((a, b) => (b.mergedAt ?? '').localeCompare(a.mergedAt ?? ''))
    .map((p) => ({ key: `m-${p.number}`, number: p.number, prNumber: p.number, title: p.title, url: p.url, agent: authorOf(p.number, p.headRefName) }));

  return { backlog, progress, qa, ready, merged };
}

export interface FloorPrCounts {
  /** Open PRs in the Kanban's In QA column: queued, testing, failed, fixing, needs-human and untested ones. */
  inQa: number;
  /** Open PRs that passed QA (the Ready to merge column). */
  ready: number;
  /** Open PRs waiting on the manager (needs-human, and the CEO isn't triaging them); also counted in inQa. */
  needsYou: number;
}

/**
 * A floor's PR counts, matching kanbanFor's columns. Only open PRs count: QA records outlive their PR's merge or
 * close, so counting records instead drifts further from the board with every merge.
 */
export function floorPrCounts(repo: RepoView, qaRecords: Record<string, QaView>): FloorPrCounts {
  const counts: FloorPrCounts = { inQa: 0, ready: 0, needsYou: 0 };
  for (const p of repo.pulls) {
    if (p.state !== 'OPEN') continue;
    const rec = qaRecords[qaKey(repo.id, p.number)];
    if (rec?.status === 'passed') counts.ready++;
    else counts.inQa++;
    if (needsManager(rec)) counts.needsYou++;
  }
  return counts;
}
