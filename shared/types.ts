// Types shared between the swarm server and the 3D client.

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

/** A folder in the manager's projects folder, as offered when adding a floor. */
export interface ProjectFolderView {
  name: string;
  path: string;
  git: boolean;
  github: string | null; // owner/name of its GitHub origin
  floor: number | null; // already a floor in the office
}

/** dev and qa are the two pipeline lanes on every floor; the one CEO works in the lobby and runs the company. */
export type AgentRole = 'dev' | 'qa' | 'ceo';

/** Fixed id of the CEO agent. */
export const CEO_ID = 'ceo';

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
  title: string; // job title, e.g. "Three.js graphics engineer" ('' = plain developer / QA tester)
  specialty: string; // routes issues labelled swarm:<specialty> to this agent first ('' = generalist)
  brief: string; // job description for this project, added to the agent's instructions
  hiredBy: 'manager' | 'ceo';
  look: AgentLook;
  task: AgentTask | null;
  desk: number; // desk slot on the floor (dev desks and QA lab stations are numbered separately)
  color: string; // shirt color
  hair: string; // hair color
  skin: string;
  model: string; // '' = use the swarm default model, or a model id / alias
  effort: EffortLevel | ''; // '' = use the swarm default effort
  cli: AgentCli | ''; // the CLI they run in the terminal runtime ('' = the office default)
  terminal: boolean; // they have a terminal to watch (the terminal runtime); otherwise their log lines are the screen
  status: AgentStatus;
  issueNumber: number | null; // devs: the issue being worked on
  issueTitle: string | null; // devs: issue title; QA: title of the PR under test
  branch: string | null;
  prNumber: number | null; // devs: the PR they opened; QA: the PR under test
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
  log: LogLine[]; // tail of the terminal log (full buffer on snapshot)
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

/** One piece of an agent's prompt; the parts' texts concatenated are the whole prompt. */
export interface PromptPart {
  label: string;
  text: string;
  /** The manager can change it (the job description); the rest is the office's workflow and safety rules. */
  editable: boolean;
}

/** GET /api/agents/:id/prompt: what the agent is told on a task, with placeholders for the task's details. */
export interface AgentPromptView {
  kind: 'dev' | 'qa' | 'ceo';
  text: string;
  parts: PromptPart[];
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type QaStatus =
  | 'queued' // waiting for a free QA tester
  | 'testing' // a QA tester is on it
  | 'passed' // ready to merge
  | 'failed' // failed; waiting for the dev who wrote it to be free
  | 'fixing' // the dev is fixing what QA found
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
  devAgentId: string | null; // who wrote it (null for PRs opened outside the swarm)
  qaAgentId: string | null; // who is testing / last tested it
  summary: string | null; // latest QA summary
  checks: QaCheck[];
  commentUrl: string | null; // the PR comment with the latest QA report
  mergeNote: string | null; // where auto-merge stands once QA passed, e.g. "waiting for checks: Vercel"
  ceoLooking: boolean; // needs-human, and the CEO has a triage job for it (queued or running) before the manager hears
  updatedAt: number;
}

export interface SwarmSettings {
  sessionLimit: number; // most Claude Code sessions running at once; 0 = no limit
  defaultModel: string;
  defaultEffort: EffortLevel;
  runtime: AgentRuntime;
  defaultCli: AgentCli; // what developers and QA testers run in their terminals unless they have their own
  hiring: 'approve' | 'auto'; // CEO proposals wait for the manager, or go through while the floor is under teamCap
  teamCap: number; // most agents per floor the CEO may reach without the manager's approval (auto mode)
  ceoHeartbeatMin: number; // minutes between the CEO's periodic reviews; 0 = off
  managerName: string; // what the office calls you
  companyName: string;
  projectsDir: string; // where your project folders live; new projects are created here
  setupDone: boolean; // the first-run setup wizard has been completed or skipped
  tutorialStep: number; // index of the current tutorial step; -1 when finished or skipped
  autoUpdate?: boolean; // update the office itself once it's quiet (absent on servers without self-update)
  pacingSessions: number; // after Claude warns about usage, new issues start only while fewer sessions than this run
  trimIdleDesksMin: number; // a desk idle this many minutes loses its node_modules and build output; 0 = never
  voice: VoiceSettings;
  notify: NotifySettings;
}

/** What the office tells the manager about when they're away (docs/pocket.md). */
export type NotifyEvent = 'needsHuman' | 'ceoMessage' | 'hire' | 'agentError' | 'usage' | 'merge';

/** Where it tells them: this browser, Web Push to their devices, or a chat app's webhook. */
export type NotifyChannel = 'desktop' | 'push' | 'discord' | 'slack' | 'telegram' | 'ntfy';

/** The chat apps, whose webhook URLs and tokens live in the server's secrets file. */
export type NotifyWebhook = 'discord' | 'slack' | 'telegram' | 'ntfy';

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
  qaWaitMs: number | null; // median wait for a QA tester
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

/** A CEO proposal to hire someone or let someone go. The manager (the board) decides. */
export interface HireRequestView {
  id: string;
  kind: 'hire' | 'let-go';
  repoId: string;
  role: 'dev' | 'qa';
  agentId: string | null; // let-go: who; hire: who was hired once approved
  name: string; // the candidate's name (let-go: the agent's name)
  title: string;
  specialty: string;
  brief: string;
  reason: string;
  model: string;
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

export interface WorldSnapshot {
  user: string | null; // gh login
  ghReady: boolean;
  ghError?: string;
  demo: boolean;
  workspaceRoot: string;
  settings: SwarmSettings;
  repos: RepoView[];
  agents: AgentView[];
  qa: QaView[];
  requests: HireRequestView[];
  ceo: CeoInfo;
  messages: PhoneMessage[];
  phoneReadAt: number; // CEO messages newer than this are unread
  officeCommit?: string | null; // short sha the server started on (absent on servers without self-update)
  officeUpdate?: OfficeUpdateView;
  usage: UsageView;
  ops: OpsView;
  clis: CliView[];
  voiceKeySet: boolean; // an ElevenLabs key is saved (the key itself never leaves the server)
  voiceKeyHint: string; // its last 4 characters, '' when none
  voiceCache: VoiceCacheView;
  ticker?: TickerItem[]; // the floors' recent ticker lines, oldest first
  notifyChannels: NotifyChannelsView;
}

export type ServerEvent =
  | { type: 'snapshot'; data: WorldSnapshot }
  | { type: 'repo'; repo: RepoView }
  | { type: 'repoRemoved'; repoId: string }
  | { type: 'agent'; agent: Omit<AgentView, 'log'> }
  | { type: 'agentRemoved'; agentId: string }
  | { type: 'log'; agentId: string; lines: LogLine[] }
  | { type: 'screen'; agentId: string; url: string | null; at: number }
  | { type: 'qa'; qa: QaView }
  | { type: 'qaRemoved'; repoId: string; prNumber: number }
  | { type: 'settings'; settings: SwarmSettings }
  | { type: 'request'; request: HireRequestView }
  | { type: 'ceo'; ceo: CeoInfo }
  | { type: 'message'; message: PhoneMessage }
  | { type: 'phoneRead'; at: number }
  | { type: 'officeUpdate'; officeUpdate: OfficeUpdateView }
  | { type: 'usage'; usage: UsageView }
  | { type: 'ops'; ops: OpsView }
  | { type: 'clis'; clis: CliView[] }
  | { type: 'voiceKey'; voiceKeySet: boolean; voiceKeyHint: string }
  | { type: 'voiceCache'; voiceCache: VoiceCacheView }
  | { type: 'ticker'; item: TickerItem }
  | { type: 'notifyChannels'; notifyChannels: NotifyChannelsView }
  | { type: 'notify'; note: NoteView }
  | { type: 'toast'; level: 'info' | 'success' | 'error'; text: string };

export interface GhRepoSummary {
  nameWithOwner: string;
  description: string;
  visibility: string;
  updatedAt: string;
}
