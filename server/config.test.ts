import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProjectsDir, demoScale, envMinutes, envPort, isLoopback, localAddress, networkUrls } from './config.ts';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-config-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('defaultProjectsDir', () => {
  it('is the folder a checkout sits in', () => {
    expect(defaultProjectsDir(path.join(tmp, 'Projects', 'cubefarm'), tmp)).toBe(path.join(tmp, 'Projects'));
  });

  it('is a projects folder in your home when installed from npm', () => {
    const installed = path.join(tmp, 'npm', 'node_modules', 'cubefarm');
    expect(defaultProjectsDir(installed, tmp)).toBe(path.join(tmp, 'Projects'));
    fs.mkdirSync(path.join(tmp, 'code'));
    expect(defaultProjectsDir(installed, tmp)).toBe(path.join(tmp, 'code'));
  });
});

describe('preview settings from the environment', () => {
  it('takes a usable port and falls back otherwise', () => {
    expect(envPort('7300', 6300)).toBe(7300);
    for (const bad of [undefined, '', 'abc', '80', '70000', '6300.5']) expect(envPort(bad, 6300)).toBe(6300);
  });

  it('takes positive minutes, fractions included', () => {
    expect(envMinutes('0.5', 20)).toBe(0.5);
    for (const bad of [undefined, '', '0', '-3', 'soon']) expect(envMinutes(bad, 20)).toBe(20);
  });
});

describe('listen address', () => {
  it('knows which addresses stay on this machine', () => {
    for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', '::1', '[::1]']) expect(isLoopback(h)).toBe(true);
    for (const h of ['0.0.0.0', '::', '192.168.1.20', 'mini.local']) expect(isLoopback(h)).toBe(false);
  });

  it('reaches the any-address on loopback and one address at itself', () => {
    expect(localAddress('0.0.0.0')).toBe('127.0.0.1');
    expect(localAddress('::')).toBe('127.0.0.1');
    expect(localAddress('127.0.0.1')).toBe('127.0.0.1');
    expect(localAddress('192.168.1.20')).toBe('192.168.1.20');
    expect(localAddress('::1')).toBe('[::1]');
    expect(localAddress('[fe80::1]')).toBe('[fe80::1]');
  });

  it('lists the network addresses only for the any-address', () => {
    const ifaces = {
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      en0: [
        { address: '192.168.1.20', family: 'IPv4', internal: false },
        { address: 'fe80::1', family: 'IPv6', internal: false },
      ],
    } as unknown as ReturnType<typeof os.networkInterfaces>;
    expect(networkUrls('0.0.0.0', 4317, ifaces)).toEqual(['http://192.168.1.20:4317']);
    expect(networkUrls('127.0.0.1', 4317, ifaces)).toEqual([]);
    expect(networkUrls('192.168.1.20', 4317, ifaces)).toEqual([]);
  });
});

describe('demoScale', () => {
  it('is the usual demo without --floors or --agents', () => {
    expect(demoScale(['node', 'server/index.ts', '--demo'], {})).toBeNull();
  });

  it('reads the big company from the command line or the environment, within what a building holds', () => {
    expect(demoScale(['--demo', '--floors', '10', '--agents', '15'], {})).toEqual({ floors: 10, agents: 15 });
    expect(demoScale(['--floors=3'], {})).toEqual({ floors: 3, agents: 6 });
    expect(demoScale([], { SWARM_DEMO_FLOORS: '4', SWARM_DEMO_AGENTS: '9' })).toEqual({ floors: 4, agents: 9 });
    expect(demoScale(['--floors', '99', '--agents', '40'], {})).toEqual({ floors: 20, agents: 15 });
    expect(demoScale(['--agents', '0'], {})).toEqual({ floors: 2, agents: 1 });
  });
});
