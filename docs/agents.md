# Agents

How cubefarm thinks about its agents: interchangeable coding agents, each on a machine of its own, and how a floor's team grows and shrinks. For the life of an issue and a pull request, see [How it works](how-it-works.md).

## An agent is an agent

Every agent is the same thing: a coding-agent session (Claude Code, Codex or OpenCode) waiting for work. There are no roles, titles, job descriptions or specialties, and no QA testers set apart from developers. Whatever is next on the floor's board, any free agent takes it:

- **Build an issue**: a fresh worktree branch, the change, the project's checks, a pull request.
- **QA a pull request**: review the diff, run the checks, exercise it in a browser, report.
- **Fix a pull request**: QA's findings, failing checks or a merge conflict, pushed to the same branch.

What makes QA independent is a **fresh session**, not a different kind of agent: a QA run never resumes the session that built the pull request. QA goes to an agent other than the author: the author carries on with other work, and the next agent to come free tests it. The author tests their own pull request (in a new session) only when nobody else on the floor can, or nobody else has come free for 15 minutes, so a one-agent floor never stalls.

Fixes go back to the pull request's author while they're around (they have the session and the worktree), and to any free agent otherwise.

An agent has a name and a look, for personality, and three settings: its **provider** (Claude Code, Codex or OpenCode), its **model** and its **reasoning effort**. Each falls back to the office default (Settings) when left empty. The CEO or the manager can change them; changes apply from the agent's next task.

Most people have one subscription, so the default is every agent on the same provider. Mixing providers (Codex reviewing what Claude wrote, say) is an option for those who have more than one, never a requirement.

## A floor's team

Each floor (one repository) has its own team, up to **10 agents** by default (Settings → *Most agents per floor*, at most 15: the room has 15 desks). Agents stay on their floor and take that board's work.

The CEO never decides on new work: it files GitHub issues only when you ask (a brief when the project moves in, **Plan**, or a message), and the office refuses its `file_issue` in any other job. Its own reviews, onboarding and triage suggest work in its message to you instead.

The **CEO** watches each floor's throughput (issues ready to start, pull requests waiting for QA or being fixed, idle agents, merges per hour) and sets the team's size with its `scale_team` tool, saying why. Settings → *Team changes* decides what happens next:

- **I approve each change** (the default): new agents wait in the lobby, on the chairs by the glass door. Press `E` on one to see who they'd be: the CEO's reason, and their provider, model and effort, which you can change before they're created. **Hire** creates the agent and its machine; they take the elevator up and get the welcome tour. A smaller team is an envelope on the desk of the agent the CEO picked to leave.
- **Apply straight away**: within the floor's maximum, the change happens at once; idle agents leave first, and busy ones are left to finish.

The phone and the manager's console show the same requests. You can always add or remove agents yourself (console → Team, or `E` on an empty desk).

## Machines

Each agent works on a **machine** of its own: today a folder on your computer, later a container or a cloud VM. The office talks to a machine through one interface (`server/machines.ts`), so where it runs can change without touching the scheduler.

A local machine lives in `<SWARM_HOME>/machines/<machine>/`, named after the start of its agent's id:

| Folder | What it is |
| --- | --- |
| `repos/<owner>__<repo>/` | the agent's own clone of its floor's repository (borrowing objects from the floor's checkout, so it's quick to make) |
| `work/<owner>__<repo>/` | the agent's worktree of that clone, where its feature branches (`swarm/issue-*`, `qa/pr-*`, PR branches) are checked out |
| `tmp/` | its temporary folder (`TMP`, `TEMP` and `TMPDIR` in its sessions) |

Because every machine has its own clone, agents no longer queue behind one shared repository lock, and a branch checked out by one agent never blocks another. The floor's own checkout (your project folder, or the office's clone) is left to you, the CEO's reading and the preview monitor.

Removing an agent removes its machine; uncommitted or unpushed work is saved to `<SWARM_HOME>/leftovers/` first. The office's sweeps delete finished branches in each machine's clone, and machines whose agents are gone.

Agents from before machines keep their old desk until their current task is over, and move to a machine of their own at their next one. A session can only be resumed from the folder it ran in, so their fixes then start a fresh session.

### Signing in

Today every machine uses the coding agents' logins and settings on this computer, as before: your Claude Code, Codex and OpenCode sign-ins, skills, plugins and MCP servers, and your `gh` login. That works because the machines are folders on the same computer. Machines elsewhere (containers, cloud VMs) need credentials of their own, and the rules differ per provider:

- **Never copy a login file** (`~/.claude/.credentials.json`, Codex's `auth.json`) into several machines. Their refresh tokens rotate, so the copies log each other out.
- **Third-party apps may not collect or store claude.ai credentials or session tokens** (Anthropic's terms). cubefarm won't run the Claude sign-in itself or save a Claude token.

So the plan for per-machine logins (roadmap step 3) is:

- **Claude Code**: each machine gets its own config folder (`CLAUDE_CONFIG_DIR`), with onboarding and folder trust filled in. It signs in with `CLAUDE_CODE_OAUTH_TOKEN` when the office was started with it (you run `claude setup-token` yourself and keep the one-year token in your own environment; the office passes it to its machines and never writes it down), or with an API key, or you sign in once in that agent's terminal.
- **Codex and OpenCode**: their own `CODEX_HOME` / XDG folders, signed in once per machine (or with an API key).
- **GitHub**: `GH_TOKEN` for each machine (a fine-grained token scoped to the floors' repos, or your `gh auth token`), later a GitHub App's short-lived tokens.

## Roadmap

1. **Interchangeable agents** (done): no roles, titles or QA lab; any free agent takes any task; the CEO scales teams; lobby candidates with provider, model and effort.
2. **Local machines** (done): an own clone and worktree per agent, its own temp folder and port.
3. **Per-machine logins**: own sign-in folders, tokens from the environment, a sign-in check in the office doctor.
4. **Container machines**: [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/) (`sbx`, microVMs, no Docker Desktop needed; Windows 11 needs the Hypervisor Platform feature), reaching the office at `host.docker.internal`.
5. **Cloud machines**: Upstash Box, Docker's cloud sandboxes, E2B or Daytona behind the same interface, with GitHub App tokens instead of your own login.
