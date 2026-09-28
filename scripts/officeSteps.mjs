// The launcher's decisions, kept pure so Vitest can cover them: its arguments, where last-update.json goes, whether
// an update may run, what a set of changed files needs, and what to undo when a step fails. Used by office.mjs.
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

/** `--dev` (server + Vite, restarts on code changes), `--demo` (passed to the server), `--no-open` (start mode). */
export function parseOfficeArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      dev: { type: 'boolean', default: false },
      demo: { type: 'boolean', default: false },
      'no-open': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  return { dev: values.dev, demo: values.demo, open: !values['no-open'], help: values.help };
}

/** The office's state folder, resolved like server/config.ts. */
export function swarmHome(env = process.env, home = os.homedir()) {
  return env.SWARM_HOME ?? path.join(home, '.cubefarm');
}

/** Vite's port: SWARM_CLIENT_PORT, else 5317 (the same default as vite.config.ts). */
export function clientPort(env = process.env) {
  return Number(env.SWARM_CLIENT_PORT || 5317);
}

/** The default branch from `git ls-remote --symref origin HEAD` ("ref: refs/heads/main\tHEAD"), or null. */
export function parseSymref(output) {
  return /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(output)?.[1] ?? null;
}

/**
 * Why the office's folder must not be updated, or null when it may. The same rules as a floor's folder (syncMain):
 * only on the default branch, with no local changes and no local commits. Nothing is ever stashed or discarded.
 */
export function refusal({ branch, defaultBranch, dirty, ahead }) {
  if (!branch) return 'the office folder is on a detached HEAD';
  if (branch !== defaultBranch) return `the office folder is on branch ${branch}, not ${defaultBranch}`;
  if (dirty) return 'the office folder has local changes';
  if (ahead > 0) return `the office folder has ${ahead} local commit${ahead === 1 ? '' : 's'} not on origin/${defaultBranch}`;
  return null;
}

const DEPENDENCY_FILES = ['package.json', 'package-lock.json'];

/**
 * What the pulled files need: `npm install` when the root package.json or lockfile changed, and in start mode (the
 * built office) `npm run build` whenever anything changed.
 */
export function stepsFor(changedFiles, { startMode }) {
  const files = changedFiles.map((f) => f.trim().replace(/\\/g, '/')).filter(Boolean);
  return { install: files.some((f) => DEPENDENCY_FILES.includes(f)), build: startMode && files.length > 0 };
}

/**
 * What to undo after a failed step. `moved`: HEAD is no longer the commit the update started from. `installed` /
 * `built`: npm install / npm run build ran for the new commit (even if they failed partway). Going back to the old
 * commit (`git reset --keep`, which never touches local changes) also means reinstalling its dependencies and, if
 * a build ran, rebuilding it.
 */
export function rollbackPlan({ moved, installed, built }) {
  return { reset: moved, install: moved && installed, build: built };
}

/** A line typed into the launcher's terminal that asks for an update: `u`. */
export const isUpdateCommand = (line) => line.trim().toLowerCase() === 'u';
