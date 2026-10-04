import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

// The agents' test browser: the Playwright MCP server pinned in package.json, started with node from the installed
// package (no npx, no npm registry, no surprise browser download at session start), driving the installed Google
// Chrome the README asks for.

export interface McpCommand {
  command: string;
  args: string[];
}

/** The pinned Playwright MCP's CLI script, resolved from cubefarm's own dependencies; null when it isn't installed. */
export function playwrightMcpCli(): string | null {
  try {
    const pkgFile = createRequire(import.meta.url).resolve('@playwright/mcp/package.json');
    const bin = (JSON.parse(fs.readFileSync(pkgFile, 'utf8')) as { bin?: Record<string, string> }).bin?.['playwright-mcp'] ?? 'cli.js';
    return path.join(path.dirname(pkgFile), bin);
  } catch {
    return null;
  }
}

/**
 * The MCP server command: node on the CLI script, each path its own argument (no shell, so spaces need no quoting).
 * browser-init.js keeps pages from taking the real mouse with pointer lock (headless Chrome does on Windows).
 * `outputDir` gets snapshots and unnamed screenshots (the terminal runtime collects them from there).
 */
export function playwrightMcpCommand(cli: string, initScript: string, outputDir?: string, node = process.execPath): McpCommand {
  return { command: node, args: [cli, '--headless', '--isolated', ...(outputDir ? ['--output-dir', outputDir] : []), '--init-script', initScript] };
}

/** The office's Playwright MCP server for a session, or null when the pinned package can't be found. */
export function playwrightMcp(outputDir?: string): McpCommand | null {
  const cli = playwrightMcpCli();
  return cli ? playwrightMcpCommand(cli, path.join(import.meta.dirname, 'browser-init.js'), outputDir) : null;
}

/** Where Playwright's "chrome" channel looks for Google Chrome (bin/cubefarm.js doctor checks the same places). */
export function chromePaths(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string[] {
  if (platform === 'win32') {
    return [env.LOCALAPPDATA, env.PROGRAMFILES, env['PROGRAMFILES(X86)']].filter((d): d is string => !!d).map((d) => path.win32.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  if (platform === 'darwin') return ['/Applications/Google Chrome.app', path.posix.join(home, 'Applications', 'Google Chrome.app')];
  return ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
}

export const hasChrome = () => chromePaths().some((p) => fs.existsSync(p));

/** The one line a session's log shows when browser testing can't work on this machine, or null when it can. */
export function browserProblem(mcp: McpCommand | null, chrome = hasChrome()): string | null {
  if (!mcp) return '⚠ The browser tool (@playwright/mcp) is not installed with cubefarm: reinstall it, or run npx cubefarm doctor';
  if (!chrome) return '⚠ Google Chrome not found, so this session cannot test in a browser: install it, or run npx cubefarm doctor';
  return null;
}
