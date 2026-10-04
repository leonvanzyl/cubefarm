import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PORT = Number(process.env.SWARM_PORT ?? 4317);
// package.json sits one folder up both from server/ and from the published dist-server/.
export const VERSION: string = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'package.json'), 'utf8')).version;

// Everything the swarm writes lives outside this project so that agents working in
// cloned repos never pick up this project's CLAUDE.md or settings by walking up the tree.
export const HOME_DIR = process.env.SWARM_HOME ?? path.join(os.homedir(), '.cubefarm');
export const WORKSPACE_ROOT = path.join(HOME_DIR, 'workspaces');
export const DEMO = process.argv.includes('--demo') || process.env.SWARM_DEMO === '1' || process.env.SWARM_DEMO === 'true';
export const STATE_FILE = path.join(HOME_DIR, DEMO ? 'demo-state.json' : 'state.json');

// How often each connected repo's issues and PRs are refreshed from GitHub.
export const SYNC_INTERVAL_MS = 45_000;
// How often idle agents on auto-assign floors look for new work.
export const SCHEDULER_INTERVAL_MS = 8_000;
// How often each floor's desks and finished branches are swept (also at start and after a let-go).
export const DESK_SWEEP_INTERVAL_MS = 30 * 60_000;
// Terminal lines kept per agent.
export const LOG_BUFFER = 600;

/**
 * Where new projects go unless the manager picks another folder. Run from a checkout, that's the folder the app sits
 * in (C:\Projects\cubefarm → C:\Projects). Installed from npm the app lives in node_modules, so it's the usual
 * projects folder in your home instead.
 */
export function defaultProjectsDir(appDir: string, home = os.homedir()): string {
  if (!appDir.split(/[\\/]/).includes('node_modules')) return path.resolve(appDir, '..');
  const names = ['Projects', 'projects', 'code', 'Code', 'dev', 'Developer', 'src', 'repos', 'git', 'GitHub'];
  return names.map((n) => path.join(home, n)).find((d) => fs.existsSync(d)) ?? path.join(home, 'Projects');
}
