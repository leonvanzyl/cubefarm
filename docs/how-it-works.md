# How cubefarm works

The details behind the office: how an issue becomes a merged pull request, who does what, and what agents are allowed to do on your machine. For getting started, see the [README](../README.md).

## How an issue flows through the office

1. **Backlog.** An issue is assigned to a developer, either by you (Kanban, terminal panel or manager's console) or automatically when **auto-assign** is on for that floor. Auto-assign keeps every developer busy while there's work that can start:
   - An issue that says `Depends on #N` waits until #N is closed. Of the rest, the ones that hold up the longest chain of other issues go first, then the oldest.
   - A `swarm:<specialty>` label is a preference, not a lock. A free specialist gets first pick, and otherwise the issue goes to whichever free developer is least needed for their own specialty.
   - If a session fails, its issue goes back on the board for someone else, and the agent gets new work after a two-minute cooldown. An issue that fails twice waits for you to assign it by hand.
   - If Claude turns a session away because your usage limit is reached, the office starts no new work until the limit resets.
2. **In progress.** The server fetches the repo and creates a git worktree for that developer on the branch `swarm/issue-<n>-<agent>`, branched from the default branch. A Claude Code session starts there with the issue text. The developer implements the change, runs the project's checks, pushes the branch and opens a PR with `gh pr create` that says `Closes #<n>`.
3. **In QA.** The PR is handed to the floor's QA lab. A free QA tester checks out the PR head in their own worktree; when every tester is busy, a free developer who didn't write the PR covers for them, `testing` specialists first. The tester then:
   - reads the PR and the linked issue to work out the acceptance criteria
   - reviews the diff like a code reviewer: bugs, unhandled errors and edge cases, security problems, leftover debug code, missing tests
   - runs the test suite, linters and build
   - exercises the feature in a real headless browser (Playwright), including phone sizes and edge cases, taking screenshots of each important state
   - returns a structured report: a verdict, the checks performed, the commands run, and a caption for each screenshot
4. **Evidence on the PR.** The server uploads the screenshots to an orphan branch called `swarm-qa-evidence`, so evidence never lands in your code, and posts a comment on the PR. The comment contains the verdict, a table of checks, the commands run, and the screenshots.
5. **Fail → fix → re-test.** If QA fails, the report goes back to the developer who wrote the PR, who resumes their own Claude Code session and pushes fixes to the same branch. If they're busy on something else, any free developer takes the fix instead. The PR then goes back to QA for the next round. After 3 failed rounds it's flagged **needs you**.
6. **Merge.** Once QA passes, the PR moves to **Ready to merge**. With **auto-merge** on for the floor (the default; switch it in the manager's console or on the Kanban board), the office takes it from there:
   - It waits for GitHub's checks (Actions, Vercel and so on) and merges as soon as they're green, but only the exact commit QA signed off on. Commits pushed after the sign-off go back through QA first.
   - If checks fail, or the PR conflicts with the default branch because other work merged first, a free developer gets the failing checks or the conflict, fixes the branch, and QA re-tests it when the code changed. After 3 such fixes it's flagged **needs you**.
   - It squash-merges (falling back to a merge commit if the repo doesn't allow squash), deletes the remote branch, and updates the branch first if the repo only merges up-to-date branches.
   - If GitHub refuses the merge (say, branch protection wants an approving review), your phone gets a message and the office retries every 10 minutes. Checks still running after 30 minutes also get a message.
   - Only `swarm/` branches merge themselves. PRs people opened are left for you.

   With auto-merge off, review the PR on GitHub, including the QA comment, then press **Merge** (squash) on the board. Merging a PR that hasn't passed QA asks you to confirm first. Either way, the developer sees the merge, celebrates, and goes back to the backlog.
7. **Your folder catches up.** After any merge, the floor's folder fast-forwards to the default branch, but only when it's on that branch with no local changes. Nothing is ever stashed, reset or discarded; otherwise the manager's console shows why it wasn't updated (`2 behind: local changes`, `on branch feature-x`, `diverged`). If `package.json` or the lockfile changed, it runs `npm install`. The office's own folder is never updated while it runs: it shows `update ready` instead. **Sync now** in the manager's console retries.

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
- Every agent draws on the same subscription usage limits. By default every agent with work runs at once; set a **Session limit** in the manager's console to cap it. When a limit is hit, the agent's terminal shows it.

## Safety model

Agents run on your machine, so the default **guarded** permission mode:

- auto-approves file edits inside the agent's own worktree and refuses writes anywhere else
- refuses force-pushes, pushes to the default branch, `gh pr merge` (the office does the merging), repo admin commands and a few destructive shell patterns
- gives agents only the Playwright MCP server: claude.ai connectors (Gmail, Drive, …), user-level MCP servers and plugins are not loaded (`strictMcpConfig`)
- disables `AskUserQuestion`. Nobody is watching live, so agents decide and record their assumptions in the PR

**Bypass** mode turns every check off. Use it only in a disposable VM or container.

The repo's own project settings (`CLAUDE.md`, `.claude/settings.json`, skills) are loaded, so agents follow each project's conventions. Project `.mcp.json` servers are not loaded.

## Where things live

- `~/.cubefarm/state.json`: floors, agents, settings and terminal history (`SWARM_HOME` overrides the folder)
- `~/.cubefarm/workspaces/<owner>__<repo>/main`: a clone of each repo
- `~/.cubefarm/workspaces/<owner>__<repo>/desks/<agent>`: one worktree per agent

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

## Updating the office

Run from a clone of this repo, the office has a parent process, the launcher `scripts/office.mjs`. `npm start` runs the built office under it (`bin/cubefarm.js`: the usual checks, then `dist-server/` serving `dist/`); `npm run dev` and `npm run demo` add `--dev`: the server from source plus Vite (on `SWARM_CLIENT_PORT`, default 5317), with the server restarted when code in `server/` or `shared/` changes. It starts the server with an IPC channel and `SWARM_LAUNCHER=1`.

When the office has finished its work and asks for an update (`{ type: 'office:update', from }`), or when you type `u` + Enter in the launcher's terminal, the launcher:

1. Pauses the file watcher and stops the office: it sends the server `{ type: 'office:shutdown' }` (the server stops its floor previews and exits), stops Vite, and kills whatever is still running after 20 seconds, process trees included (`taskkill /T /F` on Windows).
2. Checks the folder: only on origin's default branch, with no local changes and no local commits. Otherwise it changes nothing. Nothing is ever stashed or discarded.
3. Runs `git fetch` and `git merge --ff-only origin/<default>`.
4. Runs `npm install --no-save` if `package.json` or `package-lock.json` changed. This only happens once nothing is running, because Windows locks esbuild's and Rollup's binaries while they're in use. `--no-save` leaves the lockfile as pulled, so another npm version can't turn it into a local change that blocks the next update.
5. Under `npm start`, runs `npm run build`.
6. Writes `<SWARM_HOME>/last-update.json`: `{ from, to, ok, error?, installed, built, at }`. Here `to` is the commit the office runs afterwards, `installed` and `built` say whether npm install and the build ran, and `at` is a timestamp in milliseconds. Then it starts the office again, and the server reports the result on your phone.

If a step fails, the launcher goes back with `git reset --keep <from>`, which never touches local changes. It reinstalls the old dependencies if npm install ran, rebuilds if a build ran, starts the old version and writes `ok: false` with the error. A refused update (another branch, local changes) also writes `ok: false`.

Ctrl+C (or SIGTERM) stops the server, then Vite, and leaves no processes behind; press it twice to quit at once. The launcher is only for a checkout: `npx cubefarm` and a bare `node --import tsx server/index.ts` have none, so there the office only reports that an update is ready.
