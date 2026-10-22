# Cloud agents

Out of the box every agent works on your computer: close the office or shut your laptop and they stop. **Cloud agents** work in an [Upstash Box](https://upstash.com/docs/box/overall/quickstart) each instead, a small Linux machine in the cloud, so they carry on with their task while the office is closed. It's optional: agents on your computer stay the default, and you can have both on one floor.

## What keeps going while the office is closed

A cloud agent finishes the task it's on: it writes the code, runs the checks, pushes its branch and opens its pull request, or tests a pull request and writes its QA report. When you open the office again it picks up where things are: it reads what each cloud agent did while it was away, queues QA for the pull requests they opened, posts the QA reports they wrote, and hands out the next work.

The office itself still runs on your computer. Handing out new work, QA hand-offs between agents and merging happen while it's open. (Running the office itself in the cloud is a later step.)

## Set it up

You need an Upstash account. The free plan is enough to try it.

1. **Connect Upstash.** In the [Upstash console](https://console.upstash.com), open **Box → API Keys** and create a key. In the office: the manager's console → **Settings → Cloud agents** → paste it as the *Upstash Box API key*. The office checks it before saving it.
2. **GitHub, once for every Box.** Your `gh` login is used as it is (the office reads `gh auth token` when a session starts and never saves it). Safer: paste a [fine-grained token](https://github.com/settings/personal-access-tokens/new) limited to your floors' repos, with **Contents**, **Pull requests** and **Issues** set to read and write.
3. **Choose where new agents work.** Under *Where new agents work*, pick **An Upstash Box each**. New hires work in the cloud from then on, and the lobby lets you choose for each candidate. To move an agent you already have, open their ⚙️ Setup and change *Works on* while they have no task.
4. **Sign each cloud agent in, once.** Their coding agent signs in with your own subscription, in their terminal: see below.

The demo office (`npx cubefarm --demo`) has a fake Upstash account: any key works, and its Boxes appear and disappear without costing anything. Its sign-ins are fake too (any code works), and Settings → Cloud agents → *Expire sign-ins (demo)* signs every Box out, to see what an expired sign-in looks like.

## Signing a cloud agent in

A cloud agent's Claude Code or Codex signs in with **your own subscription** (Claude Pro or Max, a ChatGPT plan), through the coding agent's own login, run in that agent's terminal. You finish Anthropic's or OpenAI's sign-in yourself, once per cloud machine:

1. When a new cloud agent's Box is ready, the office asks their coding agent whether it's signed in. If it isn't, the agent is marked **needs sign-in**: they take no work (a task they were starting waits), their desk gets a 🔑 note on the monitor, and their card a **🔑 Sign in** button. The phone tells you too.
2. Walk to their desk and press `E`, or tap **🔑 Sign in** (the manager's console → Team, the phone's Team tab, or the list view). Their terminal opens with the sign-in running:
   - **Claude Code** (`claude auth login`) shows a link. Open it, approve with your Claude account, paste the code the page gives you into the terminal and press Enter.
   - **Codex** (`codex login --device-auth`) shows a link and a one-time code. Open the link, sign in to ChatGPT and enter the code there. (Codex's usual sign-in waits for a browser on the Box itself, which nobody can open; this one works from anywhere.) The code lasts 15 minutes: **↻ Start over** above the terminal shows a new one.
3. The office sees the sign-in is done, clears the flag and starts the task that waited.

The Box keeps the sign-in (Claude Code's in `~/.claude`, Codex's in `~/.codex`, in the Box user's home) through pauses and office restarts, so each cloud machine signs in once. It's gone with the Box when the agent leaves.

**When a sign-in expires** (or is revoked), the office notices before the agent's next task, or when their session fails on it mid-task. It forgets the dead login in their Box, marks them **needs sign-in** again and holds the task; signing in again the same way carries the task on in the same conversation.

**Rather not sign in Box by Box?** A key in Settings → Cloud agents is used by every cloud agent instead: an **Anthropic API key** (`sk-ant-…`, billed per token) for Claude Code, an **OpenAI API key** for Codex. Or, for Claude Code with your subscription, a token from `claude setup-token` kept in your environment as `CUBEFARM_CLAUDE_TOKEN` (Windows: `setx CUBEFARM_CLAUDE_TOKEN "<token>"`; macOS or Linux: `export CUBEFARM_CLAUDE_TOKEN="<token>"` in your shell profile), then restart the office. It's a cubefarm-only name, so your own `claude` keeps its normal login, and the office never writes it down.

## How it works

- **A Box per agent.** A cloud agent's Box is created and set up in the background when they're hired or moved (it takes about a minute). It's named `cubefarm-<office>-<agent>` and labelled `cubefarm`, so it stands apart from Boxes your other apps use, and the office only ever touches its own. The office installs its own copies of the coding agents at the versions it supports (not the Box image's), Playwright for browser testing, tmux and git in it. The Box keeps the agent's own clone and worktree of the floor's repo between tasks, like a machine on your computer would.
- **The office's credentials never land on the Box's disk.** GitHub's token and a key or token from Settings travel only as the environment of the commands that need them. git reads the token through a helper, not from a file. Keys you paste are kept in `~/.cubefarm/secrets.json` on your computer, never in the office's state, its logs or what your browser sees. The one exception is a coding agent's **own sign-in**: Claude Code and Codex keep their login in the Box user's home, where the agent (who runs as that user) can read it.
- **The office never sees a sign-in.** It starts the coding agent's own login in the agent's terminal and passes your keys and its screen along as for any terminal. It never reads, parses or stores the link, the code or the login, and asks only whether the coding agent is signed in (by its exit code). It never copies a login from your computer into a Box: Anthropic's terms don't let apps like this one collect or store Claude.ai credentials, and copied logins log each other out as their refresh tokens rotate.
- **The terminal is live.** An agent's CLI runs under tmux in their Box, and their desk shows its terminal as for any agent: watch it, type to it, press `Esc` to interrupt. If the connection drops, the office reconnects; the agent never notices.
- **The office reads what they did.** A Box can't reach your computer, so a cloud agent's CLI writes what it does (each tool call, each finished turn, its cost) to a file in its Box. The office reads that file while it's connected, and catches up on it when it comes back.
- **Idle Boxes pause.** A cloud agent's CLI closes 5 minutes after it finished, and an agent with nothing to do has their Box paused. A paused Box costs nothing but its disk and wakes in seconds for the next task. Upstash also pauses a Box nobody has used for a while: after an hour on the free plan, six hours on pay-as-you-go.
- **Leaving.** When a cloud agent leaves, their work that isn't on GitHub is saved to `~/.cubefarm/leftovers` as a patch, then their Box is deleted. **Delete orphans** in Settings removes Boxes this office no longer has an agent for.

## Costs and limits

- Upstash bills a Box for the CPU it uses while it works, from $0.10 per active CPU hour for a small Box (2 vCPU, 4 GB). Paused Boxes only pay for their disk. Settings → Cloud agents sets the size for new Boxes. See [Upstash's pricing](https://upstash.com/pricing/box).
- The free plan allows **10 Boxes** (paused ones count) and 5 CPU hours a month. Set *Your plan's Box limit* to match your plan: the office won't hire a cloud agent past it.
- Coding agents in the cloud use your subscription or API key the same way they do on your computer, and share its usage limits.
- **OpenCode** can't run in a Box yet; an OpenCode agent stays on your computer.
- **Linked repos** are copied into the Box read-only for each task instead of being read from your computer.

## Security

Agents in a Box work like agents on your computer: they approve their own tool calls, hold their credentials for the length of a session and read issue text. The difference is where: a Box is a sandbox of its own, with nothing of yours on it except the floor's repo and, once you sign them in, their coding agent's login, which the agent can read like any file in its home. Read an issue before you let an agent take it, especially in a public repo. If you think a Box's sign-in was misused, sign out of other sessions from your Claude or ChatGPT account, or let the agent go (their Box goes with them). Rotate a token or key if it was ever shown or pasted somewhere it shouldn't have been; the `claude setup-token` token lasts a year.
