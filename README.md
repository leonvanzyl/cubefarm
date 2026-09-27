# ✻ Office Swarm

A cartoon, first-person 3D office where a swarm of **Claude Code** agents works through your **GitHub issues**.

- Every connected GitHub repo gets its own **floor**. Ride the **elevator** between them.
- Each agent is a separate Claude Code instance (via the **Claude Agent SDK**) running on your Claude subscription, in its own git worktree.
- Walk up behind an agent to watch their **monitor**: it streams their real terminal, and switches to a split view with a live **browser** pane when they test the UI with Playwright.
- Every floor has a **QA lab** with at least one **QA tester** (lab coat, glasses). Every pull request is tested before it can be merged, and the test report and screenshots are posted on the PR.
- The **whiteboard** on each floor is the Kanban board: backlog, in progress (who's on what), in QA, ready to merge, and merged.
- The **manager's office** in the lobby is where you connect repos, create new blank repos, hire agents, file issues and tune settings.

## Requirements

- Node.js 20+ (built and tested on Node 24)
- [GitHub CLI](https://cli.github.com/) signed in: `gh auth login`
- Claude Code signed in with your Claude subscription (`claude`, then `/login`). The agents use the Claude Code executable bundled with the Agent SDK, so they use the same login.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5317 and click **Enter the office**.

Want to look around without spending any usage or touching GitHub? Demo mode fakes both:

```bash
npm run demo
```

For a single-process build: `npm run build && npm start`, then open http://localhost:4317.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` / arrows | walk |
| `Shift` | run |
| mouse | look (click the view to capture the mouse) |
| `E` / left click | interact with whatever the crosshair is on (a click only captures the mouse if it is not captured yet) |
| `H` | help |
| `Esc` | release the mouse / close a panel |

Things you can press `E` (or click) on:
- agent desks: open the full terminal, message the agent, stop, assign, or let them go
- empty desks and QA stations: hire
- the whiteboard: the interactive Kanban
- the elevator and its panel
- the lobby directory
- the manager's computer

Your floor and position are remembered, so a page refresh puts you back where you were.

## How an issue flows through the office

1. **Backlog.** An issue is assigned to a developer, either by you (Kanban, terminal panel or manager's console) or automatically when **auto-assign** is on for that floor.
2. **In progress.** The server fetches the repo and creates a git worktree for that developer on the branch `swarm/issue-<n>-<agent>`, branched from the default branch. A Claude Code session starts there with the issue text. The developer implements the change, runs the project's checks, pushes the branch and opens a PR with `gh pr create` that says `Closes #<n>`.
3. **In QA.** The PR is handed to the floor's QA lab. A free QA tester checks out the PR head in their own worktree, then:
   - reads the PR and the linked issue to work out the acceptance criteria
   - runs the test suite, linters and build
   - exercises the feature in a real headless browser (Playwright), including phone sizes and edge cases, taking screenshots of each important state
   - returns a structured report: a verdict, the checks performed, the commands run, and a caption for each screenshot
4. **Evidence on the PR.** The server uploads the screenshots to an orphan branch called `swarm-qa-evidence`, so evidence never lands in your code, and posts a comment on the PR. The comment contains the verdict, a table of checks, the commands run, and the screenshots.
5. **Fail → fix → re-test.** If QA fails, the report goes back to the developer who wrote the PR, who resumes their own Claude Code session and pushes fixes to the same branch. The PR then goes back to QA for the next round. After 3 failed rounds it's flagged **needs you**.
6. **Ready to merge.** Once QA passes, the PR moves to **Ready to merge**. Review it on GitHub, including the QA comment, then press **Merge** (squash) on the board. The developer sees the merge, celebrates, and goes back to the backlog. Merging a PR that hasn't passed QA asks you to confirm first.

PRs opened by people, not agents, show up under **In QA** as "not tested yet", with a **Send to QA** button.

You can message an agent at any time. While they're working, the message is injected into their live session. After a developer finishes, the message resumes their session, e.g. "the CI failed, please fix the lint errors".

## QA testers

- Every floor always has at least one QA tester: one is hired when a repo is connected, and the last one can't be let go. You can hire up to 3 per floor (manager's console → Team, or press `E` on an empty QA station).
- QA testers use the same model and effort settings as everyone else. In guarded mode they can't push, comment on, review, merge or edit PRs or issues. The office posts their report for them.
- QA is automatic for every PR from a `swarm/` branch, whether or not auto-assign is on.

## The team

Agents get names from a pool of computing pioneers (developers) and fictional detectives (QA testers). Each character's look is picked from their name, so Ada, Grace and Marple are drawn with long hair, a ponytail or a bun. You can change any agent's name or look in the manager's console → Team.

## Models and usage

- Every agent defaults to **Claude Opus 5.5 (`claude-opus-5-5`) at medium effort**. You can change the default, or set it per agent, in the manager's console.
- Agents run on your Claude **subscription**: the server removes `ANTHROPIC_API_KEY` and all other inherited `CLAUDE_*` / `ANTHROPIC_*` variables before starting each agent, so the SDK uses your Claude Code login.
- Every agent draws on the same subscription usage limits. **Max concurrent sessions** (default 4) caps how many run at once. When a limit is hit, the agent's terminal shows it.

## Safety model

Agents run on your machine, so the default **guarded** permission mode:

- auto-approves file edits inside the agent's own worktree and refuses writes anywhere else
- refuses force-pushes, pushes to the default branch, `gh pr merge`, repo admin commands and a few destructive shell patterns
- gives agents only the Playwright MCP server: claude.ai connectors (Gmail, Drive, …), user-level MCP servers and plugins are not loaded (`strictMcpConfig`)
- disables `AskUserQuestion`. Nobody is watching live, so agents decide and record their assumptions in the PR

**Bypass** mode turns every check off. Use it only in a disposable VM or container.

The repo's own project settings (`CLAUDE.md`, `.claude/settings.json`, skills) are loaded, so agents follow each project's conventions. Project `.mcp.json` servers are not loaded.

## Where things live

- `~/.office-swarm/state.json`: floors, agents, settings and terminal history (`SWARM_HOME` overrides the folder)
- `~/.office-swarm/workspaces/<owner>__<repo>/main`: a clone of each repo
- `~/.office-swarm/workspaces/<owner>__<repo>/desks/<agent>`: one worktree per agent

Workspaces live outside this project on purpose: agents working in them never pick up this project's `CLAUDE.md`.

Disconnecting a floor never deletes anything on GitHub, and it leaves the clone on disk.

## Floor connections

In the manager's console, each floor can **link** to other connected repos. Agents on that floor get read access to the linked repos' clones (for example, a frontend team that needs to read the API repo) and are told about them in their instructions.

## Architecture

```
client/  Vite + React + react-three-fiber (toon materials, canvas textures)
  src/world/   the 3D building: floors, desks, characters, laptops, whiteboard, elevator, player
  src/ui/      HUD and panels: terminal, Kanban, elevator, manager's console
server/  Node + Express + ws
  swarm.ts        orchestrator: floors, agents, scheduling, persistence, websocket fan-out
  agentRunner.ts  one Claude Agent SDK session per agent; turns its stream into terminal lines
  github.ts       everything GitHub, via the gh CLI
  workspace.ts    clones + per-agent git worktrees
  demo.ts         fake GitHub and fake agents for `npm run demo`
shared/types.ts   the websocket / REST contract
```

The server streams everything to the browser over one websocket (`/ws`). Laptop screens and the whiteboard are canvases drawn from that data and used as textures. They only repaint when something changed, and less often when you're far away.
