# Contributing

How to run cubefarm from source, test it and publish it. Agent sessions working on this repo also follow [CLAUDE.md](CLAUDE.md).

## Run it from source

```bash
git clone https://github.com/leonvanzyl/cubefarm.git
cd cubefarm
npm install
npm run dev    # or: npm run demo
```

Open http://localhost:5317 (`SWARM_CLIENT_PORT` moves Vite, `SWARM_PORT` the server). The server restarts when code in `server/` or `shared/` changes, and the client reloads itself.

For the build that gets published: `npm run build && npm start`.

All three run `scripts/office.mjs`, the launcher: `--dev` runs the server from source plus Vite, and without it (`npm start`) it runs `bin/cubefarm.js` on the build. It also keeps the checkout up to date: when the office has finished its work and a new commit is on `origin`, or when you type `u` + Enter in its terminal, it stops the office, fast-forwards, installs and builds as needed, and starts it again. See [Updating the office](docs/how-it-works.md#updating-the-office).

## Testing

```bash
npm test             # run every test once (Vitest)
npm run test:watch   # re-run tests as you edit
npm run typecheck
npm run build
npm run test:e2e     # browser smoke tests (Playwright): builds, boots a demo office and drives it (see below for when)
```

- Tests sit next to the code they cover as `*.test.ts`, anywhere under `client/`, `server/`, `shared/` or `scripts/` (e.g. `shared/issues.test.ts`). Vitest finds them through `vitest.config.ts`; `tsc` type-checks them and the Vite build leaves them out, since nothing in the app imports them.
- Keep them fast and offline: no network, no GitHub (`gh`), no Claude sessions and no real `~/.cubefarm`. Test pure logic directly, fake anything that would spend usage, and use a temp `SWARM_HOME` and random free ports for anything that needs a server. `npm test` already points `SWARM_HOME` at a temp folder.
- Before a pull request, run `typecheck`, `test` and `build`. Run `test:e2e` only when you changed `e2e/`, `playwright.config.ts` or how the office boots (`server/index.ts`, the start screen, the setup wizard), or to fix a failing e2e job: CI runs it on every pull request and is the gate.
- `npm run test:e2e` runs `e2e/*.spec.ts` headless with software WebGL against a demo office on port 4399 (`E2E_PORT` changes it) with a temp `SWARM_HOME`. It uses your installed Google Chrome when there is one, otherwise Playwright's Chromium (always in CI, or with `E2E_BROWSER=chromium`). If that browser is missing it stops at once and says so: run `npx playwright install chromium` once, into the shared cache (leave `PLAYWRIGHT_BROWSERS_PATH` unset). Just built? `E2E_SKIP_BUILD=1` reuses `dist/` instead of building again. Wait on what the page shows rather than sleeping, and don't rely on pointer lock, which a headless browser may not grant.
- One e2e spec file per feature (`e2e/coffee.spec.ts`, `toys.spec.ts`, …), sharing `e2e/helpers.ts` (the `test` that fails on console errors and failed requests, `enterOffice`, `startAt`). New e2e tests go in their feature's spec file or a new one, never appended to `smoke.spec.ts`, which keeps only the core boot and runs first (`playwright.config.ts`).
- GitHub Actions (`.github/workflows/ci.yml`) runs `npm ci`, `npm run typecheck`, `npm test` and `npm run build` for every pull request and every push to `main`, then packs the npm package, installs it into an empty folder and boots it in demo mode (`scripts/smoke-package.mjs`). That `check` job always runs on Ubuntu, and on Windows and macOS for every push to `main`, every manual run and every pull request that touches something OS-sensitive (`server/`, `shared/`, `scripts/`, `bin/`, `.github/`, `package.json`, the lockfile or the root configs); a pull request that only changes `client/`, `e2e/` or docs shows `check (windows-latest)` and `check (macos-latest)` as skipped, which counts as passing. A separate `e2e` job on Ubuntu runs `npm run test:e2e` and uploads the Playwright report when it fails. It needs no secrets.

### The agents' browser tool

Agents test in a browser through the Playwright MCP server, a pinned dependency (`@playwright/mcp` at an exact version in `package.json`) started as `node <its cli.js>` from the installed package (`server/browser.ts`), so a session never runs npx or touches the npm registry. It drives the installed Google Chrome. To bump it:

```bash
npm install --save-exact @playwright/mcp@<version>
node node_modules/@playwright/mcp/cli.js --help   # the flags in server/browser.ts still exist
npm test && npm run build && node scripts/smoke-package.mjs
```

Read its release notes first: a release that moves to a new Playwright may change which Chrome versions it supports.

## Architecture

```
client/  Vite + React + react-three-fiber (toon materials, canvas textures)
  src/world/   the 3D building: floors, desks, characters, laptops, whiteboard, elevator, player
  src/ui/      HUD and panels: terminal, Kanban, elevator, manager's console
bin/cubefarm.js  the `npx cubefarm` command: checks the machine, starts the server, opens the browser
scripts/office.mjs  the launcher for a checkout (npm run dev / demo / start): runs the office and updates it
server/  Node + Express + ws
  swarm.ts        orchestrator: floors, agents, scheduling, persistence, websocket fan-out
  agentRunner.ts  one Claude Agent SDK session per agent; turns its stream into terminal lines
  cliRunner.ts    one agent as the real CLI in a pseudo-terminal: hooks, turn endings, the CEO's tools over MCP
  ptyHost.ts      the terminal keeper: its own process holding the CLIs' terminals and hooks through office restarts
  ptyClient.ts    the office's side of the keeper (ptyProtocol.ts: their messages)
  clis.ts         the CLIs agents can run (Claude Code, Codex, OpenCode): finding them, their command lines
  terminal.ts     each agent's terminal: a headless xterm mirror, its viewers, keystrokes to the running CLI
  github.ts       everything GitHub, via the gh CLI
  workspace.ts    clones + per-agent git worktrees
  previews.ts     one preview per floor: ports, statuses, start / stop
  previewRunner.ts  checkout, install and run a floor's app in its preview worktree
  demo.ts         fake GitHub and fake agents for `npm run demo`
shared/types.ts   the websocket / REST contract
```

The server streams everything to the browser over one websocket (`/ws`); an open terminal panel has its own (`/ws/term?agent=<id>`). Laptop screens and the whiteboard are canvases drawn from that data and used as textures. They only repaint when something changed, and less often when you're far away.

## Publishing

The npm package holds `bin/cubefarm.js` (the command), `dist/` (the built client) and `dist-server/` (the server, bundled into plain JavaScript by `scripts/build-server.mjs`, because Node won't run TypeScript from inside `node_modules`). The client's libraries are bundled into `dist/`, so users only install the server's dependencies.

Releases are published by GitHub Actions (`.github/workflows/release.yml`), not from a laptop. Once `main` has what you want to ship and its CI is green: on GitHub, open **Actions → Release → Run workflow**, pick `patch`, `minor` or `major` and run it. The workflow bumps `package.json`, runs the tests, the build and the package smoke test, pushes a `Release x.y.z` commit and its `vx.y.z` tag to `main`, publishes to npm and creates a GitHub release whose notes list the PRs merged since the last one.

It publishes with [trusted publishing](https://docs.npmjs.com/trusted-publishers): npm trusts that workflow file in this repo, so there is no npm token to store or renew, and every version gets a provenance statement. If anything fails before the push, nothing was released: fix it and run the workflow again (the same goes for a PR merged while it ran). If the publish itself fails after the push, that version number is used up on GitHub only, and the next run releases the one after it.

Pushing a tag from a laptop still works and runs the same workflow:

```bash
npm version patch -m "Release %s"   # or minor / major: bumps package.json, commits and tags v<version>
git push --follow-tags              # the v* tag starts the release workflow
```

`npm pack --dry-run` lists exactly what would be published, and `node scripts/smoke-package.mjs` (after `npm run build`) installs the package into an empty folder and boots it in demo mode, like CI does.
