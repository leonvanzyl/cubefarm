import { fmtDuration, fmtPct, fmtUsd } from '../ops';
import { roundRect, SANS } from './draw';

// 2D canvas painters for mission control's screens in the lobby (MissionControl.tsx). Each takes exactly the numbers
// it shows, so a screen repaints only when one of them changes.

const C = {
  bg: '#0f1530',
  grid: 'rgba(143, 211, 255, 0.06)',
  line: '#27315c',
  title: '#8fd3ff',
  text: '#eef1ff',
  dim: '#6f7aa8',
  good: '#7CFFB2',
  warn: '#ffd166',
  bad: '#ff6b6b',
  idle: '#4a557f',
  ceo: '#b388ff',
};

/** A floor's label on the screens. */
export interface FloorTag {
  floor: number;
  name: string;
  color: string;
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  let t = text;
  while (t.length > 2 && ctx.measureText(t).width > max) t = `${t.slice(0, -2)}…`;
  return t;
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', weight = 700, max = 4000) {
  ctx.font = `${weight} ${size}px ${SANS}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(fit(ctx, s, max), x, y);
  ctx.textAlign = 'left';
}

/** The dark screen, a faint grid, and the title bar. */
function frame(ctx: CanvasRenderingContext2D, w: number, h: number, title: string, sub?: string) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 32; x < w; x += 64) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = 32; y < h; y += 64) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
  ctx.textBaseline = 'middle';
  text(ctx, title, 32, 46, 40, C.title);
  if (sub) text(ctx, sub, w - 32, 48, 26, C.dim, 'right', 500, w * 0.55);
  ctx.fillStyle = C.line;
  ctx.fillRect(32, 82, w - 64, 3);
}

/** The floor's number on a rounded tile of its colour, then its name. */
function floorLabel(ctx: CanvasRenderingContext2D, f: FloorTag, x: number, y: number, size: number, max: number) {
  const s = size * 1.25;
  roundRect(ctx, x, y - s / 2, s, s, s * 0.25);
  ctx.fillStyle = f.color;
  ctx.fill();
  text(ctx, String(f.floor), x + s / 2, y + 2, size * 0.8, '#1f1d2b', 'center');
  text(ctx, f.name, x + s + 14, y, size * 0.8, C.text, 'left', 600, max - s - 14);
}

// ---------- the pipeline ----------

export interface PipelineCounts {
  ready: number;
  building: number;
  inQa: number;
  fixing: number;
  toMerge: number;
  needsYou: number;
  triage: number;
}

const STAGES: [keyof PipelineCounts, string][] = [
  ['ready', 'Ready'],
  ['building', 'Building'],
  ['inQa', 'In QA'],
  ['fixing', 'Fixing'],
  ['toMerge', 'To merge'],
  ['needsYou', 'Needs you'],
];
const MAX_ROWS = 6;

/** Ready → building → in QA → fixing → to merge → needs you, per floor and in total. */
export function drawPipeline(ctx: CanvasRenderingContext2D, w: number, h: number, d: { floors: (FloorTag & PipelineCounts)[]; total: PipelineCounts }) {
  frame(ctx, w, h, 'PIPELINE', 'issues and pull requests, now');
  const nameW = 270;
  const colW = (w - 64 - nameW) / STAGES.length;
  const colX = (i: number) => 32 + nameW + colW * i + colW / 2;
  STAGES.forEach(([, label], i) => text(ctx, label, colX(i), 118, 24, C.dim, 'center', 600, colW - 6));
  const rows = d.floors.slice(0, MAX_ROWS);
  const top = 148;
  const rowH = Math.min(100, (h - top - 30) / (rows.length + 1));
  const cell = (n: number, key: keyof PipelineCounts, i: number, y: number, bold: boolean) => {
    const size = Math.round(rowH * (bold ? 0.6 : 0.54));
    if (key === 'needsYou' && n > 0) {
      roundRect(ctx, colX(i) - colW * 0.36, y - rowH * 0.38, colW * 0.72, rowH * 0.76, rowH * 0.38);
      ctx.fillStyle = C.bad;
      ctx.fill();
      text(ctx, String(n), colX(i), y + 2, size, '#ffffff', 'center');
    } else text(ctx, String(n), colX(i), y + 2, size, n ? (bold ? C.title : C.text) : C.dim, 'center');
  };
  rows.forEach((f, r) => {
    const y = top + rowH * r + rowH / 2;
    floorLabel(ctx, f, 32, y, Math.min(40, rowH * 0.45), nameW - 10);
    STAGES.forEach(([key], i) => cell(f[key], key, i, y, false));
  });
  const y = top + rowH * rows.length + rowH / 2;
  ctx.fillStyle = C.line;
  ctx.fillRect(32, y - rowH / 2, w - 64, 2);
  const more = d.floors.length - rows.length;
  text(ctx, more > 0 ? `All (+${more} more)` : 'All floors', 32, y, Math.min(36, rowH * 0.42), C.title, 'left', 700, nameW - 10);
  STAGES.forEach(([key], i) => cell(d.total[key], key, i, y, true));
  if (d.total.triage) text(ctx, `🧭 ${d.total.triage} with the CEO`, colX(STAGES.length - 1), Math.min(h - 18, y + rowH * 0.62), 20, C.warn, 'center', 600, colW + 30);
}

// ---------- throughput ----------

/** Merged today and in the last hour, the last 24 hours as bars, and each floor's count today. */
export function drawThroughput(ctx: CanvasRenderingContext2D, w: number, h: number, d: { today: number; hour: number; spark: number[]; floors: (FloorTag & { today: number })[] }) {
  frame(ctx, w, h, 'THROUGHPUT', 'pull requests merged');
  text(ctx, String(d.today), 150, 225, 160, C.good, 'center');
  text(ctx, 'today', 150, 325, 36, C.dim, 'center', 600);
  text(ctx, `${d.hour} in the last hour`, 150, 380, 28, d.hour ? C.text : C.dim, 'center', 600, 260);

  const x0 = 310;
  const x1 = w - 36;
  const yTop = 120;
  const yBase = 390;
  const peak = Math.max(0, ...d.spark);
  const max = Math.max(1, peak);
  const slot = (x1 - x0) / d.spark.length;
  d.spark.forEach((n, i) => {
    const bh = n ? Math.max(8, ((yBase - yTop) * n) / max) : 4;
    roundRect(ctx, x0 + i * slot + 3, yBase - bh, slot - 6, bh, Math.min(6, (slot - 6) / 2));
    ctx.fillStyle = n ? (i === d.spark.length - 1 ? C.good : 'rgba(143, 211, 255, 0.75)') : C.line;
    ctx.fill();
  });
  ctx.fillStyle = C.line;
  ctx.fillRect(x0, yBase + 4, x1 - x0, 2);
  text(ctx, '24 h ago', x0, yBase + 30, 22, C.dim, 'left', 500);
  text(ctx, `busiest hour: ${peak}`, (x0 + x1) / 2, yBase + 30, 22, C.dim, 'center', 500);
  text(ctx, 'now', x1, yBase + 30, 22, C.dim, 'right', 500);

  // each floor's merges today
  const shown = d.floors.slice(0, 4);
  const each = (w - 64) / Math.max(1, shown.length);
  shown.forEach((f, i) => {
    const x = 32 + i * each;
    floorLabel(ctx, f, x, 500, 26, each - 90);
    text(ctx, String(f.today), x + each - 16, 500, 40, f.today ? C.text : C.dim, 'right');
  });
  if (!shown.length) text(ctx, 'No floors yet', w / 2, 500, 30, C.dim, 'center', 600);
  text(ctx, 'merged today, by floor', w / 2, 560, 22, C.dim, 'center', 500);
}

// ---------- flow and CI ----------

export interface FlowNumbers {
  leadMs: number | null;
  qaWaitMs: number | null;
  qaPass: number | null;
  ciPass: number | null;
  ciRuns: number;
  ciMs: number | null;
}

const passTone = (x: number | null) => (x === null ? C.dim : x >= 0.9 ? C.good : x >= 0.7 ? C.warn : C.bad);

/** Lead time and QA wait (last 24 hours), and GitHub's checks (7 days), in four tiles; one line per floor below. */
export function drawFlow(ctx: CanvasRenderingContext2D, w: number, h: number, d: { total: FlowNumbers; floors: (FloorTag & FlowNumbers)[] }) {
  frame(ctx, w, h, 'FLOW & CI', 'medians · last 24 h · checks 7 days');
  const t = d.total;
  const tiles: [string, string, string, string][] = [
    ['LEAD TIME', fmtDuration(t.leadMs), 'issue → merge', t.leadMs === null ? C.dim : C.text],
    ['QA WAIT', fmtDuration(t.qaWaitMs), `QA passes ${fmtPct(t.qaPass)} (7 d)`, t.qaWaitMs === null ? C.dim : C.text],
    ['CI PASS RATE', fmtPct(t.ciPass), `${t.ciRuns} run${t.ciRuns === 1 ? '' : 's'}`, passTone(t.ciPass)],
    ['CI DURATION', fmtDuration(t.ciMs), 'first check to last', t.ciMs === null ? C.dim : C.text],
  ];
  const tw = (w - 64 - 20) / 2;
  const th = 160;
  tiles.forEach(([label, value, sub, color], i) => {
    const x = 32 + (i % 2) * (tw + 20);
    const y = 102 + Math.floor(i / 2) * (th + 14);
    roundRect(ctx, x, y, tw, th, 18);
    ctx.fillStyle = 'rgba(143, 211, 255, 0.07)';
    ctx.fill();
    text(ctx, label, x + 22, y + 30, 24, C.dim, 'left', 700);
    text(ctx, value, x + 22, y + 88, 66, color, 'left', 700, tw - 40);
    text(ctx, sub, x + 22, y + 138, 22, C.dim, 'left', 500, tw - 40);
  });
  d.floors.slice(0, 2).forEach((f, i) => {
    const y = 470 + i * 52;
    floorLabel(ctx, f, 32, y, 26, 330);
    text(ctx, `lead ${fmtDuration(f.leadMs)} · QA wait ${fmtDuration(f.qaWaitMs)} · CI ${fmtPct(f.ciPass)}${f.ciRuns ? ` · ${fmtDuration(f.ciMs)}` : ''}`, w - 32, y, 26, C.text, 'right', 600, w - 400);
  });
  if (d.floors.length > 2) text(ctx, `+${d.floors.length - 2} more floors in the manager's console`, w / 2, 576, 20, C.dim, 'center', 500);
}

// ---------- the team ----------

export interface TeamCounts {
  busy: number;
  idle: number;
  errors: number;
}

/** Busy, idle and in error, per floor, as stacked bars. */
export function drawTeam(ctx: CanvasRenderingContext2D, w: number, h: number, d: { floors: (FloorTag & TeamCounts)[]; total: TeamCounts }) {
  const t = d.total;
  frame(ctx, w, h, 'TEAM', `${t.busy} busy · ${t.idle} idle · ${t.errors} in error`);
  const rows = d.floors.slice(0, MAX_ROWS);
  const top = 108;
  const legend = 40;
  const rowH = Math.min(72, (h - top - legend - 10) / Math.max(1, rows.length));
  const max = Math.max(1, ...rows.map((f) => f.busy + f.idle + f.errors));
  const x0 = 300;
  const x1 = w - 140;
  rows.forEach((f, r) => {
    const y = top + rowH * r + rowH / 2;
    floorLabel(ctx, f, 32, y, Math.min(32, rowH * 0.5), x0 - 50);
    const unit = (x1 - x0) / max;
    let x = x0;
    for (const [n, color] of [
      [f.busy, C.good],
      [f.idle, C.idle],
      [f.errors, C.bad],
    ] as const) {
      if (!n) continue;
      roundRect(ctx, x, y - rowH * 0.26, n * unit - 4, rowH * 0.52, 8);
      ctx.fillStyle = color;
      ctx.fill();
      if (n * unit > 40) text(ctx, String(n), x + (n * unit - 4) / 2, y + 2, Math.round(rowH * 0.36), '#14182c', 'center');
      x += n * unit;
    }
    text(ctx, `${f.busy}/${f.busy + f.idle + f.errors}`, w - 32, y, Math.round(rowH * 0.42), f.errors ? C.bad : C.text, 'right');
  });
  if (!rows.length) text(ctx, 'No floors yet', w / 2, h / 2, 34, C.dim, 'center', 600);
  const ly = h - 28;
  [
    ['busy', C.good],
    ['idle', C.idle],
    ['in error', C.bad],
  ].forEach(([label, color], i) => {
    const x = 32 + i * 170;
    roundRect(ctx, x, ly - 11, 22, 22, 6);
    ctx.fillStyle = color;
    ctx.fill();
    text(ctx, label, x + 32, ly, 22, C.dim, 'left', 600);
  });
}

// ---------- Claude's usage ----------

export interface UsageScreen {
  state: string; // Normal / Pacing / Paused
  tone: 'good' | 'warn' | 'bad';
  limit: string;
  pct: number | null;
  resets: string | null;
  hint: string;
}

const TONE = { good: C.good, warn: C.warn, bad: C.bad };
const STATE_ICON: Record<string, string> = { Normal: '✓', Pacing: '🐢', Paused: '⏸' };

/** The usage meter: normal, pacing or paused, the last warning's limit and fill, and when it resets. */
export function drawUsage(ctx: CanvasRenderingContext2D, w: number, h: number, d: UsageScreen) {
  frame(ctx, w, h, 'CLAUDE USAGE', d.tone === 'good' ? 'full speed' : 'new work held back');
  const color = TONE[d.tone];
  text(ctx, `${STATE_ICON[d.state] ?? ''} ${d.state}`, w / 2, 160, 92, color, 'center');
  const gx = 60;
  const gw = w - 120;
  roundRect(ctx, gx, 236, gw, 42, 21);
  ctx.fillStyle = C.line;
  ctx.fill();
  if (d.pct !== null) {
    roundRect(ctx, gx, 236, Math.max(42, (gw * Math.min(100, d.pct)) / 100), 42, 21);
    ctx.fillStyle = d.pct >= 90 ? C.bad : d.pct >= 75 ? C.warn : C.good;
    ctx.fill();
  }
  text(ctx, d.limit, w / 2, 320, 34, C.text, 'center', 600, w - 80);
  text(ctx, d.resets ? `resets ${d.resets}` : 'nothing to reset', w / 2, 368, 30, C.dim, 'center', 600);
  roundRect(ctx, 60, 404, w - 120, 64, 32);
  ctx.fillStyle = d.tone === 'warn' ? 'rgba(255, 209, 102, 0.16)' : 'rgba(143, 211, 255, 0.08)';
  ctx.fill();
  text(ctx, d.hint, w / 2, 437, 28, d.tone === 'warn' ? C.warn : C.dim, 'center', 700, w - 160);
}

// ---------- cost ----------

/** Today's cost per floor and the CEO's, from finished sessions' reported cost: an estimate. */
export function drawCost(ctx: CanvasRenderingContext2D, w: number, h: number, d: { floors: (FloorTag & { usd: number })[]; ceo: number; total: number }) {
  frame(ctx, w, h, 'COST TODAY', 'estimate · finished sessions');
  text(ctx, `~${fmtUsd(d.total)}`, w - 40, 150, 84, C.warn, 'right');
  text(ctx, 'all floors and the CEO', w - 40, 210, 24, C.dim, 'right', 500);
  const rows: (FloorTag & { usd: number })[] = [...d.floors.slice(0, 4), { floor: 0, name: 'CEO', color: C.ceo, usd: d.ceo }];
  const max = Math.max(0.01, ...rows.map((r) => r.usd));
  const top = 250;
  const rowH = Math.min(56, (h - top - 10) / rows.length);
  rows.forEach((r, i) => {
    const y = top + rowH * i + rowH / 2;
    if (r.floor) floorLabel(ctx, r, 32, y, Math.min(28, rowH * 0.5), 300);
    else text(ctx, '🧠 CEO', 32, y, Math.min(24, rowH * 0.45), C.ceo, 'left', 700);
    const x0 = 340;
    const bw = ((w - 160 - x0) * r.usd) / max;
    roundRect(ctx, x0, y - rowH * 0.2, Math.max(6, bw), rowH * 0.4, 6);
    ctx.fillStyle = r.usd ? r.color : C.line;
    ctx.fill();
    text(ctx, fmtUsd(r.usd), w - 32, y, Math.min(30, rowH * 0.5), r.usd ? C.text : C.dim, 'right');
  });
}

// ---------- the header strip ----------

/** Above the screens: the wall's name, and either all clear or what needs the manager. */
export function drawStrip(ctx: CanvasRenderingContext2D, w: number, h: number, d: { alarms: string[] }) {
  ctx.fillStyle = d.alarms.length ? '#3a0d18' : '#0b1024';
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  text(ctx, '🛰️ MISSION CONTROL', 40, h / 2 + 4, h * 0.46, C.title);
  const n = d.alarms.length;
  if (!n) text(ctx, '✓ All clear', w - 40, h / 2 + 4, h * 0.42, C.good, 'right');
  else text(ctx, `🚨 ${n > 1 ? `${n} need you · ` : ''}${d.alarms[0]}`, w - 40, h / 2 + 4, h * 0.36, '#ffd6dc', 'right', 700, w * 0.6);
}
