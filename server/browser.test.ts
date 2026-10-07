import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { browserProblem, chromePaths, playwrightMcp, playwrightMcpCli, playwrightMcpCommand } from './browser.ts';
import { launchArgs, type LaunchContext } from './clis.ts';

const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { dependencies: Record<string, string> };

describe('the Playwright MCP server', () => {
  it('is a pinned runtime dependency, not @latest', () => {
    expect(pkg.dependencies['@playwright/mcp']).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('starts with node from the installed package: no npx, no shell, the flags intact', () => {
    const mcp = playwrightMcp(path.join('session', 'browser'))!;
    expect(mcp.command).toBe(process.execPath);
    expect(mcp.args[0]).toBe(playwrightMcpCli());
    expect(fs.existsSync(mcp.args[0])).toBe(true);
    expect(mcp.args.slice(1)).toEqual(['--headless', '--isolated', '--output-dir', path.join('session', 'browser'), '--init-script', path.join(import.meta.dirname, 'browser-init.js')]);
    const line = [mcp.command, ...mcp.args].join(' ');
    expect(line).not.toMatch(/npx|@latest|\bcmd\b|-y\b/);
  });

  it('leaves --output-dir out when no folder is given (the Agent SDK runtime)', () => {
    expect(playwrightMcp()!.args).not.toContain('--output-dir');
  });

  it('passes Windows paths with spaces as whole arguments, unquoted', () => {
    const cmd = playwrightMcpCommand(
      'C:\\Users\\A B\\AppData\\npm\\node_modules\\cubefarm\\node_modules\\@playwright\\mcp\\cli.js',
      'C:\\Users\\A B\\cubefarm\\dist-server\\browser-init.js',
      'C:\\Users\\A B\\.cubefarm\\sessions\\x\\browser',
      'C:\\Program Files\\nodejs\\node.exe',
    );
    expect(cmd).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: [
        'C:\\Users\\A B\\AppData\\npm\\node_modules\\cubefarm\\node_modules\\@playwright\\mcp\\cli.js',
        '--headless',
        '--isolated',
        '--output-dir',
        'C:\\Users\\A B\\.cubefarm\\sessions\\x\\browser',
        '--init-script',
        'C:\\Users\\A B\\cubefarm\\dist-server\\browser-init.js',
      ],
    });
  });

  it('is the command Codex and OpenCode get too', () => {
    const browser = playwrightMcpCommand('C:\\A B\\cli.js', 'C:\\A B\\init.js', 'C:\\A B\\out', 'C:\\Program Files\\nodejs\\node.exe');
    const ctx: LaunchContext = {
      prompt: 'go',
      systemAppend: '',
      model: '',
      effort: '',
      sessionId: 's',
      name: 'n',
      role: 'agent',
      additionalDirectories: [],
      files: { settings: 's', mcp: null, system: 'i' },
      notify: { script: 'n.cjs', url: 'http://127.0.0.1:1/x' },
      codexHook: 'h.cjs',
      plugin: 'file:///p.mjs',
      browser,
    };
    const codex = launchArgs('codex', ctx).args.find((a) => a.startsWith('mcp_servers.playwright='))!;
    expect(codex).toBe(`mcp_servers.playwright={command=${JSON.stringify(browser.command)},args=[${browser.args.map((a) => JSON.stringify(a)).join(',')}]}`);
    expect(codex).not.toContain('npx');
    const opencode = JSON.parse(launchArgs('opencode', ctx).env.OPENCODE_CONFIG_CONTENT);
    expect(opencode.mcp.playwright.command).toEqual([browser.command, ...browser.args]);
  });
});

describe('chromePaths', () => {
  it("looks where Playwright's chrome channel does on each platform", () => {
    const win = chromePaths('win32', { LOCALAPPDATA: 'C:\\Users\\A B\\AppData\\Local', PROGRAMFILES: 'C:\\Program Files' }, 'C:\\Users\\A B');
    expect(win).toEqual(['C:\\Users\\A B\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']);
    expect(chromePaths('linux', {}, '/home/a')).toContain('/opt/google/chrome/chrome');
    expect(chromePaths('darwin', {}, '/Users/a')).toContain('/Applications/Google Chrome.app');
  });
});

describe('browserProblem', () => {
  const mcp = { command: 'node', args: ['cli.js'] };
  it('says nothing when the tool and Chrome are both there', () => {
    expect(browserProblem(mcp, true)).toBeNull();
  });
  it('gives one clear line when Chrome is missing, or the tool is', () => {
    expect(browserProblem(mcp, false)).toMatch(/Google Chrome not found.*install it, or run npx cubefarm doctor/);
    expect(browserProblem(null, true)).toMatch(/@playwright\/mcp.*npx cubefarm doctor/);
  });
});
