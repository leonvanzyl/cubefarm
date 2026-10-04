import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import type { Backend } from './backend.ts';
import type { LogEntry, SessionHandle, SessionResult } from './agentRunner.ts';
import type { PrDetails } from './github.ts';
import { defaultProjectsDir, DESK_SWEEP_INTERVAL_MS, HOME_DIR, LOG_BUFFER, SCHEDULER_INTERVAL_MS, STATE_FILE, SYNC_INTERVAL_MS, WORKSPACE_ROOT } from './config.ts';
import { ceoJobPrompt, ceoSystemPrompt, checkCloseIssue, checkPendingLimit, createOfficeTools, FLOOR_DESKS, floorCapacity, IssueCap, jobLabel, MAX_PENDING_PROPOSALS, planRoute, seatCount, specialtyLabel, specialtySlug, type CeoJob, type OfficeTools } from './ceo.ts';
import { afterClose, ASK_AGAIN_MS, closedWhy, closuresHeld, forgettable, issueOpen, nameList, pullNow, stillOpen, stoppedMessage, toAsk, toHold, type Closure, type FloorState, type KnownPull, type LearnedPull } from './closeCleanup.ts';
import { depsPromptLine, type DepsOutcome } from './deps.ts';
import { setUpDesk } from './deskSetup.ts';
import { fixOutcome, MAX_FIX_FAILURES } from './fixOutcome.ts';
import { fixGoesTo, PREP_HOLD_MS, prepFailure, prepHeld, type PrepStrikes } from './handOut.ts';
import { HttpError } from './httpError.ts';
import { IssueAges } from './issueAges.ts';
import { issuesResolvedBy, issueTaken } from './issueClaims.ts';
import { CHECKS_ALERT_MS, failedRunIds, MAX_MERGE_FIXES, MERGE_RETRY_MS, mergeStep } from './mergeGate.ts';
import { orphanedQa } from './qaOrphans.ts';
import { catchUp, failedRunId, logTail, noChangeReason, PR_LIMITS_VERSION, QA_STOPPED, unpushedFix } from './prOwnership.ts';
import { conflictFixInstructions, MAX_QA_ROUNDS, qaGate, qaOutcome, type PreQa, type QaNext } from './qaOutcome.ts';
import { qaInstructions } from './qaPrompt.ts';
import { followKeptCli, resumeNote, resumesAfterRestart } from './restartRecovery.ts';
import { sendBackPatch } from './sendBack.ts';
import { checkTriageTarget, triageStep, type TriagePr } from './triage.ts';
import { DEFAULT_PREVIEW, Previews, parsePreviewPatch } from './previews.ts';
import { PREVIEW_SLUG } from './previewRunner.ts';
import { ceoPromptPreview, devBranch, devPromptPreview, devSystemPrompt, failedLogLines, noPushNudge, ownPrLine, qaBranch, qaPromptPreview, qaSystemPrompt } from './prompts.ts';
import { QA_RESUME_PROMPT, qaRetry } from './qaRetry.ts';
import { drainDecision, lastUpdateMessage, POSTPONE_MS, type DrainInput, type LastUpdate } from './officeUpdate.ts';
import { clampPacingSessions, DEFAULT_PACING_SESSIONS, mayStart, PACING_MS, pacingMessage, usageLabel, usageView, type UsageWarning, type WorkKind } from './pacing.ts';
import { clampTrimIdleMin, DEFAULT_TRIM_IDLE_MIN, desksToTrim, formatBytes, freedMessage, idleSince, TRIM_SWEEP_MS } from './deskTrim.ts';
import { isCli } from './clis.ts';
import { AgentTerminal } from './terminal.ts';
import { DEFAULT_VOICE, speaks, Voice, voiceSettings } from './voice.ts';
import { Notifier } from './notifier.ts';
import { clip, plainText, stuckAgents } from './notify.ts';
import { DEFAULT_NOTIFY, notifySettings, officeUrl } from '../shared/notify.ts';
import { blockers, holdUps, issueSpecialty, waitsMessage } from '../shared/issues.ts';
import { effectiveModel } from '../shared/models.ts';
import { CEO_ID, INSTALL_STEP } from '../shared/types.ts';
import type {
  AgentCli,
  AgentLook,
  AgentPromptView,
  AgentRole,
  AgentStatus,
  AgentTask,
  AgentView,
  CeoInfo,
  CliView,
  EffortLevel,
  HireRequestView,
  IssueInfo,
  LogLine,
  OfficeUpdateView,
  PhoneMessage,
  PreviewConfig,
  PreviewView,
  ProjectFolderView,
  PullInfo,
  QaCheck,
  QaView,
  RepoView,
  ServerEvent,
  SwarmSettings,
  WorldSnapshot,
} from '../shared/types.ts';

// ---------- persisted shape ----------

interface PersistedRepo {
  id: string;
  fullName: string;
  description: string;
  url: string;
  defaultBranch: string;
  floor: number;
  color: string;
  autoAssign: boolean;
  autoMerge: boolean; // PRs merge themselves once QA passes and GitHub's checks are green
  browserTesting: boolean;
  links: string[]; // other connected repos this floor's agents may read
  localPath: string | null; // the manager's own project folder (null: a clone under WORKSPACE_ROOT)
  mission: string;
  summary: string;
  qaBrief: string;
  preview: PreviewConfig; // how the floor's app runs for the preview monitor
  addedAt: number;
}

interface PersistedAgent {
  id: string;
  name: string;
  repoId: string; // '' for the CEO, who works in the lobby
  role: AgentRole;
  title: string;
  specialty: string;
  brief: string;
  hiredBy: 'manager' | 'ceo';
  look: AgentLook;
  task: AgentTask | null;
  desk: number;
  color: string;
  hair: string;
  skin: string;
  model: string;
  effort: EffortLevel | '';
  cli: AgentCli | ''; // '' = the office's default CLI
  status: AgentStatus;
  issueNumber: number | null;
  issueTitle: string | null;
  branch: string | null;
  prNumber: number | null;
  prUrl: string | null;
  startedAt: number | null;
  endedAt: number | null;
  costUsd: number;
  turns: number;
  sessionId: string | null;
  sessionCli: AgentCli | null; // the CLI whose session sessionId is: only it can resume it
  lastError: string | null;
  logTail: LogLine[];
}

/** A pull request's trip through QA. */
interface QaRecord extends Omit<QaView, 'ceoLooking'> {
  issueNumber: number | null;
  devSessionId: string | null; // the dev's Claude Code session, resumed to fix QA findings
  fixInstructions: string | null;
  sessionFailures: number;
  testedSha: string | null; // the head commit QA is testing
  passedSha: string | null; // the head commit QA signed off on: auto-merge merges exactly that
  fixReason: 'qa' | 'checks' | 'conflict' | null; // why it was last sent back to a developer
  mergeFixes: number; // times it went back for failing checks or conflicts
  retests: number; // QA rounds caused by merge fixes or new commits rather than by QA failing it
  preQa: PreQa | null; // a conflict found before QA tested the head is being fixed
  noChangeSha: string | null; // the head a developer last said needed no change (one free re-test per commit)
  pendingSince: number | null; // when auto-merge started waiting on its checks
  mergeRetryAt: number | null; // GitHub refused the merge: try again after this
  alerted: boolean; // the manager has been told it's stuck
  rerunSha: string | null; // the head commit whose failed checks the office re-ran (once per commit)
  rerunAt: number | null;
  qaChecks: PullInfo['checks'] | null; // GitHub's checks when QA last failed it: a later re-run can be the fix
  stuckWhy: string | null; // why it last became needs-human, for the CEO's triage and the manager's alert
  triages: number; // CEO triage jobs it has had (triage.ts caps them)
  escalated: boolean; // needs-human and the manager has been told; cleared when it leaves needs-human
}

/** The PR work a desk is being set up for. author: the PR's author before a fix was handed out (restored if it can't start). */
type PrepJob = { rec: QaRecord; task: 'qa' } | { rec: QaRecord; task: 'fix'; author: string | null };
const prepKey = (repoId: string, prNumber: number, task: PrepJob['task']) => `${repoId}#${prNumber}:${task}`;

/** Choices made when a project moves into the office. */
interface FloorOptions {
  mission?: string; // brief for the CEO to plan from
  autoAssign?: boolean; // free developers pick up backlog issues as soon as they're filed
}

interface CeoState {
  queue: CeoJob[];
  job: CeoJob | null; // the job the CEO is on right now
  lastReviewAt: number | null;
  lastFingerprint: string | null; // company state at the last review; unchanged means the next review is skipped
}

/** An open issue whose PR was closed: auto-assign leaves it for the manager (closeCleanup.ts toHold). */
interface HeldIssue {
  repoId: string;
  issue: number;
  pr: number;
}

interface Persisted {
  settings: SwarmSettings;
  repos: PersistedRepo[];
  agents: PersistedAgent[];
  qa: QaRecord[];
  requests: HireRequestView[];
  ceo: CeoState;
  messages: PhoneMessage[];
  phoneReadAt: number;
  prLimits: number; // the PR budgets (PR_LIMITS_VERSION) needs-human records were judged by
  held: HeldIssue[];
}

interface Shot {
  data: Buffer;
  mime: string;
  url: string | null;
  at: number;
}

interface AgentRuntime {
  log: LogLine[];
  pending: LogLine[];
  session: SessionHandle | null;
  currentTool: string | null;
  browserUrl: string | null;
  screenshot: { data: Buffer; mime: string; at: number } | null;
  shots: Shot[]; // every screenshot of the current session (QA evidence)
  terminal: AgentTerminal | null; // their terminal, once they've run in the terminal runtime
  qaResume?: { cwd: string; systemAppend: string } | null; // the QA run's one resume for a missing report, until used
}

interface RepoRuntime {
  issues: IssueInfo[];
  pulls: PullInfo[];
  lastSync: number | null;
  syncError?: string;
  syncing: boolean;
  cloneStatus: RepoView['cloneStatus'];
  cloneError?: string;
  fetchedAt?: number; // when the latest issues/PRs fetch started
  lastMergedAt: string | null; // newest merge seen: a newer one means the folder needs a sync
  folderSync: string | null;
  merging: boolean;
  closedIssues: Map<number, number>; // issues the office learned are closed, and when (closeCleanup.ts)
  closedPulls: Map<number, LearnedPull>; // PRs it learned are closed or merged
  openAt: Map<string, number>; // `issue#<n>` / `pr#<n>` -> when GitHub said one the sync doesn't list is open
}

interface QaReport {
  verdict: 'pass' | 'fail';
  summary: string;
  checks: QaCheck[];
  commands: { command: string; result: string }[];
  screenshots: string[];
  fixInstructions?: string;
}

// ---------- flavour ----------

const FLOOR_COLORS = ['#ff8a5b', '#4fb3e8', '#8fd14f', '#c77dff', '#ffc93c', '#ff6fb5', '#2ec4b6', '#f25f5c'];
const SHIRTS = ['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#9b5de5', '#f15bb5', '#00bbf9', '#06d6a0', '#ffbe0b', '#8338ec', '#fb5607', '#3a86ff'];
const HAIR = ['#2b2118', '#6b4226', '#c68642', '#f2d16b', '#d94f30', '#1c1c1c', '#8e8e8e', '#5b3cc4', '#e76f51'];
const SKIN = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffe0bd'];
const DEV_NAMES = [
  'Ada', 'Linus', 'Grace', 'Alan', 'Margaret', 'Dennis', 'Barbara', 'Ken', 'Radia', 'Guido', 'Hedy', 'Tim', 'Katherine',
  'Bjarne', 'Frances', 'Edsger', 'Anita', 'Donald', 'Sophie', 'Yukihiro', 'Jean', 'Niklaus', 'Karen', 'Brendan',
];
const QA_NAMES = ['Sherlock', 'Marple', 'Poirot', 'Nancy', 'Columbo', 'Fletcher', 'Watson', 'Morse', 'Holmes', 'Maigret'];

// Names that get the feminine character look: everyone in the name pools above, plus common first names
// for agents the manager names themselves. The manager can always change an agent's look in the console.
const FEMININE_NAMES = new Set(
  (
    'ada grace margaret barbara radia hedy katherine frances anita sophie jean karen marple nancy fletcher ' +
    'alice amanda amelia amy ana anna anne aisha astrid ava bella beth carla caroline charlotte chloe claire clara ' +
    'diana elena elizabeth ella ellie emily emma eva fatima fiona freya georgia hannah harper helen holly ingrid iris ' +
    'isabella ivy jane jasmine jessica julia kate laura leah leila lena lily linda lisa lucy maria marie mary maya mei ' +
    'mia mila monica naomi natalie nina nora olivia paula priya rachel rose ruby sandra sara sarah scarlett sofia ' +
    'stella susan tess tessa tina vera victoria yuki zara zoe'
  ).split(' '),
);
const lookFor = (name: string): AgentLook => (FEMININE_NAMES.has(name.trim().split(/\s+/)[0].toLowerCase()) ? 'feminine' : 'masculine');
const LOOKS: AgentLook[] = ['feminine', 'masculine'];
const MAX_DESKS: Record<AgentRole, number> = { ...FLOOR_DESKS, ceo: 1 };
// Every agent runs Claude Opus 5.5 at medium effort unless the manager overrides it.
const DEFAULT_MODEL = 'claude-opus-5-5';
const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
// The CEO thinks harder than the staff: Opus 5.5 at xhigh effort unless the manager changes it.
const CEO_MODEL = 'claude-opus-5-5';
const CEO_EFFORT: EffortLevel = 'xhigh';
const CEO_NAME = 'Morgan';
// The CEO's own folder: its notes about the company live here. Repos are read through their clones.
const CEO_DIR = path.join(HOME_DIR, 'ceo');
const DEFAULT_PROJECTS_DIR = defaultProjectsDir(path.resolve(import.meta.dirname, '..'));
const MAX_ISSUES_PER_JOB = 12;
const KEEP_MESSAGES = 200;
const KEEP_DECIDED_REQUESTS = 40;

const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'agent';

const BUSY: AgentStatus[] = ['preparing', 'working'];
const FREE: AgentStatus[] = ['idle', 'done'];
// An agent whose session failed sits out this long before taking new work, so a broken setup can't burn through the queue.
const ERROR_COOLDOWN_MS = 2 * 60_000;
// Auto-assign stops retrying an issue after this many failed sessions; the manager can still assign it by hand.
const MAX_ISSUE_FAILURES = 2;
// Failed QA runs (sessions, or desks that couldn't be set up) before a PR goes to the manager.
const MAX_QA_FAILURES = 2;
// How long the office waits after Claude's usage limit is hit when Claude doesn't say when it resets.
const LIMIT_PAUSE_MS = 15 * 60_000;
const oneLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).split(/\r?\n/)[0].slice(0, 200);

// The latest browser screenshot per agent is kept on disk so monitors survive a server restart.
const SCREENS_DIR = path.join(HOME_DIR, 'screens');
const MIME_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const screenFile = (agentId: string, mime: string) => path.join(SCREENS_DIR, `${agentId}.${MIME_EXT[mime] ?? 'img'}`);

async function loadScreen(agentId: string): Promise<{ data: Buffer; mime: string; at: number } | null> {
  for (const [mime, ext] of Object.entries(MIME_EXT)) {
    const file = path.join(SCREENS_DIR, `${agentId}.${ext}`);
    try {
      const [data, stat] = await Promise.all([fs.readFile(file), fs.stat(file)]);
      return { data, mime, at: stat.mtimeMs };
    } catch {
      // try the next extension
    }
  }
  return null;
}

async function removeScreens(agentId: string) {
  await Promise.all(Object.values(MIME_EXT).map((ext) => fs.rm(path.join(SCREENS_DIR, `${agentId}.${ext}`), { force: true })));
}

// Each agent's terminal (screen and scrollback) is saved too, so the office shows what they did after a restart.
const TERMINALS_DIR = path.join(HOME_DIR, 'terminals');
const terminalFile = (agentId: string) => path.join(TERMINALS_DIR, `${agentId}.ansi`);
const TERMINAL_SAVE_MS = 20_000;

// ---------- QA report ----------

const QA_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'checks', 'commands', 'screenshots'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'], description: 'pass only if the change works and meets the issue requirements' },
    summary: { type: 'string', description: 'Two to four sentences for the pull request comment.' },
    checks: {
      type: 'array',
      description: 'Each acceptance criterion, test run or scenario you verified.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'result', 'details'],
        properties: {
          name: { type: 'string' },
          result: { type: 'string', enum: ['pass', 'fail', 'skip'] },
          details: { type: 'string', description: 'What you did and what you observed.' },
        },
      },
    },
    commands: {
      type: 'array',
      description: 'Test suites, linters, builds and other commands you ran.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['command', 'result'],
        properties: { command: { type: 'string' }, result: { type: 'string', description: 'e.g. "42 passed, 0 failed"' } },
      },
    },
    screenshots: {
      type: 'array',
      description: 'One short caption per screenshot you took with browser_take_screenshot, in the order you took them.',
      items: { type: 'string' },
    },
    fixInstructions: { type: 'string', description: 'When the verdict is fail: precise, actionable instructions for the developer.' },
  },
};

function parseReport(result: SessionResult): QaReport | null {
  let raw: unknown = result.structured;
  if (!raw && result.text) {
    // Terminal agents end their last message with the report, usually in a ```json block.
    const fenced = [...result.text.matchAll(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/g)].map((m) => m[1]).reverse();
    for (const json of [...fenced, result.text.match(/\{[\s\S]*\}/)?.[0]].filter((j): j is string => !!j)) {
      try {
        raw = JSON.parse(json);
        break;
      } catch {
        raw = null;
      }
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<QaReport>;
  if (r.verdict !== 'pass' && r.verdict !== 'fail') return null;
  return {
    verdict: r.verdict,
    summary: String(r.summary ?? ''),
    checks: Array.isArray(r.checks) ? r.checks.map((c) => ({ name: String(c.name ?? ''), result: c.result === 'fail' ? 'fail' : c.result === 'skip' ? 'skip' : 'pass', details: String(c.details ?? '') })) : [],
    commands: Array.isArray(r.commands) ? r.commands.map((c) => ({ command: String(c.command ?? ''), result: String(c.result ?? '') })) : [],
    screenshots: Array.isArray(r.screenshots) ? r.screenshots.map(String) : [],
    fixInstructions: r.fixInstructions ? String(r.fixInstructions) : undefined,
  };
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
const ICON = { pass: '✅', fail: '❌', skip: '⏭️' } as const;

export { HttpError };

export class Swarm {
  private state: Persisted = {
    settings: {
      sessionLimit: 0,
      defaultModel: DEFAULT_MODEL,
      defaultEffort: 'medium',
      runtime: 'terminal',
      defaultCli: 'claude',
      hiring: 'approve',
      teamCap: 6,
      ceoHeartbeatMin: 60,
      managerName: '',
      companyName: '',
      projectsDir: DEFAULT_PROJECTS_DIR,
      setupDone: false,
      tutorialStep: 0,
      autoUpdate: true,
      pacingSessions: DEFAULT_PACING_SESSIONS,
      trimIdleDesksMin: DEFAULT_TRIM_IDLE_MIN,
      voice: { ...DEFAULT_VOICE },
      notify: notifySettings(DEFAULT_NOTIFY, {}),
    },
    repos: [],
    agents: [],
    qa: [],
    requests: [],
    ceo: { queue: [], job: null, lastReviewAt: null, lastFingerprint: null },
    messages: [],
    phoneReadAt: 0,
    prLimits: PR_LIMITS_VERSION,
    held: [],
  };
  /**
   * The CEO's office tools. Every session gets its own server: one can only be connected to one session at a time, so
   * a shared one left the next session connected but without any tools while an earlier session still held it.
   */
  private officeTools(): OfficeTools {
    return createOfficeTools({
      companyStatus: () => this.companyStatus(),
      agentDetail: (a) => this.agentDetail(a),
      setFloorProfile: (a) => this.setFloorProfile(a),
      updateJob: (a) => this.updateJob(a),
      proposeHire: (a) => this.proposeHire(a),
      proposeLetGo: (a) => this.proposeLetGo(a),
      fileIssue: (a) => this.fileIssue(a),
      routeIssue: (a) => this.routeIssue(a),
      closeIssue: (a) => this.closeIssue(a),
      retryQa: (a) => this.triageRetryQa(a),
      sendBack: (a) => this.triageSendBack(a),
      rerunChecks: (a) => this.triageRerunChecks(a),
      closePull: (a) => this.triageClosePull(a),
      escalate: (a) => this.triageEscalate(a),
    });
  }
  private ceoIssues = new IssueCap(MAX_ISSUES_PER_JOB); // issues filed during the current CEO job
  private messageSeq = 1;
  private agentRt = new Map<string, AgentRuntime>();
  private repoRt = new Map<string, RepoRuntime>();
  private issueAges = new IssueAges(); // when the issues behind recent merges were filed, for the whiteboard
  private deskAlerts = new Map<string, string>(); // agent id -> the desk setup error the manager was last told about
  private prepStrikes = new Map<string, PrepStrikes>(); // `${repoId}#${pr}:${task}` -> its desks that couldn't be set up
  private dropping = new Map<string, string>(); // agent id -> why their task's issue or PR closed: the desk clears once the session ends
  private clients = new Set<WebSocket>();
  private user: string | null = null;
  private ghError: string | undefined;
  private saveTimer: NodeJS.Timeout | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private logSeq = 1;
  private previews: Previews;
  private officeHead: string | null = null; // the commit the office runs (null: not a git checkout, so no self-update)
  private officeUpdate = {
    behind: 0,
    requested: false,
    postponedUntil: null as number | null,
    postponedBehind: 0,
    failed: null as string | null,
    failedBehind: null as number | null,
    drainingSince: null as number | null,
    sent: false,
    handedOver: false, // sessions cut off by the hand-over are the restarted office's to recover
  };
  private lastOfficeView = '';
  private clis: CliView[] = []; // coding-agent CLIs found on this machine (detected at startup)
  /** Phone messages read aloud. The demo keeps its own key and clips, so it never touches the real ones. */
  readonly voice: Voice;
  /** Notifications to the manager's devices and chat apps (docs/pocket.md). The demo's only log what they'd send. */
  readonly notifier: Notifier;
  private toldStuck = new Set<string>(); // `${agentId}:${endedAt}`: agents in an error the manager was notified about

  constructor(private backend: Backend) {
    this.voice = new Voice({
      api: backend.voice,
      secretsFile: path.join(HOME_DIR, backend.demo ? 'demo-secrets.json' : 'secrets.json'),
      cacheDir: path.join(HOME_DIR, backend.demo ? 'demo-voice' : 'voice'),
      settings: () => this.state.settings.voice,
      messages: () => this.state.messages,
      officeNote: (text) => this.postMessage('office', text),
      keyChanged: (view) => this.broadcast({ type: 'voiceKey', ...view }),
      cacheChanged: (voiceCache) => this.broadcast({ type: 'voiceCache', voiceCache }),
      log: (line) => console.log(line),
    });
    this.notifier = new Notifier({
      transport: backend.notify,
      secretsFile: path.join(HOME_DIR, backend.demo ? 'demo-secrets.json' : 'secrets.json'),
      pushFile: path.join(HOME_DIR, backend.demo ? 'demo-push.json' : 'push.json'),
      settings: () => this.state.settings.notify,
      broadcast: (note) => this.broadcast({ type: 'notify', note }),
      channelsChanged: (notifyChannels) => this.broadcast({ type: 'notifyChannels', notifyChannels }),
      log: (line) => console.warn(line),
    });
    this.previews = new Previews(backend, {
      emit: (id) => {
        const r = this.state.repos.find((x) => x.id === id);
        if (r && this.repoRt.has(id)) this.emitRepo(r);
      },
      pulls: (id) => this.repoRt.get(id)?.pulls ?? [],
    });
  }

  // ---------- lifecycle ----------

  async init() {
    try {
      const raw = await fs.readFile(STATE_FILE, 'utf8');
      const loaded = JSON.parse(raw) as Partial<Persisted>;
      this.state = {
        settings: { ...this.state.settings, ...loaded.settings },
        repos: (loaded.repos ?? []).map((r) => ({
          ...r,
          autoMerge: r.autoMerge ?? true,
          links: r.links ?? [],
          mission: r.mission ?? '',
          summary: r.summary ?? '',
          qaBrief: r.qaBrief ?? '',
          localPath: r.localPath ?? null,
          preview: { command: r.preview?.command ?? null, env: { ...r.preview?.env } },
        })),
        agents: (loaded.agents ?? []).map((a) => ({
          ...a,
          effort: a.effort ?? '',
          role: a.role ?? 'dev',
          title: a.title ?? '',
          specialty: a.specialty ?? '',
          brief: a.brief ?? '',
          hiredBy: a.hiredBy ?? 'manager',
          look: a.look ?? lookFor(a.name),
          task: a.task ?? (a.issueNumber ? 'issue' : null),
          cli: isCli(a.cli) ? a.cli : '',
          sessionCli: a.sessionCli ?? (a.sessionId ? 'claude' : null),
        })),
        qa: (loaded.qa ?? []).map((q) => ({
          ...q,
          testedSha: q.testedSha ?? null,
          passedSha: q.passedSha ?? null,
          fixReason: q.fixReason ?? null,
          mergeFixes: q.mergeFixes ?? 0,
          retests: q.retests ?? 0,
          pendingSince: q.pendingSince ?? null,
          mergeRetryAt: q.mergeRetryAt ?? null,
          alerted: q.alerted ?? false,
          preQa: q.preQa ?? null,
          noChangeSha: q.noChangeSha ?? null,
          rerunSha: q.rerunSha ?? null,
          rerunAt: q.rerunAt ?? null,
          qaChecks: q.qaChecks ?? null,
          stuckWhy: q.stuckWhy ?? null,
          triages: q.triages ?? 0,
          escalated: q.escalated ?? q.status === 'needs-human', // stuck before triage existed: the manager was told
          mergeNote: null,
        })),
        requests: loaded.requests ?? [],
        ceo: { ...this.state.ceo, ...loaded.ceo },
        messages: loaded.messages ?? [],
        phoneReadAt: loaded.phoneReadAt ?? 0,
        prLimits: loaded.prLimits ?? 1,
        held: loaded.held ?? [],
      };
      for (const m of this.state.messages) this.messageSeq = Math.max(this.messageSeq, m.id + 1);
      if (!EFFORTS.includes(this.state.settings.defaultEffort)) this.state.settings.defaultEffort = 'medium';
      if (this.state.settings.runtime !== 'sdk') this.state.settings.runtime = 'terminal';
      if (!isCli(this.state.settings.defaultCli)) this.state.settings.defaultCli = 'claude';
      this.state.settings.trimIdleDesksMin = clampTrimIdleMin(this.state.settings.trimIdleDesksMin);
      if (!this.state.settings.defaultModel && this.state.settings.defaultCli === 'claude') this.state.settings.defaultModel = DEFAULT_MODEL;
      // "Max concurrent sessions" (default 4) became an optional session limit. The old default goes; a limit the manager chose stays.
      const old = this.state.settings as SwarmSettings & { maxConcurrent?: number; permissionMode?: string };
      if (old.maxConcurrent !== undefined) {
        if (loaded.settings?.sessionLimit === undefined) old.sessionLimit = old.maxConcurrent === 4 ? 0 : old.maxConcurrent;
        delete old.maxConcurrent;
      }
      delete old.permissionMode; // the office's rules are instructions now, not a permission mode
      this.state.settings.voice = voiceSettings(DEFAULT_VOICE, loaded.settings?.voice);
      this.state.settings.notify = notifySettings(DEFAULT_NOTIFY, loaded.settings?.notify);
      // Offices that were set up before the setup wizard existed skip it.
      if (loaded.settings && loaded.settings.setupDone === undefined && this.state.repos.length > 0) {
        Object.assign(this.state.settings, { setupDone: true, tutorialStep: -1 });
      }
    } catch {
      // first run
    }
    await this.voice.init();
    await this.notifier.init();
    for (const r of this.state.repos) if (r.localPath) this.backend.setLocalPath(r.fullName, r.localPath);
    const interrupted: PersistedAgent[] = [];
    for (const a of this.state.agents) {
      const tail = a.logTail ?? [];
      for (const l of tail) this.logSeq = Math.max(this.logSeq, l.id + 1);
      this.agentRt.set(a.id, { log: tail, pending: [], session: null, currentTool: null, browserUrl: null, screenshot: await loadScreen(a.id), shots: [], terminal: await this.loadTerminal(a.id) });
    }
    // CLIs the terminal keeper kept running through the restart go back into their terminals, and busy ones carry on.
    // (The CEO's session is resumed instead: its office tools live in this process.)
    const back = await this.backend
      .reconnectClis((id) => {
        const a = this.state.agents.find((x) => x.id === id);
        return a && a.role !== 'ceo' ? this.terminalFor(a) : null;
      })
      .catch((err) => {
        console.warn('could not reconnect to the terminal keeper', err);
        return [];
      });
    const carryOn: PersistedAgent[] = [];
    const preparing = new Set<PersistedAgent>(); // their task's session hadn't started: nothing of it to resume
    for (const a of this.state.agents) {
      if (!BUSY.includes(a.status)) continue;
      if (followKeptCli(a, back.find((c) => c.agentId === a.id))) {
        carryOn.push(a);
        continue;
      }
      if (a.status === 'preparing') preparing.add(a);
      a.status = 'stopped';
      a.lastError = 'The swarm server restarted while this agent was working.';
      interrupted.push(a);
    }
    for (const c of back) if (c.busy && !carryOn.some((a) => a.id === c.agentId)) this.agentRt.get(c.agentId)?.terminal?.releaseIdle?.();
    for (const r of this.state.repos) this.repoRt.set(r.id, { issues: [], pulls: [], lastSync: null, syncing: false, cloneStatus: 'pending', lastMergedAt: null, folderSync: null, merging: false, closedIssues: new Map(), closedPulls: new Map(), openAt: new Map() });
    for (const a of carryOn) this.reattachSession(a);
    this.backend.hooksReady();

    try {
      this.user = await this.backend.user();
    } catch (err) {
      this.ghError = `GitHub CLI is not ready: ${(err as Error).message}. Run "gh auth login".`;
      console.warn(this.ghError);
    }

    if (this.backend.demo && this.state.repos.length === 0) {
      // The demo opens on a busy office; the tutorial still runs so it can be tried.
      Object.assign(this.state.settings, { setupDone: true, managerName: 'Demo Manager', companyName: 'Demo Co.' });
      for (const r of await this.backend.listMyRepos()) {
        const repo = await this.connectRepo(r.nameWithOwner);
        for (let i = 0; i < (repo.floor === 1 ? 5 : 3); i++) this.hireAgent(repo.id, {});
        this.updateRepo(repo.id, { autoAssign: true });
      }
    }
    for (const r of this.state.repos) this.ensureQaTester(r);
    this.ensureCeo(interrupted);

    for (const r of this.state.repos) void this.cloneRepo(r.id);
    await Promise.all(this.state.repos.map((r) => this.syncRepo(r.id)));
    // Anything still alive in a desk (or a preview) is left over from before the restart, except around the CLIs that
    // kept running through it: their dev servers and commands are theirs.
    await Promise.all([
      ...this.state.agents.map((a) => {
        const repo = this.state.repos.find((r) => r.id === a.repoId);
        if (!repo || back.some((c) => c.agentId === a.id)) return undefined;
        return this.backend.releaseDesk(repo.fullName, this.agentSlug(a), this.port(a)).catch(() => undefined);
      }),
      this.previews.clearOrphans(this.state.repos),
    ]);
    for (const r of this.state.repos) void this.previews.refreshDefault(r);
    this.recover(interrupted, preparing);
    // A PR the restart left in "testing" with nobody on it: test it again (the result, if any, was lost).
    for (const rec of orphanedQa(this.state.qa, this.state.agents, BUSY)) this.setQa(rec, { status: 'queued', qaAgentId: null });
    if (this.state.prLimits < PR_LIMITS_VERSION) this.catchUpPrs();
    this.officeHead = await this.backend.office.head();
    const updated = await this.backend.office.takeLastUpdate().catch(() => null);
    if (updated) await this.reportUpdate(updated);
    setInterval(() => this.state.repos.forEach((r, i) => setTimeout(() => void this.syncRepo(r.id), i * 1500)), SYNC_INTERVAL_MS);
    setInterval(() => this.schedule(), SCHEDULER_INTERVAL_MS);
    setInterval(() => void this.saveTerminals(), TERMINAL_SAVE_MS);
    // Every minute in the demo, so a short idle time shows its phone message soon.
    setInterval(() => {
      void this.trimIdleDesks();
      void this.voice.prune();
    }, this.backend.demo ? 60_000 : TRIM_SWEEP_MS);
    setInterval(() => this.state.repos.forEach((r, i) => setTimeout(() => void this.sweepFloor(r.id), i * 1500)), DESK_SWEEP_INTERVAL_MS);
    setInterval(() => this.notifyStuck(), 60_000);
    void this.backend
      .detectClis()
      .then((clis) => {
        this.clis = clis;
        this.broadcast({ type: 'clis', clis });
      })
      .catch((err) => console.warn('could not look for agent CLIs', err));
    this.save();
    setTimeout(() => this.schedule(), 1000);
  }

  /**
   * Agents cut off by a server restart pick their session back up, told what they were doing. QA, demo agents and
   * tasks still being prepared start over from the queue.
   */
  private recover(agents: PersistedAgent[], preparing: Set<PersistedAgent>) {
    for (const a of agents) {
      if (!a.task) continue; // its issue or PR closed while the office was down: the startup sync cleared the desk
      const fix = a.task === 'fix' ? this.state.qa.find((q) => q.devAgentId === a.id && q.status === 'fixing') : undefined;
      if (!resumesAfterRestart(a, preparing.has(a), this.backend.demo)) {
        this.appendLog(a, [{ kind: 'system', text: '↺ The office server restarted. Starting over from the queue.' }]);
        const rec = a.task === 'qa' ? this.state.qa.find((q) => q.qaAgentId === a.id && q.status === 'testing') : undefined;
        if (rec) this.setQa(rec, { status: 'queued' });
        if (fix) this.setQa(fix, { status: 'failed' });
        this.clearTask(a);
        continue;
      }
      if (this.slotsFull()) continue; // stays 'stopped'; the manager can resume it later
      void this.message(a.id, resumeNote(a, fix)).catch((err) => console.warn(`could not resume ${a.name}`, err));
    }
  }

  /** One-off, on the first start with bigger PR budgets: PRs the manager got under the old ones go back to work. */
  private catchUpPrs() {
    const back: string[] = [];
    for (const rec of this.state.qa) {
      const status = catchUp(rec);
      if (!status) continue;
      const repo = this.state.repos.find((r) => r.id === rec.repoId);
      this.setQa(rec, { status, mergeNote: null, pendingSince: null, mergeRetryAt: null, alerted: false });
      back.push(`#${rec.prNumber}${repo ? ` on ${repo.fullName}` : ''}`);
    }
    this.state.prLimits = PR_LIMITS_VERSION;
    if (back.length) this.postMessage('office', `↩️ Developers now get more tries at their PRs, so ${back.join(', ')} went back to them instead of waiting for you.`);
  }

  // ---------- views ----------

  private repoView(r: PersistedRepo): RepoView {
    const rt = this.repoRt.get(r.id)!;
    return {
      id: r.id,
      fullName: r.fullName,
      description: r.description,
      url: r.url,
      defaultBranch: r.defaultBranch,
      floor: r.floor,
      color: r.color,
      autoAssign: r.autoAssign,
      autoMerge: r.autoMerge,
      folderSync: rt.folderSync,
      browserTesting: r.browserTesting,
      links: r.links,
      mission: r.mission,
      summary: r.summary,
      qaBrief: r.qaBrief,
      localPath: r.localPath,
      checkoutPath: this.backend.mainDir(r.fullName),
      cloneStatus: rt.cloneStatus,
      cloneError: rt.cloneError,
      issues: rt.issues,
      pulls: rt.pulls,
      held: this.state.held.filter((h) => h.repoId === r.id).map((h) => ({ issue: h.issue, pr: h.pr })),
      lastSync: rt.lastSync,
      syncError: rt.syncError,
      previewConfig: r.preview,
      preview: this.previews.view(r),
    };
  }

  private agentView(a: PersistedAgent, withLog: boolean): AgentView {
    const rt = this.agentRt.get(a.id)!;
    return {
      id: a.id,
      name: a.name,
      repoId: a.repoId,
      role: a.role,
      title: a.title,
      specialty: a.specialty,
      brief: a.brief,
      hiredBy: a.hiredBy,
      look: a.look,
      task: a.task,
      desk: a.desk,
      color: a.color,
      hair: a.hair,
      skin: a.skin,
      model: a.model,
      effort: a.effort,
      cli: a.cli,
      terminal: !!rt.terminal,
      status: a.status,
      issueNumber: a.issueNumber,
      issueTitle: a.issueTitle,
      branch: a.branch,
      prNumber: a.prNumber,
      prUrl: a.prUrl,
      currentTool: rt.currentTool,
      startedAt: a.startedAt,
      endedAt: a.endedAt,
      costUsd: a.costUsd,
      turns: a.turns,
      browserUrl: rt.browserUrl,
      hasScreenshot: !!rt.screenshot,
      screenshotAt: rt.screenshot?.at ?? null,
      lastError: a.lastError,
      log: withLog ? rt.log : [],
    };
  }

  private qaView(q: QaRecord): QaView {
    return {
      repoId: q.repoId,
      prNumber: q.prNumber,
      status: q.status,
      round: q.round,
      devAgentId: q.devAgentId,
      qaAgentId: q.qaAgentId,
      summary: q.summary,
      checks: q.checks,
      commentUrl: q.commentUrl,
      mergeNote: q.mergeNote,
      ceoLooking: q.status === 'needs-human' && !q.escalated && this.triageJob(q) != null,
      updatedAt: q.updatedAt,
    };
  }

  snapshot(): WorldSnapshot {
    return {
      user: this.user,
      ghReady: !this.ghError,
      ghError: this.ghError,
      demo: this.backend.demo,
      workspaceRoot: WORKSPACE_ROOT,
      settings: this.state.settings,
      repos: this.state.repos.map((r) => this.repoView(r)),
      agents: this.state.agents.map((a) => this.agentView(a, true)),
      qa: this.state.qa.map((q) => this.qaView(q)),
      requests: this.state.requests,
      ceo: this.ceoInfo(),
      messages: this.state.messages.slice(-100),
      phoneReadAt: this.state.phoneReadAt,
      usage: this.usageNow(),
      clis: this.clis,
      ...this.voice.keyView(),
      voiceCache: this.voice.cacheInfo(),
      notifyChannels: this.notifier.channelsView(),
      officeCommit: this.officeHead?.slice(0, 7) ?? null,
      officeUpdate: this.officeHead ? this.officeUpdateView() : undefined,
    };
  }

  /** The short commit the office runs, or null when it isn't a git checkout. */
  officeCommit(): string | null {
    return this.officeHead?.slice(0, 7) ?? null;
  }

  /** The agent's latest screenshot: null when it has none right now, undefined for an unknown agent. */
  screenshot(agentId: string) {
    const rt = this.agentRt.get(agentId);
    return rt ? rt.screenshot : undefined;
  }

  // ---------- clients ----------

  addClient(ws: WebSocket) {
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    this.send(ws, { type: 'snapshot', data: this.snapshot() });
  }

  private send(ws: WebSocket, ev: ServerEvent) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(ev));
  }

  private broadcast(ev: ServerEvent) {
    const msg = JSON.stringify(ev);
    for (const ws of this.clients) if (ws.readyState === ws.OPEN) ws.send(msg);
  }

  private toast(level: 'info' | 'success' | 'error', text: string) {
    this.broadcast({ type: 'toast', level, text });
  }

  private emitRepo(r: PersistedRepo) {
    this.broadcast({ type: 'repo', repo: this.repoView(r) });
  }

  private emitAgent(a: PersistedAgent) {
    // A session can finish after its agent was let go (their floor disconnected mid-task); they're gone, so say nothing.
    if (!this.agentRt.has(a.id)) return;
    const { log: _log, ...rest } = this.agentView(a, false);
    this.broadcast({ type: 'agent', agent: rest });
  }

  private setQa(rec: QaRecord, patch: Partial<QaRecord>) {
    const told = rec.status === 'needs-human' && rec.escalated;
    Object.assign(rec, patch, { updatedAt: Date.now() });
    if (!this.state.qa.includes(rec)) return; // it left QA (its PR closed) while a session on it was still wrapping up
    if (rec.status !== 'needs-human') rec.escalated = false;
    this.broadcast({ type: 'qa', qa: this.qaView(rec) });
    this.save();
    // Every way a PR reaches the manager (escalated by the CEO, or straight to them) passes here.
    if (!told && rec.status === 'needs-human' && rec.escalated) this.notifyNeedsHuman(rec);
  }

  private appendLog(a: PersistedAgent, entries: LogEntry[]) {
    const rt = this.agentRt.get(a.id);
    if (!rt) return;
    const t = Date.now();
    for (const e of entries) {
      const line: LogLine = { id: this.logSeq++, t, kind: e.kind, text: e.text, tool: e.tool };
      rt.log.push(line);
      rt.pending.push(line);
    }
    if (rt.log.length > LOG_BUFFER) rt.log.splice(0, rt.log.length - LOG_BUFFER);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flushLogs(), 120);
  }

  private flushLogs() {
    this.flushTimer = null;
    for (const [agentId, rt] of this.agentRt) {
      if (rt.pending.length === 0) continue;
      this.broadcast({ type: 'log', agentId, lines: rt.pending });
      rt.pending = [];
    }
    this.save();
  }

  // ---------- persistence ----------

  private save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => void this.writeState().catch((err) => console.warn('could not save the state', err)), 1500);
  }

  /** Write the state file now, e.g. before the office stops or hands itself to the launcher. */
  private async writeState() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    for (const a of this.state.agents) a.logTail = (this.agentRt.get(a.id)?.log ?? []).slice(-200);
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.state, null, 2));
    await fs.rename(tmp, STATE_FILE);
  }

  // ---------- lookups ----------

  private repo(id: string) {
    const r = this.state.repos.find((x) => x.id === id);
    if (!r) throw new HttpError(404, `Repo ${id} is not connected`);
    return r;
  }

  private agent(id: string) {
    const a = this.state.agents.find((x) => x.id === id);
    if (!a) throw new HttpError(404, `No agent ${id}`);
    return a;
  }

  private running() {
    return this.state.agents.filter((a) => BUSY.includes(a.status)).length;
  }

  /** True when the manager has set a session limit and every slot is taken. */
  private slotsFull() {
    const limit = this.state.settings.sessionLimit;
    return limit > 0 && this.running() >= limit;
  }

  private agentSlug(a: PersistedAgent) {
    return `${slugify(a.name)}-${a.id.slice(0, 4)}`;
  }

  private clearTask(a: PersistedAgent) {
    Object.assign(a, { status: 'idle', task: null, issueNumber: null, issueTitle: null, branch: null, prNumber: null, prUrl: null, lastError: null });
    this.emitAgent(a);
  }

  // ---------- GitHub / repos ----------

  listGithubRepos(owner?: string) {
    return this.backend.listMyRepos(owner);
  }

  /**
   * Give a GitHub repo a floor. Its main checkout is one of your own folders: the one you picked, else the folder in
   * your projects folder that already has it as origin, else a fresh clone into your projects folder.
   */
  async connectRepo(fullName: string, opts: FloorOptions & { localPath?: string } = {}): Promise<RepoView> {
    const existing = this.state.repos.find((r) => r.id.toLowerCase() === fullName.toLowerCase());
    if (existing) throw new HttpError(409, `${fullName} is already floor ${existing.floor}`);
    const meta = await this.backend.repoMeta(fullName);
    const folder = opts.localPath ?? (await this.projectFolderFor(meta.nameWithOwner));
    const floor = this.state.repos.reduce((m, r) => Math.max(m, r.floor), 0) + 1;
    const repo: PersistedRepo = {
      id: meta.nameWithOwner,
      fullName: meta.nameWithOwner,
      description: meta.description,
      url: meta.url,
      defaultBranch: meta.defaultBranch,
      floor,
      color: FLOOR_COLORS[(floor - 1) % FLOOR_COLORS.length],
      autoAssign: !!opts.autoAssign,
      autoMerge: true,
      browserTesting: true,
      links: [],
      localPath: folder,
      mission: (opts.mission ?? '').trim().slice(0, 4000),
      summary: '',
      qaBrief: '',
      preview: { ...DEFAULT_PREVIEW, env: {} },
      addedAt: Date.now(),
    };
    this.backend.setLocalPath(repo.fullName, folder);
    this.state.repos.push(repo);
    this.repoRt.set(repo.id, { issues: [], pulls: [], lastSync: null, syncing: false, cloneStatus: 'pending', lastMergedAt: null, folderSync: null, merging: false, closedIssues: new Map(), closedPulls: new Map(), openAt: new Map() });
    this.save();
    this.emitRepo(repo);
    this.toast('success', `${repo.fullName} moved into floor ${floor}`);
    this.ensureQaTester(repo);
    void this.cloneRepo(repo.id);
    void this.syncRepo(repo.id);
    // The CEO studies every new floor and proposes the team it needs.
    this.enqueueCeo({ kind: 'onboard', repoId: repo.id, at: Date.now() });
    return this.repoView(repo);
  }

  /** Where a GitHub repo's checkout goes when you connect it without picking a folder. */
  private async projectFolderFor(fullName: string): Promise<string> {
    const root = this.state.settings.projectsDir;
    const folders = await this.backend.scanProjects(root).catch(() => []);
    const match = folders.find((f) => f.github?.toLowerCase() === fullName.toLowerCase());
    if (match) return match.path;
    const name = fullName.split('/')[1];
    const taken = folders.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (taken) throw new HttpError(409, `${taken.path} already exists and isn't a clone of ${fullName}. Connect that folder instead, or rename it first.`);
    return path.join(root, name); // cloned there when the floor opens
  }

  /** A brand-new project: a folder in your projects folder, pushed to a new GitHub repo. */
  async createRepo(name: string, opts: FloorOptions & { description?: string; visibility: 'private' | 'public'; owner?: string }) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new HttpError(400, 'Project names may only contain letters, numbers, ".", "-" and "_"');
    const created = await this.backend.createProject(this.state.settings.projectsDir, name, opts).catch((err: Error) => {
      throw new HttpError(400, err.message);
    });
    return this.connectRepo(created.fullName, { mission: opts.mission, autoAssign: opts.autoAssign, localPath: created.path });
  }

  /** The folders in your projects folder (or another folder you point at), and which are floors already. */
  async listProjectFolders(dir?: string): Promise<{ root: string; folders: ProjectFolderView[] }> {
    const root = dir?.trim() ? path.resolve(dir.trim()) : this.state.settings.projectsDir;
    const folders = await this.backend.scanProjects(root).catch((err: Error) => {
      throw new HttpError(400, err.message);
    });
    const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
    const floorOf = (f: { path: string; github: string | null }) =>
      this.state.repos.find((r) => (r.localPath && same(r.localPath, f.path)) || (f.github && r.id.toLowerCase() === f.github.toLowerCase()))?.floor ?? null;
    return { root, folders: folders.map((f) => ({ name: f.name, path: f.path, git: f.git, github: f.github, floor: floorOf(f) })) };
  }

  /** Give one of your folders a floor. It must already be on GitHub; otherwise publish it first. */
  async connectFolder(dir: string, opts: FloorOptions = {}) {
    const f = await this.backend.inspectFolder(dir).catch((err: Error) => {
      throw new HttpError(400, err.message);
    });
    if (!f.github) throw new HttpError(400, `${f.name} ${f.git ? "isn't on GitHub yet" : "isn't a git repository yet"}. Publish it to GitHub first.`);
    return this.connectRepo(f.github, { ...opts, localPath: f.path });
  }

  /** Put one of your folders on GitHub (only what's committed goes up), then give it a floor. */
  async publishFolder(dir: string, opts: FloorOptions & { name?: string; visibility: 'private' | 'public'; description?: string }) {
    const f = await this.backend.inspectFolder(dir).catch((err: Error) => {
      throw new HttpError(400, err.message);
    });
    const name = (opts.name?.trim() || f.name).replace(/[^A-Za-z0-9._-]+/g, '-');
    const fullName = await this.backend.publishFolder(f.path, { name, visibility: opts.visibility, description: opts.description }).catch((err: Error) => {
      throw new HttpError(400, err.message);
    });
    return this.connectRepo(fullName, { mission: opts.mission, autoAssign: opts.autoAssign, localPath: f.path });
  }

  disconnectRepo(id: string) {
    const repo = this.repo(id);
    this.state.ceo.queue = this.state.ceo.queue.filter((j) => j.repoId !== id);
    for (const r of this.state.requests.filter((x) => x.repoId === id && x.status === 'pending')) {
      this.decide(r, { status: 'rejected', note: 'The floor was disconnected.', decidedBy: null });
    }
    for (const a of this.state.agents.filter((x) => x.repoId === id)) this.fireAgent(a.id, true);
    void this.previews.remove({ ...repo });
    this.state.repos = this.state.repos.filter((r) => r.id !== id);
    for (const q of this.state.qa.filter((x) => x.repoId === id)) this.broadcast({ type: 'qaRemoved', repoId: id, prNumber: q.prNumber });
    this.state.qa = this.state.qa.filter((q) => q.repoId !== id);
    this.state.held = this.state.held.filter((h) => h.repoId !== id);
    for (const r of this.state.repos) r.links = r.links.filter((l) => l !== id);
    this.repoRt.delete(id);
    // Keep floors contiguous.
    this.state.repos.sort((a, b) => a.floor - b.floor).forEach((r, i) => (r.floor = i + 1));
    this.backend.setLocalPath(repo.fullName, null);
    this.save();
    this.broadcast({ type: 'repoRemoved', repoId: id });
    for (const r of this.state.repos) this.emitRepo(r);
    this.toast('info', repo.localPath ? `${repo.fullName} left the building. Your folder ${repo.localPath} is untouched.` : `${repo.fullName} disconnected (its clone stays on disk)`);
  }

  updateRepo(
    id: string,
    patch: Partial<Pick<PersistedRepo, 'autoAssign' | 'autoMerge' | 'browserTesting' | 'color' | 'links' | 'mission' | 'summary' | 'qaBrief'>> & { previewCommand?: unknown; previewEnv?: unknown },
  ) {
    const repo = this.repo(id);
    const preview = parsePreviewPatch(patch.previewCommand, patch.previewEnv);
    repo.preview = { ...repo.preview, ...preview };
    if (preview.command === null) void this.previews.refreshDefault(repo);
    if (patch.autoAssign !== undefined) repo.autoAssign = !!patch.autoAssign;
    if (patch.autoMerge !== undefined) {
      repo.autoMerge = !!patch.autoMerge;
      if (repo.autoMerge) void this.syncRepo(repo.id);
    }
    if (patch.browserTesting !== undefined) repo.browserTesting = !!patch.browserTesting;
    if (patch.color && /^#[0-9a-f]{6}$/i.test(patch.color)) repo.color = patch.color;
    if (Array.isArray(patch.links)) repo.links = patch.links.filter((l) => l !== id && this.state.repos.some((r) => r.id === l));
    if (typeof patch.mission === 'string') repo.mission = patch.mission.trim().slice(0, 4000);
    if (typeof patch.summary === 'string') repo.summary = patch.summary.trim().slice(0, 140);
    if (typeof patch.qaBrief === 'string') repo.qaBrief = patch.qaBrief.trim().slice(0, 2500);
    this.save();
    this.emitRepo(repo);
    setTimeout(() => this.schedule(), 200);
    return this.repoView(repo);
  }

  // ---------- auto-merge ----------

  /**
   * Auto-merge (floors with it on): a swarm PR merges itself once QA has signed off on its latest commit and GitHub's
   * checks are green. Failing checks and merge conflicts go back to a developer; new commits after QA's sign-off send
   * it back to QA. Merging deletes the remote branch, and the floor's folder then fast-forwards (syncRepo sees the merge).
   */
  private async advanceMerges(repo: PersistedRepo) {
    const rt = this.repoRt.get(repo.id);
    if (!rt || !repo.autoMerge || rt.merging) return;
    rt.merging = true;
    let merged = false;
    try {
      for (const rec of this.state.qa.filter((q) => q.repoId === repo.id && q.status === 'passed')) {
        const pr = rt.pulls.find((p) => p.number === rec.prNumber && p.state === 'OPEN');
        if (!pr || !pr.headRefName.startsWith('swarm/')) continue; // people's own PRs are theirs to merge
        // Only act on PR data fetched after the record last changed (a fix may have just pushed).
        if ((rt.fetchedAt ?? 0) < rec.updatedAt) continue;
        try {
          if (await this.advanceMerge(repo, rec, pr)) merged = true;
        } catch (err) {
          console.warn(`auto-merge of ${repo.fullName}#${pr.number} failed`, err);
          this.mergeNote(rec, `auto-merge hit a problem: ${oneLine(err)}`);
        }
      }
    } finally {
      rt.merging = false;
    }
    if (merged) {
      await this.syncRepo(repo.id);
      setTimeout(() => this.schedule(), 200);
    }
  }

  /** One step toward merging a QA-passed PR. Returns true when it merged. */
  private async advanceMerge(repo: PersistedRepo, rec: QaRecord, pr: PullInfo): Promise<boolean> {
    let step = mergeStep(pr, rec, Date.now(), { base: repo.defaultBranch });
    if (step.do === 'details') {
      // GitHub works mergeability out lazily and lists often say UNKNOWN; asking about the PR itself gets an answer.
      const d = await this.backend.prDetails(repo.fullName, pr.number);
      pr = { ...pr, headSha: d.headSha, mergeable: d.mergeable, mergeState: d.mergeState };
      step = mergeStep(pr, rec, Date.now(), { base: repo.defaultBranch, detailed: true });
    }
    Object.assign(rec, step.set);
    if (step.do === 'requeue') {
      // Commits arrived after QA's sign-off: they get tested too.
      this.setQa(rec, { status: 'queued', round: rec.round + 1, retests: rec.retests + 1, mergeNote: null, pendingSince: null });
      setTimeout(() => this.schedule(), 200);
      return false;
    }
    if (step.do === 'rerun') {
      // A red check may be a flake or an outage: re-run it once for this commit before a developer is sent to fix it.
      try {
        await this.backend.rerunFailedJobs(repo.fullName, step.runIds);
      } catch (err) {
        console.warn(`could not re-run the failed checks of ${repo.fullName}#${pr.number}`, err);
        return this.sendBack(repo, rec, step.reason, step.instructions, step.needsHuman);
      }
      this.setQa(rec, { rerunSha: pr.headSha, rerunAt: Date.now(), pendingSince: null, alerted: false, mergeNote: 're-running a failed check' });
      return false;
    }
    if (step.do === 'send-back') return this.sendBack(repo, rec, step.reason, step.instructions, step.needsHuman);
    if (step.do === 'wait') {
      if (step.alert) {
        this.postMessage('office', `⏳ PR #${pr.number} on ${repo.fullName} passed QA, but its checks (${pr.pendingChecks.join(', ')}) have been running for over ${CHECKS_ALERT_MS / 60_000} minutes. It merges as soon as they finish.`);
      }
      return step.note === undefined ? false : this.mergeNote(rec, step.note);
    }
    if (step.do === 'update-branch') {
      // The repo only merges up-to-date branches. GitHub merges the base in cleanly (or refuses); CI checks the result.
      this.mergeNote(rec, `updating the branch with ${repo.defaultBranch}`);
      await this.backend.updateBranch(repo.fullName, pr.number);
      const details = await this.backend.prDetails(repo.fullName, pr.number);
      this.setQa(rec, { passedSha: details.headSha });
      return false;
    }
    if (step.do !== 'merge') return false;
    this.mergeNote(rec, 'merging…');
    let error = '';
    for (const method of ['squash', 'merge', 'rebase'] as const) {
      try {
        await this.backend.mergePull(repo.fullName, pr.number, method, rec.passedSha ?? pr.headSha);
        error = '';
        break;
      } catch (err) {
        error = oneLine(err).replace(/^gh .*? failed: /, '');
        if (!/not allowed/i.test(error)) break; // only a merge method the repo turned off is worth another try
      }
    }
    if (error && /head (branch|commit)/i.test(error)) return this.mergeNote(rec, 'new commits arrived; QA checks them first'); // the next sync re-queues it
    if (error) {
      rec.mergeRetryAt = Date.now() + MERGE_RETRY_MS;
      if (!rec.alerted) {
        rec.alerted = true;
        this.postMessage('office', `⚠️ PR #${pr.number} on ${repo.fullName} passed QA and its checks, but GitHub won't merge it: ${error}. The office retries every ${MERGE_RETRY_MS / 60_000} minutes; merge it yourself, or change the repo's merge rules, if it keeps failing.`);
      }
      return this.mergeNote(rec, `merge blocked: ${error}`);
    }
    this.toast('success', `🔀 Merged PR #${pr.number} into ${repo.defaultBranch}: ${pr.title}`);
    this.notifyMerge(repo, pr.number, pr.title);
    await this.closeResolvedIssues(repo, pr.number, pr);
    return true;
  }

  /**
   * After the office merges a PR: close the issues it resolves now rather than waiting for GitHub's "Closes #N" (which
   * lags, and never comes when the link wasn't recognised), so the scheduler doesn't hand them out again. Never throws.
   */
  private async closeResolvedIssues(repo: PersistedRepo, prNumber: number, pr: Pick<PullInfo, 'headRefName' | 'closesIssues'>) {
    const numbers = issuesResolvedBy(pr);
    const rt = this.repoRt.get(repo.id);
    if (rt && rt.issues.some((i) => numbers.includes(i.number))) {
      rt.issues = rt.issues.filter((i) => !numbers.includes(i.number));
      this.emitRepo(repo);
    }
    // A merge is the normal end: whoever only remembers the PR or its issues is cleared, and nobody's session stops.
    if (rt) {
      for (const n of numbers) rt.closedIssues.set(n, Date.now());
      this.learnPull(repo, { number: prNumber, headRefName: pr.headRefName, closesIssues: pr.closesIssues }, 'MERGED');
    }
    for (const n of numbers) {
      try {
        if ((await this.backend.issueState(repo.fullName, n)) !== 'OPEN') continue;
        await this.backend.closeIssue(repo.fullName, n, `Shipped in #${prNumber}`);
      } catch (err) {
        console.warn(`could not close ${repo.fullName}#${n} after merging #${prNumber}`, err);
      }
    }
  }

  /** Show where auto-merge stands on a PR's card. Doesn't count as a change to the record. */
  private mergeNote(rec: QaRecord, text: string | null) {
    if (rec.mergeNote !== text) {
      rec.mergeNote = text;
      this.broadcast({ type: 'qa', qa: this.qaView(rec) });
    }
    return false;
  }

  /** QA passed, but the PR can't merge as it is: a developer fixes it, and QA re-tests if the code changed. */
  private sendBack(repo: PersistedRepo, rec: QaRecord, reason: 'checks' | 'conflict', fixInstructions: string, needsHuman: boolean) {
    if (needsHuman) {
      this.stuck(rec, { mergeNote: null }, `it still ${reason === 'conflict' ? `conflicts with ${repo.defaultBranch}` : 'fails its checks'} after ${MAX_MERGE_FIXES} fixes`);
      return false;
    }
    this.setQa(rec, { status: 'failed', fixReason: reason, fixInstructions, mergeFixes: rec.mergeFixes + 1, mergeNote: null, pendingSince: null });
    setTimeout(() => this.schedule(), 200);
    return false;
  }

  /** Fast-forward the floor's main checkout (usually your own project folder) and report how it stands. */
  private async syncFolder(repo: PersistedRepo) {
    const rt = this.repoRt.get(repo.id);
    if (!rt || rt.cloneStatus !== 'ready') return rt?.folderSync ?? null;
    const own = this.backend.office.isOwnFolder(this.backend.mainDir(repo.fullName)); // updating the running office restarts it mid-work
    const sync = await this.backend.syncMain(repo.fullName, repo.defaultBranch, { touch: !own }).catch((err) => ({ status: `sync failed: ${oneLine(err)}`, behind: 0, updatable: false }));
    const status = sync?.status ?? null;
    if (own && sync) this.setOfficeBehind(sync.updatable ? sync.behind : 0);
    if (!this.repoRt.has(repo.id)) return null;
    const before = rt.folderSync;
    rt.folderSync = status;
    this.emitRepo(repo);
    if (status && status !== before) {
      const name = repo.localPath ? path.basename(repo.localPath) : repo.fullName;
      if (status.startsWith('updated')) this.toast('success', `📁 ${name}: ${status}`);
      else if (/behind|diverged|failed/.test(status)) this.toast('info', `📁 ${name} wasn't updated: ${status}`);
    }
    return status;
  }

  /** The manager's "Sync now". */
  async syncFolderNow(repoId: string) {
    return { folderSync: await this.syncFolder(this.repo(repoId)) };
  }

  /** Remove the floor's desks, desk folders and swarm/qa branches nobody uses any more; say so when something went. */
  private async sweepFloor(repoId: string) {
    const repo = this.state.repos.find((r) => r.id === repoId);
    const rt = this.repoRt.get(repoId);
    if (!repo || !rt || rt.cloneStatus !== 'ready') return;
    try {
      const pulls = rt.lastSync ? rt.pulls : await this.backend.listPulls(repo.fullName);
      const agents = this.state.agents.filter((a) => a.repoId === repo.id);
      const keep = {
        desks: [...agents.map((a) => this.agentSlug(a)), PREVIEW_SLUG],
        branches: [...agents.flatMap((a) => (a.branch ? [a.branch] : [])), ...pulls.filter((p) => p.state === 'OPEN').map((p) => p.headRefName)],
      };
      const r = await this.backend.sweepDesks(repo.fullName, keep);
      const desks = r.desks + r.folders;
      const saved = r.patches.length ? ` (${r.patches.length} patch${r.patches.length === 1 ? '' : 'es'} saved to ${path.dirname(r.patches[0])})` : '';
      console.log(`desk sweep ${repo.fullName}: ${desks} desks, ${r.branches} branches removed${saved}${r.skipped.length ? `, ${r.skipped.length} still in use` : ''}`);
      if (!desks && !r.branches) return;
      const removed = [desks && `${desks} old desk${desks === 1 ? '' : 's'}`, r.branches && `${r.branches} finished branch${r.branches === 1 ? '' : 'es'}`].filter(Boolean).join(' and ');
      const text = `🧹 ${repo.fullName.split('/')[1]}: removed ${removed}${saved}`;
      this.toast('info', text);
      this.postMessage('office', text);
    } catch (err) {
      console.warn(`desk sweep ${repo.fullName} failed: ${oneLine(err)}`);
    }
  }

  // ---------- the floor's app (preview monitor) ----------

  /** Run the floor's app from its preview worktree: the default branch, or an open PR. Replaces what it is running now. */
  async startPreview(id: string, pr?: number | null): Promise<PreviewView> {
    const repo = this.repo(id);
    return this.previews.start(repo, `${repo.fullName.split('/')[1]} app`, pr);
  }

  stopPreview(id: string): Promise<PreviewView> {
    return this.previews.stop(this.repo(id));
  }

  /**
   * Server shutdown: stop every floor's app so nothing is left holding a preview port. Agents' CLIs keep working
   * through a restart (the terminal keeper holds them for the next start) and stop when the office quits.
   */
  async shutdown(restart = false): Promise<void> {
    await this.writeState().catch((err) => console.warn('could not save the state', err));
    await this.backend.releaseClis(restart); // before the terminals are saved: whatever they print next waits in the keeper
    await this.saveTerminals(true);
    await this.previews.stopAll(this.state.repos);
  }

  private async cloneRepo(id: string) {
    const repo = this.state.repos.find((r) => r.id === id);
    const rt = this.repoRt.get(id);
    if (!repo || !rt || rt.cloneStatus === 'cloning') return;
    rt.cloneStatus = 'cloning';
    rt.cloneError = undefined;
    this.emitRepo(repo);
    try {
      await this.backend.ensureClone(repo.fullName);
      rt.cloneStatus = 'ready';
      void this.previews.refreshDefault(repo);
      void this.sweepFloor(id);
    } catch (err) {
      rt.cloneStatus = 'error';
      rt.cloneError = (err as Error).message;
      this.toast('error', `Could not clone ${repo.fullName}: ${rt.cloneError}`);
    }
    if (this.repoRt.has(id)) this.emitRepo(repo);
  }

  async syncRepo(id: string) {
    const repo = this.state.repos.find((r) => r.id === id);
    const rt = this.repoRt.get(id);
    if (!repo || !rt || rt.syncing) return;
    rt.syncing = true;
    try {
      const started = Date.now();
      const [issues, pulls] = await Promise.all([this.backend.listIssues(repo.fullName), this.backend.listPulls(repo.fullName)]);
      rt.issues = issues;
      rt.pulls = pulls;
      this.issueAges.learn(repo.id, issues);
      this.issueAges.stamp(repo.id, pulls);
      void this.lookUpIssueAges(repo);
      rt.lastSync = Date.now();
      rt.fetchedAt = started;
      rt.syncError = undefined;
      await this.askGitHub(repo, rt);
      if (!this.repoRt.has(id)) return; // disconnected meanwhile
      this.settleLearned(rt);
      this.cleanUpClosed(repo);
      this.reconcilePulls(repo, rt.pulls);
      // Something was merged since the last look (by the office or anyone else): bring the folder up to date.
      const newest = pulls.reduce<string | null>((m, p) => (p.mergedAt && (!m || p.mergedAt > m) ? p.mergedAt : m), null);
      if (newest !== rt.lastMergedAt) {
        rt.lastMergedAt = newest;
        void this.syncFolder(repo);
      }
      void this.advanceMerges(repo);
    } catch (err) {
      rt.syncError = (err as Error).message;
    } finally {
      rt.syncing = false;
    }
    if (this.repoRt.has(id)) this.emitRepo(repo);
  }

  /** When the issues behind the day's merges were filed, if the office never saw them open (e.g. after a restart). */
  private async lookUpIssueAges(repo: PersistedRepo) {
    const wanted = this.issueAges.wanted(repo.id, this.repoRt.get(repo.id)?.pulls ?? [], Date.now());
    if (!wanted.length) return;
    for (const n of wanted) this.issueAges.know(repo.id, n, (await this.backend.issueDetails(repo.fullName, n).catch(() => null))?.createdAt);
    const rt = this.repoRt.get(repo.id);
    if (!rt) return;
    this.issueAges.stamp(repo.id, rt.pulls);
    this.emitRepo(repo);
  }

  /**
   * Every swarm PR goes through QA, including ones opened before QA existed or while the server was down. (Merged and
   * closed PRs leave QA, and agents who had them are cleared, in cleanUpClosed.)
   */
  private reconcilePulls(repo: PersistedRepo, pulls: PullInfo[]) {
    for (const pr of pulls) {
      if (pr.state !== 'OPEN' || pr.isDraft || !pr.headRefName.startsWith('swarm/')) continue;
      if (this.state.qa.some((q) => q.repoId === repo.id && q.prNumber === pr.number)) continue;
      const dev = this.state.agents.find((a) => a.repoId === repo.id && a.role === 'dev' && a.task !== 'qa' && (a.prNumber === pr.number || a.branch === pr.headRefName));
      this.queueQa(repo, pr.number, dev ?? null, pr.closesIssues[0] ?? null);
    }
    this.save();
  }

  async createIssue(repoId: string, title: string, body: string, assignTo?: string, specialty?: string) {
    const repo = this.repo(repoId);
    if (!title.trim()) throw new HttpError(400, 'An issue needs a title');
    const slug = specialtySlug(specialty);
    const number = await this.backend.createIssue(repo.fullName, title.trim(), body, slug ? [specialtyLabel(slug)] : []);
    await this.syncRepo(repo.id);
    this.toast('success', `Issue #${number} filed on ${repo.fullName}`);
    if (assignTo) await this.assign(assignTo, number);
    else setTimeout(() => this.schedule(), 200);
    return number;
  }

  async mergePull(repoId: string, number: number, method: 'squash' | 'merge' | 'rebase' = 'squash') {
    const repo = this.repo(repoId);
    const pr = this.repoRt.get(repo.id)?.pulls.find((p) => p.number === number) ?? (await this.backend.prDetails(repo.fullName, number));
    await this.backend.mergePull(repo.fullName, number, method);
    this.toast('success', `Merged PR #${number} into ${repo.defaultBranch}`);
    this.notifyMerge(repo, number, pr.title);
    await this.closeResolvedIssues(repo, number, pr);
    await this.syncRepo(repo.id);
    setTimeout(() => this.schedule(), 200);
  }

  /** The manager's Close on a PR: closed on GitHub, and its QA, fix and anyone working on it stop now. */
  async closePull(repoId: string, number: number) {
    const repo = this.repo(repoId);
    const pr = this.repoRt.get(repo.id)?.pulls.find((p) => p.number === number) ?? (await this.backend.prDetails(repo.fullName, number).catch(() => null));
    await this.backend.closePull(repo.fullName, number);
    this.learnPull(repo, { number, headRefName: pr?.headRefName ?? '', closesIssues: pr?.closesIssues ?? [] }, 'CLOSED');
    await this.syncRepo(repo.id);
  }

  /** The manager's Close on an issue: closed on GitHub as not planned, and whoever works on it stops now. */
  async closeIssueByManager(repoId: string, number: number) {
    const repo = this.repo(repoId);
    const rt = this.repoRt.get(repo.id);
    const state = rt?.issues.some((i) => i.number === number) ? 'OPEN' : await this.backend.issueState(repo.fullName, number).catch(() => null);
    checkCloseIssue({ floor: repo.floor, number, state, pulls: rt?.pulls ?? [] });
    await this.backend.closeIssue(repo.fullName, number, `Closed as not planned by ${this.state.settings.managerName || 'the manager'} from the cubefarm office.`, 'not planned');
    this.toast('info', `Closed #${number} on ${repo.fullName}`);
    this.learnIssueClosed(repo, number);
    await this.syncRepo(repo.id);
  }

  // ---------- closed issues and PRs ----------

  /** The floor's issues and PRs as the office knows them now (closeCleanup.ts). */
  private floorState(rt: RepoRuntime): FloorState {
    return { fetchedAt: rt.fetchedAt ?? 0, openIssues: rt.issues.map((i) => i.number), pulls: rt.pulls, closedIssues: rt.closedIssues, closedPulls: rt.closedPulls };
  }

  /** The floor's agents whose work a closure can end. One whose stopped session is still ending is left to finish. */
  private holders(repo: PersistedRepo) {
    return this.state.agents.filter((a) => a.repoId === repo.id && !this.dropping.has(a.id));
  }

  /** Ask GitHub about the issues and PRs agents, QA records or holds hold that the last sync doesn't list. */
  private async askGitHub(repo: PersistedRepo, rt: RepoRuntime) {
    const held = this.state.held.filter((h) => h.repoId === repo.id).map((h) => h.issue);
    const ask = toAsk(this.holders(repo), this.state.qa.filter((q) => q.repoId === repo.id), held, this.floorState(rt), rt.openAt, Date.now());
    await Promise.all([
      ...ask.issues.map(async (n) => {
        const state = await this.backend.issueState(repo.fullName, n).catch(() => null);
        if (state === 'CLOSED') rt.closedIssues.set(n, Date.now());
        else if (state === 'OPEN') rt.openAt.set(`issue#${n}`, Date.now());
      }),
      ...ask.pulls.map(async (n) => {
        const pr = await this.backend.prDetails(repo.fullName, n).catch(() => null);
        if (pr?.state === 'OPEN') rt.openAt.set(`pr#${n}`, Date.now());
        else if (pr) {
          rt.closedPulls.set(n, { number: n, state: pr.state, headRefName: pr.headRefName, closesIssues: pr.closesIssues, at: Date.now() });
          this.holdIssues(repo, rt.closedPulls.get(n)!);
        }
      }),
    ]);
  }

  /** After a sync: forget closures it shows reopened, and keep what it lists in step with closures learned since it started. */
  private settleLearned(rt: RepoRuntime) {
    const gone = forgettable(this.floorState(rt), Date.now());
    for (const n of gone.issues) rt.closedIssues.delete(n);
    for (const n of gone.pulls) rt.closedPulls.delete(n);
    for (const [key, at] of rt.openAt) if (Date.now() - at > ASK_AGAIN_MS) rt.openAt.delete(key);
    const f = this.floorState(rt);
    rt.issues = rt.issues.filter((i) => issueOpen(i.number, f) !== false);
    rt.pulls = rt.pulls.map((p) => (p.state === 'OPEN' && pullNow(p.number, f)?.state === 'CLOSED' ? { ...p, state: 'CLOSED' as const } : p));
  }

  /** Stop and clear the work on the floor's closed issues and PRs (closeCleanup.ts). Returns the names of those it stopped. */
  private cleanUpClosed(repo: PersistedRepo): string[] {
    const rt = this.repoRt.get(repo.id);
    if (!rt) return [];
    const f = this.floorState(rt);
    const gone = this.state.held.filter((h) => h.repoId === repo.id && issueOpen(h.issue, f) === false);
    if (gone.length) {
      this.state.held = this.state.held.filter((h) => !gone.includes(h));
      this.emitRepo(repo);
    }
    const closures = closuresHeld(this.holders(repo), this.state.qa.filter((q) => q.repoId === repo.id), f);
    return closures.flatMap((c) => this.applyClosure(repo, c));
  }

  private applyClosure(repo: PersistedRepo, c: Closure): string[] {
    const plan = afterClose(c, this.holders(repo), this.state.qa.filter((q) => q.repoId === repo.id), BUSY);
    const agent = (id: string) => this.state.agents.find((a) => a.id === id)!;
    const why = closedWhy(c);
    const stopped = plan.stop.map(agent);
    for (const a of stopped) this.stopForClosure(a, why);
    for (const a of plan.clear.map(agent)) {
      const merged = c.kind === 'pr' && c.merged;
      if (a.task === 'qa') this.dropTask(a, null); // they only tested it
      else this.dropTask(a, merged ? `🎉 PR #${c.number} was merged. Ready for the next issue.` : `↺ ${why[0].toUpperCase()}${why.slice(1)}. Cleared desk.`, merged ? 'done' : 'system');
    }
    if (plan.dropQa) this.dropRecord(repo, c.number);
    if (stopped.length) this.postMessage('office', stoppedMessage(stopped.map((a) => a.name), c, repo.fullName));
    if (stopped.length || plan.clear.length || plan.dropQa) {
      this.save();
      setTimeout(() => this.schedule(), 200);
    }
    return stopped.map((a) => a.name);
  }

  /** End a session whose issue or PR closed, as ■ Stop does. Its desk is cleared once the session has ended. */
  private stopForClosure(a: PersistedAgent, why: string) {
    a.status = 'stopped';
    a.lastError = `Stopped: ${why}`;
    this.dropping.set(a.id, why);
    this.appendLog(a, [{ kind: 'system', text: `■ Stopped: ${why}.` }]);
    this.emitAgent(a);
    this.agentRt.get(a.id)?.session?.stop(); // no session yet (preparing): prepare() gives up and clears it
  }

  /** Clear the desk of an agent whose work closed, as ↺ Clear desk does. */
  private dropTask(a: PersistedAgent, text: string | null, kind: LogLine['kind'] = 'system') {
    this.dropping.delete(a.id);
    this.agentRt.get(a.id)?.terminal?.releaseIdle?.();
    this.clearTask(a);
    if (text) this.appendLog(a, [{ kind, text }]);
  }

  /** A task given up before its session started: one stopped because its issue or PR closed clears the desk now. */
  private abandoned(a: PersistedAgent): null {
    if (this.dropping.has(a.id)) this.dropTask(a, '↺ Cleared desk. Ready for new work.');
    return null;
  }

  /** A closed or merged PR leaves QA, so its QA or fix is never handed out again. */
  private dropRecord(repo: PersistedRepo, prNumber: number) {
    const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === prNumber);
    if (!rec) return;
    this.state.qa = this.state.qa.filter((q) => q !== rec);
    this.broadcast({ type: 'qaRemoved', repoId: repo.id, prNumber });
    this.clearPrepStrikes(repo.id, prNumber);
    this.fixNudged.delete(`${repo.id}#${prNumber}`);
    this.save();
  }

  /** The office closed an issue, or found it closed: off the board, and its work cleaned up now. Returns who it stopped. */
  private learnIssueClosed(repo: PersistedRepo, n: number): string[] {
    const rt = this.repoRt.get(repo.id);
    if (!rt) return [];
    rt.closedIssues.set(n, Date.now());
    if (rt.issues.some((i) => i.number === n)) {
      rt.issues = rt.issues.filter((i) => i.number !== n);
      this.emitRepo(repo);
    }
    return this.cleanUpClosed(repo);
  }

  /**
   * The office closed or merged a PR, or found it so: its work is cleaned up now, not at the next sync. A closed PR's
   * issues wait for the manager, unless it was closed to be built again (rebuild). Returns who it stopped.
   */
  private learnPull(repo: PersistedRepo, pr: Omit<KnownPull, 'state'>, state: 'CLOSED' | 'MERGED', rebuild = false): string[] {
    const rt = this.repoRt.get(repo.id);
    if (!rt) return [];
    const known: LearnedPull = { number: pr.number, headRefName: pr.headRefName, closesIssues: pr.closesIssues, state, at: Date.now() };
    rt.closedPulls.set(pr.number, known);
    if (!rebuild) this.holdIssues(repo, known);
    if (state === 'CLOSED' && rt.pulls.some((p) => p.number === pr.number && p.state === 'OPEN')) {
      rt.pulls = rt.pulls.map((p) => (p.number === pr.number ? { ...p, state } : p));
      this.emitRepo(repo);
    }
    return this.cleanUpClosed(repo);
  }

  /** A closed PR's open issues wait for the manager instead of going back to auto-assign (toHold). */
  private holdIssues(repo: PersistedRepo, pr: KnownPull) {
    const rt = this.repoRt.get(repo.id);
    const add = rt ? toHold(pr, this.floorState(rt)).filter((n) => !this.isHeld(repo.id, n)) : [];
    if (!add.length) return;
    this.state.held.push(...add.map((issue) => ({ repoId: repo.id, issue, pr: pr.number })));
    this.emitRepo(repo);
    this.save();
  }

  private isHeld(repoId: string, n: number) {
    return this.state.held.some((h) => h.repoId === repoId && h.issue === n);
  }

  // ---------- agents ----------

  hireAgent(
    repoId: string,
    opts: {
      name?: string;
      model?: string;
      effort?: string;
      role?: string;
      look?: string;
      title?: string;
      specialty?: string;
      brief?: string;
      cli?: string;
      hiredBy?: 'manager' | 'ceo';
      appearance?: { color: string; hair: string; skin: string };
    },
  ) {
    const repo = this.repo(repoId);
    const role: AgentRole = opts.role === 'qa' ? 'qa' : 'dev';
    const used = new Set(this.state.agents.filter((a) => a.repoId === repo.id && a.role === role).map((a) => a.desk));
    let desk = 0;
    while (used.has(desk)) desk++;
    if (desk >= MAX_DESKS[role]) {
      throw new HttpError(400, role === 'qa' ? `The QA lab on floor ${repo.floor} is full (${MAX_DESKS.qa} stations)` : `Floor ${repo.floor} is full (${MAX_DESKS.dev} desks)`);
    }
    const name = opts.name?.trim() || this.freeName(role);
    const agent: PersistedAgent = {
      id: crypto.randomUUID(),
      name,
      repoId: repo.id,
      role,
      title: String(opts.title ?? '').trim().slice(0, 60),
      specialty: specialtySlug(opts.specialty),
      brief: String(opts.brief ?? '').trim().slice(0, 2500),
      hiredBy: opts.hiredBy ?? 'manager',
      look: LOOKS.includes(opts.look as AgentLook) ? (opts.look as AgentLook) : lookFor(name),
      task: null,
      desk,
      color: opts.appearance?.color ?? pick(SHIRTS),
      hair: opts.appearance?.hair ?? pick(HAIR),
      skin: opts.appearance?.skin ?? pick(SKIN),
      model: opts.model ?? '',
      effort: EFFORTS.includes(opts.effort as EffortLevel) ? (opts.effort as EffortLevel) : '',
      cli: isCli(opts.cli) ? opts.cli : '',
      status: 'idle',
      issueNumber: null,
      issueTitle: null,
      branch: null,
      prNumber: null,
      prUrl: null,
      startedAt: null,
      endedAt: null,
      costUsd: 0,
      turns: 0,
      sessionId: null,
      sessionCli: null,
      lastError: null,
      logTail: [],
    };
    this.state.agents.push(agent);
    this.agentRt.set(agent.id, { log: [], pending: [], session: null, currentTool: null, browserUrl: null, screenshot: null, shots: [], terminal: null });
    this.appendLog(agent, [
      { kind: 'system', text: role === 'qa' ? `🔍 ${name} joined the QA lab on floor ${repo.floor} (${repo.fullName}).` : `👋 ${name} joined floor ${repo.floor} (${repo.fullName}).` },
      ...(agent.title ? [{ kind: 'system' as const, text: `🪪 ${agent.title}${agent.specialty ? ` · takes swarm:${agent.specialty} issues first` : ''}` }] : []),
    ]);
    this.save();
    this.broadcast({ type: 'agent', agent: this.agentView(agent, false) });
    setTimeout(() => this.schedule(), 200);
    return this.agentView(agent, true);
  }

  /** Every floor has at least one QA tester. */
  private ensureQaTester(repo: PersistedRepo) {
    if (this.state.agents.some((a) => a.repoId === repo.id && a.role === 'qa')) return;
    this.hireAgent(repo.id, { role: 'qa' });
  }

  /** A name from the role's pool that no agent or pending candidate has. */
  private freeName(role: 'dev' | 'qa') {
    const taken = new Set([...this.state.agents.map((a) => a.name), ...this.state.requests.filter((r) => r.status === 'pending').map((r) => r.name)]);
    const pool = role === 'qa' ? QA_NAMES : DEV_NAMES;
    return pool.find((n) => !taken.has(n)) || `${role === 'qa' ? 'Tester' : 'Agent'} ${this.state.agents.length + 1}`;
  }

  updateAgent(
    id: string,
    patch: { name?: string; model?: string; effort?: string; cli?: string; look?: string; title?: string; specialty?: string; brief?: string; color?: string; hair?: string },
  ) {
    const a = this.agent(id);
    if (patch.cli !== undefined && a.role !== 'ceo') a.cli = isCli(patch.cli) ? patch.cli : '';
    if (patch.name?.trim() && patch.name.trim() !== a.name) {
      a.name = patch.name.trim().slice(0, 24);
      a.look = lookFor(a.name);
    }
    if (LOOKS.includes(patch.look as AgentLook)) a.look = patch.look as AgentLook;
    if (patch.color && /^#[0-9a-f]{6}$/i.test(patch.color)) a.color = patch.color;
    if (patch.hair && /^#[0-9a-f]{6}$/i.test(patch.hair)) a.hair = patch.hair;
    if (patch.model !== undefined) a.model = String(patch.model).trim();
    if (patch.effort !== undefined) a.effort = EFFORTS.includes(patch.effort as EffortLevel) ? (patch.effort as EffortLevel) : '';
    if (a.role !== 'ceo') {
      if (patch.title !== undefined) a.title = String(patch.title).trim().slice(0, 60);
      if (patch.specialty !== undefined) a.specialty = specialtySlug(patch.specialty);
      if (patch.brief !== undefined) a.brief = String(patch.brief).trim().slice(0, 2500);
    }
    this.save();
    this.emitAgent(a);
  }

  fireAgent(id: string, force = false) {
    const a = this.agent(id);
    if (a.role === 'ceo') throw new HttpError(409, `${a.name} runs the company and can't be let go.`);
    if (!force && a.role === 'qa' && this.state.agents.filter((x) => x.repoId === a.repoId && x.role === 'qa').length <= 1) {
      throw new HttpError(409, `${a.name} is the only QA tester on this floor, and every floor needs at least one.`);
    }
    for (const r of this.state.requests.filter((x) => x.kind === 'let-go' && x.agentId === id && x.status === 'pending')) {
      this.decide(r, { status: 'approved', note: 'They were let go directly.', decidedBy: 'manager' });
    }

    this.agentRt.get(id)?.session?.stop();
    this.agentRt.get(id)?.terminal?.releaseIdle?.();
    this.agentRt.get(id)?.terminal?.dispose();
    void removeScreens(id);
    void fs.rm(terminalFile(id), { force: true }).catch(() => undefined);
    for (const q of this.state.qa) {
      if (q.qaAgentId === id && q.status === 'testing') this.setQa(q, { status: 'queued', qaAgentId: null });
      if (q.devAgentId === id) q.devAgentId = null;
      if (q.devAgentId === null && q.status === 'fixing') this.setQa(q, { status: 'failed' });
    }
    const repo = this.state.repos.find((r) => r.id === a.repoId);
    if (repo) {
      const slug = this.agentSlug(a);
      const main = this.backend.mainDir(repo.fullName); // now: a disconnect points the floor elsewhere before this runs
      void this.backend
        .releaseDesk(repo.fullName, slug, this.port(a))
        .then(() => this.backend.removeDesk(repo.fullName, slug, main))
        .catch(() => undefined)
        .then(() => this.sweepFloor(repo.id));
    }
    this.state.agents = this.state.agents.filter((x) => x.id !== id);
    this.agentRt.delete(id);
    this.save();
    this.broadcast({ type: 'agentRemoved', agentId: id });
  }

  stopAgent(id: string) {
    const a = this.agent(id);
    if (!BUSY.includes(a.status)) return;
    a.status = 'stopped';
    a.lastError = 'Stopped by manager';
    this.appendLog(a, [{ kind: 'manager', text: '■ Manager stopped this session.' }]);
    this.agentRt.get(id)?.session?.stop();
    this.emitAgent(a);
    this.save();
  }

  /** An agent whose CLI kept working through the office's restart: the office follows its session again. */
  private reattachSession(a: PersistedAgent) {
    const repo = this.state.repos.find((r) => r.id === a.repoId);
    if (!repo) return;
    this.appendLog(a, [{ kind: 'system', text: '↻ The office restarted; their CLI kept working and the office is following it again.' }]);
    this.startAgentSession(a, repo, this.backend.deskDir(repo.fullName, this.agentSlug(a)), '', '', a.sessionId ?? undefined, undefined, 'reattach');
  }

  /** The manager pressed Esc in the agent's terminal and the CLI stopped its turn: a Stop that leaves the CLI to them. */
  private interrupted(a: PersistedAgent) {
    if (!BUSY.includes(a.status)) return;
    a.status = 'stopped';
    a.lastError = 'Interrupted in the terminal';
    this.appendLog(a, [{ kind: 'manager', text: '■ Interrupted in the terminal. Type there to carry on.' }]);
  }

  resetAgent(id: string) {
    const a = this.agent(id);
    if (BUSY.includes(a.status)) throw new HttpError(409, `${a.name} is busy; stop them first`);
    for (const q of this.state.qa) {
      if (q.qaAgentId === id && q.status === 'testing') this.setQa(q, { status: 'queued', qaAgentId: null });
      if (q.devAgentId === id && q.status === 'fixing') this.setQa(q, { status: 'failed' });
    }
    this.agentRt.get(id)?.terminal?.releaseIdle?.();
    this.clearTask(a);
    this.appendLog(a, [{ kind: 'system', text: '↺ Cleared desk. Ready for new work.' }]);
    this.save();
  }

  private issueTaken(repo: PersistedRepo, n: number) {
    return issueTaken(
      n,
      this.state.agents.filter((a) => a.repoId === repo.id),
      this.repoRt.get(repo.id)?.pulls ?? [],
      Date.now(),
    );
  }

  private ensureSlot() {
    if (this.slotsFull()) {
      throw new HttpError(429, `All ${this.state.settings.sessionLimit} session slots are busy. Raise or clear the session limit in the manager's console, or wait.`);
    }
  }

  /** `waitForDeps`: refuse an issue that still waits for open ones (a sticky carried to a desk; the console may override). */
  async assign(agentId: string, issueNumber: number, note?: string, waitForDeps = false) {
    const a = this.agent(agentId);
    const repo = this.repo(a.repoId);
    if (a.role === 'qa') throw new HttpError(400, `${a.name} is a QA tester; they test pull requests rather than issues.`);
    if (a.role === 'ceo') throw new HttpError(400, `${a.name} runs the company; give issues to the developers.`);
    if (BUSY.includes(a.status)) throw new HttpError(409, `${a.name} is already working on #${a.issueNumber}`);
    this.ensureSlot();
    const issues = this.repoRt.get(repo.id)?.issues ?? [];
    const issue = issues.find((i) => i.number === issueNumber);
    if (!issue) throw new HttpError(404, `Issue #${issueNumber} is not open on ${repo.fullName}`);
    const waits = waitForDeps ? blockers(issue.body, new Set(issues.map((i) => i.number))) : [];
    if (waits.length) throw new HttpError(409, waitsMessage(issueNumber, waits));
    const holder = this.state.agents.find((x) => x.id !== a.id && x.repoId === repo.id && x.issueNumber === issueNumber && BUSY.includes(x.status));
    if (holder) throw new HttpError(409, `${holder.name} is already working on #${issueNumber}`);
    if (this.isHeld(repo.id, issueNumber)) {
      // Assigned by hand: its wait after its PR closed is over.
      this.state.held = this.state.held.filter((h) => !(h.repoId === repo.id && h.issue === issueNumber));
      this.emitRepo(repo);
    }
    void this.runTask(a, repo, issue, note);
    return this.agentView(a, false);
  }

  private port(a: PersistedAgent) {
    return 5200 + (parseInt(a.id.slice(0, 4), 16) % 700);
  }

  private linkedRepos(repo: PersistedRepo) {
    return repo.links.map((id) => this.state.repos.find((r) => r.id === id)).filter((r): r is PersistedRepo => !!r);
  }

  /**
   * How an agent's next session runs: the CLI in their terminal (the terminal runtime), or Claude Code through the
   * SDK. A session can only be resumed by the CLI that made it, so a follow-up stays with that CLI.
   */
  private sessionRuntime(a: PersistedAgent, resume?: string): { terminal?: AgentTerminal; cli?: AgentCli; label?: string; resumeSessionId?: string } {
    const inTerminal = this.state.settings.runtime === 'terminal' && this.backend.terminals;
    let cli: AgentCli = a.role === 'ceo' ? 'claude' : a.cli || this.state.settings.defaultCli;
    if (resume && a.sessionCli && a.sessionCli !== cli) {
      if (inTerminal) cli = a.sessionCli;
      else if (a.sessionCli !== 'claude') resume = undefined;
    }
    if (!inTerminal) return { resumeSessionId: resume };
    const what = a.role === 'ceo' ? a.issueTitle : a.task === 'qa' ? `QA · PR #${a.prNumber}` : a.task === 'fix' ? `fixing PR #${a.prNumber}` : a.issueNumber ? `#${a.issueNumber} ${a.issueTitle ?? ''}` : null;
    return { terminal: this.terminalFor(a), cli, label: `${a.name}${what ? ` · ${what}` : ''}`.slice(0, 80).trim(), resumeSessionId: resume };
  }

  /** The model to ask for (the Agent SDK runs Claude Code). '' lets another coding agent use its own default. */
  private modelFor(a: PersistedAgent, cli: AgentCli | undefined) {
    return effectiveModel(a.model, cli ?? 'claude', this.state.settings, DEFAULT_MODEL);
  }

  // ---------- terminals ----------

  private async loadTerminal(agentId: string): Promise<AgentTerminal | null> {
    if (!(await fs.stat(terminalFile(agentId)).catch(() => null))) return null;
    const t = this.newTerminal(agentId);
    await t.load(terminalFile(agentId));
    return t;
  }

  /** The agent's terminal, made the first time they run in the terminal runtime. */
  private terminalFor(a: PersistedAgent): AgentTerminal {
    const rt = this.agentRt.get(a.id)!;
    rt.terminal ??= this.newTerminal(a.id);
    return rt.terminal;
  }

  private newTerminal(agentId: string) {
    const t = new AgentTerminal();
    // Typed at a CLI waiting at its prompt after its task: a follow-up, which starts synchronously when it can.
    t.onIdlePrompt = (text) => {
      void this.message(agentId, text, true).catch(() => undefined);
      return !!this.agentRt.get(agentId)?.session;
    };
    return t;
  }

  private async saveTerminals(all = false) {
    for (const [id, rt] of this.agentRt) {
      if (rt.terminal && (all || rt.terminal.dirty)) await rt.terminal.save(terminalFile(id)).catch((err) => console.warn('could not save a terminal', err));
    }
  }

  /** A browser opened an agent's terminal (/ws/term?agent=<id>). */
  attachTerminal(agentId: string, ws: WebSocket) {
    const t = this.agentRt.get(agentId)?.terminal;
    if (!t) return ws.close(4404, 'That agent has no terminal');
    t.attach(ws);
  }

  private buildSystemAppend(a: PersistedAgent, repo: PersistedRepo, cwd: string, branch: string, fixing?: { pr: number; headRef: string }, deps?: DepsOutcome) {
    return devSystemPrompt({ agent: a, repo, port: this.port(a), cwd, branch, linked: this.linkedDirs(repo), fixing, depsLine: depsPromptLine(deps) });
  }

  private linkedDirs(repo: PersistedRepo) {
    return this.linkedRepos(repo).map((r) => ({ fullName: r.fullName, dir: this.backend.mainDir(r.fullName) }));
  }

  /** What an agent is told on a task, previewed with placeholders for the task's details. */
  agentPrompt(id: string): AgentPromptView {
    const a = this.agent(id);
    if (a.role === 'ceo') return ceoPromptPreview(ceoSystemPrompt(this.ceoPromptInput(a)));
    const repo = this.repo(a.repoId);
    const base = { agent: a, repo, port: this.port(a), slug: slugify(a.name) };
    return a.role === 'qa' ? qaPromptPreview(base) : devPromptPreview({ ...base, linked: this.linkedDirs(repo) });
  }

  private beginTask(a: PersistedAgent, patch: Partial<PersistedAgent>, banner: string, preparing: string) {
    const rt = this.agentRt.get(a.id)!;
    this.dropping.delete(a.id);
    Object.assign(a, {
      status: 'preparing' as AgentStatus,
      startedAt: Date.now(),
      endedAt: null,
      costUsd: 0,
      turns: 0,
      lastError: null,
      ...patch,
    });
    rt.screenshot = null;
    rt.browserUrl = null;
    rt.shots = [];
    void removeScreens(a.id);
    this.appendLog(a, [
      { kind: 'system', text: '' },
      { kind: 'system', text: `━━━ ${banner} ━━━` },
      { kind: 'system', text: preparing },
    ]);
    this.emitAgent(a);
    this.save();
  }

  /** job: the PR fix or QA run this desk is for; if the desk can't be set up, the PR pays for it, not the agent. */
  private async prepare(a: PersistedAgent, repo: PersistedRepo, base: { pr?: number }, branch: string, job?: PrepJob): Promise<{ cwd: string; deps: DepsOutcome } | null> {
    try {
      if (this.repoRt.get(repo.id)?.cloneStatus !== 'ready') await this.cloneRepo(repo.id);
      const slug = this.agentSlug(a);
      const note = (text: string) => this.appendLog(a, [{ kind: 'system', text }]);
      const cwd = await setUpDesk(this.agentRt.get(a.id)?.terminal, {
        release: () => this.backend.releaseDesk(repo.fullName, slug, this.port(a)),
        prepare: () => this.backend.prepareDesk(repo.fullName, { defaultBranch: repo.defaultBranch, pr: base.pr }, slug, branch, note),
      });
      this.deskAlerts.delete(a.id);
      if (job) this.prepStrikes.delete(prepKey(repo.id, job.rec.prNumber, job.task));
      if (a.status !== 'preparing') return this.abandoned(a); // stopped or fired while preparing, or its issue or PR closed
      // Outside the repo's git lock, so other desks keep checking out meanwhile. A failed install never fails the task.
      const deps = await this.installDeps(a, cwd);
      return a.status === 'preparing' ? { cwd, deps } : this.abandoned(a);
    } catch (err) {
      if (a.status !== 'preparing') return this.abandoned(a);
      if (job) {
        this.jobDeskFailed(a, repo, job, (err as Error).message);
        return null;
      }
      a.status = 'error';
      a.endedAt = Date.now();
      a.lastError = (err as Error).message;
      this.appendLog(a, [{ kind: 'error', text: `✗ ${a.lastError}` }]);
      if (this.deskAlerts.get(a.id) !== a.lastError) {
        // Once per agent and error: retries that fail the same way don't ring the phone again.
        this.deskAlerts.set(a.id, a.lastError);
        this.postMessage('office', `⚠️ ${a.name}'s desk couldn't be set up: ${a.lastError.slice(0, 240)}`);
      }
      this.emitAgent(a);
      this.save();
      return null;
    }
  }

  /**
   * A desk couldn't be set up for a PR's fix or QA run (#199). Nothing ran, so the agent is free again at once. The PR
   * is handed out again; after repeated failures it sits out a while (one phone message), and in time needs the manager.
   */
  private jobDeskFailed(a: PersistedAgent, repo: PersistedRepo, job: PrepJob, error: string) {
    const { rec, task } = job;
    this.appendLog(a, [
      { kind: 'error', text: `✗ ${error}` },
      { kind: 'system', text: `Nothing ran, so ${a.name} is free for other work.` },
    ]);
    this.clearTask(a);
    this.save();
    if (!this.state.qa.includes(rec)) return;
    const key = prepKey(repo.id, rec.prNumber, task);
    const step = prepFailure(this.prepStrikes.get(key), rec.sessionFailures, task === 'fix' ? MAX_FIX_FAILURES : MAX_QA_FAILURES, Date.now());
    this.prepStrikes.set(key, step.strikes);
    const needsHuman = step.next === 'needs-human';
    this.setQa(rec, {
      ...(task === 'fix' ? { status: needsHuman ? 'needs-human' : 'failed', devAgentId: job.author } : { status: needsHuman ? 'needs-human' : 'queued', qaAgentId: null }),
      sessionFailures: step.sessionFailures,
      ...(needsHuman ? { mergeNote: "its desk couldn't be set up", stuckWhy: "its desk couldn't be set up", escalated: true } : {}), // no CEO tool fixes a desk: straight to the manager
    });
    if (step.next === 'retry') return;
    const what = task === 'fix' ? 'fix' : 'QA run';
    const why = `desks couldn't be set up for its ${what} twice in a row: ${error.slice(0, 240)}`;
    this.postMessage(
      'office',
      needsHuman
        ? `⚠️ PR #${rec.prNumber} on ${repo.fullName} needs you: ${why}`
        : `⚠️ PR #${rec.prNumber} on ${repo.fullName} waits ${Math.round(PREP_HOLD_MS / 60_000)} minutes before anyone tries its ${what} again: ${why}`,
    );
  }

  private clearPrepStrikes(repoId: string, prNumber: number) {
    for (const task of ['fix', 'qa'] as const) this.prepStrikes.delete(prepKey(repoId, prNumber, task));
  }

  /** The desk's dependencies, shown on the agent's card ("Installing dependencies") while npm runs. */
  private async installDeps(a: PersistedAgent, cwd: string): Promise<DepsOutcome> {
    const rt = this.agentRt.get(a.id);
    try {
      return await this.backend.installDeps(cwd, {
        log: (lines) => this.appendLog(a, lines.map((text) => ({ kind: text.startsWith('⚠') ? 'error' : 'system', text }))),
        installing: () => {
          if (!rt) return;
          rt.currentTool = INSTALL_STEP;
          this.emitAgent(a);
        },
      });
    } finally {
      if (rt?.currentTool === INSTALL_STEP) {
        rt.currentTool = null;
        this.emitAgent(a);
      }
    }
  }

  private async runTask(a: PersistedAgent, repo: PersistedRepo, issue: IssueInfo, note?: string) {
    const branch = devBranch(issue.number, slugify(a.name));
    this.beginTask(
      a,
      { task: 'issue', issueNumber: issue.number, issueTitle: issue.title, branch, prNumber: null, prUrl: null, sessionId: null },
      `Issue #${issue.number}: ${issue.title}`,
      `Preparing worktree on ${branch}…`,
    );
    // GitHub's word, not the last sync's: an issue closed since then isn't started.
    const live = await this.backend.issueState(repo.fullName, issue.number).catch(() => null);
    if (a.status !== 'preparing') return void this.abandoned(a);
    const rt = this.repoRt.get(repo.id);
    if (rt && !stillOpen({ kind: 'issue', number: issue.number }, this.floorState(rt), live)) {
      this.appendLog(a, [{ kind: 'system', text: `Issue #${issue.number} is closed; nothing to do.` }]);
      this.clearTask(a);
      this.learnIssueClosed(repo, issue.number);
      return;
    }
    const desk = await this.prepare(a, repo, {}, branch);
    if (!desk) return;
    const { cwd } = desk;

    const prompt = [
      `Please resolve GitHub issue #${issue.number}: ${issue.title}`,
      `URL: ${issue.url}`,
      issue.labels.length ? `Labels: ${issue.labels.join(', ')}` : '',
      '',
      issue.body?.trim() || '(The issue has no description.)',
      note ? `\nNote from the manager: ${note}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    this.startAgentSession(a, repo, cwd, prompt, this.buildSystemAppend(a, repo, cwd, branch, undefined, desk.deps));
  }

  private startAgentSession(
    a: PersistedAgent,
    repo: PersistedRepo,
    cwd: string,
    prompt: string,
    systemAppend: string,
    resumeSessionId?: string,
    outputSchema?: Record<string, unknown>,
    /** typed: the manager typed the prompt at the CLI; reattach: follow the CLI that kept working through a restart. */
    mode: 'typed' | 'reattach' | null = null,
  ) {
    const rt = this.agentRt.get(a.id)!;
    a.status = 'working';
    const how = this.sessionRuntime(a, resumeSessionId);
    this.emitAgent(a);
    rt.session = this.backend.startSession(
      {
        cwd,
        prompt,
        systemAppend,
        model: this.modelFor(a, how.cli),
        effort: a.effort || this.state.settings.defaultEffort,
        browserTesting: repo.browserTesting,
        additionalDirectories: this.linkedRepos(repo).map((r) => this.backend.mainDir(r.fullName)),
        role: a.task === 'qa' ? 'qa' : a.role, // a developer covering QA works under QA's rules
        outputSchema,
        // A developer's CLI stays at its prompt afterwards, for the manager and for follow-ups; QA's closes.
        keepAlive: a.task !== 'qa',
        typed: mode === 'typed',
        reattach: mode === 'reattach',
        agentId: a.id,
        ...how,
      },
      {
        log: (entries) => this.appendLog(a, entries),
        tool: (name) => {
          if (rt.currentTool === name) return;
          rt.currentTool = name;
          this.emitAgent(a);
        },
        sessionId: (id) => {
          a.sessionId = id;
          a.sessionCli = id ? (how.cli ?? 'claude') : null;
        },
        browserUrl: (url) => {
          rt.browserUrl = url;
          this.emitAgent(a);
        },
        screenshot: (data, mime) => {
          const at = Date.now();
          rt.screenshot = { data, mime, at };
          rt.shots.push({ data, mime, url: rt.browserUrl, at });
          if (rt.shots.length > 12) rt.shots.shift();
          this.broadcast({ type: 'screen', agentId: a.id, url: rt.browserUrl, at });
          void removeScreens(a.id)
            .then(() => fs.mkdir(SCREENS_DIR, { recursive: true }))
            .then(() => fs.writeFile(screenFile(a.id, mime), data))
            .catch((err) => console.warn('could not save screenshot', err));
        },
        limited: (at) => this.pauseForLimit(at),
        usageWarning: (info) => this.paceForWarning(info),
        finished: (result) => void this.onFinished(a, repo, result),
      },
    );
  }

  private async onFinished(a: PersistedAgent, repo: PersistedRepo, result: SessionResult) {
    const rt = this.agentRt.get(a.id);
    if (!rt || !this.state.agents.includes(a)) return; // fired
    if (this.officeUpdate.handedOver) return; // stopped for the office's update: recovered like after a restart
    rt.session = null;
    rt.currentTool = null;
    a.endedAt = Date.now();
    a.costUsd += result.costUsd;
    a.turns += result.turns;
    // Dev servers the agent forgot to stop would otherwise keep its port and lock its desk folder.
    void this.backend.releaseDesk(repo.fullName, this.agentSlug(a), this.port(a)).catch(() => undefined);
    if (result.interrupted) this.interrupted(a);

    if (this.dropping.has(a.id)) this.dropTask(a, '↺ Cleared desk. Ready for new work.'); // stopped: its issue or PR closed
    else if (a.task === 'qa') await this.onQaFinished(a, repo, result);
    else if (a.task === 'fix') await this.onFixFinished(a, repo, result);
    else await this.onIssueFinished(a, repo, result);

    this.emitAgent(a);
    this.save();
    void this.syncRepo(repo.id);
    setTimeout(() => this.schedule(), 500);
  }

  private minutes(a: PersistedAgent) {
    return a.startedAt && a.endedAt ? Math.max(1, Math.round((a.endedAt - a.startedAt) / 60000)) : 0;
  }

  private fail(a: PersistedAgent, result: SessionResult, what: string) {
    a.status = 'error';
    a.lastError = result.errors.join('; ') || 'Session failed';
    this.appendLog(a, [{ kind: 'error', text: `✗ ${a.lastError}` }]);
    this.toast('error', `${a.name} hit a problem on ${what}: ${a.lastError.slice(0, 120)}`);
  }

  private async onIssueFinished(a: PersistedAgent, repo: PersistedRepo, result: SessionResult) {
    const escaped = repo.fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = result.text.match(new RegExp(`https://github\\.com/${escaped}/pull/(\\d+)`, 'i'));
    if (m) {
      a.prNumber = Number(m[1]);
      a.prUrl = m[0];
    } else if (a.branch) {
      const pr = await this.backend.prForBranch(repo.fullName, a.branch).catch(() => null);
      if (pr) {
        a.prNumber = pr.number;
        a.prUrl = pr.url;
      }
    }

    if (a.status === 'stopped') return; // the manager already logged the stop
    if (!result.ok) {
      this.issueFailed(repo, a.issueNumber);
      return this.fail(a, result, `#${a.issueNumber}`);
    }
    this.issueFailures.delete(`${repo.id}#${a.issueNumber}`);
    a.status = 'done';
    this.appendLog(a, [{ kind: 'done', text: `✔ Finished in ${this.minutes(a)}m · ${a.turns} turns${a.prNumber ? ` · PR #${a.prNumber}` : ' · no PR found'}` }]);
    const failedEarly = a.prNumber ? this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === a.prNumber && q.status === 'failed') : undefined;
    if (failedEarly) {
      // QA failed the PR while this session was still going (#199): the fix was kept for them, and resumes this session.
      this.setQa(failedEarly, { devAgentId: a.id, devSessionId: a.sessionId ?? failedEarly.devSessionId });
      this.appendLog(a, [{ kind: 'system', text: `📨 QA already failed PR #${a.prNumber}; fixing it is next.` }]);
    } else if (a.prNumber) {
      this.queueQa(repo, a.prNumber, a, a.issueNumber);
      this.appendLog(a, [{ kind: 'system', text: `📨 Handed PR #${a.prNumber} to QA.` }]);
      this.toast('success', `${a.name} opened PR #${a.prNumber} for #${a.issueNumber}; it's off to QA`);
    } else {
      this.noPullRequest(a, repo);
    }
  }

  /**
   * An issue session ended without a PR, which would leave the issue "taken" with nobody on it. The same developer,
   * who has the context and the worktree, is asked once to finish; after that the issue goes back on the board.
   */
  private noPullRequest(a: PersistedAgent, repo: PersistedRepo) {
    const key = `${repo.id}#${a.issueNumber}`;
    if (this.nudged.has(key)) return this.releaseIssue(a, repo);
    this.nudged.add(key);
    // message() starts the session before its first await, so the scheduler can't hand this developer other work first.
    void this.message(
      a.id,
      `You finished without opening a pull request for #${a.issueNumber}. Finish the remaining steps now: commit, push your branch and open the PR with "Closes #${a.issueNumber}". If the issue can't be done, open a draft PR that explains why.`,
    ).catch(() => this.releaseIssue(a, repo));
  }

  private releaseIssue(a: PersistedAgent, repo: PersistedRepo) {
    const n = a.issueNumber;
    this.clearTask(a);
    this.postMessage('office', `⚠️ ${a.name} finished #${n} on ${repo.fullName} without opening a pull request, so it's back on the board for anyone.`);
  }

  // ---------- QA ----------

  private queueQa(repo: PersistedRepo, prNumber: number, dev: PersistedAgent | null, issueNumber: number | null) {
    const rt = this.repoRt.get(repo.id);
    if (rt && !stillOpen({ kind: 'pr', number: prNumber }, this.floorState(rt))) return; // it closed: QA has nothing to test
    let rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === prNumber);
    if (rec) {
      if (rec.status === 'testing') return;
      this.setQa(rec, { status: 'queued', devAgentId: dev?.id ?? rec.devAgentId, devSessionId: dev?.sessionId ?? rec.devSessionId });
    } else {
      rec = {
        repoId: repo.id,
        prNumber,
        status: 'queued',
        round: 1,
        devAgentId: dev?.id ?? null,
        qaAgentId: null,
        summary: null,
        checks: [],
        commentUrl: null,
        updatedAt: Date.now(),
        issueNumber,
        devSessionId: dev && dev.prNumber === prNumber ? dev.sessionId : null,
        fixInstructions: null,
        sessionFailures: 0,
        mergeNote: null,
        testedSha: null,
        passedSha: null,
        fixReason: null,
        mergeFixes: 0,
        retests: 0,
        pendingSince: null,
        mergeRetryAt: null,
        alerted: false,
        preQa: null,
        noChangeSha: null,
        rerunSha: null,
        rerunAt: null,
        qaChecks: null,
        stuckWhy: null,
        triages: 0,
        escalated: false,
      };
      this.state.qa.push(rec);
      this.setQa(rec, {});
    }
    setTimeout(() => this.schedule(), 200);
  }

  /** Manager's "send to QA" for any open PR (including ones opened by people). */
  async sendToQa(repoId: string, prNumber: number) {
    const repo = this.repo(repoId);
    const pr = this.repoRt.get(repo.id)?.pulls.find((p) => p.number === prNumber && p.state === 'OPEN');
    if (!pr) throw new HttpError(404, `PR #${prNumber} is not open on ${repo.fullName}`);
    const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === prNumber);
    if (rec?.status === 'testing' || rec?.status === 'fixing') throw new HttpError(409, `PR #${prNumber} is already ${rec.status}`);
    if (rec && (rec.status === 'needs-human' || rec.status === 'passed' || rec.status === 'failed')) {
      // a fresh start: the manager decided it deserves another round
      rec.round += 1;
      rec.sessionFailures = 0;
      rec.mergeNote = null;
      if (rec.preQa) Object.assign(rec, { fixReason: rec.preQa.fixReason, preQa: null }); // QA gets the test it was queued for
    }
    const dev = this.state.agents.find((a) => a.repoId === repo.id && a.role === 'dev' && a.task !== 'qa' && (a.prNumber === prNumber || a.branch === pr.headRefName));
    this.clearPrepStrikes(repo.id, prNumber);
    this.queueQa(repo, prNumber, dev ?? null, pr.closesIssues[0] ?? null);
    this.toast('info', `PR #${prNumber} is queued for QA`);
  }

  /** Manager's "send back to dev" for a PR that needs a human or failed QA: a developer fixes it, with the note. */
  async sendBackToDev(repoId: string, prNumber: number, note?: string, from?: string) {
    const repo = this.repo(repoId);
    const find = () => this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === prNumber);
    const listed = this.repoRt.get(repo.id)?.pulls.find((p) => p.number === prNumber);
    sendBackPatch(prNumber, listed, find(), repo.defaultBranch, note, from); // refuse before asking GitHub
    // The last sync's mergeability may be stale or UNKNOWN: ask about the PR itself whether it conflicts now.
    const details = await this.backend.prDetails(repo.fullName, prNumber).catch(() => null);
    const pr = details && listed ? { ...listed, state: details.state, mergeable: details.mergeable, mergeState: details.mergeState } : listed;
    const rec = find();
    const patch = sendBackPatch(prNumber, pr, rec, repo.defaultBranch, note, from);
    this.clearPrepStrikes(repo.id, prNumber);
    this.setQa(rec!, { ...patch, preQa: null });
    setTimeout(() => this.schedule(), 200);
    this.toast('info', `PR #${prNumber} goes back to a developer${patch.fixReason === 'conflict' ? ' to resolve its conflicts' : ''}`);
  }

  private buildQaSystemAppend(a: PersistedAgent, repo: PersistedRepo, cwd: string, branch: string, pr: PrDetails, testStep: string, deps?: DepsOutcome) {
    return qaSystemPrompt({ agent: a, repo, port: this.port(a), cwd, branch, pr, testStep, depsLine: depsPromptLine(deps) });
  }

  private async runQa(a: PersistedAgent, repo: PersistedRepo, rec: QaRecord) {
    const branch = qaBranch(rec.prNumber, slugify(a.name));
    this.setQa(rec, { status: 'testing', qaAgentId: a.id });
    this.beginTask(
      a,
      { task: 'qa', issueNumber: rec.issueNumber, issueTitle: `PR #${rec.prNumber}`, branch, prNumber: rec.prNumber, prUrl: null, sessionId: null },
      `QA · PR #${rec.prNumber} · round ${rec.round}`,
      `Checking out PR #${rec.prNumber}…`,
    );

    let pr: PrDetails;
    let issue: { title: string; body: string } | null = null;
    const lastTestedSha = rec.testedSha;
    // Stopped meanwhile, by the manager or because the PR closed (then its record has left QA already).
    const stopped = () => {
      if (this.state.qa.includes(rec) && rec.status === 'testing') this.setQa(rec, { status: 'queued', qaAgentId: null });
      return void this.abandoned(a);
    };
    try {
      pr = await this.backend.prDetails(repo.fullName, rec.prNumber);
      const issueNumber = rec.issueNumber ?? pr.closesIssues[0] ?? null;
      if (issueNumber) issue = await this.backend.issueDetails(repo.fullName, issueNumber).catch(() => null);
      Object.assign(a, { issueTitle: pr.title, prUrl: pr.url });
      this.emitAgent(a);
    } catch (err) {
      if (a.status !== 'preparing') return stopped();
      a.status = 'error';
      a.endedAt = Date.now();
      a.lastError = (err as Error).message;
      this.appendLog(a, [{ kind: 'error', text: `✗ ${a.lastError}` }]);
      this.setQa(rec, { status: 'queued', qaAgentId: null });
      this.emitAgent(a);
      return;
    }
    if (a.status !== 'preparing') return stopped();
    if (pr.state !== 'OPEN') {
      this.appendLog(a, [{ kind: 'system', text: `PR #${pr.number} is ${pr.state.toLowerCase()}; nothing to test.` }]);
      this.clearTask(a);
      this.dropRecord(repo, rec.prNumber);
      this.learnPull(repo, pr, pr.state);
      return;
    }
    // QA never spends a session on a stale branch: a conflict goes to the developer first, a branch behind is updated.
    const gate = qaGate(pr, rec, repo.autoMerge);
    if (gate.do === 'send-back') {
      this.appendLog(a, [{ kind: 'system', text: `PR #${pr.number} conflicts with ${repo.defaultBranch}; it goes back to its developer before QA.` }]);
      this.clearTask(a);
      if (gate.needsHuman) {
        this.sendBack(repo, rec, 'conflict', rec.fixInstructions ?? '', true);
        return;
      }
      // QA's last findings stay on the record for the test QA was queued for, which follows the merge.
      this.setQa(rec, { status: 'failed', qaAgentId: null, fixReason: 'conflict', preQa: { sha: pr.headSha, fixReason: rec.fixReason }, mergeFixes: rec.mergeFixes + 1, mergeNote: null });
      setTimeout(() => this.schedule(), 200);
      return;
    }
    if (gate.do === 'update-branch') {
      this.appendLog(a, [{ kind: 'system', text: `Updating PR #${pr.number}'s branch with ${repo.defaultBranch} first…` }]);
      try {
        await this.backend.updateBranch(repo.fullName, pr.number);
        pr = await this.backend.prDetails(repo.fullName, pr.number);
      } catch (err) {
        this.appendLog(a, [{ kind: 'system', text: `  ⎿ GitHub couldn't update it (${oneLine(err)}); testing it as it is.` }]);
      }
    }
    rec.testedSha = pr.headSha;

    const desk = await this.prepare(a, repo, { pr: rec.prNumber }, branch, { rec, task: 'qa' });
    if (!desk) {
      if (this.state.qa.includes(rec) && rec.status === 'testing') this.setQa(rec, { status: 'queued', qaAgentId: null });
      return;
    }
    const { cwd } = desk;

    const dev = rec.devAgentId ? this.state.agents.find((x) => x.id === rec.devAgentId) : null;
    // A last-round fail sent back for a merge fix (QA never passed it): QA's findings first, then a full re-check.
    const failedConflict = rec.fixReason === 'conflict' && !rec.passedSha;
    const qa = qaInstructions({
      ...pr,
      round: rec.round,
      fixReason: failedConflict ? 'qa' : rec.fixReason,
      lastTestedSha: failedConflict ? null : lastTestedSha,
      summary: rec.summary,
      fixInstructions: rec.fixInstructions,
      defaultBranch: repo.defaultBranch,
    });
    const prompt = [
      `Please QA pull request #${pr.number}: ${pr.title}`,
      `URL: ${pr.url}`,
      `Author: ${dev ? `${dev.name} (developer agent)` : 'a teammate'} · QA round ${rec.round}`,
      qa.checks,
      qa.retest,
      '',
      'PR description:',
      pr.body.trim() || '(empty)',
      issue ? `\nLinked issue: ${issue.title}\n${issue.body.trim() || '(no description)'}` : '',
    ]
      .filter((l) => l !== '')
      .join('\n');

    const systemAppend = this.buildQaSystemAppend(a, repo, cwd, branch, pr, qa.testStep, desk.deps);
    this.agentRt.get(a.id)!.qaResume = { cwd, systemAppend };
    this.startAgentSession(a, repo, cwd, prompt, systemAppend, undefined, QA_SCHEMA);
  }

  private async onQaFinished(a: PersistedAgent, repo: PersistedRepo, result: SessionResult) {
    const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === a.prNumber);
    const rt = this.agentRt.get(a.id)!;
    const report = result.ok ? parseReport(result) : null;
    const resume = rt.qaResume;
    const next = qaRetry({ stopped: a.status === 'stopped', limited: this.limited(), ok: result.ok, report: !!report, canResume: !!resume && !!a.sessionId });
    if (next === 'resume' && resume && a.sessionId) {
      // Same session, context and screenshots: they likely ended a turn to wait on something that never woke them.
      rt.qaResume = null;
      a.endedAt = null;
      this.appendLog(a, [{ kind: 'system', text: '↻ The session ended without a QA report. Resuming it once to finish.' }]);
      this.startAgentSession(a, repo, resume.cwd, QA_RESUME_PROMPT, resume.systemAppend, a.sessionId, QA_SCHEMA);
      return;
    }

    if (next === 'give-up' || !report) {
      if (a.status !== 'stopped') this.fail(a, { ...result, errors: result.errors.length ? result.errors : ['QA finished without a usable report'] }, `QA of PR #${a.prNumber}`);
      if (rec) {
        const failures = rec.sessionFailures + (this.limited() ? 0 : 1); // the usage limit isn't the PR's fault
        const patch = { qaAgentId: null, sessionFailures: failures, summary: a.status === 'stopped' ? QA_STOPPED : rec.summary };
        if (a.status === 'stopped') this.setQa(rec, { ...patch, status: 'needs-human', escalated: true }); // the manager stopped it: theirs to decide
        else if (failures >= MAX_QA_FAILURES) this.stuck(rec, patch, `QA ended without a usable report ${failures} times in a row`);
        else this.setQa(rec, { ...patch, status: 'queued' });
      }
      return;
    }

    a.status = 'done';
    const pass = report.verdict === 'pass';
    this.appendLog(a, [{ kind: pass ? 'done' : 'error', text: `${pass ? '✅ QA passed' : '❌ QA failed'} PR #${a.prNumber} · ${report.checks.length} checks · ${rt.shots.length} screenshots` }]);

    // Evidence + comment on the PR
    let commentUrl: string | null = null;
    if (rec) {
      // On a fail: a conflict with the default branch is the merge gate's job, not the manager's (on QA's last round),
      // and the checks are recorded so a re-run of a red one can count as the fix.
      const pull = !pass ? await this.backend.prDetails(repo.fullName, rec.prNumber).catch(() => null) : null;
      const next = qaOutcome(pass, rec, pull);
      try {
        this.appendLog(a, [{ kind: 'system', text: '📎 Uploading evidence and posting the QA report on the PR…' }]);
        const body = await this.renderQaComment(a, repo, rec, report, rt.shots, next);
        commentUrl = (await this.backend.commentPull(repo.fullName, rec.prNumber, body)) || null;
        this.appendLog(a, [{ kind: 'system', text: `  ⎿ ${commentUrl ?? 'comment posted'}` }]);
      } catch (err) {
        this.appendLog(a, [{ kind: 'error', text: `  ⎿ Could not post the QA report: ${(err as Error).message}` }]);
      }
      const qaRounds = rec.round - rec.retests; // rounds QA itself asked for
      const nextStatus = next === 'conflict' ? 'failed' : next;
      const fixInstructions = report.fixInstructions ?? report.checks.filter((c) => c.result === 'fail').map((c) => `${c.name}: ${c.details}`).join('\n');
      this.setQa(rec, {
        status: nextStatus,
        summary: report.summary,
        checks: report.checks,
        commentUrl: commentUrl ?? rec.commentUrl,
        fixInstructions,
        sessionFailures: 0,
        fixReason: pass ? null : 'qa',
        preQa: null,
        passedSha: pass ? rec.testedSha : null,
        mergeNote: null,
        pendingSince: null,
        mergeRetryAt: null,
        alerted: false,
        qaChecks: pull?.checks ?? null,
      });
      // QA's findings travel with the merge fix; the developer's push then gets one more QA round.
      if (next === 'conflict') this.sendBack(repo, rec, 'conflict', conflictFixInstructions(fixInstructions, repo.defaultBranch), false);
      const stillConflicts = pull && (pull.mergeable === 'CONFLICTING' || pull.mergeState === 'DIRTY') ? `, and it still conflicts with ${repo.defaultBranch} with its ${MAX_MERGE_FIXES} merge fixes used up` : '';
      const triaged = nextStatus === 'needs-human' && this.stuck(rec, {}, `it failed QA ${qaRounds} times, the most QA rounds a PR gets (${MAX_QA_ROUNDS})${stillConflicts}`);
      this.toast(
        pass ? 'success' : 'error',
        pass
          ? `✅ ${a.name} passed PR #${rec.prNumber}${repo.autoMerge ? "; it merges once GitHub's checks are green" : ': ready to merge'}`
          : nextStatus === 'needs-human'
            ? `❌ PR #${rec.prNumber} failed QA ${qaRounds} times${triaged ? `; ${this.ceo().name} takes a look before it comes to you` : ' and needs a human'}`
            : next === 'conflict'
              ? `❌ ${a.name} failed PR #${rec.prNumber}, and it conflicts with ${repo.defaultBranch}; sending it back to merge and fix`
              : `❌ ${a.name} failed PR #${rec.prNumber}; sending it back to the developer`,
      );
    }
  }

  private async renderQaComment(a: PersistedAgent, repo: PersistedRepo, rec: QaRecord, report: QaReport, shots: Shot[], next: QaNext) {
    const pass = report.verdict === 'pass';
    const images: string[] = [];
    const evidence = shots.slice(-8);
    const offset = shots.length - evidence.length;
    const folder = `pr-${rec.prNumber}/round-${rec.round}-${Date.now().toString(36)}`;
    for (const [i, shot] of evidence.entries()) {
      const n = offset + i + 1;
      const ext = MIME_EXT[shot.mime] ?? 'png';
      const file = `${folder}/${String(n).padStart(2, '0')}.${ext}`;
      try {
        const url = await this.backend.uploadEvidence(repo.fullName, file, shot.data);
        const caption = report.screenshots[n - 1] ?? `Screenshot ${n}`;
        images.push(`**${n}. ${caption}**${shot.url ? ` · \`${shot.url}\`` : ''}\n\n<img src="${url}" alt="${caption.replace(/"/g, "'")}" width="760">`);
      } catch (err) {
        this.appendLog(a, [{ kind: 'error', text: `  ⎿ screenshot ${n} upload failed: ${(err as Error).message.slice(0, 120)}` }]);
      }
    }
    const dev = rec.devAgentId ? this.state.agents.find((x) => x.id === rec.devAgentId) : null;
    const lines = [
      `## 🔍 QA report: ${pass ? '✅ Passed' : '❌ Failed'}`,
      `**Tester:** ${a.name} (cubefarm QA agent) · **Round:** ${rec.round}${dev ? ` · **Author:** ${dev.name}` : ''}`,
      '',
      report.summary,
      '',
      '| | Check | Details |',
      '|---|---|---|',
      ...report.checks.map((c) => `| ${ICON[c.result]} | ${cell(c.name)} | ${cell(c.details)} |`),
    ];
    if (report.commands.length) {
      lines.push('', '<details><summary>🧪 Commands run</summary>', '', '| Command | Result |', '|---|---|', ...report.commands.map((c) => `| \`${cell(c.command)}\` | ${cell(c.result)} |`), '', '</details>');
    }
    if (!pass && report.fixInstructions) lines.push('', '### 🔧 What needs fixing', '', report.fixInstructions);
    if (images.length) lines.push('', '### 📸 Evidence', '', ...images.flatMap((img) => [img, '']));
    else lines.push('', '_No browser screenshots were taken in this round._');
    const merge = repo.autoMerge ? "merges automatically once GitHub's checks pass" : 'ready for the manager to merge';
    lines.push('', `<sub>Posted by cubefarm · ${pass ? merge : next === 'needs-human' ? 'needs a human decision' : next === 'conflict' ? `sent back to the developer to merge ${repo.defaultBranch} and fix` : 'sent back to the developer for fixes'}</sub>`);
    return lines.join('\n');
  }

  /** Send a failed PR back to the developer who wrote it (or any free developer on the floor). */
  private async runFix(dev: PersistedAgent, repo: PersistedRepo, rec: QaRecord) {
    const original = rec.devAgentId === dev.id;
    const pull = this.repoRt.get(repo.id)?.pulls.find((p) => p.number === rec.prNumber);
    const headRef = pull?.headRefName ?? dev.branch ?? `pr-${rec.prNumber}`;
    const qaAgent = rec.qaAgentId ? this.state.agents.find((x) => x.id === rec.qaAgentId) : null;
    this.fixNudged.delete(`${repo.id}#${rec.prNumber}`);
    const author = rec.devAgentId;
    this.setQa(rec, { status: 'fixing', devAgentId: dev.id });
    this.beginTask(
      dev,
      // The session they held was another task's (QA, say); the author's own is resumed below, from rec.devSessionId.
      { task: 'fix', issueNumber: rec.issueNumber, issueTitle: pull?.title ?? `PR #${rec.prNumber}`, branch: headRef, prNumber: rec.prNumber, prUrl: pull?.url ?? null, sessionId: null },
      rec.fixReason === 'conflict' ? `Resolving conflicts on PR #${rec.prNumber}` : rec.fixReason === 'checks' ? `Fixing checks on PR #${rec.prNumber}` : `Fixing PR #${rec.prNumber} after QA round ${rec.round}`,
      `Checking out PR #${rec.prNumber}…`,
    );
    // GitHub's word, not the last sync's: a PR closed or merged since then gets no fix.
    const live = await this.backend.prDetails(repo.fullName, rec.prNumber).catch(() => null);
    if (dev.status !== 'preparing') {
      if (this.state.qa.includes(rec) && rec.status === 'fixing') this.setQa(rec, { status: 'failed' });
      return void this.abandoned(dev);
    }
    if (live && live.state !== 'OPEN') {
      this.appendLog(dev, [{ kind: 'system', text: `PR #${rec.prNumber} is ${live.state.toLowerCase()}; nothing to fix.` }]);
      this.clearTask(dev);
      this.dropRecord(repo, rec.prNumber);
      this.learnPull(repo, live, live.state);
      return;
    }
    const desk = await this.prepare(dev, repo, { pr: rec.prNumber }, headRef, { rec, task: 'fix', author });
    if (!desk) {
      if (this.state.qa.includes(rec) && rec.status === 'fixing') this.setQa(rec, { status: 'failed' });
      return;
    }
    const { cwd } = desk;
    const failed = rec.checks.filter((c) => c.result === 'fail');
    const takeover = original ? '' : ' A teammate wrote it, so read the PR and the linked issue first.';
    const push = `push to the same branch: git push origin HEAD:${headRef}`;
    const runId = rec.fixReason === 'checks' ? failedRunId(rec.fixInstructions) : null;
    const runLog = runId ? logTail(await this.backend.failedRunLog(repo.fullName, runId).catch(() => '')) : '';
    // A conflict QA never passed (it failed the last round) goes out as a QA fix: its instructions add the merge.
    const mergeFix =
      rec.fixReason === 'conflict' && (rec.preQa || rec.passedSha)
        ? [
            rec.preQa
              ? `Pull request #${rec.prNumber} (${pull?.url ?? ''}) conflicts with ${repo.defaultBranch} because other work was merged first, so it comes back to you before QA tests it.${takeover}`
              : `QA passed pull request #${rec.prNumber} (${pull?.url ?? ''}), but it now conflicts with ${repo.defaultBranch} because other work was merged first.${takeover}`,
            // A conflict found before QA keeps QA's last findings for the re-test, not for this fix.
            !rec.preQa && rec.fixInstructions ? `\nWhat needs fixing:\n${rec.fixInstructions}` : '',
            '',
            `Bring it up to date: git fetch origin && git merge origin/${repo.defaultBranch}. Resolve the conflicts so both this change and the newly merged work keep working, run the project's checks, and ${push}`,
          ]
        : rec.fixReason === 'checks'
          ? [
              `QA passed pull request #${rec.prNumber} (${pull?.url ?? ''}), but GitHub checks failed on it.${takeover}`,
              '',
              `Failed checks:\n${rec.fixInstructions ?? ''}`,
              ...(runId ? failedLogLines(runId, runLog) : []),
              '',
              `Read the logs with gh pr checks ${rec.prNumber} -R ${repo.fullName} (for GitHub Actions: gh run view <run id> -R ${repo.fullName} --log-failed). Fix the cause, run the same checks locally where you can, and ${push}`,
              `If a failure clearly has nothing to do with this change (a flaky test or a service outage), re-run it instead with gh run rerun <run id> -R ${repo.fullName} --failed, and say so.`,
            ]
          : null;
    const qaFix = [
      original
        ? `QA tester ${qaAgent?.name ?? 'QA'} tested your pull request #${rec.prNumber} and it FAILED (round ${rec.round}).`
        : `You are taking over pull request #${rec.prNumber} (${pull?.url ?? ''}), written by a teammate, because QA failed it (round ${rec.round}). Read the PR and the linked issue first.`,
      '',
      `QA summary: ${rec.summary ?? ''}`,
      failed.length ? `Failed checks:\n${failed.map((c) => `- ${c.name}: ${c.details}`).join('\n')}` : '',
      rec.fixInstructions ? `\nWhat needs fixing:\n${rec.fixInstructions}` : '',
      rec.commentUrl ? `\nFull report with screenshots: ${rec.commentUrl}` : '',
      '',
      `Fix these problems, re-run the relevant checks, and push to the same branch: git push origin HEAD:${headRef}`,
      ownPrLine(repo.defaultBranch),
      'Then reply with a short summary of what you changed. Do not open a new pull request; QA will re-test automatically.',
    ];
    const mergeEnd = 'Then reply with a short summary of what you did. Do not open a new pull request; the office merges it once the checks pass, after another QA round if the code changed.';
    const prompt = (mergeFix ? [...mergeFix, ownPrLine(repo.defaultBranch), mergeEnd] : qaFix).filter((l) => l !== '').join('\n');
    const resume = original && rec.devSessionId ? rec.devSessionId : undefined;
    this.startAgentSession(dev, repo, cwd, prompt, this.buildSystemAppend(dev, repo, cwd, headRef, { pr: rec.prNumber, headRef }, desk.deps), resume);
  }

  private async onFixFinished(a: PersistedAgent, repo: PersistedRepo, result: SessionResult) {
    const rec = this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === a.prNumber);
    // Did it push anything? A checks fix may only re-run a flaky check, so only QA and conflict fixes are asked.
    const current = rec && result.ok && a.status !== 'stopped' && rec.fixReason !== 'checks' ? await this.prHead(a, repo, rec.prNumber) : null;
    if (a.status === 'stopped') {
      if (rec?.status === 'fixing') this.setQa(rec, { status: 'failed' });
      return;
    }
    if (!result.ok) {
      this.fail(a, result, `the fix for PR #${a.prNumber}`);
      // Someone else gets a go before it lands on the manager.
      const failures = rec ? rec.sessionFailures + (this.limited() ? 0 : 1) : 0;
      if (rec && failures >= MAX_FIX_FAILURES) this.stuck(rec, { sessionFailures: failures }, `${failures} fix sessions in a row failed`);
      else if (rec) this.setQa(rec, { status: 'failed', sessionFailures: failures });
      return;
    }
    if (!rec || !this.state.qa.includes(rec)) {
      a.status = 'done';
      this.appendLog(a, [{ kind: 'done', text: `✔ Fix pushed for PR #${a.prNumber} in ${this.minutes(a)}m. Back to QA.` }]);
      return;
    }
    const head = current?.headSha ?? null;
    const step = fixOutcome(rec, head, this.minutes(a), !this.limited(), current?.checks ?? null);
    if (!step.pushed && head) {
      // Asked once to push or say why nothing needs to change, before it counts as a strike.
      const key = `${repo.id}#${rec.prNumber}`;
      const noChange = noChangeReason(result.text);
      const next = unpushedFix(rec, head, { nudged: this.fixNudged.has(key), noChange, counts: !this.limited() });
      if (next.do === 'retest') {
        this.fixNudged.delete(key);
        a.status = 'done';
        this.appendLog(a, [{ kind: 'done', text: `✔ No change needed for PR #${rec.prNumber}: ${noChange?.replace(/[.!\s]+$/, '')}. Back to QA for a re-test.` }]);
        this.setQa(rec, { ...next.set, devSessionId: a.sessionId ?? rec.devSessionId });
        this.toast('info', `${a.name} says PR #${rec.prNumber} needs no change; QA re-tests it`);
        return;
      }
      if (next.do === 'nudge') {
        this.fixNudged.add(key);
        a.status = 'done';
        this.appendLog(a, [{ kind: 'system', text: `No new commits were pushed for PR #${rec.prNumber}; asking ${a.name} once more.` }]);
        // message() starts the session before its first await, so the scheduler can't hand this developer other work first.
        void this.message(a.id, noPushNudge(rec.prNumber, repo.defaultBranch)).catch(() => {
          if (rec.status !== 'fixing') return;
          this.unpushed(a, repo, rec, step);
          this.emitAgent(a);
          setTimeout(() => this.schedule(), 500);
        });
        return;
      }
    }
    if (!step.pushed) return this.unpushed(a, repo, rec, step);
    a.status = 'done';
    this.appendLog(a, [step.log]);
    this.setQa(rec, { ...step.set, devSessionId: a.sessionId ?? rec.devSessionId });
    this.toast(
      'info',
      step.set.status === 'passed'
        ? `${a.name} fixed PR #${rec.prNumber}; it merges once it passes again`
        : 'preQa' in step.set
          ? `${a.name} brought PR #${rec.prNumber} up to date; QA tests it`
          : step.set.retests
            ? `${a.name} re-ran the failed checks on PR #${rec.prNumber}; QA re-tests it`
            : `${a.name} pushed fixes for PR #${rec.prNumber}; QA round ${rec.round} is queued`,
    );
  }

  /** A fix that pushed nothing counts as a failed session (fixOutcome's step). */
  private unpushed(a: PersistedAgent, repo: PersistedRepo, rec: QaRecord, step: ReturnType<typeof fixOutcome>) {
    // Like a failed session: someone gets another go, with the same instructions, before it lands on the CEO.
    this.fixNudged.delete(`${repo.id}#${rec.prNumber}`);
    const needsHuman = step.set.status === 'needs-human';
    a.status = 'error';
    a.lastError = `No new commits were pushed for PR #${rec.prNumber}`;
    this.appendLog(a, [step.log]);
    const triaged = needsHuman ? this.stuck(rec, step.set, `it went back for fixes, but ${step.set.sessionFailures} fix sessions in a row ended without pushing a commit`) : (this.setQa(rec, step.set), false);
    const next = !needsHuman ? '; it goes back for another try' : triaged ? `; ${this.ceo().name} takes a look` : '; it needs you';
    this.toast('error', `${a.name} ended the fix for PR #${rec.prNumber} without pushing a commit${next}`);
  }

  /** The PR's head commit and checks now; null (with a warning in the agent's log) when GitHub can't be asked. */
  private async prHead(a: PersistedAgent, repo: PersistedRepo, prNumber: number): Promise<Pick<PrDetails, 'headSha' | 'checks'> | null> {
    try {
      return await this.backend.prDetails(repo.fullName, prNumber);
    } catch (err) {
      console.warn(`could not read the head of ${repo.fullName}#${prNumber}`, err);
      this.appendLog(a, [{ kind: 'system', text: `⚠ Could not check PR #${prNumber} for new commits (${oneLine(err)}); taking the fix at its word.` }]);
      return null;
    }
  }

  /** A message for an agent: sent into their running session, or a follow-up that resumes it. typed: the manager typed it at their CLI's prompt, where it's already running. */
  async message(id: string, text: string, typed = false) {
    const a = this.agent(id);
    if (a.role === 'ceo') return this.messageCeo(text);
    const repo = this.repo(a.repoId);
    if (!text.trim()) throw new HttpError(400, 'Empty message');
    const rt = this.agentRt.get(id)!;
    if (rt.session) {
      this.appendLog(a, [{ kind: 'manager', text: `▶ Manager: ${text}` }]);
      if (!typed) rt.session.send(text);
      return;
    }
    if (a.role === 'qa') throw new HttpError(409, `${a.name} isn't testing anything right now. Send a PR to QA from the Kanban board.`);
    if (a.status === 'preparing') throw new HttpError(409, `${a.name} is still setting up; try again in a moment`);
    if (!a.sessionId || !a.branch || a.task === 'qa') throw new HttpError(409, `${a.name} has no session to continue. Assign an issue instead.`);
    this.ensureSlot();
    this.appendLog(a, [{ kind: 'manager', text: `▶ Manager: ${text}` }]);
    const cwd = this.backend.deskDir(repo.fullName, this.agentSlug(a));
    a.lastError = null;
    a.startedAt = Date.now();
    if (a.task === null) a.task = 'issue';
    const fixing = a.task === 'fix' && a.prNumber ? { pr: a.prNumber, headRef: a.branch } : undefined;
    this.startAgentSession(a, repo, cwd, text, this.buildSystemAppend(a, repo, cwd, a.branch, fixing), a.sessionId, undefined, typed ? 'typed' : null);
  }

  updateSettings(patch: Partial<SwarmSettings>) {
    const s = this.state.settings;
    if (patch.sessionLimit !== undefined) s.sessionLimit = Math.max(0, Math.round(Number(patch.sessionLimit)) || 0);
    // The default model belongs to the default coding agent: a new agent starts on its own default.
    if (isCli(patch.defaultCli) && patch.defaultCli !== s.defaultCli) {
      s.defaultCli = patch.defaultCli;
      if (patch.defaultModel === undefined) s.defaultModel = s.defaultCli === 'claude' ? DEFAULT_MODEL : '';
    }
    if (patch.defaultModel !== undefined) s.defaultModel = String(patch.defaultModel).trim() || (s.defaultCli === 'claude' ? DEFAULT_MODEL : '');
    if (patch.defaultEffort !== undefined && EFFORTS.includes(patch.defaultEffort)) s.defaultEffort = patch.defaultEffort;
    if (patch.runtime === 'terminal' || patch.runtime === 'sdk') s.runtime = patch.runtime;
    if (patch.hiring === 'approve' || patch.hiring === 'auto') s.hiring = patch.hiring;
    if (patch.teamCap !== undefined) s.teamCap = Math.max(1, Math.min(15, Math.round(Number(patch.teamCap)) || 1));
    if (patch.ceoHeartbeatMin !== undefined) s.ceoHeartbeatMin = Math.max(0, Math.min(1440, Math.round(Number(patch.ceoHeartbeatMin)) || 0));
    if (typeof patch.managerName === 'string') s.managerName = patch.managerName.trim().slice(0, 40);
    if (typeof patch.companyName === 'string') s.companyName = patch.companyName.trim().slice(0, 60);
    if (typeof patch.projectsDir === 'string' && patch.projectsDir.trim()) s.projectsDir = path.resolve(patch.projectsDir.trim());
    if (typeof patch.setupDone === 'boolean') s.setupDone = patch.setupDone;
    if (patch.tutorialStep !== undefined) s.tutorialStep = Math.max(-1, Math.round(Number(patch.tutorialStep)) || 0);
    if (typeof patch.autoUpdate === 'boolean') s.autoUpdate = patch.autoUpdate;
    if (patch.pacingSessions !== undefined) s.pacingSessions = clampPacingSessions(patch.pacingSessions);
    if (patch.trimIdleDesksMin !== undefined) {
      s.trimIdleDesksMin = clampTrimIdleMin(patch.trimIdleDesksMin);
      setTimeout(() => void this.trimIdleDesks(), 1000);
    }
    if (patch.voice !== undefined) {
      const keepDays = s.voice.keepDays;
      s.voice = voiceSettings(s.voice, patch.voice);
      if (s.voice.keepDays !== keepDays) setTimeout(() => void this.voice.prune(), 500);
    }
    if (patch.notify !== undefined) {
      const url = (patch.notify as { officeUrl?: unknown } | null)?.officeUrl;
      if (url !== undefined && officeUrl(url) === null) throw new HttpError(400, 'The office URL must be an http(s) address, e.g. https://office.your-tailnet.ts.net');
      s.notify = notifySettings(s.notify, patch.notify);
    }
    this.save();
    this.broadcast({ type: 'settings', settings: s });
    this.emitCeo();
    setTimeout(() => this.schedule(), 200);
    return s;
  }

  /** The setup wizard: who you are, the company, and your CEO. */
  setup(x: { managerName?: string; companyName?: string; hiring?: string; ceoName?: string; ceoLook?: string; ceoColor?: string }) {
    this.updateSettings({
      managerName: x.managerName,
      companyName: x.companyName,
      ...(x.hiring === 'auto' || x.hiring === 'approve' ? { hiring: x.hiring } : {}),
    });
    const ceo = this.ceo();
    this.updateAgent(ceo.id, { name: x.ceoName, color: x.ceoColor });
    if (LOOKS.includes(x.ceoLook as AgentLook)) this.updateAgent(ceo.id, { look: x.ceoLook });
    return this.state.settings;
  }

  // ---------- scheduling ----------

  /**
   * Agents on a floor who can take work now. One whose last session failed sits out a short cooldown, then gets work
   * like everyone else instead of waiting for the manager to reset them.
   */
  private available(repo: PersistedRepo, role: AgentRole) {
    const now = Date.now();
    return this.state.agents
      .filter((a) => a.repoId === repo.id && a.role === role && (FREE.includes(a.status) || (a.status === 'error' && now - (a.endedAt ?? 0) >= ERROR_COOLDOWN_MS)))
      .sort((x, y) => x.desk - y.desk);
  }

  private scheduleOffset = 0;
  private issueFailures = new Map<string, number>(); // `${repoId}#${issue}` → failed sessions on it
  private nudged = new Set<string>(); // `${repoId}#${issue}`: its developer was asked once to finish the missing PR
  private fixNudged = new Set<string>(); // `${repoId}#${pr}`: its fix session was asked once to push or say why not
  private pausedUntil = 0; // Claude's usage limit was hit: nothing new starts before this
  private pacingUntil = 0; // Claude warned about usage: new issues are paced until this
  private lastUsage = '';

  /** Backlog issues that can start now, most urgent first: the ones holding up the longest chain of other issues, then the oldest. */
  private readyIssues(repo: PersistedRepo) {
    const issues = this.repoRt.get(repo.id)!.issues;
    const open = new Set(issues.map((i) => i.number));
    const weight = holdUps(issues);
    return issues
      .filter(
        (i) =>
          !i.labels.some((l) => /^(swarm:skip|wontfix|question)$/i.test(l)) &&
          !this.issueTaken(repo, i.number) &&
          !this.isHeld(repo.id, i.number) &&
          blockers(i.body, open).length === 0 &&
          (this.issueFailures.get(`${repo.id}#${i.number}`) ?? 0) < MAX_ISSUE_FAILURES,
      )
      .map((issue) => ({ issue, want: issueSpecialty(issue.labels), ...weight.get(issue.number)! }))
      .sort((x, y) => y.chain - x.chain || y.waiting - x.waiting || x.issue.number - y.issue.number);
  }

  /**
   * The free developer to put on a job: one it `suits` first, then whoever is least needed elsewhere (fewest ready
   * issues in their specialty, then the least open work in it), so specialists stay free for their own lane.
   */
  private pickDev(repo: PersistedRepo, devs: PersistedAgent[], suits: (a: PersistedAgent) => boolean) {
    if (devs.length <= 1) return devs[0];
    const ready = this.readyIssues(repo).map((r) => r.want);
    const open = this.repoRt.get(repo.id)!.issues.map((i) => issueSpecialty(i.labels));
    const rank = (a: PersistedAgent) => {
      const s = a.specialty.toLowerCase();
      return [suits(a) ? 0 : 1, ready.filter((w) => w === s).length, open.filter((w) => w === s).length, a.desk];
    };
    return devs
      .map((a) => ({ a, r: rank(a) }))
      .sort((x, y) => x.r[0] - y.r[0] || x.r[1] - y.r[1] || x.r[2] - y.r[2] || x.r[3] - y.r[3])[0].a;
  }

  /**
   * Finish work in flight: test queued PRs (oldest first) and get failed ones fixed. Returns true if work started.
   * QA testers test; when they're all busy, a free developer who didn't write the PR covers for them, so QA never
   * holds up the floor. A failed PR goes back to its author when they're free; while the author is still in a session
   * on it, it waits for them; otherwise any free developer takes it. A PR whose desks keep failing to set up sits out.
   */
  private startPipelineWork(repo: PersistedRepo): boolean {
    const devs = this.available(repo, 'dev');
    const testers = this.available(repo, 'qa');
    const now = Date.now();
    const floor = this.floorState(this.repoRt.get(repo.id)!);
    const waiting = (status: QaRecord['status'], task: PrepJob['task']) =>
      this.state.qa
        .filter(
          (q) =>
            q.repoId === repo.id &&
            q.status === status &&
            stillOpen({ kind: 'pr', number: q.prNumber }, floor) &&
            !prepHeld(this.prepStrikes.get(prepKey(repo.id, q.prNumber, task)), now),
        )
        .sort((x, y) => x.updatedAt - y.updatedAt);
    for (const rec of waiting('queued', 'qa')) {
      const tester =
        testers[0] ??
        this.pickDev(
          repo,
          devs.filter((a) => a.id !== rec.devAgentId),
          (a) => /test|qa/i.test(a.specialty),
        );
      if (!tester) continue;
      void this.runQa(tester, repo, rec);
      return true;
    }
    for (const rec of waiting('failed', 'fix')) {
      const issue = this.repoRt.get(repo.id)!.issues.find((i) => i.number === rec.issueNumber);
      const want = issue ? issueSpecialty(issue.labels) : null;
      const author = this.state.agents.find((a) => a.id === rec.devAgentId && a.repoId === repo.id && a.role === 'dev') ?? null;
      const headRef = this.repoRt.get(repo.id)!.pulls.find((p) => p.number === rec.prNumber)?.headRefName ?? null;
      const to = fixGoesTo(author, !!author && devs.includes(author), rec.prNumber, headRef);
      if (to === 'wait') continue; // the author gets it when their session ends
      const dev = to === 'author' ? author : this.pickDev(repo, devs, (a) => a.specialty.toLowerCase() === want);
      if (!dev) break;
      void this.runFix(dev, repo, rec);
      return true;
    }
    return false;
  }

  /**
   * Give a free developer the next backlog issue (auto-assign floors only). Returns true if work started.
   * Issues that say "Depends on #N" wait until #N is closed; the rest go in readyIssues() order. A swarm:<specialty>
   * label is a preference, not a lock: a free specialist gets first pick, and otherwise the issue goes to whichever
   * free developer is least needed elsewhere, so nobody sits idle while there is work that can start.
   */
  private startIssueWork(repo: PersistedRepo): boolean {
    if (!repo.autoAssign || !this.mayStart('issue')) return false;
    const free = this.available(repo, 'dev');
    const ready = free.length ? this.readyIssues(repo) : [];
    if (ready.length === 0) return false;
    const fits = (a: PersistedAgent, want: string) => a.specialty.toLowerCase() === want;
    // Of the issues holding up the most, take one a free specialist fits.
    const pick = ready.find((r) => r.chain === ready[0].chain && free.some((a) => fits(a, r.want))) ?? ready[0];
    const agent = this.pickDev(repo, free, (a) => fits(a, pick.want))!;
    // assign() flips the agent to 'preparing' synchronously, so the next pass sees it as busy.
    void this.assign(agent.id, pick.issue.number).catch((err) => console.warn('auto-assign failed', err));
    return agent.status === 'preparing';
  }

  private limited() {
    return Date.now() < this.pausedUntil;
  }

  /** Claude turned a session away for the usage limit: start nothing new until it resets, rather than failing agent after agent. */
  private pauseForLimit(resetsAt: number | null) {
    const until = (resetsAt ?? Date.now() + LIMIT_PAUSE_MS) + 30_000;
    if (until <= this.pausedUntil) return;
    const fresh = Date.now() >= this.pausedUntil;
    this.pausedUntil = until;
    if (fresh) this.postMessage('office', `⏸ Claude's usage limit was reached. The office starts no new work until ${new Date(until).toLocaleTimeString()}; sessions already running carry on.`);
    this.emitUsage();
  }

  /** Claude warned that usage is getting high: pace new issues until the window resets, rather than run into the limit. */
  private paceForWarning(info: UsageWarning) {
    const now = Date.now();
    const until = info.resetsAt && info.resetsAt > now ? info.resetsAt : now + PACING_MS;
    if (until <= this.pacingUntil) return;
    const fresh = now >= this.pacingUntil;
    this.pacingUntil = until;
    if (fresh) this.postMessage('office', pacingMessage(info, until, this.state.settings.pacingSessions, now));
    this.emitUsage();
  }

  /** May work of this kind start now, as far as Claude's usage goes? */
  private mayStart(kind: WorkKind) {
    return mayStart(kind, { now: Date.now(), pausedUntil: this.pausedUntil, pacingUntil: this.pacingUntil, running: this.running(), pacingSessions: this.state.settings.pacingSessions });
  }

  private usageNow() {
    return usageView({ now: Date.now(), pausedUntil: this.pausedUntil, pacingUntil: this.pacingUntil });
  }

  private emitUsage() {
    const usage = this.usageNow();
    const key = JSON.stringify(usage);
    if (key === this.lastUsage) return;
    const was = this.lastUsage ? (JSON.parse(this.lastUsage) as typeof usage).state : 'normal';
    this.lastUsage = key;
    this.broadcast({ type: 'usage', usage });
    if (usage.state !== was && usage.state !== 'normal') {
      const until = usage.until ? new Date(usage.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'it resets';
      if (usage.state === 'paused') this.notifier.notify('usage', "Claude's usage limit was reached", `The office starts no new work until ${until}; running sessions carry on.`);
      else this.notifier.notify('usage', 'Pacing new work', `Claude warned that usage is high, so new issues start slowly until ${until}.`);
    }
  }

  /** Pacing and pauses run out on their own: say so when pacing ends. */
  private tickUsage() {
    if (this.pacingUntil && Date.now() >= this.pacingUntil) {
      this.pacingUntil = 0;
      this.postMessage('office', "✅ Claude's usage is back to normal. The office starts new work at full speed again.");
    }
    this.emitUsage();
  }

  /** A failed session releases its issue for someone else; an issue that keeps failing waits for the manager. */
  private issueFailed(repo: PersistedRepo, n: number | null) {
    if (n == null || this.limited()) return; // the usage limit isn't the issue's fault
    const key = `${repo.id}#${n}`;
    const failures = (this.issueFailures.get(key) ?? 0) + 1;
    this.issueFailures.set(key, failures);
    if (failures === MAX_ISSUE_FAILURES) {
      this.postMessage('office', `⚠️ Issue #${n} on ${repo.fullName} failed ${failures} sessions in a row, so auto-assign skips it now. Assign it to someone by hand once it's sorted.`);
    }
  }

  /**
   * Hand out work for free session slots. Finishing beats starting: QA and QA fixes on every floor go before any new issue.
   * Within each phase floors take turns (one job per floor per pass), and the starting floor rotates between calls,
   * so no repo can hog the slots.
   */
  private schedule() {
    this.tickUsage();
    if (this.officeUpdateTick()) return; // draining for the office's own update
    if (this.limited()) return;
    // Management first: the CEO's jobs are short and shape everyone else's work.
    this.maybeHeartbeat();
    this.startCeoWork();
    const repos = this.state.repos.filter((r) => {
      const rt = this.repoRt.get(r.id);
      return rt && rt.lastSync != null && rt.cloneStatus !== 'error';
    });
    if (repos.length === 0) return;
    this.scheduleOffset = (this.scheduleOffset + 1) % repos.length;
    const order = [...repos.slice(this.scheduleOffset), ...repos.slice(0, this.scheduleOffset)];
    for (const start of [(r: PersistedRepo) => this.startPipelineWork(r), (r: PersistedRepo) => this.startIssueWork(r)]) {
      let progress = true;
      while (progress) {
        progress = false;
        for (const repo of order) {
          if (this.slotsFull()) return;
          if (start(repo)) progress = true;
        }
      }
    }
  }

  // ---------- the office's own update ----------

  private drainInput(): DrainInput {
    const u = this.officeUpdate;
    return {
      now: Date.now(),
      behind: this.officeHead ? u.behind : 0,
      launcher: this.backend.office.launcher,
      autoUpdate: this.state.settings.autoUpdate !== false,
      requested: u.requested,
      postponedUntil: u.postponedUntil,
      postponedBehind: u.postponedBehind,
      failed: u.failed,
      failedBehind: u.failedBehind,
      drainingSince: u.drainingSince,
      sent: u.sent,
      running: this.running(),
    };
  }

  private officeUpdateView(): OfficeUpdateView {
    const u = this.officeUpdate;
    const input = this.drainInput();
    const d = drainDecision(input);
    const until = u.postponedUntil ? new Date(u.postponedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const detail = d.state === 'failed' ? u.failed : d.state === 'waiting' ? `Postponed until ${until}, or until a newer commit lands.` : null;
    return { state: d.state, behind: input.behind, launcher: input.launcher, drainingSince: u.drainingSince ?? d.drainingSince, running: input.running, detail };
  }

  private emitOfficeUpdate() {
    if (!this.officeHead) return;
    const view = this.officeUpdateView();
    const key = JSON.stringify(view);
    if (key === this.lastOfficeView) return;
    this.lastOfficeView = key;
    this.broadcast({ type: 'officeUpdate', officeUpdate: view });
  }

  /** The own-folder check found the office this many commits behind GitHub. */
  private setOfficeBehind(behind: number) {
    const u = this.officeUpdate;
    if (u.failed && u.failedBehind === null) u.failedBehind = behind; // only a newer commit retries a failed update by itself
    u.behind = behind;
    if (behind === 0) Object.assign(u, { requested: false, failed: null, failedBehind: null });
    this.officeUpdateTick();
  }

  /**
   * Take the office's own update one step (see drainDecision): drain, and once nothing is running, or the drain timed
   * out, hand it to the launcher. True while nothing new may start.
   */
  private officeUpdateTick(): boolean {
    if (!this.officeHead) return false;
    const u = this.officeUpdate;
    const d = drainDecision(this.drainInput());
    if (d.state === 'draining' && u.drainingSince === null) {
      const running = this.running();
      this.postMessage(
        'office',
        `⬆️ Updating the office (${u.behind} new commit${u.behind === 1 ? '' : 's'}). Nothing new starts${running ? ` while ${running} running session${running === 1 ? '' : 's'} finish` : ''}; then it installs and restarts.`,
      );
    }
    u.drainingSince = d.drainingSince;
    if (d.send) void this.handOver(d.timedOut);
    this.emitOfficeUpdate();
    return d.state === 'draining' || d.state === 'updating';
  }

  /** Drained: hand the update to the launcher. Sessions still running after the timeout stop the way a restart stops them. */
  private async handOver(timedOut: boolean) {
    const u = this.officeUpdate;
    const from = this.officeHead!;
    u.sent = true;
    const busy = this.state.agents.filter((a) => BUSY.includes(a.status));
    if (timedOut) this.postMessage('office', `⏱ ${busy.length} session${busy.length === 1 ? ' was' : 's were'} still running after 20 minutes. Stopped; the work goes back to the queue after the update.`);
    this.emitOfficeUpdate();
    u.handedOver = true;
    await this.writeState().catch((err) => console.warn('could not save the state', err)); // still "working": the restarted office recovers them
    for (const a of busy) this.agentRt.get(a.id)?.session?.stop();
    try {
      const result = await this.backend.office.update(from);
      if (result) await this.afterUpdate(result); // the demo: nothing restarts
    } catch (err) {
      await this.afterUpdate({ from, to: from, ok: false, error: `the launcher didn't take the update: ${oneLine(err)}`, installed: false, built: false, at: Date.now() });
    }
  }

  /** An update that didn't restart the office (the demo, or a failed hand-over): recover like a restart would, then report it. */
  private async afterUpdate(result: LastUpdate) {
    const u = this.officeUpdate;
    Object.assign(u, { sent: false, handedOver: false, requested: false, drainingSince: null });
    const interrupted = this.state.agents.filter((a) => BUSY.includes(a.status));
    const preparing = new Set(interrupted.filter((a) => a.status === 'preparing'));
    for (const a of interrupted) {
      Object.assign(a, { status: 'stopped', lastError: 'The office updated itself while this agent was working.' });
      const rt = this.agentRt.get(a.id);
      if (rt) Object.assign(rt, { session: null, currentTool: null });
    }
    this.ensureCeo(interrupted);
    this.recover(interrupted, preparing);
    interrupted.forEach((a) => this.emitAgent(a));
    await this.reportUpdate(result);
    if (!result.ok) u.failedBehind = u.behind;
    const own = this.state.repos.find((r) => this.backend.office.isOwnFolder(this.backend.mainDir(r.fullName)));
    if (own) await this.syncFolder(own);
    this.emitCeo();
    this.save();
    setTimeout(() => this.schedule(), 300);
  }

  /** One phone message about the last update (the launcher's last-update.json, or the demo's fake). */
  private async reportUpdate(result: LastUpdate) {
    const commits = result.ok && result.to ? await this.backend.office.commitsBetween(result.from, result.to) : null;
    this.postMessage('office', lastUpdateMessage(result, commits));
    Object.assign(this.officeUpdate, { failed: result.ok ? null : result.error || 'unknown error', failedBehind: null });
  }

  /** The manager's Update now (drain now, even with automatic updates off) or Later (not for 2 hours, or until a newer commit). */
  updateOffice(action: unknown): OfficeUpdateView {
    if (action !== 'now' && action !== 'later') throw new HttpError(400, 'action must be "now" or "later"');
    const u = this.officeUpdate;
    if (!this.officeHead || !this.backend.office.launcher) throw new HttpError(409, 'The office can only update itself when its launcher started it (npm run dev or npm start).');
    if (u.sent) throw new HttpError(409, 'The update is already under way.');
    if (u.behind <= 0) throw new HttpError(409, 'The office is up to date: there is nothing to update.');
    if (action === 'now') Object.assign(u, { requested: true, postponedUntil: null });
    else Object.assign(u, { requested: false, postponedUntil: Date.now() + POSTPONE_MS, postponedBehind: u.behind });
    this.officeUpdateTick();
    setTimeout(() => this.schedule(), 200);
    return this.officeUpdateView();
  }

  // ---------- the CEO ----------

  private ceo() {
    return this.state.agents.find((a) => a.id === CEO_ID)!;
  }

  /** The company always has a CEO. One cut off by a server restart picks its job back up. */
  private ensureCeo(interrupted: PersistedAgent[]) {
    let a = this.state.agents.find((x) => x.id === CEO_ID);
    if (!a) {
      a = {
        id: CEO_ID,
        name: CEO_NAME,
        repoId: '',
        role: 'ceo',
        title: 'Chief Executive Officer',
        specialty: '',
        brief: '',
        hiredBy: 'manager',
        look: lookFor(CEO_NAME),
        task: null,
        desk: 0,
        color: '#e63946',
        hair: '#2b2118',
        skin: pick(SKIN),
        model: CEO_MODEL,
        effort: CEO_EFFORT,
        cli: 'claude',
        status: 'idle',
        issueNumber: null,
        issueTitle: null,
        branch: null,
        prNumber: null,
        prUrl: null,
        startedAt: null,
        endedAt: null,
        costUsd: 0,
        turns: 0,
        sessionId: null,
        sessionCli: null,
        lastError: null,
        logTail: [],
      };
      this.state.agents.push(a);
      this.agentRt.set(a.id, { log: [], pending: [], session: null, currentTool: null, browserUrl: null, screenshot: null, shots: [], terminal: null });
      this.appendLog(a, [{ kind: 'system', text: `🏛️ ${a.name} moved into the corner office. The CEO studies every floor, shapes its team and plans its work.` }]);
    }
    const i = interrupted.indexOf(a);
    if (i >= 0) {
      interrupted.splice(i, 1);
      a.status = 'idle';
      a.lastError = null;
      this.appendLog(a, [{ kind: 'system', text: '↺ The office server restarted. Picking the job back up.' }]);
    }
    if (this.state.ceo.job) {
      this.state.ceo.queue.unshift(this.state.ceo.job);
      this.state.ceo.job = null;
    }
    this.state.ceo.lastReviewAt ??= Date.now(); // the first review comes one heartbeat after the office opens
  }

  private ceoFloor(repoId?: string) {
    const repo = repoId ? this.state.repos.find((r) => r.id === repoId) : undefined;
    if (!repo) return null;
    return { floor: repo.floor, fullName: repo.fullName, clone: this.backend.mainDir(repo.fullName), mission: repo.mission, backlog: this.repoRt.get(repo.id)?.issues.length ?? 0 };
  }

  private ceoInfo(): CeoInfo {
    const c = this.state.ceo;
    const view = (j: CeoJob) => ({ kind: j.kind, label: jobLabel(j, this.ceoFloor(j.repoId)) });
    const min = this.state.settings.ceoHeartbeatMin;
    return {
      queue: c.queue.map(view),
      job: c.job ? view(c.job) : null,
      lastReviewAt: c.lastReviewAt,
      nextReviewAt: min > 0 && c.lastReviewAt ? c.lastReviewAt + min * 60_000 : null,
    };
  }

  private emitCeo() {
    this.broadcast({ type: 'ceo', ceo: this.ceoInfo() });
  }

  /** Queue a job for the CEO: one onboarding or plan per floor, one review, and chat messages merge into one reply. */
  private enqueueCeo(job: CeoJob) {
    const q = this.state.ceo.queue;
    if (job.kind === 'plan' && q.some((j) => j.kind === 'onboard' && j.repoId === job.repoId)) return; // onboarding plans from the brief too
    const same = q.findIndex((j) => j.kind === job.kind && (job.kind === 'review' || job.kind === 'chat' || (j.repoId === job.repoId && j.prNumber === job.prNumber)));
    if (same >= 0) q[same] = job.kind === 'chat' ? { ...q[same], text: `${q[same].text}\n${job.text}` } : job;
    else q.push(job);
    this.emitCeo();
    this.save();
    setTimeout(() => this.schedule(), 150);
  }

  /** Start the CEO's next job when they're free and a session slot is open. Replies to the manager go first. */
  private startCeoWork(): void {
    const a = this.state.agents.find((x) => x.id === CEO_ID);
    const c = this.state.ceo;
    // A triage whose PR is no longer stuck (the manager stepped in, or it closed) has nothing left to do.
    const stale = c.queue.filter((j) => j.kind === 'triage' && !this.stuckRecord(j));
    if (stale.length) {
      c.queue = c.queue.filter((j) => !stale.includes(j));
      this.emitCeo();
      this.save();
    }
    if (!a || BUSY.includes(a.status) || c.job || c.queue.length === 0) return;
    if (this.slotsFull()) return;
    const rank: Record<CeoJob['kind'], number> = { chat: 0, triage: 0, onboard: 1, plan: 1, review: 2 };
    // A floor's jobs wait for its clone and first sync, so the CEO has something to read.
    const ready = (j: CeoJob) => {
      const rt = j.repoId ? this.repoRt.get(j.repoId) : undefined;
      return !rt || rt.cloneStatus === 'error' || (rt.cloneStatus === 'ready' && rt.lastSync != null);
    };
    const job = [...c.queue].sort((x, y) => rank[x.kind] - rank[y.kind]).find(ready);
    if (!job) return;
    c.queue.splice(c.queue.indexOf(job), 1);
    const rt = job.repoId ? this.repoRt.get(job.repoId) : undefined;
    if (job.repoId && (!rt || rt.cloneStatus === 'error')) {
      const repo = this.state.repos.find((r) => r.id === job.repoId);
      if (repo) this.postMessage('office', `⚠️ ${a.name} couldn't study floor ${repo.floor}: the repository clone failed (${rt?.cloneError ?? 'unknown error'}).`);
      this.emitCeo();
      this.save();
      return this.startCeoWork();
    }
    void this.runCeoJob(a, job);
  }

  private ceoPromptInput(a: PersistedAgent): Parameters<typeof ceoSystemPrompt>[0] {
    const s = this.state.settings;
    return { name: a.name, company: s.companyName, manager: s.managerName, notesFile: path.join(CEO_DIR, 'NOTES.md'), sessionLimit: s.sessionLimit, teamCap: s.teamCap, hiring: s.hiring };
  }

  private async runCeoJob(a: PersistedAgent, job: CeoJob) {
    const rt = this.agentRt.get(a.id)!;
    const floor = this.ceoFloor(job.repoId);
    const label = jobLabel(job, floor);
    this.state.ceo.job = job;
    Object.assign(a, { status: 'working' as AgentStatus, task: null, issueNumber: null, issueTitle: label, startedAt: Date.now(), endedAt: null, costUsd: 0, turns: 0, lastError: null });
    this.appendLog(a, [
      { kind: 'system', text: '' },
      { kind: 'system', text: `━━━ ${label} ━━━` },
    ]);
    if (job.kind === 'chat') this.appendLog(a, [{ kind: 'manager', text: `▶ Manager: ${job.text}` }]);
    if (job.kind === 'review') {
      this.state.ceo.lastReviewAt = Date.now();
      this.state.ceo.lastFingerprint = this.fingerprint();
    }
    this.ceoIssues = new IssueCap(MAX_ISSUES_PER_JOB);
    this.emitAgent(a);
    this.emitCeo();
    this.save();
    await fs.mkdir(CEO_DIR, { recursive: true }).catch(() => undefined);
    const triage = job.kind === 'triage' ? await this.triagePr(job) : null;
    if (a.status !== 'working') {
      // stopped before the session started
      this.state.ceo.job = null;
      if (job.kind === 'triage') this.endTriage(job);
      this.emitCeo();
      return;
    }
    // A chat carries on from the CEO's last session, so "why did you propose that?" has an answer.
    const how = this.sessionRuntime(a, job.kind === 'chat' ? (a.sessionId ?? undefined) : undefined);
    rt.session = this.backend.startSession(
      {
        cwd: CEO_DIR,
        prompt: ceoJobPrompt(job, floor, triage),
        systemAppend: ceoSystemPrompt(this.ceoPromptInput(a)),
        model: a.model || CEO_MODEL,
        effort: a.effort || CEO_EFFORT,
        browserTesting: false,
        additionalDirectories: this.state.repos.filter((r) => this.repoRt.get(r.id)?.cloneStatus === 'ready').map((r) => this.backend.mainDir(r.fullName)),
        role: 'ceo',
        office: this.officeTools(),
        ...how,
      },
      {
        log: (entries) => this.appendLog(a, entries),
        tool: (name) => {
          if (rt.currentTool === name) return;
          rt.currentTool = name;
          this.emitAgent(a);
        },
        sessionId: (id) => {
          a.sessionId = id;
          a.sessionCli = id ? 'claude' : null;
        },
        browserUrl: () => undefined,
        screenshot: () => undefined,
        turn: (text) => this.postMessage('ceo', text),
        limited: (at) => this.pauseForLimit(at),
        usageWarning: (info) => this.paceForWarning(info),
        finished: (result) => this.onCeoFinished(a, result),
      },
    );
  }

  private onCeoFinished(a: PersistedAgent, result: SessionResult) {
    const rt = this.agentRt.get(a.id);
    if (!rt || this.officeUpdate.handedOver) return;
    rt.session = null;
    rt.currentTool = null;
    a.endedAt = Date.now();
    a.costUsd += result.costUsd;
    a.turns += result.turns;
    const job = this.state.ceo.job;
    this.state.ceo.job = null;
    if (job?.kind === 'triage') this.endTriage(job);
    if (result.interrupted) this.interrupted(a);
    if (a.status === 'stopped') {
      // the manager already logged the stop
    } else if (!result.ok) {
      a.status = 'error';
      a.lastError = result.errors.join('; ') || 'Session failed';
      this.appendLog(a, [{ kind: 'error', text: `✗ ${a.lastError}` }]);
      const what = job ? jobLabel(job, this.ceoFloor(job.repoId)).toLowerCase() : 'working';
      this.postMessage('office', `⚠️ ${a.name} hit a problem while ${what}: ${a.lastError.slice(0, 240)}`);
    } else {
      a.status = 'done';
      const filed = this.ceoIssues.total ? ` · ${this.ceoIssues.total} issue${this.ceoIssues.total === 1 ? '' : 's'} filed` : '';
      this.appendLog(a, [{ kind: 'done', text: `✔ Done in ${this.minutes(a)}m · ${a.turns} turns${filed}` }]);
    }
    for (const id of this.ceoIssues.repos) void this.syncRepo(id);
    this.emitAgent(a);
    this.emitCeo();
    this.save();
    setTimeout(() => this.schedule(), 300);
  }

  /** The manager's phone → the CEO. Injected into a running session, otherwise the CEO picks it up next. */
  async messageCeo(text: string) {
    const t = text.trim().slice(0, 4000);
    if (!t) throw new HttpError(400, 'Empty message');
    const a = this.ceo();
    this.postMessage('manager', t);
    const rt = this.agentRt.get(a.id)!;
    if (rt.session) {
      this.appendLog(a, [{ kind: 'manager', text: `▶ Manager: ${t}` }]);
      this.ceoIssues.managerMessage(); // a new request: the issue cap counts from here
      rt.session.send(`Message from the manager (they read your reply on their phone, so keep it short):\n${t}`);
      return;
    }
    this.enqueueCeo({ kind: 'chat', text: t, at: Date.now() });
  }

  requestReview() {
    if (this.state.repos.length === 0) throw new HttpError(400, 'Connect a repo first: the CEO needs a floor to review.');
    this.enqueueCeo({ kind: 'review', at: Date.now() });
  }

  onboardFloor(repoId: string) {
    const repo = this.repo(repoId);
    this.enqueueCeo({ kind: 'onboard', repoId: repo.id, at: Date.now() });
  }

  /** The manager hands the CEO a brief for a floor; the CEO turns it into issues and a team. */
  planFloor(repoId: string, mission?: string) {
    const repo = this.repo(repoId);
    if (typeof mission === 'string') {
      repo.mission = mission.trim().slice(0, 4000);
      this.emitRepo(repo);
    }
    if (!repo.mission) throw new HttpError(400, 'Write a brief first: what should this floor build?');
    this.enqueueCeo({ kind: 'plan', repoId: repo.id, at: Date.now() });
  }

  /** Everything the heartbeat cares about. When it hasn't changed since the last review, the review is skipped. */
  private fingerprint() {
    const data = {
      repos: this.state.repos.map((r) => {
        const rt = this.repoRt.get(r.id);
        return [r.id, r.mission, r.summary, rt?.issues.map((i) => i.number), rt?.pulls.filter((p) => p.state === 'OPEN').map((p) => p.number)];
      }),
      agents: this.state.agents.filter((a) => a.role !== 'ceo').map((a) => [a.id, FREE.includes(a.status) ? 'free' : a.status]),
      qa: this.state.qa.map((q) => [q.repoId, q.prNumber, q.status]),
      requests: this.state.requests.filter((r) => r.status === 'pending').map((r) => r.id),
    };
    return crypto.createHash('sha1').update(JSON.stringify(data)).digest('hex');
  }

  private maybeHeartbeat() {
    const min = this.state.settings.ceoHeartbeatMin;
    const c = this.state.ceo;
    if (!min || this.state.repos.length === 0 || c.job?.kind === 'review' || c.queue.some((j) => j.kind === 'review')) return;
    if (Date.now() < (c.lastReviewAt ?? 0) + min * 60_000) return;
    if (this.fingerprint() === c.lastFingerprint) {
      c.lastReviewAt = Date.now(); // nothing changed since the last review
      this.emitCeo();
      this.save();
      return;
    }
    this.enqueueCeo({ kind: 'review', at: Date.now() });
  }

  // ---------- triage ----------

  /**
   * A PR the office can't move on its own (needs-human): the CEO triages it first, at most MAX_TRIAGES times, and the
   * manager hears when the CEO escalates or takes no action, or when it keeps getting stuck. True: it went to the CEO.
   */
  private stuck(rec: QaRecord, patch: Partial<QaRecord>, why: string): boolean {
    if (!this.state.qa.includes(rec)) return false; // its PR closed: nothing is stuck
    this.setQa(rec, { ...patch, status: 'needs-human', stuckWhy: why });
    const step = triageStep({ kind: 'stuck', triages: rec.triages });
    if (step.do !== 'triage') {
      this.escalate(rec, step.do === 'escalate' ? step.note : null);
      return false;
    }
    rec.triages += 1;
    this.enqueueCeo({ kind: 'triage', repoId: rec.repoId, prNumber: rec.prNumber, at: Date.now() });
    this.setQa(rec, {}); // the card shows the CEO looking
    return true;
  }

  /** Tell the manager a stuck PR needs them, once each time it gets stuck. note: what the CEO adds. */
  private escalate(rec: QaRecord, note: string | null) {
    if (rec.status !== 'needs-human' || rec.escalated) return;
    this.setQa(rec, { escalated: true });
    const repo = this.state.repos.find((r) => r.id === rec.repoId);
    if (repo) this.postMessage('office', `⚠️ PR #${rec.prNumber} on ${repo.fullName} needs you: ${rec.stuckWhy ?? 'it is stuck'}.${note ? ` ${note}` : ''}`);
  }

  /** The CEO's triage job for this PR, queued or running. */
  private triageJob(q: Pick<QaRecord, 'repoId' | 'prNumber'>) {
    const c = this.state.ceo;
    return [c.job, ...c.queue].find((j) => j?.kind === 'triage' && j.repoId === q.repoId && j.prNumber === q.prNumber) ?? null;
  }

  /** The record a triage job is for, while it is still waiting on a decision. */
  private stuckRecord(job: CeoJob) {
    return this.state.qa.find((q) => q.repoId === job.repoId && q.prNumber === job.prNumber && q.status === 'needs-human' && !q.escalated);
  }

  /** What a triage job's prompt says about its PR: the QA record and GitHub's view of it now. null: no longer stuck. */
  private async triagePr(job: CeoJob): Promise<TriagePr | null> {
    const rec = this.stuckRecord(job);
    const repo = this.state.repos.find((r) => r.id === job.repoId);
    if (!rec || !repo) return null;
    const listed = this.repoRt.get(repo.id)?.pulls.find((p) => p.number === rec.prNumber);
    const pr = await this.backend.prDetails(repo.fullName, rec.prNumber).catch(() => null);
    if ((pr ?? listed)?.state !== 'OPEN') return null;
    return {
      number: rec.prNumber,
      title: pr?.title ?? listed?.title ?? '',
      url: pr?.url ?? listed?.url ?? '',
      round: rec.round,
      why: rec.stuckWhy,
      summary: rec.summary,
      fixInstructions: rec.fixInstructions,
      mergeNote: rec.mergeNote,
      checks: pr?.checks ?? listed?.checks ?? 'none',
      failedChecks: pr?.failedChecks ?? listed?.failedChecks.map((c) => c.name) ?? [],
      pendingChecks: pr?.pendingChecks ?? listed?.pendingChecks ?? [],
      mergeable: pr?.mergeable ?? listed?.mergeable ?? 'UNKNOWN',
      mergeState: pr?.mergeState ?? listed?.mergeState ?? 'UNKNOWN',
      triage: rec.triages,
    };
  }

  /** A triage job ended (done, failed or stopped): a PR still waiting on a decision goes to the manager. */
  private endTriage(job: CeoJob) {
    const rec = this.stuckRecord(job);
    const pull = rec && this.repoRt.get(rec.repoId)?.pulls.find((p) => p.number === rec.prNumber);
    const step = triageStep({ kind: 'ended', acted: !rec || (pull != null && pull.state !== 'OPEN') }); // a closed PR leaves QA on the next sync
    if (rec && step.do === 'escalate') this.escalate(rec, step.note);
  }

  /** The stuck PR a triage tool names; refused unless it is on the current triage job's floor (see checkTriageTarget). */
  private async triageTarget(x: { floor: number; pr: number }) {
    const job = this.state.ceo.job;
    const jobFloor = job?.kind === 'triage' ? (this.state.repos.find((r) => r.id === job.repoId)?.floor ?? null) : null;
    const repo = this.state.repos.find((r) => r.floor === x.floor);
    const pr = Number(x.pr);
    const listed = repo ? this.repoRt.get(repo.id)?.pulls.find((p) => p.number === pr) : undefined;
    // The last sync may be a minute old and doesn't list closed PRs: ask GitHub about this one.
    const pull = repo && x.floor === jobFloor ? await this.backend.prDetails(repo.fullName, pr).catch(() => listed) : listed;
    const rec = repo ? this.state.qa.find((q) => q.repoId === repo.id && q.prNumber === pr) : undefined;
    checkTriageTarget({ jobFloor, floor: x.floor, pr, pull, status: rec?.status });
    return { repo: repo!, rec: rec!, listed };
  }

  private async triageRetryQa(x: { floor: number; pr: number }) {
    const { repo, rec } = await this.triageTarget(x);
    await this.sendToQa(repo.id, rec.prNumber);
    return `PR #${rec.prNumber} is queued for QA round ${rec.round}.`;
  }

  private async triageSendBack(x: { floor: number; pr: number; note: string }) {
    const { repo, rec } = await this.triageTarget(x);
    const note = String(x.note ?? '').trim();
    if (!note) throw new HttpError(400, 'Say what the developer should do: the note goes with the fix.');
    await this.sendBackToDev(repo.id, rec.prNumber, note, `${this.ceo().name}, the CEO`);
    return `PR #${rec.prNumber} goes back to a developer with QA's findings and your note.`;
  }

  private async triageRerunChecks(x: { floor: number; pr: number }) {
    const { repo, rec, listed } = await this.triageTarget(x);
    const runIds = failedRunIds(listed?.failedChecks ?? []);
    if (!listed || !runIds.length) {
      const failed = listed?.failedChecks.map((c) => c.name) ?? [];
      throw new HttpError(409, `PR #${rec.prNumber} has no failed GitHub Actions runs to re-run${failed.length ? ` (${failed.join(', ')} can't be re-run from here)` : ''}.`);
    }
    await this.backend.rerunFailedJobs(repo.fullName, runIds);
    const runs = `${runIds.length} failed run${runIds.length === 1 ? '' : 's'}`;
    if (rec.passedSha && rec.passedSha === listed.headSha) {
      // QA signed off on this commit: the merge gate waits for the re-run and merges if it goes green.
      this.setQa(rec, { status: 'passed', rerunSha: listed.headSha, rerunAt: Date.now(), pendingSince: null, mergeNote: 're-running a failed check' });
      return `Re-running ${runs} on PR #${rec.prNumber}. QA passed this commit, so it merges if they go green.`;
    }
    await this.sendToQa(repo.id, rec.prNumber);
    return `Re-running ${runs} on PR #${rec.prNumber}, and it is queued for QA round ${rec.round}.`;
  }

  private async triageClosePull(x: { floor: number; pr: number; comment: string }) {
    const { repo, rec, listed } = await this.triageTarget(x);
    const comment = String(x.comment ?? '').trim();
    if (!comment) throw new HttpError(400, 'Say why the pull request is closing: the comment is posted on it.');
    const issues = listed ? issuesResolvedBy(listed) : [];
    const ceo = this.ceo().name;
    await this.backend.commentPull(repo.fullName, rec.prNumber, `${comment}\n\n<sub>Closed by ${ceo}, the cubefarm CEO, after triage.${issues.length ? ' Its issue stays open, so it is built again.' : ''}</sub>`);
    // Closing deletes no branch and leaves the issue open, so the scheduler hands it out again.
    await this.backend.closePull(repo.fullName, rec.prNumber);
    this.postMessage('office', `🗂️ ${ceo} closed PR #${rec.prNumber} on floor ${repo.floor}: ${comment.split('\n')[0].slice(0, 200)}`);
    this.dropRecord(repo, rec.prNumber);
    this.learnPull(repo, { number: rec.prNumber, headRefName: listed?.headRefName ?? '', closesIssues: listed?.closesIssues ?? [] }, 'CLOSED', true); // built again
    void this.syncRepo(repo.id);
    return `Closed PR #${rec.prNumber}.${issues.length ? ` ${issues.map((n) => `#${n}`).join(', ')} stay${issues.length === 1 ? 's' : ''} open, so a developer builds it again.` : ''}`;
  }

  private async triageEscalate(x: { floor: number; pr: number; reason: string }) {
    const { rec } = await this.triageTarget(x);
    const step = triageStep({ kind: 'escalate', reason: String(x.reason ?? '').split('\n')[0].slice(0, 300) });
    if (step.do === 'escalate') this.escalate(rec, step.note && `${this.ceo().name}: ${step.note}`);
    return `The manager has PR #${rec.prNumber} now, with your diagnosis.`;
  }

  // ---------- idle desks ----------

  private bootAt = Date.now();
  private deskWatch = new Map<string, { busyAt: number | null; trimmedAt: number | null }>(); // desk → what the sweeps saw
  private trimming = false;

  /** An agent's desk is in use: a task (preparing, working, testing or fixing) or a live CLI in their terminal. Hands off a fired agent's. */
  private deskBusy(a: PersistedAgent) {
    const rt = this.agentRt.get(a.id);
    return !rt || !this.state.agents.includes(a) || BUSY.includes(a.status) || !!rt.session || !!rt.terminal?.live;
  }

  /**
   * Free disk space on desks idle longer than settings.trimIdleDesksMin: every agent's desk, and each floor's preview
   * worktree while no preview runs. One desk at a time, once per idle stretch; one phone message per sweep that freed anything.
   */
  private async trimIdleDesks() {
    const min = this.state.settings.trimIdleDesksMin;
    if (!min || this.trimming) return;
    this.trimming = true;
    try {
      const now = Date.now();
      const desks: { key: string; repo: PersistedRepo; slug: string; endedAt: number | null; busy: () => boolean }[] = [];
      for (const a of this.state.agents) {
        const repo = this.state.repos.find((r) => r.id === a.repoId);
        if (repo) desks.push({ key: a.id, repo, slug: this.agentSlug(a), endedAt: a.endedAt, busy: () => this.deskBusy(a) });
      }
      for (const repo of this.state.repos) {
        desks.push({ key: `preview:${repo.id}`, repo, slug: PREVIEW_SLUG, endedAt: null, busy: () => !this.state.repos.includes(repo) || this.previews.active(repo) });
      }
      for (const key of this.deskWatch.keys()) if (!desks.some((d) => d.key === key)) this.deskWatch.delete(key);
      const seen = desks.map((d) => {
        const w = this.deskWatch.get(d.key) ?? { busyAt: null, trimmedAt: null };
        this.deskWatch.set(d.key, w);
        const busy = d.busy();
        if (busy) w.busyAt = now;
        return { key: d.key, busy, idleSince: idleSince(d.endedAt, w.busyAt, this.bootAt), trimmedAt: w.trimmedAt };
      });
      const due = new Set(desksToTrim(seen, min, now));
      let freed = 0;
      let count = 0;
      for (const d of desks.filter((x) => due.has(x.key))) {
        // Asked again inside the repo lock: a task that started since is never pulled out from under its agent.
        const result = await this.backend.trimDesk(d.repo.fullName, d.slug, () => !d.busy()).catch((err) => {
          console.warn(`could not trim desk ${d.slug} of ${d.repo.fullName}:`, oneLine(err));
          return undefined;
        });
        if (result === undefined) continue;
        // Folders Windows still had locked are tried again at the next sweep.
        if (!result?.skipped.length) this.deskWatch.get(d.key)!.trimmedAt = Date.now();
        if (!result?.freed) continue;
        freed += result.freed;
        count++;
        const locked = result.skipped.length ? `; still locked: ${result.skipped.join(', ')}` : '';
        console.log(`trimmed idle desk ${d.slug} of ${d.repo.fullName}: freed ${formatBytes(result.freed)} (${result.removed.join(', ')})${locked}`);
      }
      if (count) this.postMessage('office', freedMessage(freed, count));
    } finally {
      this.trimming = false;
    }
  }

  // ---------- the phone ----------

  private postMessage(from: PhoneMessage['from'], text: string, requestId?: string) {
    const m: PhoneMessage = { id: this.messageSeq++, from, text: text.trim().slice(0, 6000), at: Date.now(), ...(requestId ? { requestId } : {}) };
    const v = this.state.settings.voice;
    if (v.provider !== 'off' && speaks(m, v)) m.voice = v.provider; // what the phone's ▶ replays it with
    this.state.messages.push(m);
    if (this.state.messages.length > KEEP_MESSAGES) this.state.messages.splice(0, this.state.messages.length - KEEP_MESSAGES);
    this.broadcast({ type: 'message', message: m });
    this.save();
    // Proposals are notified as such (proposeHire, proposeLetGo).
    if (from === 'ceo' && !requestId) this.notifier.notify('ceoMessage', this.ceo().name, plainText(m.text), `${this.ceo().name}: ${plainText(m.text, 100)}`);
    return m;
  }

  // ---------- notifications ----------

  private notifyNeedsHuman(rec: QaRecord) {
    const repo = this.state.repos.find((r) => r.id === rec.repoId);
    const title = this.repoRt.get(rec.repoId)?.pulls.find((p) => p.number === rec.prNumber)?.title;
    const name = repo?.fullName.split('/')[1] ?? rec.repoId;
    this.notifier.notify('needsHuman', `PR #${rec.prNumber} needs you`, `${name}${title ? `: ${title}` : ''}. ${rec.stuckWhy ? `Stuck because ${rec.stuckWhy}.` : rec.summary ?? ''}`, `${name} #${rec.prNumber}${title ? ` ${title}` : ''}`);
  }

  private notifyMerge(repo: PersistedRepo, n: number, title: string) {
    const name = repo.fullName.split('/')[1];
    this.notifier.notify('merge', `Merged PR #${n}`, `${name}${title ? `: ${title}` : ''}`, `${name} #${n}${title ? ` ${title}` : ''}`);
  }

  /** Agents stuck in an error for STUCK_ERROR_MS: the manager hears once per error (checked every minute). */
  private notifyStuck() {
    const now = Date.now();
    for (const { agent: a, key } of stuckAgents(this.state.agents, now, this.toldStuck)) {
      this.toldStuck.add(key);
      const repo = this.state.repos.find((r) => r.id === a.repoId);
      const mins = Math.round((now - (a.endedAt ?? now)) / 60_000);
      this.notifier.notify('agentError', `${a.name} needs help`, `In an error for ${mins} minutes${repo ? ` on floor ${repo.floor}` : ''}: ${clip(a.lastError ?? 'their session failed', 200)}`, `${a.name}${repo ? ` (floor ${repo.floor})` : ''}`);
    }
    for (const key of this.toldStuck) if (!this.state.agents.some((a) => key === `${a.id}:${a.endedAt ?? 0}` && a.status === 'error')) this.toldStuck.delete(key);
  }

  markPhoneRead(at: number) {
    const t = Math.min(Number(at) || Date.now(), Date.now());
    if (t <= this.state.phoneReadAt) return;
    this.state.phoneReadAt = t;
    this.broadcast({ type: 'phoneRead', at: t });
    this.save();
  }

  // ---------- hire and let-go proposals ----------

  private addRequest(req: HireRequestView) {
    this.state.requests.push(req);
    const decided = this.state.requests.filter((r) => r.status !== 'pending');
    if (decided.length > KEEP_DECIDED_REQUESTS) {
      const drop = new Set(decided.slice(0, decided.length - KEEP_DECIDED_REQUESTS));
      this.state.requests = this.state.requests.filter((r) => !drop.has(r));
    }
    this.broadcast({ type: 'request', request: req });
    this.save();
  }

  private decide(req: HireRequestView, patch: Pick<HireRequestView, 'status' | 'note' | 'decidedBy'>) {
    Object.assign(req, patch, { decidedAt: Date.now() });
    this.broadcast({ type: 'request', request: req });
    this.save();
  }

  approveRequest(id: string, overrides: { name?: string; model?: string; effort?: string } = {}, by: 'manager' | 'auto' = 'manager') {
    const req = this.state.requests.find((r) => r.id === id);
    if (!req) throw new HttpError(404, 'That proposal no longer exists');
    if (req.status !== 'pending') throw new HttpError(409, `That proposal was already ${req.status}`);
    const repo = this.repo(req.repoId);
    if (req.kind === 'hire') {
      const name = overrides.name?.trim() || req.name;
      const agent = this.hireAgent(repo.id, {
        name,
        role: req.role,
        model: overrides.model ?? req.model,
        effort: overrides.effort ?? req.effort,
        look: name === req.name ? req.look : undefined,
        title: req.title,
        specialty: req.specialty,
        brief: req.brief,
        hiredBy: 'ceo',
        appearance: { color: req.color, hair: req.hair, skin: req.skin },
      });
      req.agentId = agent.id;
      req.name = agent.name;
      this.decide(req, { status: 'approved', note: '', decidedBy: by });
      this.postMessage(
        'office',
        by === 'auto' ? `🤖 Auto-approved: ${agent.name} joined floor ${repo.floor} as ${req.title}.` : `✅ You hired ${agent.name} as ${req.title} on floor ${repo.floor}.`,
        req.id,
      );
      this.toast('success', `${agent.name} (${req.title}) joined floor ${repo.floor}`);
      return;
    }
    const a = req.agentId ? this.state.agents.find((x) => x.id === req.agentId) : undefined;
    this.decide(req, { status: 'approved', note: a ? '' : 'They had already left.', decidedBy: by });
    if (a) {
      try {
        this.fireAgent(a.id);
      } catch (err) {
        this.decide(req, { status: 'pending', note: '', decidedBy: null });
        throw err;
      }
    }
    this.postMessage('office', `👋 ${req.name} left floor ${repo.floor}${by === 'auto' ? ' (auto-approved)' : ''}.`, req.id);
  }

  rejectRequest(id: string, note = '') {
    const req = this.state.requests.find((r) => r.id === id);
    if (!req) throw new HttpError(404, 'That proposal no longer exists');
    if (req.status !== 'pending') throw new HttpError(409, `That proposal was already ${req.status}`);
    this.decide(req, { status: 'rejected', note: note.trim().slice(0, 400), decidedBy: 'manager' });
    const what = req.kind === 'hire' ? `${req.name} (${req.title})` : `letting ${req.name} go`;
    this.postMessage('office', `✋ You declined ${what}${req.note ? `: "${req.note}"` : '.'}`, req.id);
  }

  // ---------- the CEO's office tools ----------

  private floorRepo(floor: number) {
    const r = this.state.repos.find((x) => x.floor === Number(floor));
    if (!r) throw new Error(`There is no floor ${floor}. Floors: ${this.state.repos.map((x) => `${x.floor} (${x.fullName})`).join(', ') || 'none'}.`);
    return r;
  }

  private agentByRef(ref: string) {
    const r = String(ref ?? '').trim().toLowerCase();
    const a = this.state.agents.find((x) => x.id === ref || x.name.toLowerCase() === r);
    if (!a) throw new Error(`No agent "${ref}". Use the ids from company_status.`);
    return a;
  }

  private agentDoing(a: PersistedAgent) {
    return !BUSY.includes(a.status) ? null : a.task === 'qa' ? `testing PR #${a.prNumber}` : a.task === 'fix' ? `fixing PR #${a.prNumber}` : `issue #${a.issueNumber}`;
  }

  private companyStatus() {
    const s = this.state.settings;
    const doing = (a: PersistedAgent) => this.agentDoing(a);
    // Keep the status compact, but make the cut visible so the CEO knows to read agent_detail before rewriting.
    const jobDescription = (brief: string) => {
      if (brief.length <= 400) return brief;
      const mark = `… (truncated, ${brief.length} chars; see agent_detail)`;
      return brief.slice(0, 400 - mark.length).trimEnd() + mark;
    };
    const pending = this.state.requests.filter((r) => r.status === 'pending');
    const seats = (r: PersistedRepo, role: 'dev' | 'qa') =>
      seatCount(
        MAX_DESKS[role],
        this.state.agents.filter((a) => a.repoId === r.id && a.role === role).length,
        pending.filter((p) => p.kind === 'hire' && p.repoId === r.id && p.role === role).length,
      );
    const floors = [...this.state.repos]
      .sort((x, y) => x.floor - y.floor)
      .map((r) => {
        const rt = this.repoRt.get(r.id)!;
        const open = new Set(rt.issues.map((i) => i.number));
        return {
          floor: r.floor,
          repo: r.fullName,
          description: r.description,
          clone: rt.cloneStatus === 'ready' ? this.backend.mainDir(r.fullName) : `(not available: clone ${rt.cloneStatus})`,
          brief: r.mission || null,
          profile: r.summary || null,
          qaBrief: r.qaBrief || null,
          preview: { command: r.preview.command, env: r.preview.env, status: this.previews.view(r).status },
          autoAssign: r.autoAssign,
          autoMerge: r.autoMerge,
          folderSync: rt.folderSync,
          seats: { dev: seats(r, 'dev'), qa: seats(r, 'qa') },
          capacity: {
            developers: this.state.agents.filter((a) => a.repoId === r.id && a.role === 'dev').length,
            developersFree: this.available(r, 'dev').length,
            issuesReadyToStart: this.readyIssues(r).length,
            ...floorCapacity({
              issues: rt.issues,
              inProgress: (n) => this.issueTaken(r, n),
              openPrs: rt.pulls.filter((p) => p.state === 'OPEN').map((p) => p.number),
              qa: this.state.qa.filter((q) => q.repoId === r.id),
            }),
          },
          team: this.state.agents
            .filter((a) => a.repoId === r.id)
            .map((a) => ({
              id: a.id,
              name: a.name,
              role: a.role,
              title: a.title || (a.role === 'qa' ? 'QA tester' : 'Developer'),
              specialty: a.specialty || null,
              status: a.status,
              doing: doing(a),
              hiredBy: a.hiredBy,
              jobDescription: a.brief ? jobDescription(a.brief) : null,
            })),
          backlog: rt.issues.map((i) => ({
            number: i.number,
            title: i.title,
            specialty: issueSpecialty(i.labels) || null,
            waitsFor: blockers(i.body, open),
            inProgress: this.issueTaken(r, i.number),
            ...(this.isHeld(r.id, i.number) ? { waitsForManager: 'its PR was closed; only the manager hands it out again' } : {}),
          })),
          pullRequests: rt.pulls
            .filter((p) => p.state === 'OPEN')
            .map((p) => {
              const q = this.state.qa.find((x) => x.repoId === r.id && x.prNumber === p.number);
              return { number: p.number, title: p.title, qa: q ? `${q.status}${q.round > 1 ? ` (round ${q.round})` : ''}` : 'not tested', merge: q?.mergeNote ?? null, checks: p.checks };
            }),
          mergedRecently: rt.pulls.filter((p) => p.state === 'MERGED').map((p) => `#${p.number} ${p.title}`),
        };
      });
    const req = (r: HireRequestView) => ({
      id: r.id,
      kind: r.kind,
      floor: this.state.repos.find((x) => x.id === r.repoId)?.floor ?? null,
      role: r.role,
      name: r.name,
      title: r.title,
      specialty: r.specialty || null,
      reason: r.reason,
      status: r.status,
      managerNote: r.note || null,
    });
    return JSON.stringify(
      {
        company: {
          ceo: this.ceo().name,
          hiring: s.hiring === 'auto' ? `auto-approved while a floor has fewer than ${s.teamCap} people` : 'the manager approves every proposal',
          teamCap: s.teamCap,
          sessionLimit: s.sessionLimit || 'none',
          sessionsRunning: this.running(),
          usage: usageLabel(this.usageNow(), Date.now()),
          deskLimits: { dev: MAX_DESKS.dev, qa: MAX_DESKS.qa },
          proposalLimit: { pending: pending.length, max: MAX_PENDING_PROPOSALS },
        },
        floors,
        pendingProposals: pending.map(req),
        recentDecisions: this.state.requests.filter((r) => r.status !== 'pending').slice(-10).map(req),
      },
      null,
      1,
    );
  }

  private agentDetail(x: { agent_id: string }) {
    const a = this.agentByRef(x.agent_id);
    const repo = this.state.repos.find((r) => r.id === a.repoId);
    const ceo = a.role === 'ceo';
    return JSON.stringify(
      {
        id: a.id,
        name: a.name,
        floor: repo?.floor ?? null,
        role: a.role,
        title: a.title || (a.role === 'qa' ? 'QA tester' : a.role === 'dev' ? 'Developer' : 'CEO'),
        specialty: a.specialty || null,
        status: a.status,
        doing: this.agentDoing(a),
        issue: a.issueNumber ? { number: a.issueNumber, title: a.issueTitle } : null,
        pullRequest: a.prNumber ? { number: a.prNumber, url: a.prUrl } : null,
        codingAgent: ceo ? 'claude' : a.cli || this.state.settings.defaultCli,
        model: ceo ? a.model || CEO_MODEL : this.modelFor(a, a.cli || this.state.settings.defaultCli) || 'the coding agent default',
        effort: a.effort || (ceo ? CEO_EFFORT : this.state.settings.defaultEffort),
        hiredBy: a.hiredBy,
        jobDescription: a.brief || null,
      },
      null,
      1,
    );
  }

  private setFloorProfile(x: { floor: number; summary?: string; qa_brief?: string; preview_command?: string; preview_env?: Record<string, string> }) {
    const r = this.floorRepo(x.floor);
    const preview = parsePreviewPatch(x.preview_command, x.preview_env);
    if (x.summary !== undefined) r.summary = String(x.summary).trim().slice(0, 140);
    if (x.qa_brief !== undefined) r.qaBrief = String(x.qa_brief).trim().slice(0, 2500);
    r.preview = { ...r.preview, ...preview };
    if (preview.command === null) void this.previews.refreshDefault(r);
    this.emitRepo(r);
    this.save();
    return `Saved floor ${r.floor}'s profile.`;
  }

  private updateJob(x: { agent_id: string; title?: string; specialty?: string; job_description?: string }) {
    const a = this.agentByRef(x.agent_id);
    if (a.role === 'ceo') throw new Error("That's you.");
    this.updateAgent(a.id, { title: x.title, specialty: x.specialty, brief: x.job_description });
    const title = a.title || (a.role === 'qa' ? 'QA tester' : 'Developer');
    this.appendLog(a, [{ kind: 'system', text: `🪪 ${this.ceo().name} updated ${a.name}'s job: ${title}${a.specialty ? ` · swarm:${a.specialty}` : ''}` }]);
    return `Updated ${a.name}: ${title}${a.specialty ? ` (specialty ${a.specialty})` : ''}.`;
  }

  private proposeHire(x: { floor: number; role: 'dev' | 'qa'; title: string; specialty: string; job_description: string; reason: string; model?: string; effort?: string }) {
    const repo = this.floorRepo(x.floor);
    const role = x.role === 'qa' ? 'qa' : 'dev';
    const title = String(x.title ?? '').trim().slice(0, 60);
    if (!title) throw new Error('A hire needs a job title.');
    const specialty = specialtySlug(x.specialty);
    const pending = this.state.requests.filter((r) => r.status === 'pending');
    checkPendingLimit(pending.length);
    const dup =pending.find((r) => r.kind === 'hire' && r.repoId === repo.id && r.role === role && r.specialty === specialty);
    if (dup) throw new Error(`${dup.name} (${dup.title}) is already proposed for floor ${repo.floor} with that specialty.`);
    const seated = this.state.agents.filter((a) => a.repoId === repo.id && a.role === role).length;
    const waiting = pending.filter((r) => r.kind === 'hire' && r.repoId === repo.id && r.role === role).length;
    if (seated + waiting >= MAX_DESKS[role]) throw new Error(role === 'qa' ? `The QA lab on floor ${repo.floor} is full.` : `Floor ${repo.floor} has no free desks.`);
    const name = this.freeName(role);
    const req: HireRequestView = {
      id: crypto.randomUUID(),
      kind: 'hire',
      repoId: repo.id,
      role,
      agentId: null,
      name,
      title,
      specialty,
      brief: String(x.job_description ?? '').trim().slice(0, 2500),
      reason: String(x.reason ?? '').trim().slice(0, 600),
      model: String(x.model ?? '').trim(),
      effort: EFFORTS.includes(x.effort as EffortLevel) ? (x.effort as EffortLevel) : '',
      look: lookFor(name),
      color: pick(SHIRTS),
      hair: pick(HAIR),
      skin: pick(SKIN),
      status: 'pending',
      note: '',
      createdAt: Date.now(),
      decidedAt: null,
      decidedBy: null,
    };
    this.addRequest(req);
    const s = this.state.settings;
    if (s.hiring === 'auto' && this.state.agents.filter((a) => a.repoId === repo.id).length < s.teamCap) {
      this.approveRequest(req.id, {}, 'auto');
      return `Hired ${req.name} as ${title} on floor ${repo.floor} (auto-approved; agent id ${req.agentId}).`;
    }
    this.postMessage('ceo', `📄 New candidate for floor ${repo.floor}: ${name}, ${title}. ${req.reason}`, req.id);
    this.notifier.notify('hire', `New candidate for floor ${repo.floor}`, `${name}, ${title}. ${plainText(req.reason)}`, `${name}, ${title} (floor ${repo.floor})`);
    return `Proposed ${name} as ${title} on floor ${repo.floor}. The manager will approve or decline (request ${req.id}).`;
  }

  private proposeLetGo(x: { agent_id: string; reason: string }) {
    const a = this.agentByRef(x.agent_id);
    if (a.role === 'ceo') throw new Error("You can't let yourself go.");
    const repo = this.repo(a.repoId);
    if (a.role === 'qa' && this.state.agents.filter((y) => y.repoId === repo.id && y.role === 'qa').length <= 1) {
      throw new Error(`${a.name} is floor ${repo.floor}'s only QA tester, and every floor keeps one.`);
    }
    const pending = this.state.requests.filter((r) => r.status === 'pending');
    if (pending.some((r) => r.kind === 'let-go' && r.agentId === a.id)) throw new Error(`Letting ${a.name} go is already proposed.`);
    checkPendingLimit(pending.length);
    const req: HireRequestView = {
      id: crypto.randomUUID(),
      kind: 'let-go',
      repoId: repo.id,
      role: a.role,
      agentId: a.id,
      name: a.name,
      title: a.title || (a.role === 'qa' ? 'QA tester' : 'Developer'),
      specialty: a.specialty,
      brief: a.brief,
      reason: String(x.reason ?? '').trim().slice(0, 600),
      model: a.model,
      effort: a.effort,
      look: a.look,
      color: a.color,
      hair: a.hair,
      skin: a.skin,
      status: 'pending',
      note: '',
      createdAt: Date.now(),
      decidedAt: null,
      decidedBy: null,
    };
    this.addRequest(req);
    if (this.state.settings.hiring === 'auto' && FREE.includes(a.status)) {
      this.approveRequest(req.id, {}, 'auto');
      return `Let ${a.name} go (auto-approved).`;
    }
    this.postMessage('ceo', `👋 I suggest letting ${a.name} (${req.title}, floor ${repo.floor}) go. ${req.reason}`, req.id);
    this.notifier.notify('hire', `Let ${a.name} go?`, `${this.ceo().name} suggests letting ${a.name} (${req.title}, floor ${repo.floor}) go. ${plainText(req.reason)}`, `let ${a.name} go (floor ${repo.floor})`);
    return `Proposed letting ${a.name} go. The manager will decide (request ${req.id}).`;
  }

  private async fileIssue(x: { floor: number; title: string; body: string; specialty?: string }) {
    const repo = this.floorRepo(x.floor);
    this.ceoIssues.check();
    const title = String(x.title ?? '').trim().slice(0, 120);
    if (!title) throw new Error('An issue needs a title.');
    const slug = specialtySlug(x.specialty);
    const body = `${String(x.body ?? '').trim()}\n\n---\n_Filed by ${this.ceo().name}, the cubefarm CEO._`;
    const n = await this.backend.createIssue(repo.fullName, title, body, slug ? [specialtyLabel(slug)] : []);
    this.ceoIssues.record(repo.id);
    return `Filed #${n} on floor ${repo.floor}: ${title}${slug ? ` (routed to ${slug})` : ''}.`;
  }

  /** Change an open issue's specialty and/or dependencies (see planRoute for what is refused). */
  private async routeIssue(x: { floor: number; number: number; specialty?: string; depends_on?: number[] }) {
    const repo = this.floorRepo(x.floor);
    const issues = this.repoRt.get(repo.id)?.issues ?? [];
    const asked = [Number(x.number), ...(x.depends_on ?? []).map(Number)].filter((n) => !issues.some((i) => i.number === n));
    const states = new Map(await Promise.all([...new Set(asked)].map(async (n) => [n, await this.backend.issueState(repo.fullName, n).catch(() => null)] as const)));
    const specialties = [
      ...this.state.agents.filter((a) => a.repoId === repo.id && a.specialty).map((a) => a.specialty.toLowerCase()),
      ...this.state.requests.filter((r) => r.status === 'pending' && r.kind === 'hire' && r.repoId === repo.id && r.specialty).map((r) => r.specialty),
    ];
    const plan = planRoute({
      floor: repo.floor,
      number: Number(x.number),
      specialty: x.specialty,
      dependsOn: x.depends_on,
      issues,
      closed: (n) => states.get(n) === 'CLOSED',
      inProgress: this.issueTaken(repo, Number(x.number)),
      specialties,
    });
    if (plan.body !== null || plan.addLabels.length || plan.removeLabels.length) {
      await this.backend.editIssue(repo.fullName, Number(x.number), { body: plan.body ?? undefined, addLabels: plan.addLabels, removeLabels: plan.removeLabels });
      await this.syncRepo(repo.id); // the scheduler sees the new routing right away
    }
    return plan.summary;
  }

  /** Close an open issue as not planned, with the CEO's reason as its comment (see checkCloseIssue for what is refused). */
  private async closeIssue(x: { floor: number; number: number; reason: string }) {
    const repo = this.floorRepo(x.floor);
    const n = Number(x.number);
    const rt = this.repoRt.get(repo.id);
    const reason = String(x.reason ?? '').trim().slice(0, 1000);
    if (!reason) throw new HttpError(400, 'Say why the issue is closing: the reason is posted on it as a comment.');
    const state = rt?.issues.some((i) => i.number === n) ? 'OPEN' : await this.backend.issueState(repo.fullName, n).catch(() => null);
    checkCloseIssue({ floor: repo.floor, number: n, state, pulls: rt?.pulls ?? [] });
    await this.backend.closeIssue(repo.fullName, n, reason, 'not planned');
    this.postMessage('office', `🗂️ ${this.ceo().name} closed #${n} on floor ${repo.floor}: ${reason.split('\n')[0].slice(0, 200)}`);
    const stopped = this.learnIssueClosed(repo, n); // off the Kanban, out of the scheduler's queue, and whoever was on it stops
    await this.syncRepo(repo.id);
    return `Closed #${n} on floor ${repo.floor} as not planned.${stopped.length ? ` ${nameList(stopped)} stopped working on it.` : ''}`;
  }
}
