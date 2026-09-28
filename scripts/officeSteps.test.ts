import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { clientPort, isUpdateCommand, parseOfficeArgs, parseSymref, refusal, rollbackPlan, stepsFor, swarmHome } from './officeSteps.mjs';

describe('parseOfficeArgs', () => {
  it('is start mode, opening the browser, with no flags', () => {
    expect(parseOfficeArgs([])).toEqual({ dev: false, demo: false, open: true, help: false });
  });

  it('reads --dev, --demo and --no-open', () => {
    expect(parseOfficeArgs(['--dev', '--demo'])).toEqual({ dev: true, demo: true, open: true, help: false });
    expect(parseOfficeArgs(['--no-open'])).toMatchObject({ dev: false, open: false });
    expect(parseOfficeArgs(['-h']).help).toBe(true);
  });

  it('refuses unknown flags and stray arguments', () => {
    expect(() => parseOfficeArgs(['--prod'])).toThrow();
    expect(() => parseOfficeArgs(['demo'])).toThrow();
  });
});

describe('swarmHome and clientPort', () => {
  it('uses SWARM_HOME, else ~/.cubefarm', () => {
    expect(swarmHome({ SWARM_HOME: path.join('x', 'home') }, 'h')).toBe(path.join('x', 'home'));
    expect(swarmHome({}, path.join('users', 'me'))).toBe(path.join('users', 'me', '.cubefarm'));
  });

  it('uses SWARM_CLIENT_PORT, else 5317', () => {
    expect(clientPort({ SWARM_CLIENT_PORT: '4422' })).toBe(4422);
    expect(clientPort({})).toBe(5317);
    expect(clientPort({ SWARM_CLIENT_PORT: '' })).toBe(5317);
  });
});

describe('parseSymref', () => {
  it("reads origin's default branch", () => {
    expect(parseSymref('ref: refs/heads/main\tHEAD\n4f2c1d0a\tHEAD\n')).toBe('main');
    expect(parseSymref('ref: refs/heads/release/2.x\tHEAD\r\n')).toBe('release/2.x');
  });

  it('is null without a symref', () => {
    expect(parseSymref('')).toBeNull();
    expect(parseSymref('4f2c1d0a\tHEAD')).toBeNull();
  });
});

describe('refusal', () => {
  const ok = { branch: 'main', defaultBranch: 'main', dirty: false, ahead: 0 };

  it('allows a clean default branch', () => {
    expect(refusal(ok)).toBeNull();
  });

  it('refuses another branch or a detached HEAD', () => {
    expect(refusal({ ...ok, branch: 'feature-x' })).toMatch(/branch feature-x, not main/);
    expect(refusal({ ...ok, branch: '' })).toMatch(/detached HEAD/);
  });

  it('refuses local changes and local commits', () => {
    expect(refusal({ ...ok, dirty: true })).toMatch(/local changes/);
    expect(refusal({ ...ok, ahead: 2 })).toMatch(/2 local commits/);
  });
});

describe('stepsFor', () => {
  it('needs nothing when nothing changed', () => {
    expect(stepsFor([], { startMode: true })).toEqual({ install: false, build: false });
    expect(stepsFor([''], { startMode: true })).toEqual({ install: false, build: false });
  });

  it('installs when the root package.json or lockfile changed', () => {
    expect(stepsFor(['package-lock.json'], { startMode: false })).toEqual({ install: true, build: false });
    expect(stepsFor(['server/swarm.ts', 'package.json'], { startMode: false }).install).toBe(true);
  });

  it("ignores other folders' package files", () => {
    expect(stepsFor(['examples/app/package.json', 'docs\\package-lock.json'], { startMode: false }).install).toBe(false);
  });

  it('builds in start mode whenever anything changed', () => {
    expect(stepsFor(['client/src/store.ts'], { startMode: true })).toEqual({ install: false, build: true });
    expect(stepsFor(['client/src/store.ts'], { startMode: false }).build).toBe(false);
  });
});

describe('rollbackPlan', () => {
  it('undoes nothing when HEAD never moved (refused, fetch failed, no fast-forward)', () => {
    expect(rollbackPlan({ moved: false, installed: false, built: false })).toEqual({ reset: false, install: false, build: false });
  });

  it('resets without reinstalling when the dependencies were never touched', () => {
    expect(rollbackPlan({ moved: true, installed: false, built: false })).toEqual({ reset: true, install: false, build: false });
  });

  it('reinstalls the old dependencies after npm install ran', () => {
    expect(rollbackPlan({ moved: true, installed: true, built: false })).toEqual({ reset: true, install: true, build: false });
  });

  it('rebuilds the old version after a build ran', () => {
    expect(rollbackPlan({ moved: true, installed: true, built: true })).toEqual({ reset: true, install: true, build: true });
    expect(rollbackPlan({ moved: true, installed: false, built: true })).toEqual({ reset: true, install: false, build: true });
  });
});

describe('isUpdateCommand', () => {
  it('is u + Enter', () => {
    expect(isUpdateCommand('u')).toBe(true);
    expect(isUpdateCommand(' U \r')).toBe(true);
    expect(isUpdateCommand('update')).toBe(false);
    expect(isUpdateCommand('')).toBe(false);
  });
});
