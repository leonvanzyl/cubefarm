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
npm run test:e2e     # browser smoke tests (Playwright): builds, boots a demo office and drives it
```

- Tests sit next to the code they cover as `*.test.ts`, anywhere under `client/`, `server/`, `shared/` or `scripts/` (e.g. `shared/issues.test.ts`). Vitest finds them through `vitest.config.ts`; `tsc` type-checks them and the Vite build leaves them out, since nothing in the app imports them.
- Keep them fast and offline: no network, no GitHub (`gh`), no Claude sessions and no real `~/.cubefarm`. Test pure logic directly, fake anything that would spend usage, and use a temp `SWARM_HOME` and random free ports for anything that needs a server. `npm test` already points `SWARM_HOME` at a temp folder.
- `npm run test:e2e` runs `e2e/*.spec.ts` in headless Chromium with software WebGL against a demo office on port 4399 (`E2E_PORT` changes it) with a temp `SWARM_HOME`. The first time, get the browser with `npx playwright install chromium`. Wait on what the page shows rather than sleeping, and don't rely on pointer lock, which a headless browser may not grant.
- GitHub Actions (`.github/workflows/ci.yml`) runs `npm ci`, `npm run typecheck`, `npm test` and `npm run build` on Ubuntu and Windows for every pull request and every push to `main`, then packs the npm package, installs it into an empty folder and boots it in demo mode (`scripts/smoke-package.mjs`). A separate `e2e` job on Ubuntu runs `npm run test:e2e` and uploads the Playwright report when it fails. It needs no secrets.

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
  github.ts       everything GitHub, via the gh CLI
  workspace.ts    clones + per-agent git worktrees
  previews.ts     one preview per floor: ports, statuses, start / stop
  previewRunner.ts  checkout, install and run a floor's app in its preview worktree
  demo.ts         fake GitHub and fake agents for `npm run demo`
shared/types.ts   the websocket / REST contract
```

The server streams everything to the browser over one websocket (`/ws`). Laptop screens and the whiteboard are canvases drawn from that data and used as textures. They only repaint when something changed, and less often when you're far away.

## Publishing

The npm package holds `bin/cubefarm.js` (the command), `dist/` (the built client) and `dist-server/` (the server, bundled into plain JavaScript by `scripts/build-server.mjs`, because Node won't run TypeScript from inside `node_modules`). The client's libraries are bundled into `dist/`, so users only install the server's dependencies.

```bash
npm version patch   # or minor / major: bumps package.json and tags the commit
npm publish         # runs the tests and the build first (prepublishOnly)
git push --follow-tags
```

`npm pack --dry-run` lists exactly what would be published, and `node scripts/smoke-package.mjs` (after `npm run build`) installs the package into an empty folder and boots it in demo mode, like CI does.
