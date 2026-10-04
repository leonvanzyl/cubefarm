import { describe, expect, it } from 'vitest';
import { chatterLine, fill, readLog, shortFile, workOf, type ChatterEvent } from './chatterLines';

/** A seeded stand-in for Math.random, so a run is repeatable. */
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const EVERY: ChatterEvent[] = [
  { kind: 'start', issue: 204 },
  { kind: 'prOpened', pr: 212 },
  { kind: 'askQa', pr: 212, tester: 'Marple' },
  { kind: 'qaStart', pr: 212 },
  { kind: 'qaPassed', pr: 212 },
  { kind: 'qaFailed', pr: 212 },
  { kind: 'fixing', pr: 212 },
  { kind: 'fixPushed', pr: 212 },
  { kind: 'fixPushed', pr: null },
  { kind: 'testsGreen' },
  { kind: 'testsRed' },
  { kind: 'conflict', pr: 212, file: 'store.ts' },
  { kind: 'conflict', pr: null, file: null },
  { kind: 'ciSlow', pr: 212 },
  { kind: 'ciRed', pr: 212 },
  { kind: 'merged', pr: 212 },
  { kind: 'congrats', to: 'Ken', pr: 212 },
  { kind: 'error' },
  { kind: 'work', work: 'read', detail: 'App.tsx' },
  { kind: 'work', work: 'edit', detail: null },
  { kind: 'work', work: 'test', detail: null },
  { kind: 'coffee' },
  { kind: 'visit', host: 'Ada', issue: 7 },
  { kind: 'visit', host: 'Ada', issue: null },
  { kind: 'chat', topic: '🎉', pr: 212, venue: 'couch' },
  { kind: 'chat', topic: '🐛', pr: null, venue: 'cooler' },
  { kind: 'chat', topic: '☕', pr: null, venue: 'cooler' },
  { kind: 'greet', manager: 'Leon', mood: 'free', pr: null, issue: null },
  { kind: 'greet', manager: '', mood: 'free', pr: null, issue: null },
  { kind: 'greet', manager: 'Leon', mood: 'shipped', pr: 212, issue: 204 },
  { kind: 'greet', manager: 'Leon', mood: 'ceo', pr: null, issue: null },
  { kind: 'ceo', busy: true },
  { kind: 'ceo', busy: false },
  { kind: 'ceoVisit' },
];

describe('chatterLine', () => {
  it('fills every blank of every line it says, for every kind of event', () => {
    for (const e of EVERY) {
      const r = rng(7);
      for (let i = 0; i < 30; i++) {
        const line = chatterLine(e, r);
        expect(line, JSON.stringify(e)).not.toMatch(/[{}]|undefined|null/);
        expect(line.length).toBeGreaterThan(1);
        expect(line.length).toBeLessThanOrEqual(48);
      }
    }
  });

  it('says real things: the PR, the file, the tester by name', () => {
    const r = rng(3);
    const lines = (e: ChatterEvent) => new Set(Array.from({ length: 60 }, () => chatterLine(e, r)));
    expect(lines({ kind: 'prOpened', pr: 212 })).toContain('PR #212 is up for QA');
    expect(lines({ kind: 'askQa', pr: 212, tester: 'Marple' })).toContain('Marple, can you look at #212?');
    expect(lines({ kind: 'conflict', pr: 212, file: 'store.ts' })).toContain('Ugh, a merge conflict in store.ts');
    expect(lines({ kind: 'testsGreen' })).toContain('Tests are green! ✅');
    expect(lines({ kind: 'fixPushed', pr: 212 })).toContain('Found the bug!');
    expect(lines({ kind: 'ciSlow', pr: 212 })).toContain('CI is so slow today…');
    expect(lines({ kind: 'congrats', to: 'Ken', pr: 212 })).toContain('Nice one!');
    expect(lines({ kind: 'chat', topic: '☕', pr: null, venue: 'cooler' })).toContain('Coffee?');
  });

  it('never says the same line twice in a row when it has another', () => {
    for (const e of EVERY) {
      const r = rng(11);
      let last: string | null = null;
      for (let i = 0; i < 40; i++) {
        const line = chatterLine(e, r, last);
        const options = new Set(Array.from({ length: 80 }, () => chatterLine(e, rng(i * 97 + 1))));
        if (options.size > 1) expect(line, JSON.stringify(e)).not.toBe(last);
        last = line;
      }
    }
  });

  it("avoids what the floor just heard, when it can: five people's tests passing don't all say the same", () => {
    const r = rng(13);
    const heard: string[] = [];
    for (let i = 0; i < 3; i++) heard.push(chatterLine({ kind: 'testsGreen' }, r, null, heard));
    expect(new Set(heard).size).toBe(3);
    // with every way of saying it heard, it still says something
    expect(heard).toContain(chatterLine({ kind: 'testsGreen' }, r, null, heard));
  });

  it('has variety: an event has several ways of saying it', () => {
    const r = rng(5);
    for (const e of [{ kind: 'merged', pr: 3 }, { kind: 'start', issue: 9 }, { kind: 'coffee' }] as ChatterEvent[]) {
      expect(new Set(Array.from({ length: 50 }, () => chatterLine(e, r))).size).toBeGreaterThanOrEqual(3);
    }
  });

  it('skips lines whose blanks it can fill, and falls back to a plain hello', () => {
    const r = rng(9);
    for (let i = 0; i < 40; i++) expect(chatterLine({ kind: 'conflict', pr: null, file: null }, r)).toBe('Ugh, a merge conflict');
    // a "testing" quip needs the PR: without it, a plain hi
    for (let i = 0; i < 20; i++) expect(chatterLine({ kind: 'greet', manager: '', mood: 'testing', pr: null, issue: null }, r)).toMatch(/^(Hi!|Oh, hi!|Hello!)$/);
  });

  it('the CEO greets you by name', () => {
    const r = rng(2);
    const lines = new Set(Array.from({ length: 40 }, () => chatterLine({ kind: 'greet', manager: 'Leon', mood: 'ceo', pr: null, issue: null }, r)));
    expect([...lines].some((l) => l.includes('Leon'))).toBe(true);
  });
});

describe('fill', () => {
  it('fills blanks, or gives up when one is missing', () => {
    expect(fill('PR #{pr} by {to}', { pr: 4, to: 'Ada' })).toBe('PR #4 by Ada');
    expect(fill('PR #{pr}', { pr: null })).toBeNull();
    expect(fill('Hi {manager}', { manager: '' })).toBeNull();
    expect(fill('No blanks', {})).toBe('No blanks');
  });
});

describe('reading the log', () => {
  it('names files without their folders, and only safe-looking ones', () => {
    expect(shortFile('client/src/store.ts')).toBe('store.ts');
    expect(shortFile('C:\\Users\\me\\app\\Desk.tsx')).toBe('Desk.tsx');
    expect(shortFile('src/a b/c.ts')).toBe('c.ts');
    expect(shortFile('src/' + 'x'.repeat(40) + '.ts')).toBeNull();
    expect(shortFile('rm -rf /')).toBeNull();
    expect(shortFile('123')).toBeNull();
  });

  it("knows what a tool call is doing, with one short detail and never the command", () => {
    expect(workOf('Read', '⏺ Read src/components/TodoList.tsx')).toEqual({ work: 'read', detail: 'TodoList.tsx' });
    expect(workOf('Edit', '⏺ Edit src/styles.css')).toEqual({ work: 'edit', detail: 'styles.css' });
    expect(workOf('Grep', '⏺ Grep "useTodos"')).toEqual({ work: 'search', detail: 'useTodos' });
    expect(workOf('Bash', '⏺ $ npm test -- --run')).toEqual({ work: 'test', detail: null });
    expect(workOf('Bash', '⏺ $ npm run lint && npm run build')).toEqual({ work: 'build', detail: null });
    expect(workOf('Bash', '⏺ $ git push -u origin HEAD')).toEqual({ work: 'git', detail: null });
    expect(workOf('Bash', '⏺ $ curl -H "Authorization: token abc123" https://x')).toBeNull();
    expect(workOf('mcp__playwright__browser_click', '⏺ 🌐 click "Add todo" button')).toEqual({ work: 'browse', detail: null });
    expect(workOf('mcp__office__company_status', '⏺ company status')).toBeNull();
  });

  it('finds tests passing or failing, pushes and merge conflicts', () => {
    expect(readLog({ kind: 'result', text: '    Test Files  7 passed (7)' })).toEqual({ kind: 'testsGreen' });
    expect(readLog({ kind: 'result', text: '  ⎿ ✓ src/__tests__/feature.test.ts (4 tests) 38ms' })).toEqual({ kind: 'testsGreen' });
    expect(readLog({ kind: 'result', text: '  Tests  2 failed | 39 passed (41)' })).toEqual({ kind: 'testsRed' });
    expect(readLog({ kind: 'result', text: '  Tests  0 failed | 39 passed (41)' })).toEqual({ kind: 'testsGreen' });
    expect(readLog({ kind: 'tool', tool: 'Bash', text: '⏺ $ git commit -am "fix" && git push origin HEAD' })).toEqual({ kind: 'pushed' });
    expect(readLog({ kind: 'result', text: 'CONFLICT (content): Merge conflict in client/src/store.ts' })).toEqual({ kind: 'conflict', file: 'store.ts' });
    expect(readLog({ kind: 'text', text: '● Rebasing hit merge conflicts, sorting them out.' })).toEqual({ kind: 'conflict', file: null });
    expect(readLog({ kind: 'tool', tool: 'Read', text: '⏺ Read src/App.tsx' })).toEqual({ kind: 'work', work: 'read', detail: 'App.tsx' });
    expect(readLog({ kind: 'thinking', text: '✻ Thinking…' })).toEqual({ kind: 'work', work: 'think', detail: null });
    expect(readLog({ kind: 'result', text: '  ⎿ Read 184 lines' })).toBeNull();
    expect(readLog({ kind: 'text', text: '● Looks right in the browser.' })).toBeNull();
  });
});
