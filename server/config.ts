import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FLOOR_SEATS } from '../shared/types.ts';

export const PORT = Number(process.env.SWARM_PORT ?? 4317);
// package.json sits one folder up both from server/ and from the published dist-server/.
export const VERSION: string = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'package.json'), 'utf8')).version;

// Everything the swarm writes lives outside this project so that agents working in
// cloned repos never pick up this project's CLAUDE.md or settings by walking up the tree.
export const HOME_DIR = process.env.SWARM_HOME ?? path.join(os.homedir(), '.cubefarm');
export const WORKSPACE_ROOT = path.join(HOME_DIR, 'workspaces');
export const DEMO = process.argv.includes('--demo') || process.env.SWARM_DEMO === '1' || process.env.SWARM_DEMO === 'true';

/** A demo company bigger than the usual two floors, for scale tests: floors, and people on each (#228). */
export interface DemoScale {
  floors: number;
  /** Agents per floor: up to FLOOR_SEATS, the desks a floor has. */
  agents: number;
}

export const DEMO_MAX = { floors: 20, agents: FLOOR_SEATS };

/**
 * `--floors 10 --agents 15` (or `--floors=10`, or SWARM_DEMO_FLOORS / SWARM_DEMO_AGENTS) for the demo's big company;
 * null when neither is given: the usual demo. Either one alone takes the other from the usual demo's busier floor.
 */
export function demoScale(argv: string[], env: NodeJS.ProcessEnv): DemoScale | null {
  const read = (flag: string, name: string) => {
    const i = argv.findIndex((a) => a === flag || a.startsWith(`${flag}=`));
    const raw = i < 0 ? env[name] : argv[i].includes('=') ? argv[i].slice(flag.length + 1) : argv[i + 1];
    const n = Number(raw);
    return raw === undefined || raw === '' || !Number.isFinite(n) ? null : Math.round(n);
  };
  const floors = read('--floors', 'SWARM_DEMO_FLOORS');
  const agents = read('--agents', 'SWARM_DEMO_AGENTS');
  if (floors === null && agents === null) return null;
  const clamp = (n: number, max: number) => Math.max(1, Math.min(max, n));
  return { floors: clamp(floors ?? 2, DEMO_MAX.floors), agents: clamp(agents ?? 6, DEMO_MAX.agents) };
}

export const DEMO_SCALE = DEMO ? demoScale(process.argv, process.env) : null;
// A big company keeps its own state, so it never mixes with the usual demo's.
export const STATE_FILE = path.join(HOME_DIR, DEMO ? (DEMO_SCALE ? `demo-${DEMO_SCALE.floors}x${DEMO_SCALE.agents}-state.json` : 'demo-state.json') : 'state.json');

/** A port from the environment, or the fallback when it's unset or not a usable port. */
export function envPort(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value && Number.isInteger(n) && n >= 1024 && n <= 65_000 ? n : fallback;
}

/** Minutes from the environment (fractions allowed, so a test can make them seconds), or the fallback. */
export function envMinutes(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value && Number.isFinite(n) && n > 0 ? n : fallback;
}

// Floor previews run on this port + the floor number, PR previews 100 above it (docs/how-it-works.md). Moving it only
// keeps a test office's previews clear of another office's.
export const PREVIEW_PORT = envPort(process.env.SWARM_PREVIEW_PORT, 6300);
// A PR preview nobody has had on screen for this long stops.
export const PR_PREVIEW_IDLE_MS = envMinutes(process.env.SWARM_PR_PREVIEW_IDLE_MIN, 20) * 60_000;

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
