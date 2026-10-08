# ✻ cubefarm

A cartoon 3D office where a team of AI coding agents works through your GitHub issues. You walk the floors, look over their shoulders and watch their pull requests get tested and merged.

Every agent is a real coding agent, **Claude Code, Codex or OpenCode**, running in a terminal of its own on your machine with your logins, settings, skills and MCP servers. Run the whole team on one, or give each agent its own. The office hands out the work, has every pull request reviewed and tested in a real browser, and merges what passes.

## Get started

```bash
npx cubefarm
```

That's it. cubefarm checks your machine, starts the office and opens it in your browser. The first time, `npx` asks whether to install cubefarm: say yes.

### What you need

- **Node.js 22 or newer**: [nodejs.org](https://nodejs.org)
- **git**
- **The GitHub CLI**, signed in: install it from [cli.github.com](https://cli.github.com), then run `gh auth login`
- **Claude Code, signed in**: it comes with cubefarm, so there's nothing to install. Run `npx cubefarm login` once to sign in with your Claude subscription. It's the default coding agent, and the CEO always runs on it.
- **Codex or OpenCode** (optional): if you have them installed and signed in, any agent can run them instead (see [Coding agents](#coding-agents)).
- **Google Chrome**, for agents that test your app in a browser.

It runs on Windows, macOS and Linux. Not sure you're ready? `npx cubefarm doctor` checks all of it.

### Just want to look around?

```bash
npx cubefarm --demo
```

Demo mode fakes GitHub and the agents, so it costs nothing and changes nothing.

## Your first five minutes

1. **Set up your company.** A short wizard asks your name, names your company and introduces your CEO.
2. **Move in a project.** Pick one of your project folders or a GitHub repo, or start a new one. It gets its own floor. Every project needs to be on GitHub, because issues and pull requests are how the team works.
3. **Let the CEO plan.** The CEO studies the project, writes its QA checklist and sizes the floor's team. New work only ever comes from you: give the CEO a brief (when the project moves in, or later with **Plan**) or message them, and they turn it into GitHub issues. The CEO never files issues on its own. Press `P` for your phone to chat with them and approve team changes, or meet the new agents waiting in the lobby and set them up (coding agent, model, effort) before you hire them.
4. **Watch the work.** Agents are interchangeable: a free agent picks up the next issue, builds it on a branch of its own and opens a pull request. Another agent reviews and tests it in a fresh session and a real browser, then posts a report with screenshots on the pull request. If QA fails, the author fixes it and it goes round again. With auto-merge on, a pull request merges itself once QA passes and GitHub's checks are green. Each agent works on a machine of its own (its own clone, worktree and temp folder; see [Agents](docs/agents.md)).

## Coding agents

Every agent, the CEO included, is the actual coding-agent CLI in a terminal on your machine. Open someone's desk to watch their terminal live, click it to type to them, or press `Esc` in it to interrupt. They load your setup the way your own terminal sessions do: your settings, `CLAUDE.md` or `AGENTS.md`, skills, plugins and MCP servers.

| | Claude Code | Codex | OpenCode |
| --- | --- | --- | --- |
| Install | comes with cubefarm: `npx cubefarm login` | your own, signed in | your own, signed in |
| What the office sees | every step, plus cost and usage | every step, once you trust its hooks | each finished turn |
| Status | the default; the CEO runs it | experimental | experimental |

- **One for everyone, or one each.** The manager's console → Settings sets the default coding agent, its model and the reasoning effort (out of the box: Claude Code with Claude Opus 5.5 at medium effort). An agent's ⚙️ Setup, the Team tab, or a new agent's chair in the lobby changes them for one agent. One subscription is all you need; mixing them (say, Codex agents testing what Claude Code agents wrote) is up to you.
- **Codex's hooks.** The first time, Codex asks you to review the office's hooks: type `/hooks` in a Codex agent's terminal and press `t` to trust them. Until then the office shows a Codex agent's task rather than each step.
- **Usage.** Agents on the same coding agent share its usage limits. When Claude warns that usage is getting high, the office slows down new work until the window resets. To cap how many agents run at once, set a session limit in the manager's console.
- **Restarts.** Agents keep working while the office restarts (an update, a crash): their terminals live in a small process of their own and reconnect when the office is back.

More in [How it works](docs/how-it-works.md#agents-terminals).

## What's in the office

### The work

- **Floors**: one per project. Ride the elevator between them.
- **Desks**: walk up behind an agent to watch their monitor, and open it for their real terminal, which you can type into. It also shows a live browser when they test the UI. The ⚙️ Setup in their panel changes their name, look, coding agent, model and effort, and "What they're told" shows the prompts the office gives them for each kind of task.
- **The whiteboard**: the Kanban board, from backlog to merged. Aim at a sticky and press `E` to read it up close, or peel a Backlog sticky off with `G` and carry it to a free agent's desk to hand them the issue (a pull request sticky asks them to test it). Red strings join issues to the ones they depend on, and the corner counts today's merges, the issue-to-merge time, the QA queue and anything that needs you.
- **Who's doing what**: a sign over each busy agent says what they're on (📖 reading, ✏️ editing, 🧪 testing, 🌐 browsing, 🐙 git, ⏳ CI, 🔍 QA, 🔧 fixing). Keep someone in your sights for a moment for a card with their task, last steps and cost so far, and an LED ticker over the whiteboard scrolls the floor's news.
- **The lobby**: the manager's office, where you connect projects, meet new agents, file issues and change settings, and the CEO's corner office.
- **Mission control**: the bank of screens behind reception: each floor's pipeline, merges today, lead time, QA wait, GitHub's checks, cost, and Claude's usage meter. A beacon spins red when a pull request needs you.
- **Your app, running**: every floor can run its app so you can use it from the office, and any open pull request can run beside it in the PR theatre (aim at a channel on the big screen and press `E`), with main side by side if you want to compare.
- **Merges**: confetti bursts over the author's desk when their pull request merges, and the floor's gong booms while everyone cheers (press `E` at the gong to bang it yourself).

### Office life

- **Chatter**: the team talks about their real work in speech bubbles ("PR #212 is up for QA", "Tests are green! ✅", "Ugh, a merge conflict in store.ts") in a cute babble voice of their own, Animal Crossing style. Aim at someone with nothing to do and press `E` to say hi. Off, quiet or lively, with or without the babble, in help (`H`).
- **Rituals**: when the CEO files a burst of issues, the free agents gather at the whiteboard and the CEO comes up in the elevator to put up the new stickies (and says so out loud if the CEO's voice is on). The CEO walks the floors now and then (press `E` on them to text them), people eat lunch from noon to one, pizza arrives on Friday afternoons, and in the evening the desk lamps come on, idle agents head home and come back in the morning with a coffee. They follow the sky's clock (in help: a 30-minute day, your own clock, or always afternoon).
- **Careers and coins**: every agent has a career card with a rank, badges, stats and their last merged pull requests. Merges, first-time QA passes and green checks earn the floor coins to spend on decorations at the lobby's kiosk, and the office's achievements stand on its trophy shelf.
- **The roof**: the elevator's top stop. A garden, deck chairs to sit back in, a barbecue for a sausage, a telescope for the billboards by day and the moon and constellations by night, string lights at dusk and a helipad. Idle agents come up for a break now and then.
- **Toys**: balls to throw, a basketball hoop (aim at the painted square and charge about halfway), foam blasters, a roomba, a jukebox on every floor, and coffee: take a mug from the dispenser, brew it at the machine and sip it with `E`.
- **The office dog**: one dog for the whole building (Biscuit, renameable in Settings). Pet it with `E` and it follows you, throw a ball and it fetches it, and it naps, keeps struggling agents company, celebrates merges and rides the elevator between floors.
- **Ping-pong**: `E` at either end of the table picks up a paddle and someone free comes to play you; the mouse moves the paddle and your swing sets the pace and spin. Games go to 11 and feed the floor's leaderboard on the wall.
- **Outside**: a city around the building, a sky that follows the office's clock, and weather: a calm cycle, or your own local weather (Settings).
- **Holidays**: the office dresses up for Halloween, Christmas, New Year's Eve, Valentine's Day, Easter and your birthday (Settings → Themes).

### Around the office

- **Visitors**: anyone else with the office open (another tab, a colleague) walks around in it as a visitor, and you see them. Hold `T` to emote and press `X` (or middle-click) to point something out. Your name, colour and whether others see you are in Settings → Profile.
- **Voice**: hear the CEO's messages read aloud (your browser's voice, or ElevenLabs with your own key), and talk instead of typing: hold the 🎙️ or `V` in any message box. See [Voice messages](docs/voice.md).
- **Pocket mode**: on a phone, the office opens as a 2D app with the pipeline, the CEO chat, the Kanban, the team and approvals. It installs on your home screen and can notify you when something needs you. See [The office in your pocket](docs/pocket.md).
- **Time-lapse**: watch the day (or just what happened while you were away) replay in the office at up to 600×, from the manager's console or the screen in the lobby.
- **Photo mode**: `K` freezes the office and hands you a camera to fly, with filters, shots, clips and instant replay.
- **Accessibility**: captions for the office's sounds, colour-blind-safe status colours and shapes, motion comfort, UI scale, a readable font, high contrast, and a list view of each floor for anyone who can't use the 3D view (Settings → Accessibility).
- **Sounds and graphics**: a master volume, `M` to mute, and a slider each for footsteps, typing, toys and alerts; graphics from Low to High, or Auto to keep it smooth. Both in help (`H`).

## Controls

| Key | Action |
| --- | --- |
| `W A S D` / arrows | walk |
| `Shift` | run |
| mouse | look around (click the view first) |
| `E` / left click | use what you're looking at: a desk, the whiteboard, the elevator, the manager's computer, a ball, a mug, the coffee machine, the jukebox; say hi to someone with nothing to do |
| `E` with coffee | take a sip (three to a mug, the last a big gulp) |
| `E` on the roof | sit back in a deck chair, grill (and eat) a sausage, look through the telescope (mouse wheel zooms) |
| `F` / left click, holding something | throw a ball (hold to charge) or fire a blaster |
| mouse / left click, playing ping-pong | move the paddle (swing it for pace and spin) / toss and serve |
| `G` | drop what you're holding, or peel the whiteboard sticky you aim at off the board |
| `R` | reload a blaster |
| `-` / `+` | the jukebox softer or louder |
| `T` (hold) | the emote wheel: wave, thumbs up, clap, point, laugh |
| `X` / middle click | ping where you aim, for everyone on the floor |
| `V` (hold, in a message box) | talk instead of typing |
| `P` | your phone |
| `Tab` | the overview: the whole floor from above, dollhouse style (drag to pan, scroll to zoom, `Q` / `E` to turn, click someone to open their panel); `Tab` again flies you back, twice quickly shows the whole building |
| `L` | show or hide who's working |
| `K` | photo mode: freeze the office, fly a camera, filters, shots and clips |
| `I` | save the last 15 seconds (once instant replay is on, in photo mode or help) |
| `M` | mute or unmute |
| `H` | help, with every control and the sound settings; its Controls tab rebinds every key and sets up the mouse and gamepad |
| `Esc` | let go of the mouse, close a panel, or leave the overview |

A gamepad works too (left stick walks, right stick looks, A uses, B goes back, X picks up or drops, the triggers throw, Start opens the phone, Select the overview), and **🎥 Follow** in an agent's panel trails them with the camera.

## Commands

| Command | What it does |
| --- | --- |
| `npx cubefarm` | start the office and open it in your browser |
| `npx cubefarm login` | sign in to Claude Code, which comes with cubefarm (Codex and OpenCode use their own sign-in) |
| `npx cubefarm doctor` | check that your machine is ready |
| `npx cubefarm --demo` | fake GitHub and fake agents |
| `npx cubefarm --demo --floors 10 --agents 15` | a big demo company: 10 floors of 15 people, to see the office at scale |
| `npx cubefarm --port 4400` | use another port (the default is 4317) |
| `npx cubefarm --no-open` | don't open the browser |

## Updating

`npx` keeps using the version it downloaded first. When a newer one is out, cubefarm tells you as it starts. To update:

```bash
npx cubefarm@latest
```

Prefer a permanent install? Run `npm install -g cubefarm`, then start it with `cubefarm`.

Running it from a clone of this repo (`npm start`)? Then the office updates itself from GitHub once its agents are done: see [Updating the office](docs/how-it-works.md#updating-the-office).

## Good to know

- **It runs on your own subscriptions.** Each agent uses the login of the coding agent it runs, and agents on the same coding agent share its usage limits.
- **Agents work like the coding agents you run yourself**: unsandboxed, with your skills, MCP servers and settings, each in its own copy of the repo. Nobody has to be there to approve a tool call, so the office approves them all: run it where you'd run your own coding agents. The office's rules are in the agents' instructions: push your own branch and open a pull request, never push to your main branch or merge. The office merges, after QA.
- **Your office lives in `~/.cubefarm`**: settings, clones of your repos and one machine (a clone and a worktree) per agent. Set `SWARM_HOME` to use another folder. Machines and desks nobody uses any more are swept away every 30 minutes, and any unpushed work on them is kept as a patch in `~/.cubefarm/leftovers`.
- **It's only open to your own computer.** The office listens on `127.0.0.1`. To reach it from your phone, put something that signs you in in front of it, like Tailscale Serve: see [Reach the office from your phone](docs/pocket.md#reach-the-office-from-your-phone).

## Learn more

- [How it works](docs/how-it-works.md): the life of an issue, QA, auto-merge, models and usage, agents' terminals, the safety model and floor previews
- [Agents](docs/agents.md): interchangeable agents, team sizes and the CEO's team changes, each agent's machine and how it signs in
- [The office in your pocket](docs/pocket.md): pocket mode on your phone, installing the app, notifications (desktop, push, ntfy) and reaching the office safely from your phone
- [Voice messages](docs/voice.md): the CEO's messages read aloud, ElevenLabs voices and talking instead of typing
- [Contributing](CONTRIBUTING.md): run it from source, tests, architecture and publishing

## License

[MIT](LICENSE)
