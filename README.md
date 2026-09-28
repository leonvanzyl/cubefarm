# ✻ cubefarm

A cartoon 3D office where a team of Claude Code agents works through your GitHub issues. You walk the floors, look over their shoulders and watch their pull requests get tested and merged.

## Get started

```bash
npx cubefarm
```

That's it. cubefarm checks your machine, starts the office and opens it in your browser. The first time, `npx` asks whether to install cubefarm: say yes.

### What you need

- **Node.js 22 or newer**: [nodejs.org](https://nodejs.org)
- **git**
- **The GitHub CLI**, signed in: install it from [cli.github.com](https://cli.github.com), then run `gh auth login`
- **A Claude subscription**: sign in once with `npx cubefarm login`. Your agents use this login. You don't need to install Claude Code, because cubefarm brings its own.

Not sure you're ready? `npx cubefarm doctor` checks all four.

### Just want to look around?

```bash
npx cubefarm --demo
```

Demo mode fakes GitHub and the agents, so it costs nothing and changes nothing.

## Your first five minutes

1. **Set up your company.** A short wizard asks your name, names your company and introduces your CEO.
2. **Move in a project.** Pick one of your project folders or a GitHub repo, or start a new one. It gets its own floor. Every project needs to be on GitHub, because issues and pull requests are how the team works.
3. **Let the CEO plan.** The CEO studies the project, writes its QA checklist, plans the work as GitHub issues and proposes who to hire. Press `P` for your phone to chat with them and approve hires.
4. **Watch the work.** Developers pick up issues and open pull requests. QA testers review and test each one in a real browser, then post a report with screenshots. With auto-merge on, a pull request merges itself once QA passes and GitHub's checks are green.

## What's in the office

- **Floors**: one per project. Ride the elevator between them.
- **Desks**: walk up behind an agent to watch their monitor. It streams their real terminal, and shows a live browser when they test the UI.
- **The QA lab**: every floor has at least one QA tester.
- **The whiteboard**: the Kanban board, from backlog to merged.
- **The lobby**: the manager's office, where you connect projects, hire, file issues and change settings, and the CEO's corner office.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` / arrows | walk |
| `Shift` | run |
| mouse | look around (click the view first) |
| `E` | use what you're looking at: a desk, the whiteboard, the elevator, the manager's computer |
| `P` | your phone |
| `H` | help |
| `Esc` | let go of the mouse, or close a panel |

## Commands

| Command | What it does |
| --- | --- |
| `npx cubefarm` | start the office and open it in your browser |
| `npx cubefarm login` | sign in to Claude |
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

- **It runs on your Claude subscription.** Every agent draws on the same usage limits. To cap how many work at once, set a session limit in the manager's console.
- **Agents work on your machine.** By default they can only edit files in their own copy of the repo, can't push to your main branch and can't merge. The office merges, after QA.
- **Your office lives in `~/.cubefarm`**: settings, clones of your repos and one working copy per agent. Set `SWARM_HOME` to use another folder.

## Learn more

- [How it works](docs/how-it-works.md): the life of an issue, QA, auto-merge, models and usage, the safety model and floor previews
- [Contributing](CONTRIBUTING.md): run it from source, tests, architecture and publishing

## License

[MIT](LICENSE)
