# How cubefarm works

The details behind the office: how an issue becomes a merged pull request, who does what, and what agents are allowed to do on your machine. For getting started, see the [README](../README.md).

## How an issue flows through the office

1. **Backlog.** An issue is assigned to a developer, either by you (Kanban, terminal panel or manager's console) or automatically when **auto-assign** is on for that floor. Auto-assign keeps every developer busy while there's work that can start:
   - An issue that says `Depends on #N` waits until #N is closed. Of the rest, the ones that hold up the longest chain of other issues go first, then the oldest.
   - A `swarm:<specialty>` label is a preference, not a lock. A free specialist gets first pick, and otherwise the issue goes to whichever free developer is least needed for their own specialty.
   - If a session fails, its issue goes back on the board for someone else, and the agent gets new work after a two-minute cooldown. An issue that fails twice waits for you to assign it by hand.
   - If Claude turns a session away because your usage limit is reached, the office starts no new work until the limit resets.
   - Before that, when Claude warns that usage is getting high, the office paces itself until the window resets (an hour if Claude doesn't say): QA, fixes and CEO jobs start as usual, but new issues only start while fewer sessions than **Sessions while pacing** (manager's console → Settings, default 3) are running. Your phone gets a message when pacing starts and when it ends.
   - While it paces (or pauses), a chip under the floor card says until when, and the Kanban's backlog cards show **⏸ paced**. Topped up, or was your usage reset? **Resume full speed** (manager's console → Mission control, or `E` on the usage meter in the lobby) ends pacing at once, and later warnings about the same window are ignored. A pause after Claude turned a session away can't be cleared early.
2. **In progress.** The server fetches the repo and creates a git worktree for that developer on the branch `swarm/issue-<n>-<agent>`, branched from the default branch. The developer's coding agent starts there with the issue text. The developer implements the change, runs the project's checks, pushes the branch and opens a PR with `gh pr create` that says `Closes #<n>`.
3. **In QA.** The PR is handed to the floor's QA lab. A free QA tester checks out the PR head in their own worktree; when every tester is busy, a free developer who didn't write the PR covers for them, `testing` specialists first. The tester then:
   - reads the PR and the linked issue to work out the acceptance criteria
   - reviews the diff like a code reviewer: bugs, unhandled errors and edge cases, security problems, leftover debug code, missing tests
   - runs the test suite, linters and build, unless the PR has GitHub checks: then the tester is told what they say right now, reads what they cover and runs only what the change needs (a failing check is a finding)
   - exercises the feature in a real headless browser (Playwright), including phone sizes and edge cases, taking screenshots of each important state
   - returns a structured report: a verdict, the checks performed, the commands run, and a caption for each screenshot
4. **Evidence on the PR.** The server uploads the screenshots to an orphan branch called `swarm-qa-evidence`, so evidence never lands in your code, and posts a comment on the PR. The comment contains the verdict, a table of checks, the commands run, and the screenshots.
5. **Fail → fix → re-test.** If QA fails, the report goes back to the developer who wrote the PR, who resumes their own session and pushes fixes to the same branch. If they're busy on something else, any free developer takes the fix instead. The PR then goes back to QA for the next round, which checks last round's findings first, then tests what changed since the commit it last tested plus a quick smoke of the main flow. A PR that already conflicts with the default branch goes back to its developer to merge it before QA tests it. A fix session that pushes nothing is asked once more to push, or to say why nothing needs to change (then QA re-tests it). After 6 failed QA rounds, or 3 fix sessions in a row that fail or push nothing, it's flagged **needs you**.
6. **Merge.** Once QA passes, the PR moves to **Ready to merge**. With **auto-merge** on for the floor (the default; switch it in the manager's console or on the Kanban board), the office takes it from there:
   - It waits for GitHub's checks (Actions, Vercel and so on) and merges as soon as they're green, but only the exact commit QA signed off on. Commits pushed after the sign-off go back through QA first.
   - If checks fail, or the PR conflicts with the default branch because other work merged first, a free developer gets the failing checks or the conflict, fixes the branch, and QA re-tests it when the code changed (after a conflict fix, a lighter re-check of the merge, CI and the feature). After 5 such fixes it's flagged **needs you**.
   - It squash-merges (falling back to a merge commit if the repo doesn't allow squash), deletes the remote branch, and updates the branch first if the repo only merges up-to-date branches.
   - If GitHub refuses the merge (say, branch protection wants an approving review), your phone gets a message and the office retries every 10 minutes. Checks still running after 30 minutes also get a message.
   - Only `swarm/` branches merge themselves. PRs people opened are left for you.

   A stuck PR (3 failed QA rounds, 3 merge fixes, or fix sessions that keep failing) goes to the CEO first: its card says **🧭 CEO is looking** while the CEO reads the QA report and the checks, then retries QA, sends it back to a developer with a note, re-runs a flaky check, or closes it (its issue stays open, to be built again). It only shows **needs you**, with a phone message, when the CEO escalates it with a one-line diagnosis, ends without acting, or the PR gets stuck a third time.

   With auto-merge off, review the PR on GitHub, including the QA comment, then press **Merge** (squash) on the board. Merging a PR that hasn't passed QA asks you to confirm first. Either way, the developer sees the merge, celebrates, and goes back to the backlog.
7. **Your folder catches up.** After any merge, the floor's folder fast-forwards to the default branch, but only when it's on that branch with no local changes. Nothing is ever stashed, reset or discarded; otherwise the manager's console shows why it wasn't updated (`2 behind: local changes in package-lock.json`, `on branch feature-x`, `diverged`). If `package.json` or the lockfile changed, it runs `npm install`. **Sync now** in the manager's console retries.

   The office's own folder is the exception: pulling it would restart the office mid-work, so it shows `update ready` and the **Office** row at the top of the manager's console takes over. When the office was started by its launcher (`npm run dev` / `npm start`) and **Update automatically** is on, or you press **Update now**, the office drains: it starts no new issues, QA or CEO jobs, and lets the running sessions finish. Once nothing runs (or after 20 minutes, when the remaining sessions are stopped and their work goes back to the queue), it hands the update to the launcher, which pulls, installs, builds and restarts it; your phone then says which commit it moved to, or why the update was rolled back. **Later** postpones it for 2 hours, or until a newer commit lands. Started any other way, the office only reports the update.

**Closing an issue or PR** (its **Close** in the manager's console → Issues or on its Kanban card, the CEO's tools, or on GitHub) cleans up after it: whoever works on it stops, as ■ Stop does, their desk is cleared, and your phone says who was stopped and why. QA and fixes queued for a closed PR are dropped, and nothing starts on an issue or PR that GitHub says is closed. Closes made in the office take effect at once, ones on GitHub at the next sync. A merge is not a close: nobody's session is cut short by it. Closing a PR never closes its issue, and never hands it out again by itself: the issue waits in the Backlog, marked ⏸, until you assign it (or close it). The CEO's triage close is the exception: it closes a PR so that its issue is built again.

PRs opened by people, not agents, show up under **In QA** as "not tested yet", with a **Send to QA** button.

You can message an agent at any time. While they're working, the message is injected into their live session. After a developer finishes, the message resumes their session, e.g. "the CI failed, please fix the lint errors".

## QA testers

- Every floor always has at least one QA tester: one is hired when a repo is connected, and the last one can't be let go. You can hire up to 3 per floor (manager's console → Team, or press `E` on an empty QA station).
- QA testers use the same model and effort settings as everyone else. Their instructions tell them not to push, comment on, review, merge or edit PRs or issues: the office posts their report for them.
- QA is automatic for every PR from a `swarm/` branch, whether or not auto-assign is on.

## The team

Agents get names from a pool of computing pioneers (developers) and fictional detectives (QA testers). Each character's look is picked from their name, so Ada, Grace and Marple are drawn with long hair, a ponytail or a bun. You can change any agent's name or look in the manager's console → Team, or in the ⚙️ Setup at the top of their own panel (open their desk), which also has their coding agent, model, effort, title, specialty and job description. Changes apply from their next task. **What they're told**, in the same Setup, shows the full prompt the office gives them, with their job description highlighted; the CEO's is on the console's CEO tab.

## Mission control

The curved bank of screens behind reception in the lobby shows how the company is doing, per floor and in total: the pipeline (issues ready to start, being built, in QA, being fixed, ready to merge, needing you), PRs merged today and in the last hour with a 24-hour chart, median lead time (issue to merge) and QA wait over the last 24 hours, GitHub's checks (pass rate and median duration over 7 days), who's busy, idle or in error, and today's cost per floor. The cost is an estimate from the cost finished sessions report. Each floor's team sign carries a compact line of its own numbers. The manager's console → **Mission control** has the same numbers as a table.

The bottom middle screen is Claude's usage meter: normal, pacing or paused, the limit and how full it was at the last warning, and when it resets. While the office paces itself, `E` on the meter resumes full speed (after asking).

When a PR needs you, or an agent has been stuck on an error for more than 10 minutes, the beacon on top of the wall and on that floor's sign spins red and a calm chime plays (at most every 30 seconds, under Alerts). `E` on either opens the console at that card, with what you can do about it. The beacon stops once it's handled.

The server works the numbers out from what it already knows plus a rolling week of merges, QA verdicts, check runs and session costs kept in the state file, and pushes them to the browser when they change.

## Models and usage

- Developers and QA default to **Claude Code with Claude Opus 5.5 (`claude-opus-5-5`) at medium effort**. In the manager's console, Settings sets the default coding agent, its model and the effort; the Team tab overrides any of them per agent. The default model belongs to the default coding agent: an agent on another one uses that agent's own default unless you name a model for them. The CEO runs Claude Code, with its own model and effort on the CEO tab.
- Agents run on your Claude **subscription**: the server removes `ANTHROPIC_API_KEY` and all other inherited `CLAUDE_*` / `ANTHROPIC_*` variables before starting each agent, so Claude Code uses your login. Codex and OpenCode agents use whatever those CLIs are signed in with, and don't count toward Claude's usage pacing.
- Every agent draws on the same subscription usage limits. By default every agent with work runs at once; set a **Session limit** in the manager's console to cap it. When a limit is hit, the agent's terminal shows it.

## Agents' terminals

By default (manager's console → Settings → **How agents run: Real terminals**) every agent is the actual coding CLI running in its own pseudo-terminal on your machine. Open a desk to watch it live; click the terminal to type into it (while it has focus, `Esc` goes to the agent, which interrupts its turn: the office then counts the agent as stopped, the way the Stop button does, and what you type next at its prompt is a follow-up). The office keeps a copy of each agent's screen and scrollback, so a terminal opened late shows everything so far, and it's saved to `<SWARM_HOME>/terminals/` so it survives a restart. The message box under the terminal types into it for you, or, when the agent isn't running, resumes their session.

- **Claude Code** (the default; the office runs the copy that ships with the Agent SDK, the one `cubefarm login` signs in) reports every step to the office through HTTP hooks passed with `--settings`: each tool call (the hook also approves it, so the CLI never stops to ask), each finished turn with its final message, failures, and, through its status line, cost and usage limits for pacing. The status line under its prompt shows who the agent is and what they're on.
- **Codex** and **OpenCode** (experimental) run if they're installed: pick one for everyone (Settings → *Default coding agent*) or per agent (Team). They get the same prompt and instructions, and tell the office when a turn ends (Codex's `notify` program, an OpenCode plugin). Codex also gets the office's hooks (`-c hooks.*`, which only report its steps, and Esc as `Interrupt`), but Codex runs hooks only once you trust them: the first time, Codex asks to review them, the office carries on without them and its log says how to trust them (type `/hooks` in a Codex agent's terminal and press `t`). That holds for every later session, since the office's hook command never changes (the office's address travels in `CUBEFARM_HOOK_URL`). Until then, and for OpenCode, the office shows their task rather than each step. Their browser screenshots still reach the office: each session's Playwright server saves its snapshots and unnamed screenshots in the session's own folder (not the worktree), and the office collects new images from there, so their QA reports carry screenshots too. Codex saves every session in your own Codex, where the Codex and ChatGPT apps list it with your chats, so the office archives each agent's thread (`codex archive`) once its CLI closes and unarchives it before resuming it: they're in the apps' Archived list, not your recent chats. Neither runs sandboxed or stops for approvals (see the safety model). OpenCode's self-update is switched off, since several agents starting at once would each reinstall it. The CEO always runs Claude Code.
- A session is finished when the CLI's turn ends and it doesn't pick up another prompt within 3 seconds. A developer's CLI then stays at its prompt for 30 minutes: type into it and the office takes it on as a follow-up, and the message box (or the office itself, e.g. to fix QA findings) continues in the same CLI. QA testers' and the CEO's CLIs close. After that, a follow-up resumes the session in a new CLI (only the CLI that made a session can resume it).
- The office answers the folder-trust question for its own worktrees (moving to "Yes" first where the CLI selects "No"). Anything else a CLI asks before it starts (sign in, first-run screens) waits for you in its terminal, and the agent's log says so.
- **Agents keep working while the office restarts** (an update, a code change during development, a crash). The CLIs run in the office's *terminal keeper* (`server/ptyHost.ts`), a small process of its own that the office starts and talks to over a local socket (a named pipe on Windows, `<SWARM_HOME>/pty.sock` elsewhere, with a secret in `<SWARM_HOME>/pty.secret`). Their hooks go to the keeper too, which holds each one while the office is away, so none fails and nothing is lost. When the office is back it takes each CLI into its agent's terminal again (what it printed meanwhile, then a redraw) and follows the busy ones' sessions. The CEO's session is resumed instead, since its office tools live in the office. When the office quits for good (Ctrl+C) the CLIs stop with it, and a keeper that no office comes back to for 10 minutes stops them itself. If the keeper can't start, terminals run inside the office and stop when it restarts, as before.
- **Agent SDK** runs Claude Code through the SDK instead, shown as a log of its steps: the office's original runtime.

## Safety model

Agents behave like the coding agents you run in your own terminal: they load your setup (user and project settings, `CLAUDE.md`, skills, plugins, MCP servers and claude.ai connectors; Codex and OpenCode their own config), and nothing runs in a sandbox. On top of that the office adds its hooks, its Playwright server when a floor tests in a browser, the office tools for the CEO, and its instructions.

Nobody may be watching to answer a permission question, so the office approves every tool call (Claude Code through its PreToolUse hook, Codex with `--dangerously-bypass-approvals-and-sandbox`, OpenCode through its permission config). The office's workflow is in each agent's instructions, not enforced: push your own branch and open a PR, never push to the default branch, force-push or merge (the office merges after QA), and, for QA testers, leave GitHub alone because the office posts their report. `AskUserQuestion` and plan mode stay off for Claude Code: agents decide and record their assumptions in the PR (you can still type into any agent's terminal).

Agents can do anything your own coding agent in a terminal can. Run the office where you'd run those.

## Where things live

- `~/.cubefarm/state.json`: floors, agents, settings, terminal history and mission control's last 7 days (`SWARM_HOME` overrides the folder)
- `~/.cubefarm/terminals/<agent>.ansi`: each agent's terminal screen and scrollback
- `~/.cubefarm/sessions/<token>/`: a running CLI session's settings, MCP config and instructions (removed when it ends); `~/.cubefarm/bin/`: the small scripts the CLIs call back to the office with
- `~/.cubefarm/workspaces/<owner>__<repo>/main`: a clone of each repo
- `~/.cubefarm/workspaces/<owner>__<repo>/desks/<agent>`: one worktree per agent, reused from task to task. A desk left idle longer than **Free idle desks after** (manager's console → Settings, default 120 minutes, 0 = never) loses its `node_modules` (at any depth) and its build and test output (`dist/`, `dist-server/`, `test-results/`, `playwright-report/`, `.swarm-home/`, `.preview-tmp/`, `.playwright-mcp/`), once per idle stretch; tracked and untracked source files stay, and the next task installs again. The office checks every 15 minutes, never touches a busy desk or a running preview's, and your phone says how much it freed. A folder Windows still has locked is tried again next time.
- `~/.cubefarm/leftovers/<owner>__<repo>/`: work saved from desks the office swept away
- `~/.cubefarm/secrets.json`: the ElevenLabs key and the chat apps' webhooks; `~/.cubefarm/push.json`: the Web Push keys and your devices' subscriptions ([docs/pocket.md](pocket.md))

Every 30 minutes (and when a floor starts, or someone is let go) the office sweeps each floor: it removes desks nobody uses any more and the finished `swarm/issue-*` and `qa/pr-*` branches nobody has checked out or has an open PR for. A desk with uncommitted changes to tracked files or unpushed commits is saved as a `.patch` in `leftovers/` first, and a folder that a program still has open is left for the next sweep. Your own branches and worktrees outside `desks/` are never touched.

Workspaces live outside this project on purpose: agents working in them never pick up this project's `CLAUDE.md`.

Disconnecting a floor never deletes anything on GitHub, and it leaves the clone on disk.

## Floor connections

In the manager's console, each floor can **link** to other connected repos. Agents on that floor get read access to the linked repos' clones (for example, a frontend team that needs to read the API repo) and are told about them in their instructions.

## Floor previews

Every floor can run its app so you can open and use it from the office. The server side:

- `POST /api/repos/:repo/preview` starts it on the default branch, or `{ "pr": 12 }` on an open pull request (and restarts it when it is already running on another ref). `DELETE /api/repos/:repo/preview` stops it. One preview per floor.
- It runs in its own worktree, `workspaces/<owner>__<repo>/desks/preview` (branch `swarm-preview`), never in the floor's main checkout.
- Its port is reserved for the floor: **6300 + floor number** (moved up by 100 if that clashes with the office's own `SWARM_PORT` or another preview). It never uses 4317, 5317 or the agents' 5200-5899 range. If something else already holds the port, the preview reports an error and leaves that program alone.
- Statuses: `preparing` (checkout) → `installing` (`npm ci` with a lockfile, else `npm install`; skipped when `package.json` and the lockfile haven't changed since the last install) → `starting` → `running` (once the port accepts connections; 3 minute timeout), or `error` / `stopped`. The repo's `preview` field carries the status, URL, ref, short commit, start time, error and the last 40 log lines, and is pushed over the websocket.
- Previews stop when their floor is disconnected and when the server gets SIGINT/SIGTERM; anything left over from a hard kill is cleaned up at the next start, and every preview reads `stopped` after a restart.

**Configuring it** (`PATCH /api/repos/:repo` with `previewCommand` and `previewEnv`, or the CEO's `set_floor_profile` tool with `preview_command` / `preview_env`):

- `previewCommand`: a shell command run from the worktree root (`cmd.exe` on Windows). `null` or `""` means the default: `npm run dev`, else `npm run start`, else `npm run preview`. Plain `vite` scripts get `-- --port {port} --strictPort` appended, since Vite ignores `PORT`. No command and no `package.json` means `unconfigured`.
- `previewEnv`: extra environment variables (string values). `ANTHROPIC_*` / `CLAUDE_*` names are refused.
- Placeholders, replaced in the command and in env values: `{port}` is the floor's preview port; `{tmp}` is a scratch folder inside the preview worktree (`.preview-tmp`, kept out of git status).
- `PORT={port}` is always set. The app gets the office's environment minus `ANTHROPIC_*`, `CLAUDE_*` and the office's own `SWARM_*` variables.

Example, this repo previewing itself (a demo office on the floor's port, with its state in the scratch folder):

```json
{ "previewCommand": "npm run build && node --import tsx server/index.ts --demo",
  "previewEnv": { "SWARM_PORT": "{port}", "SWARM_HOME": "{tmp}" } }
```

In `--demo` mode no git or npm runs: starting a preview serves a small placeholder page ("<floor> app · <ref>", with a click counter) on the floor's port.

### The PR theatre

Any open PR can run beside the floor's main preview, so you can try it before it merges. The big screen's bottom row has a channel per open PR (aim at one, press E), and the app viewer has the same channels: "main" and "PR #12 · title · ✅ QA passed".

- `POST /api/repos/:repo/pr-previews/:n` starts PR #n's preview (kept as it is when it's already up; `{ "restart": true }` runs it again from the PR's latest head). `DELETE` stops it. The previews are in the snapshot's `prPreviews` and the `prPreview` / `prPreviewRemoved` events.
- It runs the floor's preview command and environment, from a slot worktree: `desks/preview-pr-1` or `desks/preview-pr-2` (branch `swarm-preview-pr-<slot>`). A slot taken over by another PR of the same floor keeps its `node_modules`, so the install is skipped when the dependencies match.
- Ports: 100 above the floor previews, one lane per slot (6401, 6403 … and 6402, 6404 …), skipping the office's ports, other previews' and anything already listening. `SWARM_PREVIEW_PORT` moves both ranges (default 6300); only test offices need it.
- At most **2** PR previews at once. A third one stops the one nobody has watched the longest (a failed one first); one on screen is never stopped for room.
- An open viewer says which PR it has on screen (`POST /api/previews/watch`, every 30 seconds). A PR preview stops after **20 minutes** off screen (`SWARM_PR_PREVIEW_IDLE_MIN` changes it, fractions allowed, for tests), when its PR merges or closes, and when the office stops. Its worktree goes with it; the office's next start clears away anything a hard stop left.
- **Compare with main** puts main on the left and the PR on the right, the same path in both. **Sync scrolling** shows each side through a small pass-through proxy (`POST /api/repos/:repo/preview/sync`, a port the OS picks, on loopback) that adds a script to HTML pages, so each side follows the other's scrolling and links. That works for plain web pages that scroll the page itself.
- The side panel shows the PR's GitHub checks and QA's latest report: summary, checks and screenshots. QA's screenshots of a PR's latest round are kept in `<SWARM_HOME>/qa-shots/` (served at `/api/repos/:repo/pulls/:n/qa-shots/:i`) until the PR leaves QA.
- In `--demo` mode a PR preview is a placeholder page of its own: the PR's number and title, a highlighted "new in this PR" row, and Home / About pages to try the path and scrolling sync on.

## Updating the office

Run from a clone of this repo, the office has a parent process, the launcher `scripts/office.mjs`. `npm start` runs the built office under it (`bin/cubefarm.js`: the usual checks, then `dist-server/` serving `dist/`); `npm run dev` and `npm run demo` add `--dev`: the server from source plus Vite (on `SWARM_CLIENT_PORT`, default 5317), with the server restarted when code in `server/` or `shared/` changes. It starts the server with an IPC channel and `SWARM_LAUNCHER=1`.

When the office has finished its work and asks for an update (`{ type: 'office:update', from }`), or when you type `u` + Enter in the launcher's terminal, the launcher:

1. Pauses the file watcher and stops the office: it sends the server `{ type: 'office:shutdown', restart: true }` (the server stops its floor previews and exits; agents' CLIs carry on in the terminal keeper), stops Vite, and kills whatever is still running after 20 seconds, process trees included (`taskkill /T /F` on Windows).
2. Checks the folder: only on origin's default branch, with no local changes and no local commits. Otherwise it changes nothing. Nothing is ever stashed or discarded.
3. Runs `git fetch` and `git merge --ff-only origin/<default>`.
4. Runs `npm install --no-save` if `package.json` or `package-lock.json` changed. This only happens once nothing is running, because Windows locks esbuild's and Rollup's binaries while they're in use. `--no-save` leaves the lockfile as pulled, so another npm version can't turn it into a local change that blocks the next update.
5. Under `npm start`, runs `npm run build`.
6. Writes `<SWARM_HOME>/last-update.json`: `{ from, to, ok, error?, installed, built, at }`. Here `to` is the commit the office runs afterwards, `installed` and `built` say whether npm install and the build ran, and `at` is a timestamp in milliseconds. Then it starts the office again, and the server reports the result on your phone.

If a step fails, the launcher goes back with `git reset --keep <from>`, which never touches local changes. It reinstalls the old dependencies if npm install ran, rebuilds if a build ran, starts the old version and writes `ok: false` with the error. A refused update (another branch, local changes) also writes `ok: false`.

Ctrl+C (or SIGTERM) stops the server, then Vite, and leaves no processes behind; press it twice to quit at once. The launcher is only for a checkout: `npx cubefarm` and a bare `node --import tsx server/index.ts` have none, so there the office only reports that an update is ready.
