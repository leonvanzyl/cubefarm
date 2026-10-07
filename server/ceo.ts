import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { blockers, holdUps, setDependsOn } from '../shared/issues.ts';
import { FLOOR_SEATS, type AgentCli, type CeoJobKind, type QaStatus } from '../shared/types.ts';
import { HttpError } from './httpError.ts';
import { ONE_TURN } from './prompts.ts';
import { MAX_TRIAGES, type TriagePr } from './triage.ts';

// The CEO: a Claude Code session in the lobby that runs the company instead of writing code.
// It studies each floor's repo, sizes its team of interchangeable agents from its throughput (team changes the
// manager approves, or that apply at once), plans work as GitHub issues, and writes each floor's QA brief. Everything
// it changes goes through the office tools below, so the swarm stays the single source of truth.

/** Refused file_issue: the CEO never decides on new work itself (askedFor). */
export const NOT_ASKED = "Only the manager decides on new work, and they haven't asked for any in this job. Suggest it in your final message instead; they can ask you to file it.";

export interface CeoJob {
  kind: CeoJobKind;
  repoId?: string; // onboard / plan / triage
  prNumber?: number; // triage: the stuck pull request
  text?: string; // chat: the manager's message(s)
  at: number;
}

/** What the CEO's tools do. Implemented by the swarm; errors are returned to the CEO as tool errors. */
/** Jobs the manager started by asking for work: a plan from their brief, or their message. Only these may file issues. */
export const askedFor = (job: Pick<CeoJob, 'kind'>) => job.kind === 'plan' || job.kind === 'chat';

export interface OfficeHandlers {
  companyStatus(): string;
  agentDetail(a: { agent_id: string }): string;
  setFloorProfile(a: { floor: number; summary?: string; qa_brief?: string; preview_command?: string; preview_env?: Record<string, string> }): string;
  scaleTeam(a: { floor: number; size: number; reason: string; cli?: AgentCli; model?: string; effort?: string }): string;
  configureAgent(a: { agent_id: string; cli?: AgentCli | ''; model?: string; effort?: string }): string;
  fileIssue(a: { floor: number; title: string; body: string }): Promise<string>;
  setDependencies(a: { floor: number; number: number; depends_on: number[] }): Promise<string>;
  closeIssue(a: { floor: number; number: number; reason: string }): Promise<string>;
  retryQa(a: { floor: number; pr: number }): Promise<string>;
  sendBack(a: { floor: number; pr: number; note: string }): Promise<string>;
  rerunChecks(a: { floor: number; pr: number }): Promise<string>;
  closePull(a: { floor: number; pr: number; comment: string }): Promise<string>;
  escalate(a: { floor: number; pr: number; reason: string }): Promise<string>;
}

export interface OfficeTools {
  server: McpSdkServerConfigWithInstance;
  /** A fresh MCP server with the same tools, for one request from a CEO running in a terminal (served over HTTP). */
  serve(): McpSdkServerConfigWithInstance['instance'];
  /** Run a tool without a model in the loop (the demo CEO). */
  call(name: string, args: Record<string, unknown>): Promise<string>;
}

const EFFORT = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
const CLI = z.enum(['claude', 'codex', 'opencode']);

export function createOfficeTools(h: OfficeHandlers): OfficeTools {
  const run = async (fn: () => string | Promise<string>) => {
    try {
      return { content: [{ type: 'text' as const, text: await fn() }] };
    } catch (err) {
      return { content: [{ type: 'text' as const, text: `Refused: ${(err as Error).message}` }], isError: true };
    }
  };
  const defs = [
    tool(
      'company_status',
      'Everything about the company right now: settings, every floor (repo, clone path, brief, profile, QA brief), its team and throughput, backlog, pull requests and QA, team changes waiting for the manager and their recent decisions. Call this first.',
      {},
      () => run(() => h.companyStatus()),
    ),
    tool(
      'agent_detail',
      'One agent in full: status, current task, and the coding agent, model and effort they run.',
      { agent_id: z.string().describe('An id (or name) from company_status') },
      (a) => run(() => h.agentDetail(a)),
    ),
    tool(
      'set_floor_profile',
      "Record your read of a floor's project: a one-line summary (kind of project and stack), the QA brief that tells agents what to check when they test a pull request for this kind of project, and how to run the app for the floor's preview monitor.",
      {
        floor: z.number().int().describe('Floor number'),
        summary: z.string().max(140).optional().describe('e.g. "3D browser game · Three.js + Vite + TypeScript"'),
        qa_brief: z.string().max(2500).optional().describe('What QA must check on every PR for this project, as short bullet points'),
        preview_command: z
          .string()
          .max(2000)
          .optional()
          .describe(
            'Shell command that serves the app on port {port} from a fresh checkout after npm install, e.g. "npm run dev -- --port {port} --strictPort". PORT={port} is always set. {tmp} is a scratch folder. Empty string: back to the default (npm run dev, else start, else preview). Only set it when the default would not serve the app on PORT.',
          ),
        // Not z.record(): the SDK can't turn it into JSON Schema, and one bad tool empties the whole tools/list.
        preview_env: z
          .object({})
          .catchall(z.string())
          .optional()
          .describe('Extra environment variables for the preview; {port} and {tmp} are replaced in the values. Replaces the whole set.'),
      },
      (a) => run(() => h.setFloorProfile(a)),
    ),
    tool(
      'scale_team',
      "Set how many agents a floor has. Every agent builds issues, tests pull requests and fixes them, whichever is next. Growing: new agents wait in the lobby until the manager sets them up and hires them (or join at once when team changes apply straight away). Shrinking: idle agents leave first; a busy one leaves once the manager agrees, or when it finishes.",
      {
        floor: z.number().int(),
        size: z.number().int().min(1).max(FLOOR_SEATS).describe("The team size you want, counting everyone already there; at most the floor's max in company_status"),
        reason: z.string().min(1).max(600).describe("Why, from the floor's throughput. The manager reads this."),
        cli: CLI.optional().describe("New agents' coding agent; leave out for the office default"),
        model: z.string().optional().describe("New agents' model; leave out for the default"),
        effort: EFFORT.optional().describe("New agents' reasoning effort; leave out for the default"),
      },
      (a) => run(() => h.scaleTeam(a)),
    ),
    tool(
      'configure_agent',
      "Change an agent's coding agent, model or reasoning effort. Takes effect from their next task.",
      {
        agent_id: z.string(),
        cli: z.union([CLI, z.literal('')]).optional().describe('"" for the office default'),
        model: z.string().optional().describe('"" for the default'),
        effort: z.union([EFFORT, z.literal('')]).optional().describe('"" for the office default'),
      },
      (a) => run(() => h.configureAgent(a)),
    ),
    tool(
      'file_issue',
      'File a GitHub issue on a floor, only for work the manager asked for in this job (a plan, or their message); anything else is refused. The next free agent takes the next issue that can start. Write "Depends on #N" in the body only when it cannot start until #N is merged: the office will not start it until #N is closed.',
      {
        floor: z.number().int(),
        title: z.string().max(120),
        body: z.string().max(6000).describe('Context, what to build, acceptance criteria'),
      },
      (a) => run(() => h.fileIssue(a)),
    ),
    tool(
      'set_dependencies',
      'Rewrite the "Depends on #N" line of an open issue instead of filing a duplicate. The rest of the body stays as it is. Not for an issue in progress.',
      {
        floor: z.number().int(),
        number: z.number().int().positive().describe('The issue number'),
        depends_on: z.array(z.number().int().positive()).max(10).describe('Issues it waits for; [] for none'),
      },
      (a) => run(() => h.setDependencies(a)),
    ),
    tool(
      'close_issue',
      'Close an open issue that is superseded or no longer wanted, as "not planned", with your reason as a comment. Not while an open pull request closes it. Nothing is deleted.',
      {
        floor: z.number().int(),
        number: z.number().int().positive().describe('The issue number'),
        reason: z.string().min(1).max(1000).describe('Posted as a comment, e.g. "Superseded by #152."'),
      },
      (a) => run(() => h.closeIssue(a)),
    ),
    tool(
      'retry_qa',
      'Triage only: give a stuck pull request another QA round (a flaky session, or the problem has since been fixed).',
      { floor: z.number().int(), pr: z.number().int().positive().describe('The pull request number') },
      (a) => run(() => h.retryQa(a)),
    ),
    tool(
      'send_back',
      "Triage only: send a stuck pull request back to a developer with QA's findings plus your note, without another QA round first.",
      { floor: z.number().int(), pr: z.number().int().positive(), note: z.string().min(1).max(1000).describe('What the developer should do, e.g. "Merge main and keep both toolbar changes."') },
      (a) => run(() => h.sendBack(a)),
    ),
    tool(
      'rerun_checks',
      "Triage only: re-run the failed GitHub Actions runs on a stuck pull request's head commit (a flaky check or an outage), then hand it back to the office.",
      { floor: z.number().int(), pr: z.number().int().positive() },
      (a) => run(() => h.rerunChecks(a)),
    ),
    tool(
      'close_pull',
      'Triage only: close a stuck pull request that is the wrong approach, with your comment on it. Its issue stays open so it is built again. No branch is deleted.',
      { floor: z.number().int(), pr: z.number().int().positive(), comment: z.string().min(1).max(1000).describe('Posted on the PR: why it is closed') },
      (a) => run(() => h.closePull(a)),
    ),
    tool(
      'escalate',
      'Triage only: hand a stuck pull request to the manager with your one-line diagnosis, when it needs a decision only they can make.',
      { floor: z.number().int(), pr: z.number().int().positive(), reason: z.string().min(1).max(300).describe('One line: what is wrong and what the manager has to decide') },
      (a) => run(() => h.escalate(a)),
    ),
  ];
  const server = createSdkMcpServer({ name: 'office', version: '1.0.0', tools: defs });
  return {
    server,
    serve: () => createSdkMcpServer({ name: 'office', version: '1.0.0', tools: defs }).instance,
    async call(name, args) {
      const def = defs.find((d) => d.name === name);
      if (!def) throw new Error(`No office tool ${name}`);
      const res = (await def.handler(args as never, undefined)) as { content: { text?: string }[] };
      return res.content.map((c) => c.text ?? '').join('\n');
    },
  };
}

// ---------- team size ----------

/** A floor's team as scale_team sees it. */
export interface TeamNow {
  agents: { id: string; desk: number; free: boolean }[];
  /** Pending hire requests, oldest first. */
  pendingHires: string[];
  /** Pending let-go requests and whom they're for. */
  pendingLetGos: { id: string; agentId: string }[];
}

/** How to reach a team size: requests to add or withdraw. The size counts pending requests as decided. */
export interface ScalePlan {
  size: number; // the size asked for, kept between 1 and the floor's max
  hire: number; // new hire requests
  cancelHires: string[]; // pending hire requests no longer wanted
  letGo: string[]; // agents to let go: idle ones first, then busy ones, the highest desks first
  cancelLetGos: string[]; // pending let-go requests no longer wanted
}

/** The team a floor will have once its pending requests are decided. */
export const plannedSize = (t: TeamNow) => t.agents.length + t.pendingHires.length - t.pendingLetGos.length;

/**
 * scale_team's arithmetic: withdraw requests that go the other way first (a let-go before a new hire, a waiting
 * candidate before someone who's working), then add what's still missing.
 */
export function scalePlan(t: TeamNow, size: number, max: number): ScalePlan {
  const target = Math.max(1, Math.min(max, Math.round(size)));
  const plan: ScalePlan = { size: target, hire: 0, cancelHires: [], letGo: [], cancelLetGos: [] };
  let diff = target - plannedSize(t);
  if (diff > 0) {
    plan.cancelLetGos = t.pendingLetGos.slice(0, diff).map((r) => r.id);
    plan.hire = diff - plan.cancelLetGos.length;
    return plan;
  }
  plan.cancelHires = t.pendingHires.slice(Math.max(0, t.pendingHires.length + diff)).reverse(); // the newest first
  diff += plan.cancelHires.length;
  const leaving = new Set(t.pendingLetGos.map((r) => r.agentId));
  plan.letGo = t.agents
    .filter((a) => !leaving.has(a.id))
    .sort((x, y) => Number(y.free) - Number(x.free) || y.desk - x.desk)
    .slice(0, -diff)
    .map((a) => a.id);
  return plan;
}

// ---------- prompts ----------

export function ceoSystemPrompt(o: {
  name: string;
  company: string;
  manager: string;
  notesFile: string;
  sessionLimit: number;
  maxAgents: number;
  scaling: 'approve' | 'auto';
}) {
  const manager = o.manager ? `the manager, ${o.manager}` : 'the human manager';
  return [
    `You are ${o.name}, the CEO of ${o.company || 'an autonomous software company'}, run from an office building called cubefarm. You work from the corner office in the lobby.`,
    `Every floor of the building is one GitHub repository with its own team of AI coding agents. The agents are interchangeable: each is a coding-agent session that takes whatever is next on its floor's board. A free agent builds the next issue in its own git worktree and opens a pull request; another free agent, in a fresh session, reviews and verifies every pull request (code review, tests, build, and a real browser via Playwright); failed ones go back for fixes. On floors with auto-merge on, the office merges a PR by itself once QA passes and GitHub's checks are green; on the others, ${manager} merges. The manager is your board: they decide on team changes.`,
    '',
    'Your job is to run the company, not to write code:',
    '- Understand each project: what it is, its stack and how far along it is. Projects differ a lot: a static marketing site, a 3D browser game and a REST API need different QA.',
    `- Size each floor's team from its throughput (team, throughput and capacity in company_status): grow it when issues ready to start or PRs waiting for QA keep waiting for free agents, shrink it when agents sit idle with nothing ready. More agents is not always faster: agents on the same coding agent share one subscription's usage limits${o.sessionLimit ? `, at most ${o.sessionLimit} sessions run at once,` : ''} and many agents on one repository mostly add merge conflicts, so a floor rarely needs more than 4 to 6. A floor holds at most ${o.maxAgents}. When the manager asks for a different size, follow that.`,
    "- Plan the work the manager asks for (a plan job from their brief, or their message): turn it into well-specified GitHub issues with acceptance criteria. An issue is a whole feature the manager would recognise (voice messages, a jukebox, the outside world), sized for one agent working for up to a few hours. Agents have large context windows and handle long jobs. Every extra issue costs a fresh exploration, a PR, a CI run, a QA round and often a conflict with its sibling PRs.",
    '- Split a feature only when its parts are truly independent AND touch different files, or when one risky foundation part should land and be tested first. Never split a feature just to give idle agents something to do: parallel work comes from different features side by side. Unrelated small fixes are still their own issues.',
    "- Write each floor's QA brief: what every QA pass must check for this kind of project (for a 3D game: the canvas renders, controls respond, frame rate is smooth; for a website: links, phone layout, accessibility; for an API: status codes, validation, error cases).",
    '',
    'How you work:',
    '- Call mcp__office__company_status first. It lists every floor, its clone path, team, backlog, pull requests and the team changes waiting for the manager.',
    '- Read the repositories through their clone paths with Read, Glob and Grep. They are read-only to you. You cannot run shell commands.',
    `- Keep durable notes about the company in ${o.notesFile}: read it at the start, and update it at the end with decisions and anything worth remembering next time.`,
    '- Change things only through the mcp__office__ tools.',
    `- ${ONE_TURN}`,
    '',
    'Rules:',
    '- Never decide on new work yourself. Only the manager asks for changes to their projects: file issues only when they asked in this job. In reviews, onboarding and triage, suggest work in your final message instead, and they decide.',
    '- Every floor keeps at least one agent.',
    `- Change a floor's size with one scale_team call, with a reason the manager can decide on in a sentence or two. ${o.scaling === 'auto' ? "Team changes apply straight away, within the floor's max, so be deliberate." : 'The manager approves every change, and sets up each new agent before hiring them.'} If the manager declined a similar change (recentDecisions), do not ask again unless something has changed, and say what.`,
    "- Agents run the office's default coding agent, model and effort. Change an agent's (configure_agent), or pick them for new agents (scale_team), only when the manager asks or for a clear reason.",
    '- Issues: the same agents build and test, so PRs queued for QA (capacity.prsAwaitingQa) mean fewer, bigger issues, not more. Most briefs need 1 to 4 issues. Write "Depends on #N" only when an issue truly cannot start until #N\'s code is merged, because it waits until #N is closed. Keep dependency chains to two steps at most. The office starts the issues that hold up others first. Do not duplicate open issues: fix an existing issue\'s dependencies with set_dependencies. File at most 12 issues per job, or per message from the manager.',
    '- Close an issue that is superseded or no longer wanted with close_issue, not by making it wait for another issue.',
    '- Triage jobs: a pull request got stuck (needs-human). Look before the manager does, and bring them only real decisions. Read the facts in the job and the code, then call exactly one of retry_qa (a flaky QA session, or it has been fixed since), send_back (a developer can fix it; your note says how), rerun_checks (a red check that looks flaky or like an outage), close_pull (the approach is wrong: its issue stays open to be built again) or escalate (only the manager can decide: a product call, credentials, a broken setup).',
    "- When company.usage in company_status says pacing or paused, Claude's usage is running low and the office is finishing open work first: file only what is needed next, not a whole milestone.",
    '- Your final message goes straight to the manager\'s phone. Keep it short and plain: what you found, what you changed or asked for, what you filed, and any question you need answered. No headings, no tables.',
  ].join('\n');
}

export function ceoJobPrompt(job: CeoJob, floor: { floor: number; fullName: string; clone: string; mission: string; backlog: number } | null, pr?: TriagePr | null): string {
  switch (job.kind) {
    case 'triage':
      if (!floor || !pr) return `Pull request #${job.prNumber ?? '?'} no longer needs triage. Reply "Nothing to do."`;
      return [
        `Triage: pull request #${pr.number} on floor ${floor.floor} (${floor.fullName}) is stuck and needs a decision before it reaches the manager.`,
        `"${pr.title}" · ${pr.url} · read-only clone of the default branch at ${floor.clone}`,
        `Why it stopped: ${pr.why ?? 'unknown'}`,
        `QA round ${pr.round}. QA summary: ${pr.summary ?? 'none yet'}`,
        pr.fixInstructions ? `QA's fix instructions:\n${pr.fixInstructions}` : '',
        pr.mergeNote ? `Merge note: ${pr.mergeNote}` : '',
        `GitHub checks: ${pr.checks}${pr.failedChecks.length ? ` (failed: ${pr.failedChecks.join(', ')})` : ''}${pr.pendingChecks.length ? ` (running: ${pr.pendingChecks.join(', ')})` : ''} · mergeable: ${pr.mergeable} (${pr.mergeState})`,
        `This is triage ${pr.triage} of ${MAX_TRIAGES} for this PR; after that it goes straight to the manager.`,
        '',
        `Work out why it is stuck, then call exactly one of retry_qa, send_back, rerun_checks, close_pull or escalate with floor ${floor.floor} and pr ${pr.number}. If you end without one, the manager is alerted. Your final message: one or two sentences on what you found and did.`,
      ]
        .filter((l) => l !== '')
        .join('\n');
    case 'onboard':
      if (!floor) return 'A floor was added but has since been removed. Reply "Nothing to do."';
      return [
        `Floor ${floor.floor} (${floor.fullName}) just joined the company. Its read-only clone is at ${floor.clone}.`,
        'Study it: README, package manifest, source layout, tests, and how far along it is. Then:',
        "1. set_floor_profile with a one-line summary and a QA brief for this project. If npm run dev / start / preview wouldn't serve the app on PORT, also set preview_command (and preview_env) so the floor's preview monitor can run it.",
        '2. scale_team to the size the work in sight needs. The floor starts with one agent; two to four is usually plenty to begin with.',
        '3. Check the open issues against that size: the team grows later when work keeps waiting for free agents.',
        floor.mission
          ? `4. The manager's brief for this floor, for your notes: """${floor.mission}"""\nFile no issues: planning it is a job of its own, when the manager asks for it.`
          : floor.backlog === 0
            ? '4. There is no brief and the backlog is empty. File no issues; suggest in your final message what the manager might want next.'
            : `4. There are ${floor.backlog} open issues. Leave them as they are and file no new ones; just make sure the team size fits them.`,
      ].join('\n');
    case 'plan':
      if (!floor) return 'A floor you were asked to plan has been removed. Reply "Nothing to do."';
      return [
        `The manager has a brief for floor ${floor.floor} (${floor.fullName}, clone at ${floor.clone}):`,
        `"""${floor.mission}"""`,
        '',
        'Plan the next milestone toward it:',
        `- Read the current code and the ${floor.backlog} open issues first, so you build on what exists and do not duplicate anything.`,
        '- One issue per whole feature. Split a feature only when its parts are independent and touch different files, or a risky foundation part should land first. Only for an empty or nearly empty repository does a skeleton issue come first, with the others depending on it.',
        '- File the issues.',
        '- Make sure the team size fits the work: scale_team when ready issues would keep waiting for free agents.',
        '- Update the floor profile and QA brief if the brief changes what the project is.',
      ].join('\n');
    case 'review':
      return [
        'Periodic review of the company. For every floor, look at:',
        '- floors without a profile or QA brief: study them and write one',
        '- team size against throughput: work that keeps waiting for free agents (grow), or agents idle with nothing ready to start or test (shrink). Idle agents are not a reason to slice features.',
        '- backlog against the team (capacity): long dependency chains (fix them with set_dependencies), or PRs piling up in QA (then plan fewer, bigger issues)',
        '- pull requests stuck in QA or marked as needing a human',
        '- floors with a brief and an empty backlog: say so, and suggest what the manager might ask for next (file no issues: only they decide on new work)',
        'Change team sizes only when clearly justified. If nothing needs doing, reply with one short sentence saying so.',
      ].join('\n');
    case 'chat':
      return `Message from the manager (they're reading your reply on their phone):\n${job.text ?? ''}`;
  }
}

export function jobLabel(job: CeoJob, floor: { floor: number; fullName: string } | null) {
  const where = floor ? `floor ${floor.floor} · ${floor.fullName.split('/')[1] ?? floor.fullName}` : 'a removed floor';
  switch (job.kind) {
    case 'onboard':
      return `Onboarding ${where}`;
    case 'plan':
      return `Planning ${where}`;
    case 'review':
      return 'Reviewing the company';
    case 'chat':
      return 'Replying to you';
    case 'triage':
      return `Triaging PR #${job.prNumber ?? '?'} · ${where}`;
  }
}

// ---------- issues ----------

/**
 * The CEO's issue cap: at most `max` issues per request from the manager. A manager message that arrives while the
 * job runs is a new request, so it resets the count.
 */
export class IssueCap {
  filed = 0; // since the job started or the manager's last message
  total = 0; // in the whole job
  readonly repos = new Set<string>(); // floors that got issues, to refresh when the job ends
  constructor(readonly max: number) {}

  check() {
    if (this.filed >= this.max) throw new Error(`You already filed ${this.max} issues in this job. That's plenty for one milestone. The manager's next message allows more.`);
  }

  record(repoId: string) {
    this.filed++;
    this.total++;
    this.repos.add(repoId);
  }

  managerMessage() {
    this.filed = 0;
  }
}

export interface DependsRequest {
  floor: number;
  number: number;
  dependsOn: number[]; // [] = no dependencies
  issues: { number: number; body: string }[]; // the floor's open issues
  closed: (n: number) => boolean; // for numbers that aren't open: closed, rather than unknown
  inProgress: boolean;
}

export interface DependsPlan {
  body: string | null; // null: leave the body alone
  summary: string;
}

/** Longest chain of open issues this one waits for, one step per "Depends on". */
function waitsDepth(n: number, deps: Map<number, number[]>, seen = new Set<number>()): number {
  if (seen.has(n)) return 0;
  seen.add(n);
  const depth = Math.max(0, ...(deps.get(n) ?? []).map((d) => waitsDepth(d, deps, seen) + 1));
  seen.delete(n);
  return depth;
}

/**
 * What set_dependencies changes, or why it refuses: a closed or unknown issue, one in progress, a dependency on
 * itself, on a closed or unknown issue, a cycle, or a chain deeper than two steps.
 */
export function planDependencies(r: DependsRequest): DependsPlan {
  const issue = r.issues.find((i) => i.number === r.number);
  if (!issue) throw new Error(r.closed(r.number) ? `#${r.number} is closed.` : `There is no open issue #${r.number} on floor ${r.floor}.`);
  if (r.inProgress) throw new Error(`#${r.number} is already in progress, so its dependencies can't change.`);
  const deps = [...new Set(r.dependsOn.map(Number))];
  const open = new Set(r.issues.map((i) => i.number));
  for (const d of deps) {
    if (d === r.number) throw new Error(`#${r.number} can't depend on itself.`);
    if (!open.has(d)) throw new Error(r.closed(d) ? `#${d} is closed, so there's nothing to wait for.` : `There is no open issue #${d} on floor ${r.floor}.`);
  }
  const body = setDependsOn(issue.body, deps);
  const after = r.issues.map((i) => (i.number === r.number ? { ...i, body } : i));
  const waits = new Map(after.map((i) => [i.number, blockers(i.body, open)]));
  const loop = deps.find((d) => reaches(d, r.number, waits));
  if (loop !== undefined) throw new Error(`#${loop} already waits for #${r.number}, directly or through other issues, so that would be a cycle.`);
  const depth = waitsDepth(r.number, waits) + (holdUps(after).get(r.number)?.chain ?? 0);
  if (depth > 2) throw new Error(`That makes a dependency chain ${depth} steps deep through #${r.number}. Keep chains to 2 steps at most: fold the dependent pieces into one issue instead of splitting further.`);
  return {
    body: body !== issue.body ? body : null,
    summary: `#${r.number} on floor ${r.floor}: ${deps.length ? `depends on ${deps.map((d) => `#${d}`).join(', ')}` : 'no dependencies'}.`,
  };
}

// ---------- capacity ----------

export interface FloorCapacity {
  issuesWaitingOnOthers: number; // not started yet and waiting for another open issue
  longestDependencyChain: number;
  prsAwaitingQa: number; // open PRs queued for or in QA, re-test rounds included
  prsBeingFixed: number; // open PRs back for fixes: waiting for an agent, or being fixed
}

/** The backlog, QA and fix numbers in company_status, so the CEO can see where work waits for agents. */
export function floorCapacity(f: {
  issues: { number: number; body: string }[]; // the floor's open issues
  inProgress: (n: number) => boolean;
  openPrs: number[];
  qa: { prNumber: number; status: QaStatus }[]; // the floor's QA records
}): FloorCapacity {
  const open = new Set(f.issues.map((i) => i.number));
  const prs = new Set(f.openPrs);
  return {
    issuesWaitingOnOthers: f.issues.filter((i) => !f.inProgress(i.number) && blockers(i.body, open).length > 0).length,
    longestDependencyChain: Math.max(0, ...[...holdUps(f.issues).values()].map((w) => w.chain)),
    prsAwaitingQa: f.qa.filter((q) => prs.has(q.prNumber) && (q.status === 'queued' || q.status === 'testing')).length,
    prsBeingFixed: f.qa.filter((q) => prs.has(q.prNumber) && (q.status === 'failed' || q.status === 'fixing')).length,
  };
}

/**
 * Whether close_issue may close an issue: only one open on that floor (`state` is its state in the floor's repo;
 * null when unknown), and never one an open pull request closes.
 */
export function checkCloseIssue(r: { floor: number; number: number; state: 'OPEN' | 'CLOSED' | null; pulls: { number: number; state: string; closesIssues: number[] }[] }) {
  if (r.state === 'CLOSED') throw new HttpError(404, `#${r.number} on floor ${r.floor} is already closed.`);
  if (r.state !== 'OPEN') throw new HttpError(404, `There is no open issue #${r.number} on floor ${r.floor}.`);
  const pr = r.pulls.find((p) => p.state === 'OPEN' && p.closesIssues.includes(r.number));
  if (pr) throw new HttpError(409, `PR #${pr.number} closes #${r.number}. Close or finish that pull request first.`);
}

/** Does `from` wait for `to`, directly or through other issues? */
function reaches(from: number, to: number, waits: Map<number, number[]>, seen = new Set<number>()): boolean {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return (waits.get(from) ?? []).some((n) => reaches(n, to, waits, seen));
}
