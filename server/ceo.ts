import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { blockers, holdUps, setDependsOn } from '../shared/issues.ts';
import type { CeoJobKind } from '../shared/types.ts';

// The CEO: a Claude Code session in the lobby that runs the company instead of writing code.
// It studies each floor's repo, shapes the team (hire / let-go proposals the manager approves),
// plans work as GitHub issues, and writes each floor's QA brief. Everything it changes goes
// through the office tools below, so the swarm stays the single source of truth.

export interface CeoJob {
  kind: CeoJobKind;
  repoId?: string; // onboard / plan
  text?: string; // chat: the manager's message(s)
  at: number;
}

/** What the CEO's tools do. Implemented by the swarm; errors are returned to the CEO as tool errors. */
export interface OfficeHandlers {
  companyStatus(): string;
  agentDetail(a: { agent_id: string }): string;
  setFloorProfile(a: { floor: number; summary?: string; qa_brief?: string; preview_command?: string; preview_env?: Record<string, string> }): string;
  updateJob(a: { agent_id: string; title?: string; specialty?: string; job_description?: string }): string;
  proposeHire(a: {
    floor: number;
    role: 'dev' | 'qa';
    title: string;
    specialty: string;
    job_description: string;
    reason: string;
    model?: string;
    effort?: string;
  }): string;
  proposeLetGo(a: { agent_id: string; reason: string }): string;
  fileIssue(a: { floor: number; title: string; body: string; specialty?: string }): Promise<string>;
  routeIssue(a: { floor: number; number: number; specialty?: string; depends_on?: number[] }): Promise<string>;
}

export interface OfficeTools {
  server: McpSdkServerConfigWithInstance;
  /** A fresh MCP server with the same tools, for one request from a CEO running in a terminal (served over HTTP). */
  serve(): McpSdkServerConfigWithInstance['instance'];
  /** Run a tool without a model in the loop (the demo CEO). */
  call(name: string, args: Record<string, unknown>): Promise<string>;
}

const EFFORT = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);

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
      'Everything about the company right now: settings, every floor (repo, clone path, brief, profile, QA brief), its free seats, team, backlog, pull requests and QA, pending proposals and recent decisions by the manager. Call this first.',
      {},
      () => run(() => h.companyStatus()),
    ),
    tool(
      'agent_detail',
      "One agent in full: title, specialty, role, status, current task, model and effort, and their complete job description (company_status shortens long ones). Read it before rewriting someone's job description.",
      { agent_id: z.string().describe('An id (or name) from company_status') },
      (a) => run(() => h.agentDetail(a)),
    ),
    tool(
      'set_floor_profile',
      "Record your read of a floor's project: a one-line summary (kind of project and stack), the QA brief that tells QA testers what to check for this kind of project, and how to run the app for the floor's preview monitor.",
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
      'update_job',
      "Change an existing agent's job title, specialty or job description so it fits the project. Takes effect from their next task.",
      {
        agent_id: z.string(),
        title: z.string().max(60).optional(),
        specialty: z.string().max(24).optional().describe('Short lowercase slug, e.g. "graphics"; "" for a generalist'),
        job_description: z.string().max(2500).optional(),
      },
      (a) => run(() => h.updateJob(a)),
    ),
    tool(
      'propose_hire',
      'Propose hiring a developer or QA tester for a floor. The manager approves or declines (or it is auto-approved if hiring is set to auto and the floor is under its team cap).',
      {
        floor: z.number().int(),
        role: z.enum(['dev', 'qa']).describe('dev = builds issues into pull requests; qa = tests pull requests'),
        title: z.string().max(60).describe('Specific job title, e.g. "Three.js graphics engineer"'),
        specialty: z.string().max(24).describe('Short lowercase slug used to label issues swarm:<specialty>, e.g. "graphics"'),
        job_description: z.string().max(2500).describe('What this person owns on this project and how they should work. Written to them, second person.'),
        reason: z.string().max(600).describe('Why the floor needs them now. The manager reads this.'),
        model: z.string().optional().describe('Leave out to use the default model'),
        effort: EFFORT.optional().describe('Leave out to use the default effort'),
      },
      (a) => run(() => h.proposeHire(a)),
    ),
    tool(
      'propose_let_go',
      'Propose letting an agent go (overstaffed floor, specialty no longer needed). The manager decides.',
      { agent_id: z.string(), reason: z.string().max(600) },
      (a) => run(() => h.proposeLetGo(a)),
    ),
    tool(
      'file_issue',
      'File a GitHub issue on a floor. A specialty routes it to that specialist first; when none is free, any free developer takes it. Write "Depends on #N" in the body only when it cannot start until #N is merged: the office will not start it until #N is closed.',
      {
        floor: z.number().int(),
        title: z.string().max(120),
        body: z.string().max(6000).describe('Context, what to build, acceptance criteria'),
        specialty: z.string().max(24).optional(),
      },
      (a) => run(() => h.fileIssue(a)),
    ),
    tool(
      'route_issue',
      'Fix the routing of an open issue instead of filing a duplicate: change its specialty, rewrite its "Depends on #N" line, or both. The rest of the body stays as it is.',
      {
        floor: z.number().int(),
        number: z.number().int().positive().describe('The issue number'),
        specialty: z.string().max(24).optional().describe('Sets swarm:<specialty> and removes any other; "" for none. Someone on the floor, or a pending proposal, must have it.'),
        depends_on: z.array(z.number().int().positive()).max(10).optional().describe('Issues it waits for; [] for none. Not for an issue in progress.'),
      },
      (a) => run(() => h.routeIssue(a)),
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

// ---------- seats ----------

/** Desks per floor. client/src/world/layout.ts draws the same number (ceo.test.ts checks they match). */
export const FLOOR_DESKS = { dev: 12, qa: 3 } as const;
/** Pending proposals the manager can have waiting: enough to staff one empty floor in one go. */
export const MAX_PENDING_PROPOSALS = FLOOR_DESKS.dev + FLOOR_DESKS.qa;

export interface SeatCount {
  total: number;
  taken: number;
  /** Pending hire proposals for these seats. */
  proposed: number;
  free: number;
}

export const seatCount = (total: number, taken: number, proposed: number): SeatCount => ({ total, taken, proposed, free: Math.max(0, total - taken - proposed) });

/** Refuses a proposal while the manager already has the most they can be asked to decide on. */
export function checkPendingLimit(pending: number, max = MAX_PENDING_PROPOSALS) {
  if (pending >= max) throw new Error(`${pending} proposals are already waiting for the manager; propose the rest after they decide.`);
}

// ---------- prompts ----------

export function ceoSystemPrompt(o: {
  name: string;
  company: string;
  manager: string;
  notesFile: string;
  sessionLimit: number;
  teamCap: number;
  hiring: 'approve' | 'auto';
}) {
  const manager = o.manager ? `the manager, ${o.manager}` : 'the human manager';
  return [
    `You are ${o.name}, the CEO of ${o.company || 'an autonomous software company'}, run from an office building called cubefarm. You work from the corner office in the lobby.`,
    `Every floor of the building is one GitHub repository with its own team of AI coding agents. Developers pick up GitHub issues, each in their own git worktree, and open pull requests. QA testers review and verify every pull request (code review, tests, build, and a real browser via Playwright); when every tester is busy, a free developer who didn't write the PR covers QA. On floors with auto-merge on, the office merges a PR by itself once QA passes and GitHub's checks are green, and sends failing checks or merge conflicts back to a developer; on the others, ${manager} merges. The manager is your board: they approve hires and let-gos.`,
    '',
    'Your job is to run the company, not to write code:',
    '- Understand each project: what it is, its stack, how far along it is, and what kind of people it needs. Projects differ a lot. A static marketing site, a 3D browser game and a REST API need different specialists and different QA.',
    `- Shape each floor's team. Propose specialists with a specific title and a job description written for this project. Keep teams lean: agents on the same coding agent share one subscription's usage limits${o.sessionLimit ? ` and at most ${o.sessionLimit} sessions run at once` : ''}, so a floor rarely needs more than ${o.teamCap} people. When the manager asks for a bigger team, follow that, up to the floor's free seats (seats in company_status). Propose letting people go when a floor is clearly overstaffed or a specialty is no longer needed.`,
    "- Plan the work: turn a floor's brief into small, well-specified GitHub issues, one agent-session each, with acceptance criteria. Route each to a specialty. The office hands issues out itself: a free specialist gets first pick of their specialty, and otherwise any free developer takes the next issue that can start, so a specialty is a preference, not a lock.",
    "- Write each floor's QA brief: what QA testers must check for this kind of project (for a 3D game: the canvas renders, controls respond, frame rate is smooth; for a website: links, phone layout, accessibility; for an API: status codes, validation, error cases).",
    '',
    'How you work:',
    '- Call mcp__office__company_status first. It lists every floor, its clone path, team, backlog, pull requests and your pending proposals.',
    '- Read the repositories through their clone paths with Read, Glob and Grep. They are read-only to you. You cannot run shell commands.',
    `- Keep durable notes about the company in ${o.notesFile}: read it at the start, and update it at the end with decisions and anything worth remembering next time.`,
    '- Change things only through the mcp__office__ tools.',
    "- Before update_job rewrites someone's job description, read the full one with mcp__office__agent_detail and keep what still applies, especially its safety rules.",
    '',
    'Rules:',
    '- Every floor keeps at least one QA tester.',
    '- Titles are specific ("Three.js graphics engineer", not "Developer"). A specialty is a short lowercase slug ("graphics", "gameplay", "frontend", "backend", "content", "a11y", "devops"). Only route an issue to a specialty that someone on the floor has, or that you are proposing to hire.',
    '- Before proposing a hire, check the floor and the pending proposals for someone who already covers it. If the manager declined a similar proposal (recentDecisions), do not propose it again unless something has changed, and say what.',
    `- ${o.hiring === 'auto' ? 'Hiring is on auto: proposals within the team cap are approved immediately, so be deliberate.' : 'The manager approves every hire, so explain each reason in a sentence or two they can decide on.'}`,
    '- Issues: plan for parallel work. What keeps a floor busy is the number of issues that can start right now (capacity.issuesReadyToStart in company_status); aim for at least one per developer. Write "Depends on #N" only when an issue truly cannot start until #N\'s code is merged, because it waits until #N is closed. Keep dependency chains to two steps at most, keep foundation issues small, and split big pieces into parts that can be built side by side. The office starts the issues that hold up others first. Do not duplicate open issues: fix an existing issue\'s specialty or dependencies with route_issue. File at most 12 issues per job, or per message from the manager.',
    "- When company.usage in company_status says pacing or paused, Claude's usage is running low and the office is finishing open work first: file only what is needed next, not a whole milestone.",
    '- Your final message goes straight to the manager\'s phone. Keep it short and plain: what you found, what you proposed, what you filed, and any question you need answered. No headings, no tables.',
  ].join('\n');
}

export function ceoJobPrompt(job: CeoJob, floor: { floor: number; fullName: string; clone: string; mission: string; backlog: number } | null): string {
  switch (job.kind) {
    case 'onboard':
      if (!floor) return 'A floor was added but has since been removed. Reply "Nothing to do."';
      return [
        `Floor ${floor.floor} (${floor.fullName}) just joined the company. Its read-only clone is at ${floor.clone}.`,
        'Study it: README, package manifest, source layout, tests, and how far along it is. Then:',
        "1. set_floor_profile with a one-line summary and a QA brief for this project. If npm run dev / start / preview wouldn't serve the app on PORT, also set preview_command (and preview_env) so the floor's preview monitor can run it.",
        '2. update_job for the people already on the floor so their titles, specialties and job descriptions fit this project (every floor starts with a generalist QA tester).',
        '3. Propose the hires this project needs. Usually two to four developers with distinct specialties is plenty.',
        floor.mission
          ? `4. The manager's brief for this floor: """${floor.mission}"""\n${floor.backlog === 0 ? 'The backlog is empty: plan the first milestone as issues.' : `There are ${floor.backlog} open issues: add issues only for what the brief needs and the backlog does not cover.`}`
          : floor.backlog === 0
            ? '4. There is no brief and the backlog is empty. Do not invent work; suggest in your final message what the manager might want next.'
            : `4. There are ${floor.backlog} open issues. Label nothing retroactively; just make sure the team can cover them.`,
      ].join('\n');
    case 'plan':
      if (!floor) return 'A floor you were asked to plan has been removed. Reply "Nothing to do."';
      return [
        `The manager has a brief for floor ${floor.floor} (${floor.fullName}, clone at ${floor.clone}):`,
        `"""${floor.mission}"""`,
        '',
        'Plan the next milestone toward it:',
        `- Read the current code and the ${floor.backlog} open issues first, so you build on what exists and do not duplicate anything.`,
        '- If the repository is empty or nearly empty, the first issue sets up a small project skeleton, and the others depend on it. Everything after that should be able to run side by side.',
        '- File the issues, each routed to a specialty.',
        '- Make sure the floor has the specialists those issues need; propose hires if not.',
        '- Update the floor profile and QA brief if the brief changes what the project is.',
      ].join('\n');
    case 'review':
      return [
        'Periodic review of the company. For every floor, look at:',
        '- floors without a profile or QA brief: study them and write one',
        '- backlog against the team (capacity): fewer issues ready to start than free developers, long dependency chains, a specialty with a long queue (fix those with route_issue)',
        '- pull requests stuck in QA or marked as needing a human',
        '- floors with a brief and an empty backlog: plan the next milestone',
        'Propose hires or let-gos only when clearly justified. If nothing needs doing, reply with one short sentence saying so.',
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

export interface RouteRequest {
  floor: number;
  number: number;
  specialty?: string; // '' = no specialty
  dependsOn?: number[]; // [] = no dependencies
  issues: { number: number; body: string; labels: string[] }[]; // the floor's open issues
  closed: (n: number) => boolean; // for numbers that aren't open: closed, rather than unknown
  inProgress: boolean;
  specialties: string[]; // held by someone on the floor or by a pending hire proposal for it
}

export interface RoutePlan {
  addLabels: string[];
  removeLabels: string[];
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
 * What route_issue changes, or why it refuses: a closed or unknown issue, a specialty nobody on the floor has,
 * dependencies on an issue in progress, a dependency on itself, on a closed or unknown issue, a cycle, or a chain
 * deeper than two steps.
 */
export function planRoute(r: RouteRequest): RoutePlan {
  const issue = r.issues.find((i) => i.number === r.number);
  if (!issue) throw new Error(r.closed(r.number) ? `#${r.number} is closed.` : `There is no open issue #${r.number} on floor ${r.floor}.`);
  if (r.specialty === undefined && r.dependsOn === undefined) throw new Error('Nothing to change: pass specialty, depends_on or both.');
  const plan: RoutePlan = { addLabels: [], removeLabels: [], body: null, summary: '' };
  const done: string[] = [];

  if (r.specialty !== undefined) {
    const slug = specialtySlug(r.specialty);
    if (r.specialty.trim() && !slug) throw new Error(`"${r.specialty}" is not a specialty. Use a short lowercase slug, or "" for none.`);
    if (slug && !r.specialties.includes(slug)) {
      const have = [...new Set(r.specialties)].join(', ') || 'none';
      throw new Error(`Nobody on floor ${r.floor} has the specialty "${slug}", and no pending proposal does. Specialties there: ${have}.`);
    }
    const label = slug ? specialtyLabel(slug) : null;
    plan.removeLabels = issue.labels.filter((l) => /^swarm:/i.test(l) && !/^swarm:skip$/i.test(l) && l !== label);
    if (label && !issue.labels.includes(label)) plan.addLabels = [label];
    done.push(slug ? `routed to ${slug}` : 'no specialty');
  }

  if (r.dependsOn !== undefined) {
    if (r.inProgress) throw new Error(`#${r.number} is already in progress, so its dependencies can't change. Changing its specialty is fine.`);
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
    if (depth > 2) throw new Error(`That makes a dependency chain ${depth} steps deep through #${r.number}. Keep chains to 2 steps at most: split the work so more of it can start side by side.`);
    if (body !== issue.body) plan.body = body;
    done.push(deps.length ? `depends on ${deps.map((d) => `#${d}`).join(', ')}` : 'no dependencies');
  }

  plan.summary = `#${r.number} on floor ${r.floor}: ${done.join(', ')}.`;
  return plan;
}

/** Does `from` wait for `to`, directly or through other issues? */
function reaches(from: number, to: number, waits: Map<number, number[]>, seen = new Set<number>()): boolean {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return (waits.get(from) ?? []).some((n) => reaches(n, to, waits, seen));
}

/** Short lowercase slug for a specialty ("Three.js graphics" -> "three-js-graphics"). */
export function specialtySlug(s: string | undefined) {
  const slug = String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  return slug === 'skip' ? '' : slug;
}

export const specialtyLabel = (slug: string) => `swarm:${slug}`;
