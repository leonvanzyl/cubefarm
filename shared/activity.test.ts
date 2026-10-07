import { describe, expect, it } from 'vitest';
import { ACTIVITY_ICONS, DETAIL_MAX, actionSummary, agentActivity, fileLabel, lineActivity, recentActions, redact, shellActivity, splitCommand, toolActivity, type ActivityInput } from './activity.ts';
import { INSTALL_STEP, type LogLine } from './types.ts';

const tool = (name: string, text: string) => toolActivity(name, `⏺ ${text}`);

describe('redact', () => {
  it.each([
    ['ghp_0123456789abcdefABCDEF0123'],
    ['github_pat_11ABCDEFG0123456789_abcdefghijklmnop'],
    ['sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345'],
    ['sk_live_51HabcdefGHIJKLmnop'],
    ['xoxb-1234567890-abcdefghij'],
    ['AKIAIOSFODNN7EXAMPLE'],
    ['AIzaSyA1234567890abcdefghijklmnopqrs'],
    ['npm_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'],
  ])('masks the token %s', (token) => {
    const out = redact(`using ${token} now`);
    expect(out).not.toContain(token);
    expect(out).toContain('•••');
  });

  it('masks env assignments, in sh and PowerShell', () => {
    expect(redact('DATABASE_URL=postgres://u:p@db/x npm run migrate')).not.toMatch(/postgres|u:p/);
    expect(redact('export OPENAI_API_KEY="abc def"')).not.toContain('abc');
    expect(redact('$env:GH_TOKEN = "s3cret-value"; gh pr list')).not.toContain('s3cret');
    expect(redact('set api_key=hunter2')).not.toContain('hunter2');
  });

  it('masks credentials in URLs, secret query parameters, flags and auth headers', () => {
    expect(redact('git clone https://bob:hunter2@github.com/x/y')).not.toContain('hunter2');
    expect(redact('curl https://api.x.dev/v1?access_token=abc123&page=2')).not.toContain('abc123');
    expect(redact('curl https://api.x.dev/v1?access_token=abc123&page=2')).toContain('page=2');
    expect(redact('deploy --token abc123 --prod')).not.toContain('abc123');
    expect(redact('login --password=hunter2')).not.toContain('hunter2');
    expect(redact('curl -H "Authorization: Bearer abcdef123456"')).not.toContain('abcdef123456');
  });

  it('masks long random strings but keeps ordinary words', () => {
    expect(redact('key 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08')).toBe('key •••');
    expect(redact('blob Zm9vYmFyMTIzNDU2Nzg5MEFCQ0RFRkdISUpLTE1OT1BRUlNU')).toBe('blob •••');
    expect(redact('npm test -- --run src/store.ts')).toBe('npm test -- --run src/store.ts');
    expect(redact('Refresh token handling and the re-auth flow')).toBe('Refresh token handling and the re-auth flow');
  });
});

describe('splitCommand', () => {
  it('splits commands at unquoted separators and keeps quoted text together', () => {
    expect(splitCommand('git add . && git commit -m "a && b"; npm test | tail -5')).toEqual([
      ['git', 'add', '.'],
      ['git', 'commit', '-m', 'a && b'],
      ['npm', 'test'],
      ['tail', '-5'],
    ]);
  });

  it('keeps redirections in their command', () => {
    expect(splitCommand('npm test 2>&1')).toEqual([['npm', 'test', '2>&1']]);
  });
});

describe('shellActivity', () => {
  it.each([
    ['npm test -- --run', 'test', 'npm test'],
    ['npx vitest run src/store.test.ts', 'test', 'vitest run store.test.ts'],
    ['npm run typecheck', 'test', 'npm run typecheck'],
    ['npx tsc --noEmit', 'test', 'tsc'],
    ['python -m pytest tests/', 'test', 'python -m pytest tests'],
    ['npm run build', 'build', 'npm run build'],
    ['npm ci', 'build', 'npm ci'],
    ['cargo build --release', 'build', 'cargo build'],
    ['git commit -am "feat: due dates"', 'git', 'git commit'],
    ['gh pr create --title "x" --body "Closes #4"', 'git', 'gh pr create'],
    ['gh pr checks 12 --watch', 'ci', 'gh pr checks 12'],
    ['gh run watch 99', 'ci', 'gh run watch 99'],
    ['cat src/App.tsx', 'read', 'cat App.tsx'],
    ['rg useTodos src', 'read', 'rg useTodos src'],
    ["sed -i 's/a/b/' src/x.ts", 'edit', 'sed'],
    ['curl -s http://localhost:5173/', 'browse', 'curl'],
    ['npm run dev -- --port 5212 &', 'run', 'npm run dev'],
  ])('%s → %s "%s"', (cmd, kind, detail) => {
    expect(shellActivity(cmd)).toEqual({ kind, detail });
  });

  it('shows the most telling command of a chain', () => {
    expect(shellActivity('cd "C:\\work\\desk" && npm ci && npm test')).toEqual({ kind: 'test', detail: 'npm test' });
    expect(shellActivity('git add -A && git commit -m wip && git push origin HEAD')).toEqual({ kind: 'git', detail: 'git push origin HEAD' });
  });

  it('never shows env values, secrets or whole commands', () => {
    const a = shellActivity('GITHUB_TOKEN=ghp_0123456789abcdefABCDEF0123 gh api /user --jq .login');
    expect(a).toEqual({ kind: 'git', detail: 'gh api' });
    const b = shellActivity('$env:API_KEY="sk-ant-api03-abcdefghijklmnop"; npm run deploy -- --token sk-ant-api03-abcdefghijklmnop');
    expect(JSON.stringify(b)).not.toMatch(/sk-ant|API_KEY/);
    const c = shellActivity('curl -H "Authorization: Bearer abcdef123456" https://user:pw@api.example.com/x?token=1');
    expect(JSON.stringify(c)).not.toMatch(/abcdef123456|user:pw|token=1/);
    expect(shellActivity('npm run a-very-long-script-name-for-everything').detail.length).toBeLessThanOrEqual(DETAIL_MAX);
    expect(shellActivity('deploy-cli push a1b2c3d4e5f6g7h8').detail).toBe('deploy-cli push');
  });

  it('leaves out paths outside the desk', () => {
    expect(shellActivity('cat C:\\Users\\leon\\.ssh\\config').detail).toBe('cat');
    expect(shellActivity('cat /home/leon/.aws/credentials').detail).toBe('cat');
    expect(shellActivity('ls ../other-repo').detail).toBe('ls');
  });
});

describe('fileLabel', () => {
  it('shows a desk file by name, and only the name of one outside the desk', () => {
    expect(fileLabel('src/components/TodoList.tsx')).toBe('TodoList.tsx');
    expect(fileLabel('C:\\Users\\leon\\secret\\notes.txt')).toBe('…/notes.txt');
    expect(fileLabel('/home/leon/.env')).toBe('…/.env');
    expect(fileLabel('~/.cubefarm/state.json')).toBe('…/state.json');
  });
});

describe('toolActivity', () => {
  it('maps file, search and web tools', () => {
    expect(tool('Read', 'Read src/store.ts')).toEqual({ kind: 'read', detail: 'store.ts' });
    expect(tool('Edit', 'Edit client/src/world/Desk.tsx')).toEqual({ kind: 'edit', detail: 'Desk.tsx' });
    expect(tool('Write', 'Write src/__tests__/feature.test.ts')).toEqual({ kind: 'edit', detail: 'feature.test.ts' });
    expect(tool('apply_patch', 'Edit add src/a.ts, src/b.ts')).toEqual({ kind: 'edit', detail: 'a.ts' });
    expect(tool('Grep', 'Grep "useTodos"')).toEqual({ kind: 'read', detail: 'grep useTodos' });
    expect(tool('Glob', 'Glob src/**/*.tsx')).toEqual({ kind: 'read', detail: 'src/**/*.tsx' });
    expect(tool('WebFetch', 'Fetch https://docs.example.com/guide?key=abc')).toEqual({ kind: 'browse', detail: 'docs.example.com' });
  });

  it('hides where a file outside the desk lives', () => {
    const a = tool('Read', 'Read C:\\Users\\leon\\AppData\\Roaming\\secrets.json');
    expect(a).toEqual({ kind: 'read', detail: '…/secrets.json' });
    expect(JSON.stringify(a)).not.toMatch(/leon|AppData/);
  });

  it('maps the browser and the office tools', () => {
    expect(tool('mcp__playwright__browser_navigate', '🌐 navigate http://localhost:5173/todos?token=abc')).toEqual({ kind: 'browse', detail: 'navigate localhost:5173' });
    expect(tool('mcp__playwright__browser_take_screenshot', '🌐 take_screenshot')).toEqual({ kind: 'browse', detail: 'take screenshot' });
    expect(tool('mcp__office__file_issue', '📝 file_issue "Add dark mode" → floor 2')).toEqual({ kind: 'git', detail: 'file issue' });
    expect(tool('mcp__office__escalate', '📣 escalate PR #12 → floor 1: stuck')).toEqual({ kind: 'talk', detail: 'escalate #12' });
    expect(tool('mcp__office__scale_team', '📈 scale_team floor 1 → 6')).toEqual({ kind: 'talk', detail: 'scale team' });
    expect(tool('mcp__office__configure_agent', '⚙️ configure_agent ada')).toEqual({ kind: 'edit', detail: 'configure agent' });
    expect(tool('mcp__office__set_dependencies', '🔗 set_dependencies #4 → floor 1')).toEqual({ kind: 'edit', detail: 'set dependencies #4' });
  });

  it('ignores bookkeeping', () => {
    expect(tool('TodoWrite', 'Update todo list')).toBeNull();
    expect(tool('ToolSearch', 'Load tools mcp__x')).toBeNull();
  });

  it('keeps every detail short', () => {
    expect(tool('Edit', `Edit src/${'a'.repeat(60)}.ts`)!.detail.length).toBeLessThanOrEqual(DETAIL_MAX);
  });
});

describe('lineActivity and the hover card', () => {
  const line = (kind: LogLine['kind'], text: string, t?: string): Pick<LogLine, 'kind' | 'text' | 'tool'> => ({ kind, text, tool: t });

  it('a message from the manager is talking', () => {
    expect(lineActivity(line('manager', '▶ Manager: please also add tests'))).toEqual({ kind: 'talk', detail: 'your message' });
    expect(lineActivity(line('manager', '■ Manager stopped this session.'))).toBeNull();
    expect(lineActivity(line('text', '● Reading the code'))).toBeNull();
  });

  it('summarises the newest actions, newest first, one short line each', () => {
    const log = [
      line('tool', '⏺ Read src/store.ts', 'Read'),
      line('result', '  ⎿ Read 120 lines'),
      line('text', '● Now the edit.'),
      line('tool', '⏺ Edit src/store.ts', 'Edit'),
      line('tool', '⏺ Update todo list', 'TodoWrite'),
      line('tool', '⏺ $ GH_TOKEN=ghp_0123456789abcdefABCDEF0123 npm test -- --run', 'Bash'),
      line('result', '  ⎿ 8 passed'),
    ];
    expect(recentActions(log)).toEqual([`${ACTIVITY_ICONS.test} npm test`, `${ACTIVITY_ICONS.edit} store.ts`, `${ACTIVITY_ICONS.read} store.ts`]);
    expect(recentActions(log, 2)).toHaveLength(2);
    expect(actionSummary(line('done', '✔ Finished in 12m · 30 turns · PR #212'))).toBe('✔ Finished in 12m · 30 turns · PR #212');
  });
});

describe('agentActivity', () => {
  const base: ActivityInput = { status: 'working', task: 'issue', currentTool: null, issueNumber: 7, prNumber: null, startedAt: 1000 };
  const seen = (kind: 'read' | 'edit' | 'test' | 'ci' | 'talk', detail: string, at = 2000) => ({ kind, detail, at });

  it('shows nothing for anyone not busy', () => {
    for (const status of ['idle', 'done', 'error', 'stopped'] as const) expect(agentActivity({ ...base, status }, seen('edit', 'a.ts'))).toBeNull();
  });

  it('sets up the desk while preparing', () => {
    expect(agentActivity({ ...base, status: 'preparing', currentTool: INSTALL_STEP }, null)).toEqual({ kind: 'build', detail: 'installing deps' });
    expect(agentActivity({ ...base, status: 'preparing' }, null)).toEqual({ kind: 'build', detail: 'setting up desk' });
  });

  it('shows the latest action this session, or the issue before the first one', () => {
    expect(agentActivity(base, seen('edit', 'store.ts'))).toEqual({ kind: 'edit', detail: 'store.ts' });
    expect(agentActivity(base, seen('edit', 'store.ts', 500))).toEqual({ kind: 'read', detail: 'issue #7' });
    expect(agentActivity(base, null)).toEqual({ kind: 'read', detail: 'issue #7' });
  });

  it('agents testing a PR always show 🔍 and fixers 🔧, with what they are doing as the detail', () => {
    expect(agentActivity({ ...base, task: 'qa', prNumber: 12 }, seen('test', 'npm test'))).toEqual({ kind: 'qa', detail: 'npm test' });
    expect(agentActivity({ ...base, task: 'qa', prNumber: 12 }, null)).toEqual({ kind: 'qa', detail: 'PR #12' });
    expect(agentActivity({ ...base, task: 'fix', prNumber: 12 }, seen('edit', 'styles.css'))).toEqual({ kind: 'fix', detail: 'styles.css' });
    expect(agentActivity({ ...base, task: 'fix', prNumber: 12 }, seen('ci', 'gh pr checks 12'))).toEqual({ kind: 'ci', detail: 'gh pr checks 12' });
  });

  it('talking to the manager wins', () => {
    expect(agentActivity({ ...base, task: 'qa' }, seen('talk', 'your message'))).toEqual({ kind: 'talk', detail: 'your message' });
    expect(agentActivity({ ...base, task: null }, seen('read', 'company status'), true)).toEqual({ kind: 'talk', detail: 'company status' });
  });
});
