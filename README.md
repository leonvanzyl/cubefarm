# ✻ cubefarm

A cartoon 3D office where a team of AI coding agents works through your GitHub issues. You walk the floors, look over their shoulders and watch their pull requests get tested and merged.

## Get started

```bash
npx cubefarm
```

That's it. cubefarm checks your machine, starts the office and opens it in your browser. The first time, `npx` asks whether to install cubefarm: say yes.

### What you need

- **Node.js 22 or newer**: [nodejs.org](https://nodejs.org)
- **git**
- **The GitHub CLI**, signed in: install it from [cli.github.com](https://cli.github.com), then run `gh auth login`
- **A coding agent subscription**: cubefarm brings Claude Code, the default agent and the one your CEO runs: sign in once with `npx cubefarm login`. You don't need to install it. Agents can also run Codex or OpenCode, if you have them installed and signed in.
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
3. **Let the CEO plan.** The CEO studies the project, writes its QA checklist, plans the work as GitHub issues and proposes who to hire. Press `P` for your phone to chat with them and approve hires, or meet the candidates waiting in the lobby and interview them face to face.
4. **Watch the work.** Developers pick up issues and open pull requests. QA testers review and test each one in a real browser, then post a report with screenshots. With auto-merge on, a pull request merges itself once QA passes and GitHub's checks are green.

## What's in the office

- **Floors**: one per project. Ride the elevator between them.
- **The roof**: the elevator's top stop. A garden, deck chairs to sit back in, a barbecue for a sausage, a telescope for the billboards by day and the moon and constellations by night, string lights at dusk and a helipad. Idle agents come up for a break now and then.
- **Desks**: walk up behind an agent to watch their monitor. Open it to see their real terminal: every agent is an actual coding agent running on your machine, and you can type into it. It also shows a live browser when they test the UI. Pick the coding agent, model and effort for the whole team or per agent.
- **The QA lab**: every floor has at least one QA tester.
- **The whiteboard**: the Kanban board, from backlog to merged. Aim at a sticky and press `E` to read it up close, or peel a Backlog sticky off with `G` and carry it to a free developer's desk to hand them the issue. Red strings join issues to the ones they depend on, and the corner counts today's merges, the issue-to-merge time, the QA queue and anything that needs you.
- **Who's doing what**: a sign over each busy agent says what they're on (📖 reading, ✏️ editing, 🧪 testing, 🌐 browsing, 🐙 git, ⏳ CI, 🔍 QA, 🔧 fixing). Keep someone in your sights for a moment for a card with their task, last steps and cost so far, and an LED ticker over the whiteboard scrolls the floor's news.
- **The lobby**: the manager's office, where you connect projects, hire, file issues and change settings, and the CEO's corner office.
- **Agent setup**: the ⚙️ Setup button in an agent's panel changes their name, look, coding agent, model, effort and job description, and "What they're told" shows the full prompt the office gives them.
- **Merges**: confetti bursts over the developer's desk when their pull request merges, and the floor's gong booms while everyone cheers (press `E` at the gong to bang it yourself).
- **Rituals**: when the CEO files a burst of issues, the free agents gather at the whiteboard and the CEO comes up in the elevator to put up the new stickies (and says so out loud if the CEO's voice is on). The CEO walks the floors now and then (press `E` on them to text them), people eat lunch from noon to one, pizza arrives on Friday afternoons, and in the evening the desk lamps come on, idle agents head home and come back in the morning with a coffee. They follow the sky's clock (in help: a 30-minute day, your own clock, or always afternoon).
- **Time-lapse**: watch the day (or just what happened while you were away) replay in the office at up to 600×, from the manager's console or the screen in the lobby.
- **Toys**: balls to throw, a basketball hoop (aim at the painted square and charge about halfway), foam blasters, a roomba, and coffee: take a mug from the dispenser, brew it at the machine and sip it with `E`.
- **The office dog**: one dog for the whole building (Biscuit, renameable in Settings). Pet it with `E` and it follows you, throw a ball and it fetches it, and it naps, keeps struggling agents company, celebrates merges and rides the elevator between floors.
- **Sounds**: a master volume, `M` to mute, and a slider each for footsteps, typing, toys and alerts. Find them in help (`H`).

## Controls

| Key | Action |
| --- | --- |
| `W A S D` / arrows | walk |
| `Shift` | run |
| mouse | look around (click the view first) |
| `E` / left click | use what you're looking at: a desk, the whiteboard, the elevator, the manager's computer, a ball, a mug, the coffee machine |
| `E` with coffee | take a sip (three to a mug, the last a big gulp) |
| `E` on the roof | sit back in a deck chair, grill (and eat) a sausage, look through the telescope (mouse wheel zooms) |
| `F` / left click, holding something | throw a ball (hold to charge) or fire a blaster |
| `G` | drop what you're holding, or peel the whiteboard sticky you aim at off the board |
| `R` | reload a blaster |
| `P` | your phone |
| `Tab` | the overview: the whole floor from above, dollhouse style (drag to pan, scroll to zoom, `Q` / `E` to turn, click someone to open their panel); `Tab` again flies you back, twice quickly shows the whole building |
| `L` | show or hide who's working |
| `M` | mute or unmute |
| `H` | help, with every control and the sound settings; its Controls tab rebinds every key and sets up the mouse and gamepad |
| `Esc` | let go of the mouse, close a panel, or leave the overview |

A gamepad works too (left stick walks, right stick looks, A uses, B goes back, X picks up or drops, the triggers throw, Start opens the phone, Select the overview), and **🎥 Follow** in an agent's panel trails them with the camera.

## Commands

| Command | What it does |
| --- | --- |
| `npx cubefarm` | start the office and open it in your browser |
| `npx cubefarm login` | sign in to Claude Code, the built-in coding agent |
| `npx cubefarm doctor` | check that your machine is ready |
| `npx cubefarm --demo` | fake GitHub and fake agents |
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

- **It runs on your coding agents' subscriptions.** Agents on the same coding agent draw on the same usage limits. To cap how many work at once, set a session limit in the manager's console.
- **Agents work on your machine, like your own coding agents**: with your skills, MCP servers and settings, each in its own copy of the repo. They can't push to your main branch or merge: the office merges, after QA.
- **Your office lives in `~/.cubefarm`**: settings, clones of your repos and one working copy per agent. Set `SWARM_HOME` to use another folder. Desks nobody uses any more are swept away every 30 minutes, and any unpushed work on them is kept as a patch in `~/.cubefarm/leftovers`.

## Learn more

- [How it works](docs/how-it-works.md): the life of an issue, QA, auto-merge, models and usage, the safety model and floor previews
- [The office in your pocket](docs/pocket.md): pocket mode on your phone, installing the app, notifications (desktop, push, Discord, Slack, Telegram, ntfy) and reaching the office safely from your phone
- [Contributing](CONTRIBUTING.md): run it from source, tests, architecture and publishing

## License

[MIT](LICENSE)
