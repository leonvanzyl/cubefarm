import * as github from './github.ts';
import * as workspace from './workspace.ts';
import { startSession, type SessionCallbacks, type SessionHandle, type SessionOptions } from './agentRunner.ts';
import { realPreviews, type PreviewBackend } from './previewRunner.ts';
import type { GhRepoSummary, IssueInfo, PullInfo } from '../shared/types.ts';

/** Everything the swarm needs from the outside world. The demo backend fakes all of it. */
export interface Backend {
  demo: boolean;
  user(): Promise<string>;
  listMyRepos(owner?: string): Promise<GhRepoSummary[]>;
  repoMeta(fullName: string): Promise<github.RepoMeta>;
  listIssues(fullName: string): Promise<IssueInfo[]>;
  listPulls(fullName: string): Promise<PullInfo[]>;
  createIssue(fullName: string, title: string, body: string, labels?: string[]): Promise<number>;
  mergePull(fullName: string, number: number, method: 'squash' | 'merge' | 'rebase'): Promise<void>;
  closePull(fullName: string, number: number): Promise<void>;
  prForBranch(fullName: string, branch: string): Promise<{ number: number; url: string } | null>;
  prDetails(fullName: string, number: number): Promise<github.PrDetails>;
  issueDetails(fullName: string, number: number): Promise<{ title: string; body: string }>;
  commentPull(fullName: string, number: number, body: string): Promise<string>;
  uploadEvidence(fullName: string, filePath: string, data: Buffer): Promise<string>;
  ensureClone(fullName: string): Promise<void>;
  /** Point a floor at the user's own project folder (null: a clone the office manages). */
  setLocalPath(fullName: string, dir: string | null): void;
  scanProjects(root: string): Promise<workspace.LocalFolder[]>;
  inspectFolder(dir: string): Promise<workspace.LocalFolder>;
  publishFolder(dir: string, opts: { name: string; visibility: 'private' | 'public'; owner?: string; description?: string }): Promise<string>;
  createProject(root: string, name: string, opts: { visibility: 'private' | 'public'; owner?: string; description?: string }): Promise<{ fullName: string; path: string }>;
  mainDir(fullName: string): string;
  deskDir(fullName: string, agentSlug: string): string;
  prepareDesk(fullName: string, base: workspace.DeskBase, agentSlug: string, branch: string): Promise<string>;
  removeDesk(fullName: string, agentSlug: string): Promise<void>;
  /** Stop processes an agent left running (dev servers on its port, anything started in its desk). */
  releaseDesk(fullName: string, agentSlug: string, port: number): Promise<void>;
  startSession(opts: SessionOptions, cb: SessionCallbacks, defaultBranch: string): SessionHandle;
  /** Run a floor's app for the preview monitor (its own worktree, its own port). */
  previews: PreviewBackend;
}

export const realBackend: Backend = {
  demo: false,
  user: github.currentUser,
  listMyRepos: github.listMyRepos,
  repoMeta: github.repoMeta,
  listIssues: github.listIssues,
  listPulls: github.listPulls,
  createIssue: github.createIssue,
  mergePull: github.mergePull,
  closePull: github.closePull,
  prForBranch: github.prForBranch,
  prDetails: github.prDetails,
  issueDetails: github.issueDetails,
  commentPull: github.commentPull,
  uploadEvidence: github.uploadEvidence,
  ensureClone: workspace.ensureClone,
  setLocalPath: workspace.setLocalPath,
  scanProjects: workspace.scanProjects,
  inspectFolder: workspace.inspectFolder,
  publishFolder: workspace.publishFolder,
  createProject: workspace.createProject,
  mainDir: workspace.mainDir,
  deskDir: workspace.deskDir,
  prepareDesk: workspace.prepareDesk,
  removeDesk: workspace.removeDesk,
  releaseDesk: workspace.releaseDesk,
  startSession,
  previews: realPreviews,
};
