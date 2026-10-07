// Types shared between the swarm server and the 3D client.
import type { CareerView } from './careers.ts';
import type { ProgressView, RewardView } from './progress.ts';

import type { WeatherSettings, WeatherView, WorldEventSettings } from './outside.ts';
import type { ThemeSettings } from './themes.ts';
import type { AgentStyle } from './looks.ts';

export type AgentStatus =
  | 'idle' // at desk, nothing assigned
  | 'preparing' // setting up the git worktree
  | 'working' // Claude Code session running
  | 'done' // finished, PR opened (or finished without one)
  | 'error' // session failed
  | 'stopped'; // manager stopped it

export type LogKind = 'text' | 'tool' | 'result' | 'system' | 'error' | 'manager' | 'done' | 'thinking';

export interface LogLine {
  id: number;
  t: number; // epoch ms
  kind: LogKind;
  text: string;
  tool?: string; // tool name for kind === 'tool'
}

export interface IssueInfo {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  createdAt: string;
}

export interface PullInfo {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  mergeable: string; // MERGEABLE | CONFLICTING | UNKNOWN
  reviewDecision: string | null;
  closesIssues: number[];
  createdAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  checks: 'pending' | 'passing' | 'failing' | 'none';
  headSha: string;
  mergeState: string; // GitHub's mergeStateStatus: CLEAN | BEHIND | BLOCKED | DIRTY | UNSTABLE | DRAFT | UNKNOWN …
  failedChecks: { name: string; url: string | null }[];
  pendingChecks: string[];
  issueCreatedAt?: string | null; // when the issue it closes was filed, as far as the office knows (the whiteboard's issue → merge time)
  /** GitHub's check runs on the head commit once all have finished: how long they took (first start to last finish) and when they finished. */
  checkRun?: { ms: number; doneAt: number } | null;
}

export interface RepoView {
  id: string; // "owner/name"
  fullName: string;
  description: string;
  url: string;
  defaultBranch: string;
  floor: number; // 1-based floor number in the building
  color: string; // accent color for the floor
  autoAssign: boolean;
  autoMerge: boolean; // PRs merge themselves once QA passes and GitHub's checks are green
  folderSync: string | null; // how the floor's main checkout stands against GitHub: "in sync", "updated to abc1234", "2 behind: local changes" …
  browserTesting: boolean;
  links: string[]; // ids of related repos this floor's agents can read for context
  mission: string; // the manager's brief: what this floor is building
  summary: string; // the CEO's one-line read of the project, e.g. "3D browser game · Three.js + Vite"
  qaBrief: string; // how QA should test this kind of project (written by the CEO, editable)
  localPath: string | null; // the manager's own project folder, when the floor lives in one
  checkoutPath: string; // where the floor's main checkout is on disk (localPath, or a clone the office manages)
  cloneStatus: 'pending' | 'cloning' | 'ready' | 'error';
  cloneError?: string;
  issues: IssueInfo[]; // open issues
  pulls: PullInfo[]; // open + recently merged PRs
  held: { issue: number; pr: number }[]; // open issues whose PR was closed: they wait to be assigned by hand
  lastSync: number | null;
  syncError?: string;
  previewConfig: PreviewConfig;
  preview: PreviewView;
}

/**
 * How a floor's app is run for the preview monitor. {port} and {tmp} are replaced in the command and env values;
 * PORT={port} is always set. command null: npm run dev, else start, else preview from package.json.
 */
export interface PreviewConfig {
  command: string | null;
  env: Record<string, string>;
}

export type PreviewStatus =
  | 'unconfigured' // no command and no package.json
  | 'stopped'
  | 'preparing' // checking out the ref in the preview worktree
  | 'installing' // npm ci / npm install
  | 'starting' // command started, waiting for the port
  | 'running'
  | 'error';

/** The floor's running app, served from its own worktree on a port reserved for the floor. */
export interface PreviewView {
  status: PreviewStatus;
  port: number;
  url: string | null; // set while running
  ref: string | null; // the default branch's name, or "PR #n"
  pr: number | null;
  commit: string | null; // short sha
  startedAt: number | null;
  error: string | null;
  logTail: string[]; // the last 40 lines of install / app output
}

/**
 * An open PR's app in the PR theatre: run beside the floor's main preview, from a worktree of its own, until nobody
 * has watched it for a while, its PR merges or closes, or the office stops.
 */
export interface PrPreviewView {
  repoId: string;
  pr: number;
  status: PreviewStatus;
  port: number;
  url: string | null; // set while running
  commit: string | null; // short sha of the PR's head
  startedAt: number;
  viewedAt: number; // the last time a viewer had it on screen
  watched: boolean; // a viewer has it on screen now
  error: string | null;
  logTail: string[]; // the last 40 lines of install / app output
}

/** A folder in the manager's projects folder, as offered when adding a floor. */
export interface ProjectFolderView {
  name: string;
  path: string;
  git: boolean;
  github: string | null; // owner/name of its GitHub origin
  floor: number | null; // already a floor in the office
}

/** Every agent on a floor is the same kind of worker (docs/agents.md); the one CEO works in the lobby and runs the company. */
export type AgentRole = 'agent' | 'ceo';

/** Desks in a floor's room: 12 in the open-plan grid and 3 along the east wall. A team is at most this big. */
export const FLOOR_SEATS = 15;

/** A floor's most agents unless the manager changes it (Settings). */
export const DEFAULT_MAX_AGENTS = 10;

/** Fixed id of the CEO agent. */
export const CEO_ID = 'ceo';

/** What the office dog is called until the manager renames it (Settings). */
export const DEFAULT_DOG_NAME = 'Biscuit';

/** An agent's currentTool while the office installs their desk's dependencies (status 'preparing'). */
export const INSTALL_STEP = 'Installing dependencies';

/** How the cartoon character is drawn. Picked from the agent's name when hired; the manager can change it. */
export type AgentLook = 'feminine' | 'masculine';

/** What an agent is currently doing: implementing an issue, testing a PR, or fixing a PR after QA. */
export type AgentTask = 'issue' | 'qa' | 'fix';

/**
 * How agents run. terminal: each agent is the real coding-agent CLI in its own terminal, shown live in the office.
 * sdk: Claude Code through the Agent SDK, its stream turned into log lines.
 */
export type AgentRuntime = 'terminal' | 'sdk';

/** The coding-agent CLI an agent runs in its terminal. The CEO is always Claude Code. */
export type AgentCli = 'claude' | 'codex' | 'opencode';

/** A coding-agent CLI the office knows how to run, and whether it's installed on this machine. */
export interface CliView {
  id: AgentCli;
  label: string;
  installed: boolean;
  version: string | null;
  /** Hooks report every tool call and enforce the guard rails; the others report only when a turn ends. */
  integrated: boolean;
}

/** Messages on an agent's terminal socket (/ws/term?agent=<id>), server to browser. */
export type TermServerMessage =
  | { t: 'snapshot'; data: string; cols: number; rows: number; live: boolean } // the screen and scrollback so far
  | { t: 'data'; data: string }
  | { t: 'size'; cols: number; rows: number } // another viewer resized the terminal
  | { t: 'live'; live: boolean }; // a CLI is (or is no longer) running in it

/** Browser to server: keystrokes go to the running CLI; the size is the viewer's fitted terminal. */
export type TermClientMessage = { t: 'input'; data: string } | { t: 'resize'; cols: number; rows: number };

export interface AgentView {
  id: string;
  name: string;
  repoId: string;
  role: AgentRole;
  look: AgentLook;
  task: AgentTask | null;
  desk: number; // desk slot on the floor, 0 to FLOOR_SEATS - 1
  color: string; // shirt color
  hair: string; // hair color
  skin: string;
  style: AgentStyle | null; // the manager's picks in the look editor (null: the look seeded from their id)
  model: string; // '' = use the swarm default model, or a model id / alias
  effort: EffortLevel | ''; // '' = use the swarm default effort
  cli: AgentCli | ''; // the CLI they run in the terminal runtime ('' = the office default)
  terminal: boolean; // they have a terminal to watch (the terminal runtime); otherwise their log lines are the screen
  status: AgentStatus;
  issueNumber: number | null; // the issue being built, or the one the PR under test or fix closes
  issueTitle: string | null; // the issue's title, or the PR's while testing or fixing it
  branch: string | null;
  prNumber: number | null; // the PR they opened, are testing or are fixing
  prUrl: string | null;
  currentTool: string | null; // while preparing: the setup step (INSTALL_STEP), null for the worktree
  startedAt: number | null;
  endedAt: number | null;
  costUsd: number;
  turns: number;
  browserUrl: string | null;
  hasScreenshot: boolean;
  screenshotAt: number | null;
  lastError: string | null;
  career: CareerView | null; // their record on the team (#226); null for the CEO
  log: LogLine[]; // the terminal log: hiring answers with it; snapshots leave it empty (tabs get lines by watch, shared/watch.ts)
  activity?: AgentActivity | null; // what they're doing right now, safe to show anyone (null: nothing, e.g. idle)
}

/** The kinds of work the icon over a busy agent shows (shared/activity.ts maps tools and status to them). */
export type ActivityKind = 'read' | 'edit' | 'test' | 'build' | 'browse' | 'git' | 'ci' | 'qa' | 'fix' | 'talk' | 'run';

/** An agent's current activity: a kind and a short, redacted detail ("store.ts", "npm test"; '' for none). */
export interface AgentActivity {
  kind: ActivityKind;
  detail: string;
}

/** One line on a floor's activity ticker ("Ken opened PR #212"), worked out by the server from what changed. */
export interface TickerItem {
  id: number;
  repoId: string;
  at: number;
  text: string;
  tone: 'good' | 'bad' | 'info';
}

/** What an agent is told for one kind of task (the CEO: its one prompt). */
export interface PromptPart {
  label: string; // e.g. "Building an issue", "Testing a pull request"
  text: string;
}

/** GET /api/agents/:id/prompt: what the agent is told on each kind of task, with placeholders for the task's details. */
export interface AgentPromptView {
  kind: 'agent' | 'ceo';
  parts: PromptPart[];
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type QaStatus =
  | 'queued' // waiting for a free agent to test it
  | 'testing' // an agent is testing it
  | 'passed' // ready to merge
  | 'failed' // failed; waiting for its author (or any free agent) to fix it
  | 'fixing' // an agent is fixing what QA found
  | 'needs-human'; // failed too many rounds, or nobody can fix it automatically

export interface QaCheck {
  name: string;
  result: 'pass' | 'fail' | 'skip';
  details: string;
}

export interface QaView {
  repoId: string;
  prNumber: number;
  status: QaStatus;
  round: number; // 1-based QA round
  devAgentId: string | null; // the agent who wrote it, or took over its fixes (null for PRs opened outside the swarm)
  qaAgentId: string | null; // the agent testing it, or who last did
  summary: string | null; // latest QA summary
  checks: QaCheck[];
  commentUrl: string | null; // the PR comment with the latest QA report
  mergeNote: string | null; // where auto-merge stands once QA passed, e.g. "waiting for checks: Vercel"
  ceoLooking: boolean; // needs-human, and the CEO has a triage job for it (queued or running) before the manager hears
  updatedAt: number;
  shots?: QaShotView[]; // QA's screenshots from the latest round (absent: none)
}

/** A screenshot from QA's latest round on a PR, served at /api/repos/:repo/pulls/:n/qa-shots/:index. */
export interface QaShotView {
  caption: string;
  page: string | null; // the page it shows
  mime: string;
}

export interface SwarmSettings {
  sessionLimit: number; // most agent sessions running at once; 0 = no limit
  defaultModel: string;
  defaultEffort: EffortLevel;
  runtime: AgentRuntime;
  defaultCli: AgentCli; // what agents run in their terminals unless they have their own
  scaling: 'approve' | 'auto'; // the CEO's team changes wait for the manager (new agents wait in the lobby), or apply at once
  maxAgents: number; // most agents on a floor: 1 to FLOOR_SEATS (DEFAULT_MAX_AGENTS)
  ceoHeartbeatMin: number; // minutes between the CEO's periodic reviews; 0 = off
  managerName: string; // what the office calls you
  companyName: string;
  dogName: string; // the office dog's name, on its tag and in the hint when you aim at it
  projectsDir: string; // where your project folders live; new projects are created here
  setupDone: boolean; // the first-run setup wizard has been completed or skipped
  tutorialStep: number; // index of the current tutorial step; -1 when finished or skipped
  autoUpdate?: boolean; // update the office itself once it's quiet (absent on servers without self-update)
  pacingSessions: number; // after Claude warns about usage, new issues start only while fewer sessions than this run
  trimIdleDesksMin: number; // a desk idle this many minutes loses its node_modules and build output; 0 = never
  voice: VoiceSettings;
  themes: ThemeSettings; // holiday themes: Settings → Themes (shared/themes.ts)
  weather: WeatherSettings; // Settings → Weather: the calm cycle, off, or the manager's real local weather
  worldEvents: WorldEventSettings; // Settings → World events: how often something happens outside
  listen: ListenSettings;
  notify: NotifySettings;
}

/** What the office tells the manager about when they're away (docs/pocket.md). */
export type NotifyEvent = 'needsHuman' | 'ceoMessage' | 'hire' | 'agentError' | 'usage' | 'merge';

/** Where it tells them: this browser, Web Push to their devices, or a chat app's webhook. */
export type NotifyChannel = 'desktop' | 'push' | 'ntfy';

/** The chat apps, whose webhook URLs and tokens live in the server's secrets file. */
export type NotifyWebhook = 'ntfy';

export interface NotifySettings {
  events: Record<NotifyEvent, boolean>;
  channels: Record<NotifyChannel, boolean>; // a chat app also needs its webhook saved
  officeUrl: string; // where messages link back to ('' = no link), e.g. a Tailscale Serve URL
}

/** Which chat apps have a webhook saved (only a hint of it: the secret never leaves the server) and how many devices get push. */
export interface NotifyChannelsView {
  webhooks: Record<NotifyWebhook, { set: boolean; hint: string }>;
  pushDevices: number;
}

/** A notification the office sent: a browser with the office open but hidden shows it as a desktop notification. */
export interface NoteView {
  id: string;
  event: NotifyEvent | 'test';
  title: string;
  body: string;
  at: number;
  url: string; // in-app link, e.g. '/?tab=approvals'
}

/** Who reads phone messages aloud: nobody, the browser's own voice, or ElevenLabs (with the manager's key). */
export type VoiceProvider = 'off' | 'browser' | 'elevenlabs';

export interface VoiceSettings {
  provider: VoiceProvider;
  voiceId: string; // the ElevenLabs voice (or the browser voice's name)
  voiceName: string;
  model: string; // ElevenLabs model id
  speakOffice: boolean; // read the office's own notes too, not just the CEO's messages
  keepDays: number; // saved clips older than this are deleted (1–90; the newest 20 CEO messages' clips always stay)
}

/** Who turns the manager's speech into text: nobody (no 🎙), the browser's own recognition, or ElevenLabs (with the key). */
export type ListenProvider = 'off' | 'browser' | 'elevenlabs';

/** Talking instead of typing (docs/voice.md): the 🎙 by every message box, and the phone's hands-free conversation. */
export interface ListenSettings {
  provider: ListenProvider;
  autoSend: boolean; // send once you stop talking (about 1.2 s of quiet), not only when you press Send
  handsFree: boolean; // after the CEO's spoken reply, the phone listens for up to 8 s and sends what it hears
}

/** The voice's saved clips: how many and how big, and which phone messages can be replayed from them. */
export interface VoiceCacheView {
  clips: number;
  bytes: number;
  saved: number[]; // message ids with every clip still on disk
}

/** GET /api/voice/voices: a voice the manager can pick. recommended: on docs/voice.md's shortlist. */
export interface VoiceOption {
  id: string;
  name: string;
  category: string;
  labels: { accent: string; gender: string; age: string; description: string; use_case: string };
  previewUrl: string | null;
  recommended: boolean;
}

/** The last usage warning Claude gave: which limit ("weekly limit"), how full it was (0-100), when it resets, and when it came. */
export interface UsageWarningView {
  limit: string | null;
  pct: number | null;
  resetsAt: number | null;
  at: number;
}

/** Claude's subscription usage: normal, pacing new work after a usage warning, or paused at the limit until `until`. */
export interface UsageView {
  state: 'normal' | 'pacing' | 'paused';
  until: number | null;
  warning: UsageWarningView | null; // the latest since the office started, for the usage meter
}

/** One floor's numbers on mission control (or the whole office's), computed by the server from its state and history. */
export interface OpsNumbers {
  // the pipeline, right now
  ready: number; // backlog issues that can start
  building: number; // issues a developer is working on
  inQa: number; // open PRs waiting for QA or being tested (or not tested yet)
  fixing: number; // open PRs back with a developer: QA failed, checks or a conflict
  toMerge: number; // open PRs that passed QA
  needsYou: number; // open PRs waiting on the manager (needsManager)
  triage: number; // stuck PRs the CEO is looking at before they reach the manager
  // throughput
  mergedToday: number; // since midnight
  mergedHour: number; // in the last 60 minutes
  spark: number[]; // merges per clock hour over the last 24 hours, oldest first (the current hour last)
  // flow, over the last 24 hours
  leadMs: number | null; // median issue → merge
  qaWaitMs: number | null; // median wait for an agent to start testing a PR
  qaPass: number | null; // share of QA rounds that passed over 7 days, 0-1
  // GitHub's checks, over 7 days
  ciPass: number | null; // share of check runs that passed, 0-1
  ciRuns: number;
  ciMs: number | null; // median duration
  // the team, right now
  busy: number;
  idle: number;
  errors: number;
  costToday: number; // dollars since midnight from finished sessions' reported cost: an estimate
}

export interface OpsFloor extends OpsNumbers {
  repoId: string;
  floor: number;
  alarms: number;
}

/** Something that needs the manager: a PR the office can't move (needsManager), or an agent in error for over 10 minutes. */
export interface OpsAlarm {
  id: string; // "pr:<repo>#<n>" or "agent:<id>": the manager's console opens at this card
  kind: 'pr' | 'agent';
  repoId: string;
  floor: number;
  prNumber: number | null;
  agentId: string | null;
  text: string;
  since: number;
}

/** Mission control: every floor's numbers, the office's total, and what needs the manager (oldest first). */
export interface OpsView {
  floors: OpsFloor[];
  total: OpsNumbers;
  ceoCostToday: number;
  alarms: OpsAlarm[];
}

/** What the office doctor's one-click fixes do (#262): the console's own actions, nothing new. */
export type DoctorFix = 'clear' | 'stop' | 'requeue' | 'retry-qa' | 'send-back' | 'close-issue';

/** Something stuck the watchdog has no safe remedy for, or already remedied within the hour (server/watchdog.ts). */
export interface DoctorFinding {
  id: string; // stable while the problem lasts
  kind: 'quiet' | 'preparing' | 'stale' | 'qa-orphan' | 'fix-orphan' | 'unclosed';
  repoId: string;
  agentId: string | null;
  prNumber: number | null;
  issueNumber: number | null;
  text: string;
  fixes: DoctorFix[];
  since: number;
}

/**
 * Where the office's own update stands. none: up to date · available: new commits on GitHub · waiting / draining:
 * starting nothing new while running sessions finish · updating: handed to the launcher · failed: see detail.
 */
export type OfficeUpdateState = 'none' | 'available' | 'waiting' | 'draining' | 'updating' | 'failed';

export interface OfficeUpdateView {
  state: OfficeUpdateState;
  behind: number; // commits the office's folder is behind GitHub
  launcher: boolean; // started by npm run dev / npm start, which can install the update and restart the office
  drainingSince: number | null;
  running: number; // sessions still running
  detail: string | null;
}

/**
 * One change to a floor's team: a new agent (they wait in the lobby, where the manager can set them up before they're
 * created) or an agent leaving. The CEO's scale_team makes them; with scaling on auto they're decided at once.
 */
export interface HireRequestView {
  id: string;
  kind: 'hire' | 'let-go';
  repoId: string;
  agentId: string | null; // let-go: who; hire: who was hired once approved
  name: string; // the new agent's name (let-go: the agent's name)
  reason: string;
  cli: AgentCli | ''; // the coding agent they'll run ('' = the office default)
  model: string; // '' = the default model
  effort: EffortLevel | '';
  look: AgentLook;
  color: string;
  hair: string;
  skin: string;
  status: 'pending' | 'approved' | 'rejected';
  note: string; // the manager's reason when rejecting
  createdAt: number;
  decidedAt: number | null;
  decidedBy: 'manager' | 'auto' | null;
}

/** One message in the phone thread between the manager and the CEO. */
export interface PhoneMessage {
  id: number;
  from: 'ceo' | 'manager' | 'office'; // office = notes from the building itself (decisions, errors)
  text: string;
  at: number;
  requestId?: string; // a hire / let-go proposal this message is about
  voice?: Exclude<VoiceProvider, 'off'>; // who read it aloud when it arrived (absent: nobody), for the phone's ▶ replay
}

export type CeoJobKind = 'onboard' | 'plan' | 'review' | 'chat' | 'triage';

export interface CeoInfo {
  queue: { kind: CeoJobKind; label: string }[]; // jobs waiting for the CEO
  job: { kind: CeoJobKind; label: string } | null; // what the CEO is doing now
  lastReviewAt: number | null;
  nextReviewAt: number | null; // null when the heartbeat is off
}

/** One player on a floor's ping-pong leaderboard: the manager or an agent, with their games on that floor. */
export interface PongRow {
  id: string; // 'player' for the manager (shared/pong.ts PONG_PLAYER), else an agent id
  name: string; // as of their last game
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  lastAt: number; // epoch ms of their last game
}

export interface WorldSnapshot {
  user: string | null; // gh login
  ghReady: boolean;
  ghError?: string;
  demo: boolean;
  machinesRoot: string; // where agents' machines live (server/machines.ts)
  settings: SwarmSettings;
  repos: RepoView[];
  agents: AgentView[];
  qa: QaView[];
  prPreviews: PrPreviewView[];
  requests: HireRequestView[];
  ceo: CeoInfo;
  messages: PhoneMessage[];
  phoneReadAt: number; // CEO messages newer than this are unread
  version?: string; // the cubefarm version the server runs (package.json)
  officeCommit?: string | null; // short sha the server started on (absent on servers without self-update)
  officeUpdate?: OfficeUpdateView;
  usage: UsageView;
  ops: OpsView;
  doctor?: DoctorFinding[]; // the office doctor's findings the manager hasn't ignored
  clis: CliView[];
  voiceKeySet: boolean; // an ElevenLabs key is saved (the key itself never leaves the server)
  voiceKeyHint: string; // its last 4 characters, '' when none
  voiceCache: VoiceCacheView;
  weather: WeatherView; // the real local weather's place and latest reading (Settings → Weather)
  ticker?: TickerItem[]; // the floors' recent ticker lines, oldest first
  notifyChannels: NotifyChannelsView;
  progress: ProgressView; // coins, decorations and achievements (#210)
  pong: Record<string, PongRow[]>; // each floor's ping-pong leaderboard by repo id, best first
}

/** What changed about an agent since the office last sent it, with its id; every field for one it never sent. */
export type AgentPatch = Partial<Omit<AgentView, 'log'>> & { id: string };
/** The same for a floor. */
export type RepoPatch = Partial<RepoView> & { id: string };

export type ServerEvent =
  | { type: 'snapshot'; data: WorldSnapshot }
  | { type: 'repo'; repo: RepoView }
  /** Floor changes batched by the office (server/outbox.ts), like agents'. */
  | { type: 'repos'; repos: RepoPatch[] }
  | { type: 'repoRemoved'; repoId: string }
  | { type: 'agent'; agent: Omit<AgentView, 'log'> }
  /** Agent changes batched by the office (server/outbox.ts), a few times a second at most. */
  | { type: 'agents'; agents: AgentPatch[] }
  | { type: 'agentRemoved'; agentId: string }
  /** New terminal lines of the agents this tab watches (shared/watch.ts); `catchUp`: their recent buffer, replacing what it had. */
  | { type: 'logs'; tails: Record<string, LogLine[]>; catchUp?: boolean }
  /** The latest line worth listing of agents it doesn't watch, for the workers list. */
  | { type: 'latest'; lines: Record<string, LogLine> }
  | { type: 'screen'; agentId: string; url: string | null; at: number }
  | { type: 'qa'; qa: QaView }
  | { type: 'qaRemoved'; repoId: string; prNumber: number }
  | { type: 'prPreview'; preview: PrPreviewView }
  | { type: 'prPreviewRemoved'; repoId: string; pr: number }
  | { type: 'settings'; settings: SwarmSettings }
  | { type: 'request'; request: HireRequestView }
  | { type: 'ceo'; ceo: CeoInfo }
  | { type: 'message'; message: PhoneMessage }
  | { type: 'phoneRead'; at: number }
  | { type: 'officeUpdate'; officeUpdate: OfficeUpdateView }
  | { type: 'usage'; usage: UsageView }
  | { type: 'ops'; ops: OpsView }
  | { type: 'doctor'; doctor: DoctorFinding[] }
  | { type: 'clis'; clis: CliView[] }
  | { type: 'voiceKey'; voiceKeySet: boolean; voiceKeyHint: string }
  | { type: 'voiceCache'; voiceCache: VoiceCacheView }
  | { type: 'weather'; weather: WeatherView }
  | { type: 'ticker'; item: TickerItem }
  | { type: 'notifyChannels'; notifyChannels: NotifyChannelsView }
  | { type: 'notify'; note: NoteView }
  | { type: 'progress'; progress: ProgressView }
  | { type: 'reward'; reward: RewardView }
  | { type: 'pong'; repoId: string; board: PongRow[] }
  | { type: 'toast'; level: 'info' | 'success' | 'error'; text: string }
  // Presence (shared/presence.ts): relayed between the office's tabs, never persisted.
  | { type: 'visitors'; you: string; visitors: VisitorView[] }
  | ({ type: 'visitorPose'; id: string } & VisitorPose)
  | { type: 'visitorEmote'; id: string; e: EmoteId }
  | { type: 'visitorPing'; id: string; x: number; y: number; z: number; label: string };

/** What a tab shows of the agents' terminals, so the office sends it only those lines (shared/watch.ts). */
export interface Watch {
  /** The floor the tab is on (0: the lobby, where the CEO sits); -1 before it has said. */
  floor: number;
  /** Agents whose panel is open (their terminal, the CEO's in the console). */
  agents: string[];
  /** The workers list is showing: the latest line of every agent. */
  workers: boolean;
}


// ---------- presence: everyone viewing the office appears in it as a visitor ----------

/** Someone else in the 3D office (a tab or device that entered it and appears to others). */
export interface VisitorView {
  id: string;
  name: string; // cleaned by the server (shared/presence.ts cleanName)
  color: string; // #rrggbb
  floor: number; // 0 = lobby, -1 = the roof
}

/** What a visitor carries, as the others draw it. `s`: a mug's sips left (0–3). */
export interface VisitorHeld {
  k: 'ball' | 'mug' | 'blaster';
  id: string;
  s?: number;
}

/**
 * Where a visitor stands: floor, position (metres), heading (yaw, 0 facing -Z), look pitch and what they hold. `ts`:
 * when, on the sender's own clock (ms), so others space their poses as they were sent, not as they happened to arrive.
 */
export interface VisitorPose {
  ts: number;
  f: number;
  x: number;
  z: number;
  h: number;
  p: number;
  held: VisitorHeld | null;
}

export type EmoteId = 'wave' | 'thumbs' | 'clap' | 'point' | 'laugh';

/**
 * Browser to server on /ws. resync: send a fresh snapshot (a tab back from the time-lapse replay); lines: which
 * agents' terminal lines this tab shows (shared/watch.ts). The rest: presence.
 */
export type ClientEvent = { type: 'resync' } | ({ type: 'lines' } & Watch) | PresenceEvent;

/**
 * A tab's presence (shared/presence.ts). hello: your name and colour · pose: you're in the office and appear to others ·
 * watch: you're in the office on floor f but don't appear · away: not in the office · fakes: the demo's fake visitors.
 */
export type PresenceEvent =
  | { type: 'hello'; name: string; color: string }
  | ({ type: 'pose' } & VisitorPose)
  | { type: 'watch'; f: number }
  | { type: 'away' }
  | { type: 'emote'; e: EmoteId }
  | { type: 'ping'; x: number; y: number; z: number; label: string }
  | { type: 'fakes'; n: number };

export interface GhRepoSummary {
  nameWithOwner: string;
  description: string;
  visibility: string;
  updatedAt: string;
}
