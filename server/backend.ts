import * as github from './github.ts';
import * as workspace from './workspace.ts';
import { startSession, type SessionCallbacks, type SessionHandle, type SessionOptions } from './agentRunner.ts';
import { hooksReady, officeProcesses, reconnectClis, releaseClis, startCliSession, terminalsAvailable, type ReconnectedCli } from './cliRunner.ts';
import { detectClis } from './clis.ts';
import { installDesk, type DepsCallbacks, type DepsOutcome } from './deps.ts';
import { realPreviews, type PreviewBackend } from './previewRunner.ts';
import { realOffice, type OfficeHost } from './officeUpdate.ts';
import { elevenLabs } from './elevenlabs.ts';
import { httpTransport, type NotifyTransport } from './notifier.ts';
import type { VoiceApi } from './voice.ts';
import type { AgentTerminal } from './terminal.ts';
import type { OpsHistory } from './metrics.ts';
import type { UsageWarning } from './pacing.ts';
import type { CliView, GhRepoSummary, IssueInfo, PullInfo } from '../shared/types.ts';

/** A made-up candidate the demo CEO proposes: the propose_hire tool's arguments, bar the floor and role. */
export interface DemoHire {
  title: string;
  specialty: string;
  job_description: string;
  reason: string;
}

/** Everything the swarm needs from the outside world. The demo backend fakes all of it. */
export interface Backend {
  demo: boolean;
  /** Demo only: a made-up developer for this floor whose specialty isn't in `taken`; null once they've all been used. */
  demoCandidate?(fullName: string, taken: readonly string[]): DemoHire | null;
  user(): Promise<string>;
  listMyRepos(owner?: string): Promise<GhRepoSummary[]>;
  repoMeta(fullName: string): Promise<github.RepoMeta>;
  listIssues(fullName: string): Promise<IssueInfo[]>;
  listPulls(fullName: string): Promise<PullInfo[]>;
  createIssue(fullName: string, title: string, body: string, labels?: string[]): Promise<number>;
  /** OPEN or CLOSED; null when there is no such issue. */
  issueState(fullName: string, number: number): Promise<'OPEN' | 'CLOSED' | null>;
  editIssue(fullName: string, number: number, edit: { body?: string; addLabels?: string[]; removeLabels?: string[] }): Promise<void>;
  /** Close an issue with a comment, as completed unless `reason` says not planned. */
  closeIssue(fullName: string, number: number, comment: string, reason?: 'completed' | 'not planned'): Promise<void>;
  mergePull(fullName: string, number: number, method: 'squash' | 'merge' | 'rebase', headSha?: string): Promise<void>;
  updateBranch(fullName: string, number: number): Promise<void>;
  /** The failed steps' log of a GitHub Actions run, for a checks fix. */
  failedRunLog(fullName: string, runId: string): Promise<string>;
  /** Re-run the failed jobs of these GitHub Actions runs. */
  rerunFailedJobs(fullName: string, runIds: number[]): Promise<void>;
  closePull(fullName: string, number: number): Promise<void>;
  prForBranch(fullName: string, branch: string): Promise<{ number: number; url: string } | null>;
  prDetails(fullName: string, number: number): Promise<github.PrDetails>;
  /** createdAt: when it was filed (absent when the demo no longer knows). */
  issueDetails(fullName: string, number: number): Promise<{ title: string; body: string; createdAt?: string }>;
  commentPull(fullName: string, number: number, body: string): Promise<string>;
  uploadEvidence(fullName: string, filePath: string, data: Buffer): Promise<string>;
  ensureClone(fullName: string): Promise<void>;
  /** Fast-forward the floor's main checkout to GitHub when that is safe; returns how it stands. */
  syncMain(fullName: string, defaultBranch: string, opts: { touch: boolean }): Promise<workspace.MainSync | null>;
  /** Point a floor at the user's own project folder (null: a clone the office manages). */
  setLocalPath(fullName: string, dir: string | null): void;
  scanProjects(root: string): Promise<workspace.LocalFolder[]>;
  inspectFolder(dir: string): Promise<workspace.LocalFolder>;
  publishFolder(dir: string, opts: { name: string; visibility: 'private' | 'public'; owner?: string; description?: string }): Promise<string>;
  createProject(root: string, name: string, opts: { visibility: 'private' | 'public'; owner?: string; description?: string }): Promise<{ fullName: string; path: string }>;
  mainDir(fullName: string): string;
  deskDir(fullName: string, agentSlug: string): string;
  /** `note` hears why the desk couldn't be reused in place, when it has to be rebuilt. */
  prepareDesk(fullName: string, base: workspace.DeskBase, agentSlug: string, branch: string, note?: (text: string) => void): Promise<string>;
  /** npm ci in a prepared desk unless nothing changed since the last one; never throws (see deps.ts installDesk). */
  installDeps(dir: string, cb: DepsCallbacks): Promise<DepsOutcome>;
  /** `main`: the floor's checkout as it was when the desk was let go (default: mainDir now). */
  removeDesk(fullName: string, agentSlug: string, main?: string): Promise<void>;
  /** Remove desks, stray desk folders and finished swarm/qa branches nothing in `keep` uses. */
  sweepDesks(fullName: string, keep: workspace.SweepKeep): Promise<workspace.SweepResult>;
  /** Free disk space on an idle desk (node_modules, build output); null when it doesn't exist or `stillIdle` says no. */
  trimDesk(fullName: string, agentSlug: string, stillIdle: () => boolean): Promise<workspace.DeskTrim | null>;
  /** Stop processes an agent left running (dev servers on its port, anything started in its desk). */
  releaseDesk(fullName: string, agentSlug: string, port: number): Promise<void>;
  /** An agent session: the real CLI in the agent's terminal when opts.terminal is set, else an Agent SDK session. */
  startSession(opts: SessionOptions, cb: SessionCallbacks): SessionHandle;
  /** Terminals can run here (the native pseudo-terminal module loaded). */
  terminals: boolean;
  /** The office started: the CLIs its terminal keeper kept running through a restart, back in their agents' terminals. */
  reconnectClis(terminalFor: (agentId: string) => AgentTerminal | null): Promise<ReconnectedCli[]>;
  /** The office follows those CLIs' sessions again: hooks that waited for it can come in. */
  hooksReady(): void;
  /** The office is stopping: its CLIs carry on in the keeper through a restart (true), or stop with it. */
  releaseClis(restart: boolean): Promise<void>;
  /** The coding-agent CLIs installed on this machine. */
  detectClis(): Promise<CliView[]>;
  /** Run a floor's app for the preview monitor (its own worktree, its own port). */
  previews: PreviewBackend;
  /** The running office's own folder and its launcher, for the office's self-update. */
  office: OfficeHost;
  /** Text to speech for the manager's phone (ElevenLabs). */
  voice: VoiceApi;
  /** Notifications to the chat apps and push services (docs/pocket.md). */
  notify: NotifyTransport;
  /** The demo only: a made-up past week for mission control, so a fresh demo office has numbers from the start. */
  seedOps?(repos: string[], now: number): OpsHistory;
  /** The demo only: Claude's usage warning, or its limit, on demand, as a session would report it. */
  simulateUsage?(kind: 'warning' | 'limit', now: number): UsageWarning | { limitResetsAt: number };
}

export const realBackend: Backend = {
  demo: false,
  user: github.currentUser,
  listMyRepos: github.listMyRepos,
  repoMeta: github.repoMeta,
  listIssues: github.listIssues,
  listPulls: github.listPulls,
  createIssue: github.createIssue,
  issueState: github.issueState,
  editIssue: github.editIssue,
  closeIssue: github.closeIssue,
  mergePull: github.mergePull,
  updateBranch: github.updateBranch,
  failedRunLog: github.failedRunLog,
  rerunFailedJobs: github.rerunFailedJobs,
  closePull: github.closePull,
  prForBranch: github.prForBranch,
  prDetails: github.prDetails,
  issueDetails: github.issueDetails,
  commentPull: github.commentPull,
  uploadEvidence: github.uploadEvidence,
  ensureClone: workspace.ensureClone,
  syncMain: workspace.syncMain,
  setLocalPath: workspace.setLocalPath,
  scanProjects: workspace.scanProjects,
  inspectFolder: workspace.inspectFolder,
  publishFolder: workspace.publishFolder,
  createProject: workspace.createProject,
  mainDir: workspace.mainDir,
  deskDir: workspace.deskDir,
  prepareDesk: workspace.prepareDesk,
  installDeps: (dir, cb) => installDesk(dir, cb),
  removeDesk: workspace.removeDesk,
  sweepDesks: workspace.sweepDesks,
  trimDesk: workspace.trimDesk,
  releaseDesk: (fullName, agentSlug, port) => workspace.releaseDesk(fullName, agentSlug, port, officeProcesses()),
  startSession: (opts, cb) => (opts.terminal ? startCliSession(opts, cb) : startSession(opts, cb)),
  terminals: terminalsAvailable,
  reconnectClis: (terminalFor) => (terminalsAvailable ? reconnectClis(terminalFor) : Promise.resolve([])),
  hooksReady,
  releaseClis,
  detectClis,
  previews: realPreviews,
  office: realOffice,
  voice: elevenLabs,
  notify: httpTransport,
};
