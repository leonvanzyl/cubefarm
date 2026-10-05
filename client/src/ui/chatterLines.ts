// What the people in the office say in their speech bubbles (and babble out loud, babble.ts): short lines about their
// real work, from office events (a PR opening, QA, a merge, a conflict) and each agent's own status, tools and log.
// Pure, with no Claude calls: a phrasebook of templates filled in with real numbers and file names, picked with some
// variety and never the same line twice in a row. Chatter.tsx decides who says what, and when.

import type { LogLine } from '../../../shared/types';

/** What someone is busy with, from their latest tool call. */
export type WorkKind = 'read' | 'search' | 'edit' | 'test' | 'build' | 'browse' | 'git' | 'think';

/** A chat's topic: socials.ts's emoji, which also ends the line. */
export type ChatTopic = '☕' | '😂' | '🚀' | '🎉' | '🐛';

/** How the person you greet is getting on, for their quip. */
export type GreetMood = 'shipped' | 'inQa' | 'fixing' | 'working' | 'testing' | 'free' | 'ceo';

/** Something worth saying, and what it's about. */
export type ChatterEvent =
  | { kind: 'start'; issue: number }
  | { kind: 'prOpened'; pr: number }
  | { kind: 'askQa'; pr: number; tester: string }
  | { kind: 'qaStart'; pr: number }
  | { kind: 'qaPassed'; pr: number }
  | { kind: 'qaFailed'; pr: number }
  | { kind: 'fixing'; pr: number }
  | { kind: 'fixPushed'; pr: number | null }
  | { kind: 'testsGreen' }
  | { kind: 'testsRed' }
  | { kind: 'conflict'; pr: number | null; file: string | null }
  | { kind: 'ciSlow'; pr: number }
  | { kind: 'ciRed'; pr: number }
  | { kind: 'merged'; pr: number }
  | { kind: 'congrats'; to: string; pr: number }
  | { kind: 'error' }
  | { kind: 'work'; work: WorkKind; detail: string | null }
  | { kind: 'coffee' }
  | { kind: 'visit'; host: string; issue: number | null }
  | { kind: 'chat'; topic: ChatTopic; pr: number | null; venue: string }
  | { kind: 'greet'; manager: string; mood: GreetMood; pr: number | null; issue: number | null }
  | { kind: 'ceo'; busy: boolean }
  | { kind: 'ceoVisit' };

export type ChatterKind = ChatterEvent['kind'];

// ---------- the phrasebook ----------

// {pr}, {issue}, {file}, {tester}, {to}, {host}, {detail} and {manager} are filled in; a template whose blanks can't
// all be filled is skipped.
const LINES: Record<Exclude<ChatterKind, 'work' | 'chat' | 'greet'>, readonly string[]> = {
  start: ['On it: #{issue}!', 'Starting #{issue} now', 'Ooh, #{issue} looks fun', "Right, #{issue}. Let's go!"],
  prOpened: ['PR #{pr} is up for QA', 'Opened PR #{pr} 🚀', '#{pr} is ready for testing!'],
  askQa: ['{tester}, can you look at #{pr}?', '{tester}, #{pr} is all yours', 'Be gentle with #{pr}, {tester}!'],
  qaStart: ['On it!', "Let's see what #{pr} does…", 'Testing #{pr} now 🔍'],
  qaPassed: ['#{pr} looks good to me ✅', 'Passed! #{pr} is ready', 'No bugs in #{pr} ✅'],
  qaFailed: ['Found a bug in #{pr} 🐛', "#{pr} isn't quite there yet", '#{pr} needs another look 🐛'],
  fixing: ['Back to #{pr} then…', 'Okay, fixing #{pr}', 'Oops. On it!'],
  fixPushed: ['Found the bug!', 'Fix pushed for #{pr}', 'There, #{pr} is fixed'],
  testsGreen: ['Tests are green! ✅', 'All tests pass ✅', 'Green across the board!'],
  testsRed: ['Ugh, a red test', 'Hmm, a test fails…', 'Why is that failing?'],
  conflict: ['Ugh, a merge conflict in {file}', 'Merge conflict on #{pr}…', 'Who else touched {file}?!', 'Ugh, a merge conflict'],
  ciSlow: ['CI is so slow today…', 'Still waiting on CI for #{pr}', 'Come on, CI…'],
  ciRed: ['CI is red on #{pr} 😬', 'CI failed on #{pr}?!'],
  merged: ['Shipped #{pr}! 🎉', '#{pr} is merged!', 'Woo, #{pr} is in!'],
  congrats: ['Nice one, {to}!', 'Nice one!', 'Great work on #{pr}, {to}!'],
  error: ["Hmm, that's not right…", 'Uh-oh.', 'Well, that broke'],
  coffee: ['Coffee time ☕', 'I need a coffee', 'Anyone want coffee?', 'Back in a sec, coffee!'],
  visit: ["How's #{issue} going, {host}?", "Ooh, what's that, {host}?", 'Need a hand, {host}?'],
  ceo: ['Big plans today!', "Let's ship it!", 'What a team we have', 'So many ideas…'],
  ceoVisit: ["Hi team! How's it going?", 'Looking good, everyone!', 'Keep it up, team!', 'Just passing through!'],
};

/** The CEO at work at their desk or about the lobby. */
const CEO_BUSY = ['Planning the next sprint…', 'Busy, busy…', 'Reviewing the floors…'];

/** What someone says about what they're doing (lively chatter). */
const WORK: Record<WorkKind, readonly string[]> = {
  read: ['Reading {detail}…', "So that's how {detail} works", 'Hmm, {detail}…', 'Reading the code…'],
  search: ['Where is {detail}…', 'Looking for {detail}', 'Where did that go…', 'I know it was here somewhere'],
  edit: ['Editing {detail}', 'Just a tweak to {detail}', 'Almost done with {detail}', 'Typing, typing…'],
  test: ['Running the tests…', 'Fingers crossed…', 'Tests, please pass', 'Come on, green…'],
  build: ['Building…', "Let's see if it builds", 'Compiling…'],
  browse: ['Clicking through the app 🌐', 'Let me try it in the browser', 'Looks nice on screen!', 'Does this button work?', 'Trying it on a phone 📱'],
  git: ['Committing…', 'Pushing my branch', 'Git, be nice', 'Writing the commit message…'],
  think: ['Hmm, let me think…', 'Thinking…', 'What if…', 'Making a plan…'],
};

/** A chat by the cooler or the couch, by topic. */
const CHAT: Record<ChatTopic, readonly string[]> = {
  '☕': ['Coffee? ☕', 'This coffee is great ☕', 'Third coffee today ☕', 'Who left the pot empty? ☕', 'Decaf? Never ☕'],
  '😂': ['It works on my machine 😂', 'Who named that variable? 😂', 'Have you tried turning it off and on? 😂', "It's not a bug, it's a feature 😂", 'Just one more refactor 😂'],
  '🚀': ["Everyone's so busy 🚀", 'Busy floor today 🚀', 'We ship a lot! 🚀', 'So many PRs today 🚀'],
  '🎉': ['Did you see #{pr} merged? 🎉', '#{pr} shipped! 🎉', 'Another merge! 🎉', 'The gong again! 🎉'],
  '🐛': ['QA found a bug in #{pr} 🐛', 'Poor #{pr} 🐛', 'Bugs everywhere today 🐛', 'Squash that bug! 🐛'],
};

/** By the water cooler, the coffee topic is an offer. */
const COOLER_COFFEE = ['Coffee?', 'Coffee? ☕', 'Want a coffee?'];

/** A greeting, then the quip about their work. */
const HI = ['Hi!', 'Hey, {manager}!', 'Oh, hi!', 'Hello!'];
const QUIPS: Record<GreetMood, readonly string[]> = {
  shipped: ['Hi! #{pr} just shipped 🎉', 'Hey! Did you see #{pr} merged?'],
  inQa: ['Hi! #{pr} is with QA', 'Hey! Waiting on QA for #{pr}'],
  fixing: ['Hi! Fixing #{pr}', 'Hey! #{pr} needs a fix'],
  working: ['Hi! Busy with #{issue}', 'Hey! #{issue} is coming along'],
  testing: ['Hi! Testing #{pr} 🔍', 'Hey! #{pr} is on my bench'],
  free: ['Hi! Got anything for me?', 'Hey {manager}! Need anything?', 'Hi! Just taking a break ☕'],
  ceo: ['Hello, {manager}!', 'Ah, {manager}! Big plans today', 'Hi! Text me any time (P)'],
};

/** The blanks a line can fill in. */
type Blanks = Partial<Record<'pr' | 'issue' | 'file' | 'tester' | 'to' | 'host' | 'detail' | 'manager', string | number | null>>;

/** The templates for an event, and what fills them in. */
function templates(e: ChatterEvent, rand: () => number): { lines: readonly string[]; blanks: Blanks } {
  switch (e.kind) {
    case 'work':
      return { lines: WORK[e.work], blanks: { detail: e.detail } };
    case 'chat':
      return { lines: e.topic === '☕' && e.venue === 'cooler' ? COOLER_COFFEE : CHAT[e.topic], blanks: { pr: e.pr } };
    case 'greet': {
      const quip = e.mood === 'ceo' || rand() < 0.65;
      return { lines: quip ? QUIPS[e.mood] : HI, blanks: { manager: e.manager || null, pr: e.pr, issue: e.issue } };
    }
    case 'ceo':
      return { lines: e.busy ? CEO_BUSY : LINES.ceo, blanks: {} };
    default: {
      const { kind: _kind, ...blanks } = e;
      return { lines: LINES[e.kind], blanks: blanks as Blanks };
    }
  }
}

/** A template with its blanks filled in, or null when one of them has nothing to go in it. */
export function fill(template: string, blanks: Blanks): string | null {
  let ok = true;
  const out = template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = blanks[k as keyof Blanks];
    if (v == null || v === '') ok = false;
    return String(v ?? '');
  });
  return ok ? out : null;
}

/**
 * The line for an event: one of its templates at random (`rand` gives numbers in [0, 1)), never `last` again (what
 * this person said last) when there's anything else to say, and if it can, nothing in `heard` (the floor's last few
 * lines), so five people whose tests pass at once don't all say the same thing.
 */
export function chatterLine(e: ChatterEvent, rand: () => number = Math.random, last: string | null = null, heard: readonly string[] = []): string {
  const { lines, blanks } = templates(e, rand);
  const filled = lines.map((t) => fill(t, blanks)).filter((l): l is string => l !== null);
  // Every template needed a blank we don't have: a plain hello, or a thoughtful noise.
  const options = filled.length ? filled : [e.kind === 'greet' ? 'Hi!' : 'Hmm…'];
  const mine = options.length > 1 ? options.filter((l) => l !== last) : options;
  const unheard = mine.filter((l) => !heard.includes(l));
  const fresh = unheard.length ? unheard : mine;
  return fresh[Math.min(fresh.length - 1, Math.floor(rand() * fresh.length))];
}

// ---------- reading the log ----------

/** A file's name without its folders, if it looks like one (short and safe to show over someone's head). */
export function shortFile(path: string): string | null {
  const name = path.trim().replace(/["'`,;:)]+$/, '').split(/[\\/]/).pop() ?? '';
  return /^[\w.-]{1,28}$/.test(name) && /[A-Za-z]/.test(name) ? name : null;
}

/** A searched-for name, if it's a plain identifier (never a whole pattern or command). */
function shortName(s: string): string | null {
  const m = s.match(/[A-Za-z_][\w.-]{2,23}/);
  return m ? m[0] : null;
}

/** What a tool call (a log line of kind 'tool') says someone is doing, and the one detail worth saying. */
export function workOf(tool: string, text: string): { work: WorkKind; detail: string | null } | null {
  const body = text.replace(/^⏺\s*/, '');
  if (/^mcp__playwright__|^browser_/.test(tool)) return { work: 'browse', detail: null };
  if (/^mcp__/.test(tool)) return null; // the CEO's office tools and the like: nothing to say about them
  switch (tool) {
    case 'Read':
      return { work: 'read', detail: shortFile(body.replace(/^Read\s+/, '')) };
    case 'Glob':
    case 'Grep':
    case 'WebSearch':
      return { work: 'search', detail: shortName(body.replace(/^(Glob|Grep|Search)\s+/, '').replace(/^["']|["']$/g, '')) };
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
    case 'apply_patch':
      return { work: 'edit', detail: shortFile(body.replace(/^(Edit|Write)\s+/, '').split(',')[0]) };
    case 'TodoWrite':
      return { work: 'think', detail: null };
    case 'Bash':
    case 'PowerShell': {
      const cmd = body.replace(/^\$\s*/, '');
      if (/\b(test|vitest|jest|pytest|playwright test)\b/.test(cmd)) return { work: 'test', detail: null };
      if (/\b(git|gh)\s/.test(cmd)) return { work: 'git', detail: null };
      if (/\b(build|tsc|typecheck|lint)\b/.test(cmd)) return { work: 'build', detail: null };
      if (/\b(dev|preview|serve)\b/.test(cmd)) return { work: 'browse', detail: null };
      return null;
    }
    default:
      return null;
  }
}

/** What a log line tells the office about someone's work. */
export type LogNews =
  | { kind: 'work'; work: WorkKind; detail: string | null }
  | { kind: 'testsGreen' }
  | { kind: 'testsRed' }
  | { kind: 'pushed' }
  | { kind: 'conflict'; file: string | null };

/** The news in one log line, if any: a tool at work, tests passing or failing, a push, a merge conflict. */
export function readLog(line: Pick<LogLine, 'kind' | 'text' | 'tool'>): LogNews | null {
  const text = line.text;
  const conflict = text.match(/CONFLICT \([^)]*\): Merge conflict in (\S+)/);
  if (conflict) return { kind: 'conflict', file: shortFile(conflict[1]) };
  if (/\bmerge conflicts?\b/i.test(text) && line.kind !== 'tool') return { kind: 'conflict', file: null };
  if (line.kind === 'tool' && line.tool) {
    if (/\bgit push\b/.test(text)) return { kind: 'pushed' };
    const w = workOf(line.tool, text);
    return w && { kind: 'work', ...w };
  }
  if (line.kind === 'thinking') return { kind: 'work', work: 'think', detail: null };
  if (line.kind === 'result') {
    if (/\b[1-9]\d* (failed|failing)\b|\bFAIL\b/.test(text)) return { kind: 'testsRed' };
    if (/\bTests?( Files)?\s+\d+ passed\b|\b\d+ (tests? )?passed\b|\(\d+ tests?\)/.test(text)) return { kind: 'testsGreen' };
  }
  return null;
}
