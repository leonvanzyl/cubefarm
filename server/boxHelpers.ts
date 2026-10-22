// The small programs the office puts in each cloud agent's Box (docs/cloud.md), in <BOX_BIN>. A Box can't reach the
// office's own address, so where a local CLI's hooks POST to the office, these append one JSON line per event to the
// session's events file, which the office reads (server/boxCli.ts). Each line is ASCII-only JSON, written in one
// append, so a reader that counts bytes never splits a line or a character.

/** Shared by the scripts below: one event, one line. */
const PUT = String.raw`
const fs = require('fs');
function put(file, ev) {
  const line = JSON.stringify(ev).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  fs.appendFileSync(file, line + '\n');
}`;

/** Starts the session's CLI from launch.json (so no prompt is ever shell-quoted) and records how it exited. */
export const BOX_LAUNCH_SOURCE = String.raw`// cubefarm: starts a cloud agent's CLI and notes its exit in the session's events file.
${PUT}
const { spawn } = require('child_process');
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const child = spawn(spec.file, spec.args, { cwd: spec.cwd, stdio: 'inherit', env: process.env });
let over = false;
const done = (code) => {
  if (over) return;
  over = true;
  try { put(spec.events, { hook_event_name: 'CubefarmExit', code }); } catch {}
  process.exit(code);
};
child.on('error', (err) => { process.stderr.write(String(err && err.message) + '\n'); done(127); });
child.on('exit', (code, signal) => done(code === null ? (signal ? 128 : 1) : code));
// Ctrl-C reaches the CLI from the terminal itself; passing it on again would count as a second press.
process.on('SIGINT', () => {});
for (const s of ['SIGHUP', 'SIGTERM']) process.on(s, () => child.kill(s));
`;

/** Claude Code's hooks: every event to the events file; tool calls are approved here (nobody may be there to answer). */
export const BOX_HOOK_SOURCE = String.raw`// cubefarm: Claude Code's hooks in a cloud agent's Box.
${PUT}
const file = process.argv[2];
const chunks = [];
// Big tool output is cut (the office shows a summary); images (screenshots) and the start of the text are kept.
function slim(v, key, depth) {
  if (typeof v === 'string') return key !== 'data' && v.length > 6000 ? v.slice(0, 4000) + '\n… (' + (v.length - 5000) + ' characters cut)\n' + v.slice(-1000) : v;
  if (depth > 6 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => slim(x, '', depth + 1));
  const out = {};
  for (const k of Object.keys(v)) out[k] = slim(v[k], k, depth + 1);
  return out;
}
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  let b = {};
  try { b = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
  if (typeof b.transcript_path === 'string') b.transcript_exists = fs.existsSync(b.transcript_path);
  if (b.tool_response !== undefined) b.tool_response = slim(b.tool_response, '', 0);
  if (b.tool_input !== undefined) b.tool_input = slim(b.tool_input, '', 0);
  try { put(file, b); } catch {}
  if (b.hook_event_name === 'PreToolUse') {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'Approved by cubefarm' } }));
  }
});
`;

/** Claude Code's status line: cost and usage limits to the events file when they change; the office's label shown. */
export const BOX_STATUSLINE_SOURCE = String.raw`// cubefarm: Claude Code's status line in a cloud agent's Box.
${PUT}
const file = process.argv[2];
let body = '';
process.stdin.on('data', (c) => (body += c));
process.stdin.on('end', () => {
  try {
    const s = JSON.parse(body);
    const ev = { hook_event_name: 'StatusLine', session_id: s.session_id, cost: s.cost, rate_limits: s.rate_limits };
    const key = JSON.stringify([ev.cost && ev.cost.total_cost_usd, ev.rate_limits]);
    let last = '';
    try { last = fs.readFileSync(file + '.status', 'utf8'); } catch {}
    if (key !== last) {
      put(file, ev);
      fs.writeFileSync(file + '.status', key);
    }
  } catch {}
  process.stdout.write(process.env.CUBEFARM_STATUS || 'cubefarm');
});
`;

/** Codex's notify program: a finished turn to the events file. */
export const BOX_NOTIFY_SOURCE = String.raw`// cubefarm: Codex's notify program in a cloud agent's Box.
${PUT}
const [file, payload] = process.argv.slice(2);
let event = {};
try { event = JSON.parse(payload || '{}'); } catch {}
if (event.type === 'agent-turn-complete') {
  const input = String((event['input-messages'] || [])[0] || '').slice(0, 300);
  try { put(file, { hook_event_name: 'TurnComplete', session_id: event['thread-id'] || null, last_assistant_message: event['last-assistant-message'] || '', input }); } catch {}
}
`;

/** Codex's hooks: what Codex tells a hook, to the events file (CUBEFARM_HOOK_URL holds its path in a Box). */
export const BOX_CODEX_HOOK_SOURCE = String.raw`// cubefarm: Codex's hooks in a cloud agent's Box.
${PUT}
const file = process.env.CUBEFARM_HOOK_URL;
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  try { if (file) put(file, JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch {}
});
`;

/**
 * Stops what an agent left running on its port or in its worktree. Never tmux, nor the two programs under it that are
 * the agent's session (the launcher and the CLI), nor this script and its shell.
 */
export const BOX_RELEASE_SOURCE = String.raw`// cubefarm: stops what a cloud agent left running.
const fs = require('fs');
const port = Number(process.argv[2]);
const dir = process.argv[3] || '/nonexistent';
const procs = new Map();
for (const name of fs.readdirSync('/proc')) {
  if (!/^\d+$/.test(name)) continue;
  try {
    const stat = fs.readFileSync('/proc/' + name + '/stat', 'utf8');
    const close = stat.lastIndexOf(')');
    const comm = stat.slice(stat.indexOf('(') + 1, close);
    const ppid = Number(stat.slice(close + 2).split(' ')[1]);
    const cmd = fs.readFileSync('/proc/' + name + '/cmdline', 'utf8').split('\0').join(' ');
    procs.set(Number(name), { ppid, comm, cmd });
  } catch {}
}
const spare = new Set([process.pid, process.ppid]);
for (const [pid, p] of procs) {
  if (!p.comm.startsWith('tmux')) continue;
  spare.add(pid);
  for (const [c, q] of procs) if (q.ppid === pid) {
    spare.add(c);
    for (const [g, r] of procs) if (r.ppid === c) spare.add(g);
  }
}
const inodes = new Set();
const hex = port.toString(16).toUpperCase().padStart(4, '0');
for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
  try {
    for (const line of fs.readFileSync(f, 'utf8').split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length > 9 && cols[1].endsWith(':' + hex) && cols[3] === '0A') inodes.add(cols[9]);
    }
  } catch {}
}
const doomed = new Set();
for (const [pid, p] of procs) {
  if (spare.has(pid)) continue;
  if (p.cmd.includes(dir)) { doomed.add(pid); continue; }
  if (!inodes.size) continue;
  try {
    for (const fd of fs.readdirSync('/proc/' + pid + '/fd')) {
      const m = /^socket:\[(\d+)\]$/.exec(fs.readlinkSync('/proc/' + pid + '/fd/' + fd));
      if (m && inodes.has(m[1])) { doomed.add(pid); break; }
    }
  } catch {}
}
for (const pid of doomed) { try { process.kill(pid, 'SIGKILL'); } catch {} }
process.stdout.write(String(doomed.size));
`;

/** Claude Code's first-run screens answered for a worktree: onboarding done, the folder trusted. */
export const BOX_SEED_CLAUDE_SOURCE = String.raw`// cubefarm: marks Claude Code's onboarding done and a folder trusted, in a cloud agent's Box.
const fs = require('fs');
const path = require('path');
const file = path.join(process.env.HOME || '/home/boxuser', '.claude.json');
let c = {};
try { c = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
if (!c || typeof c !== 'object' || Array.isArray(c)) c = {};
c.hasCompletedOnboarding = true;
c.projects = c.projects && typeof c.projects === 'object' ? c.projects : {};
for (const dir of process.argv.slice(2)) c.projects[dir] = Object.assign({}, c.projects[dir], { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true });
fs.writeFileSync(file, JSON.stringify(c, null, 2));
`;

/** Each helper's file name in BOX_BIN and its source. */
export const BOX_HELPERS: Record<string, string> = {
  'launch.cjs': BOX_LAUNCH_SOURCE,
  'hook.cjs': BOX_HOOK_SOURCE,
  'statusline.cjs': BOX_STATUSLINE_SOURCE,
  'notify.cjs': BOX_NOTIFY_SOURCE,
  'codex-hook.cjs': BOX_CODEX_HOOK_SOURCE,
  'release.cjs': BOX_RELEASE_SOURCE,
  'seed-claude.cjs': BOX_SEED_CLAUDE_SOURCE,
};
