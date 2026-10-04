import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProjectsDir, envMinutes, envPort } from './config.ts';

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
