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

## Local models

Codex and OpenCode agents can run on a model server on your computer instead of a subscription. Start the server, load a coding model, and give the agent (or the office default) a model named `<server>/<model>`:

| Server | Model name | Address (override) | Codex | OpenCode |
| --- | --- | --- | --- | --- |
| [Ollama](https://ollama.com) | `ollama/qwen3-coder` | `http://127.0.0.1:11434/v1` (`CUBEFARM_OLLAMA_URL`) | its own `--oss` | ✓ |
| [LM Studio](https://lmstudio.ai) | `lmstudio/qwen/qwen3-coder-30b` | `http://127.0.0.1:1234/v1` (`CUBEFARM_LMSTUDIO_URL`) | its own `--oss` | ✓ |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) (`llama-server`) | `llamacpp/<model>` | `http://127.0.0.1:8080/v1` (`CUBEFARM_LLAMACPP_URL`) | Responses API | ✓ |
| oMLX | `omlx/<model>` | `http://127.0.0.1:8000/v1` (`CUBEFARM_OMLX_URL`) | Responses API | ✓ |

Everything after the first `/` is the server's own name for the model. OpenCode gets the server as an OpenAI-compatible provider; Codex uses its built-in Ollama and LM Studio support, or, for the others (or an address you changed), a provider pointed at the server's Responses API. Set the `CUBEFARM_*_URL` variables in the office's environment before starting it. Claude Code and the CEO stay on Claude, and cloud agents can't reach a server on your computer. Agents need a model that's good at tool calls and a long context (Ollama's default context is too short for agent work: raise `num_ctx` / `OLLAMA_CONTEXT_LENGTH`).

## A floor's team

Each floor (one repository) has its own team, up to **10 agents** by default (Settings → *Most agents per floor*, at most 15: the room has 15 desks). Agents stay on their floor and take that board's work.

The CEO never decides on new work: it files GitHub issues only when you ask (a brief when the project moves in, **Plan**, or a message), and the office refuses its `file_issue` in any other job. Its own reviews, onboarding and triage suggest work in its message to you instead.

The **CEO** watches each floor's throughput (issues ready to start, pull requests waiting for QA or being fixed, idle agents, merges per hour) and sets the team's size with its `scale_team` tool, saying why. Settings → *Team changes* decides what happens next:

- **I approve each change** (the default): new agents wait in the lobby, on the chairs by the glass door. Press `E` on one to see who they'd be: the CEO's reason, and their provider, model and effort, which you can change before they're created. **Hire** creates the agent and its machine; they take the elevator up and get the welcome tour. A smaller team is an envelope on the desk of the agent the CEO picked to leave.
- **Apply straight away**: within the floor's maximum, the change happens at once; idle agents leave first, and busy ones are left to finish.

The phone and the manager's console show the same requests. You can always add or remove agents yourself (console → Team, or `E` on an empty desk).

## Machines

Each agent works on a **machine** of its own: a folder on your computer (the default), or an [Upstash Box](cloud.md) in the cloud, which keeps working while the office is closed. The office talks to a machine through one interface (`server/machines.ts`), so where it runs can change without touching the scheduler. An agent's ⚙️ Setup shows where they work (*Works on*), and moves them while they have no task.

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

Machines on your computer use the coding agents' logins and settings there: your Claude Code, Codex and OpenCode sign-ins, skills, plugins and MCP servers, and your `gh` login. That works because the machines are folders on the same computer. Machines elsewhere need credentials of their own, and the rules differ per provider:

- **Never copy a login file** (`~/.claude/.credentials.json`, Codex's `auth.json`) into several machines, or from your computer into one. Their refresh tokens rotate, so the copies log each other out.
- **Third-party apps may not collect or store claude.ai credentials or session tokens** (Anthropic's terms). cubefarm never handles a sign-in itself: it starts the coding agent's own login in that agent's terminal, you finish Anthropic's or OpenAI's flow there, and the login stays with that copy of the coding agent. cubefarm only asks whether it's signed in.

Cloud agents work this way today ([Signing a cloud agent in](cloud.md#signing-a-cloud-agent-in)):

- **Claude Code**: signs in once per Box with its own login (`claude auth login` in the agent's terminal), kept in the Box user's `~/.claude`. Before each task the office checks it (`claude auth status`); signed out, or failing on an expired login mid-task, the agent is marked *needs sign-in* and their task waits for you. Or, for every Box at once: `CLAUDE_CODE_OAUTH_TOKEN` from the office's environment (`CUBEFARM_CLAUDE_TOKEN`: you run `claude setup-token` yourself; the office never writes it down) or an Anthropic API key.
- **Codex**: the same with `codex login --device-auth` (a link and a one-time code, since nobody can open a browser on the Box) and `codex login status`, kept in `~/.codex`; or an OpenAI API key for every Box.
- **GitHub**: `GH_TOKEN` for each machine (a fine-grained token scoped to the floors' repos, or your `gh auth token`), later a GitHub App's short-lived tokens.

Other machines elsewhere (roadmap step 3) will get their own config folders (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, OpenCode's XDG folders) with onboarding and folder trust filled in, signed in the same way.

## Roadmap

1. **Interchangeable agents** (done): no roles, titles or QA lab; any free agent takes any task; the CEO scales teams; lobby candidates with provider, model and effort.
2. **Local machines** (done): an own clone and worktree per agent, its own temp folder and port.
3. **Per-machine logins** (done for cloud agents: a sign-in check before each task, the coding agent's own sign-in in their terminal): own sign-in folders for other machines, a sign-in check in the office doctor.
4. **Container machines**: [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/) (`sbx`, microVMs, no Docker Desktop needed; Windows 11 needs the Hypervisor Platform feature), reaching the office at `host.docker.internal`.
5. **Cloud machines** (Upstash Box done, see [Cloud agents](cloud.md)): an agent's machine can be an Upstash Box that keeps working while the office is closed. Later: Docker's cloud sandboxes, E2B or Daytona behind the same interface, GitHub App tokens instead of your own login, and the office itself in the cloud.
