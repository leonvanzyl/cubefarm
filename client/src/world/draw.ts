import type { LogLine, PreviewStatus, PreviewView, RepoView } from '../../../shared/types';
import type { Agent, KanbanCard, KanbanColumns } from '../store';
import { testingLabel } from '../qaCard';

// 2D canvas painters for everything in the office that shows text: laptop terminals,
// the Kanban whiteboard, signs and name tags.

export const MONO = '"JetBrains Mono", Consolas, "Cascadia Mono", monospace';
export const SANS = 'Fredoka, "Segoe UI", system-ui, sans-serif';

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

// ---------- terminal ----------

const TERM = {
  bg: '#1b1b29',
  bar: '#2a2a3d',
  text: '#e8e8f2',
  tool: '#8be9fd',
  result: '#8d8da8',
  system: '#bd93f9',
  error: '#ff6b6b',
  manager: '#ffb86c',
  done: '#50fa7b',
  thinking: '#f1fa8c',
};

const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
const VERBS = ['Crafting', 'Pondering', 'Tinkering', 'Brewing', 'Noodling', 'Scheming', 'Assembling', 'Percolating'];

export function toolVerb(tool: string | null): string {
  if (!tool) return '';
  if (tool.startsWith('mcp__playwright__')) return 'Browsing';
  if (tool === 'Bash' || tool === 'PowerShell') return 'Running';
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') return 'Editing';
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob') return 'Reading';
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'Researching';
  return tool;
}

export function drawTerminal(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  agent: Agent,
  lines: LogLine[],
  shot: HTMLImageElement | null,
  showBrowser: boolean,
  now: number,
  program: string, // the coding agent's command, e.g. claude or codex
) {
  ctx.fillStyle = TERM.bg;
  ctx.fillRect(0, 0, w, h);

  // title bar
  const barH = 30;
  ctx.fillStyle = TERM.bar;
  ctx.fillRect(0, 0, w, barH);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(18 + i * 20, barH / 2, 6, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = '#b8b8cc';
  ctx.font = `600 14px ${MONO}`;
  ctx.textBaseline = 'middle';
  const job =
    agent.status === 'idle'
      ? 'idle'
      : agent.role === 'ceo'
        ? (agent.issueTitle ?? 'running the company').toLowerCase()
        : agent.task === 'qa'
          ? `QA of PR #${agent.prNumber}`
          : agent.task === 'fix'
            ? `fixing PR #${agent.prNumber}`
            : agent.issueNumber
              ? `issue #${agent.issueNumber}`
              : 'idle';
  const host = agent.role === 'qa' ? 'qa-lab' : agent.role === 'ceo' ? 'hq' : 'swarm';
  const title = `${agent.name.toLowerCase()}@${host} — ${job} — ${program}`;
  ctx.fillText(title, 84, barH / 2 + 1);

  const termW = showBrowser ? Math.round(w * 0.56) : w;

  if (agent.status === 'idle' && lines.length <= 1) {
    drawScreensaver(ctx, 0, barH, w, h - barH, agent, now);
    return;
  }

  // log lines, newest at the bottom
  const fontSize = 14;
  const lh = 17;
  ctx.font = `${fontSize}px ${MONO}`;
  const charW = ctx.measureText('M').width;
  const cols = Math.max(10, Math.floor((termW - 20) / charW));
  const footer = agent.status === 'working' || agent.status === 'preparing' ? 28 : 8;
  const maxRows = Math.floor((h - barH - 10 - footer) / lh);

  const rows: { text: string; kind: LogLine['kind'] }[] = [];
  for (let i = lines.length - 1; i >= 0 && rows.length < maxRows; i--) {
    const l = lines[i];
    const chunks: string[] = [];
    const text = l.text || ' ';
    for (let p = 0; p < text.length; p += cols) chunks.push(text.slice(p, p + cols));
    for (let c = chunks.length - 1; c >= 0 && rows.length < maxRows; c--) rows.unshift({ text: chunks[c], kind: l.kind });
  }

  let y = barH + 10 + lh / 2;
  for (const r of rows) {
    if (r.kind === 'tool' && r.text.startsWith('⏺')) {
      ctx.fillStyle = TERM.done;
      ctx.fillText('⏺', 10, y);
      ctx.fillStyle = TERM.tool;
      ctx.fillText(r.text.slice(1), 10 + charW, y);
    } else if (r.kind === 'text' && r.text.startsWith('●')) {
      ctx.fillStyle = '#ffffff';
      ctx.fillText('●', 10, y);
      ctx.fillStyle = TERM.text;
      ctx.fillText(r.text.slice(1), 10 + charW, y);
    } else {
      ctx.fillStyle = TERM[r.kind] ?? TERM.text;
      ctx.fillText(r.text, 10, y);
    }
    y += lh;
  }

  if (agent.status === 'working' || agent.status === 'preparing') {
    const frame = Math.floor(now / 120) % SPINNER.length;
    const verb = agent.status === 'preparing' ? (agent.currentTool ?? 'Setting up worktree') : toolVerb(agent.currentTool) || VERBS[Math.floor(now / 6000) % VERBS.length];
    const secs = agent.startedAt ? Math.floor((Date.now() - agent.startedAt) / 1000) : 0;
    const mm = Math.floor(secs / 60);
    ctx.fillStyle = '#ff9e64';
    ctx.font = `600 ${fontSize}px ${MONO}`;
    ctx.fillText(`${SPINNER[frame]} ${verb}… (${mm}m ${secs % 60}s)`, 10, h - 14);
  }

  if (showBrowser) drawBrowser(ctx, termW, barH, w - termW, h - barH, agent.browserUrl, shot);
}

function drawScreensaver(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, agent: Agent, now: number) {
  const t = now / 1000;
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#26264a');
  g.addColorStop(1, '#3b2a55');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  const bx = x + w / 2 + Math.sin(t * 0.7) * w * 0.25;
  const by = y + h / 2 + Math.cos(t * 0.9) * h * 0.18;
  ctx.textAlign = 'center';
  ctx.font = `64px ${SANS}`;
  ctx.fillText('✻', bx, by - 20);
  ctx.fillStyle = '#ffd6a5';
  ctx.font = `600 26px ${SANS}`;
  ctx.fillText(`${agent.name} is free`, bx, by + 34);
  ctx.fillStyle = '#b8b8dd';
  ctx.font = `18px ${SANS}`;
  ctx.fillText(agent.role === 'qa' ? 'waiting for a PR to test…' : agent.role === 'ceo' ? 'thinking about the company…' : 'waiting for an issue…', bx, by + 62);
  ctx.textAlign = 'left';
}

function drawBrowser(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, url: string | null, shot: HTMLImageElement | null) {
  ctx.fillStyle = '#e9ecf2';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#d5d9e2';
  ctx.fillRect(x, y, w, 34);
  roundRect(ctx, x + 10, y + 6, w - 20, 22, 11);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.fillStyle = '#4a5160';
  ctx.font = `13px ${SANS}`;
  ctx.textBaseline = 'middle';
  const u = (url ?? 'about:blank').replace(/^https?:\/\//, '');
  ctx.fillText(`🔒 ${u.length > 42 ? `${u.slice(0, 41)}…` : u}`, x + 20, y + 18);
  const area = { x: x + 4, y: y + 38, w: w - 8, h: h - 42 };
  if (shot && shot.complete && shot.naturalWidth > 0) {
    const s = Math.min(area.w / shot.naturalWidth, area.h / shot.naturalHeight);
    const dw = shot.naturalWidth * s;
    const dh = shot.naturalHeight * s;
    ctx.drawImage(shot, area.x + (area.w - dw) / 2, area.y, dw, dh);
  } else {
    ctx.fillStyle = '#9aa1b2';
    ctx.textAlign = 'center';
    ctx.font = `16px ${SANS}`;
    ctx.fillText('🌐 loading page…', area.x + area.w / 2, area.y + area.h / 2);
    ctx.textAlign = 'left';
  }
}

// ---------- kanban whiteboard ----------

const COLS: { key: keyof KanbanColumns; title: string; chip: string; note: string }[] = [
  { key: 'backlog', title: '📋 Backlog', chip: '#ffd166', note: '#fff3b0' },
  { key: 'progress', title: '🔨 In progress', chip: '#4cc9f0', note: '#cfeefd' },
  { key: 'qa', title: '🔍 In QA', chip: '#ff9f68', note: '#ffe3cf' },
  { key: 'ready', title: '✅ Ready to merge', chip: '#80ed99', note: '#d8f9df' },
  { key: 'merged', title: '🎉 Merged', chip: '#c77dff', note: '#eadcff' },
];

const TONE = { warn: '#ffd8a8', bad: '#ffc9c9', good: '#d8f9df' };

/** The whiteboard's columns, left to right. */
export const KANBAN_KEYS: (keyof KanbanColumns)[] = COLS.map((c) => c.key);

/** Where drawKanban puts column `ci` on a canvas `w` pixels wide: its left edge and width. */
export function kanbanColumnSpan(ci: number, w: number) {
  const colW = (w - 80) / COLS.length;
  return { x0: 40 + ci * colW, colW };
}

const NOTE = { top: 96, h: 104, gap: 12, perCol: 2 };

/** How many notes fit in a column on a canvas `h` pixels tall (one slot goes to "+N more" when there are more). */
export const kanbanCapacity = (h: number) => Math.floor((h - NOTE.top - 70) / (NOTE.h + NOTE.gap)) * NOTE.perCol;

/** Where drawKanban puts the `i`th note of column `ci` on a `w` × `h` canvas. */
export function kanbanNoteRect(ci: number, i: number, w: number) {
  const { x0, colW } = kanbanColumnSpan(ci, w);
  const nw = (colW - 48) / 2;
  return { x: x0 + 16 + (i % NOTE.perCol) * (nw + 16), y: NOTE.top + 68 + Math.floor(i / NOTE.perCol) * (NOTE.h + NOTE.gap), w: nw, h: NOTE.h };
}

/** A column's sticky-note colour. */
export const kanbanNoteColor = (key: keyof KanbanColumns) => COLS.find((c) => c.key === key)?.note ?? '#fff3b0';

/** A loose sticky (StickyNotes.tsx's atlas): the note colour, its number big, a darker edge for the toon outline. */
export function drawSticky(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, color: string) {
  ctx.clearRect(x, y, w, h);
  ctx.fillStyle = shadeHex(color, -0.35);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
  ctx.fillStyle = 'rgba(0,0,0,0.07)';
  ctx.fillRect(x + 4, y + 4, w - 8, h * 0.14);
  ctx.fillStyle = '#2d3142';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(h * 0.42)}px ${SANS}`;
  ctx.fillText(label, x + w / 2, y + h * 0.56, w - 16);
  ctx.textAlign = 'left';
}

function shadeHex(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

export function drawKanban(ctx: CanvasRenderingContext2D, w: number, h: number, repo: RepoView, cols: KanbanColumns) {
  ctx.fillStyle = '#fbfbf8';
  ctx.fillRect(0, 0, w, h);
  // faint marker smudges
  ctx.fillStyle = 'rgba(120,140,170,0.05)';
  for (let i = 0; i < 6; i++) ctx.fillRect((i * 431) % w, (i * 97) % h, 260, 40);

  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#2d3142';
  ctx.font = `700 46px ${SANS}`;
  ctx.fillText(repo.fullName, 40, 48);
  ctx.font = `500 26px ${SANS}`;
  ctx.fillStyle = '#6c7086';
  const synced = repo.lastSync ? `synced ${new Date(repo.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'syncing…';
  ctx.textAlign = 'right';
  ctx.fillText(`${repo.autoAssign ? '⚡ auto-assign on · ' : ''}${synced}`, w - 40, 50);
  ctx.textAlign = 'left';

  const top = NOTE.top;
  const now = Date.now(); // a testing card's elapsed time: it only moves on when the board repaints anyway
  COLS.forEach((c, ci) => {
    const { x0, colW } = kanbanColumnSpan(ci, w);
    const cards = cols[c.key];
    roundRect(ctx, x0 + 8, top, colW - 16, 52, 26);
    ctx.fillStyle = c.chip;
    ctx.fill();
    ctx.fillStyle = '#1f2233';
    ctx.font = `600 30px ${SANS}`;
    ctx.fillText(`${c.title}  ${cards.length}`, x0 + 30, top + 27);
    if (ci > 0) {
      ctx.strokeStyle = '#d9dbe3';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x0, top);
      ctx.lineTo(x0, h - 30);
      ctx.stroke();
    }

    const capacity = kanbanCapacity(h);
    const shown = cards.length > capacity ? cards.slice(0, capacity - 1) : cards;
    shown.forEach((card, i) => {
      const n = kanbanNoteRect(ci, i, w);
      drawNote(ctx, n.x, n.y, n.w, n.h, card, card.tone ? TONE[card.tone] : c.note, now);
    });
    if (cards.length > shown.length) {
      ctx.fillStyle = '#6c7086';
      ctx.font = `600 26px ${SANS}`;
      const n = kanbanNoteRect(ci, shown.length, w);
      ctx.fillText(`+${cards.length - shown.length} more`, n.x + 14, n.y + n.h / 2);
    }
    if (cards.length === 0) {
      ctx.fillStyle = '#b4b7c5';
      ctx.font = `italic 500 26px ${SANS}`;
      ctx.fillText(c.key === 'backlog' ? 'no open issues' : 'nothing here yet', x0 + 30, top + 110);
    }
  });
}

function drawNote(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, card: KanbanCard, color: string, now: number) {
  const tilt = (((card.number * 37) % 7) - 3) * 0.006;
  const ink = card.agent && /^#[0-9a-f]{6}$/i.test(card.agent.color) ? card.agent.color : '#8a8fa3';
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(tilt);
  ctx.translate(-w / 2, -h / 2);
  if (card.ghost) {
    // the sticky is off the board, on its tester's monitor: a dashed slot in their colour, still saying what it is
    ctx.fillStyle = shadeHex(ink, 0.86);
    ctx.fillRect(0, 0, w, h);
    ctx.setLineDash([12, 9]);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    ctx.setLineDash([]);
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(4, 6, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.fillRect(0, 0, w, 10);
  }

  ctx.fillStyle = '#2d3142';
  ctx.font = `700 22px ${SANS}`;
  ctx.textBaseline = 'top';
  const header = `${card.prNumber ? 'PR ' : ''}#${card.number}`;
  ctx.fillText(header, 14, 12);
  const headerW = ctx.measureText(header).width;
  ctx.font = `500 19px ${SANS}`;
  const lines = wrap(ctx, card.title, w - 28, 2);
  lines.forEach((l, i) => ctx.fillText(l, 14, 38 + i * 21));

  ctx.textBaseline = 'middle';
  if (card.ghost) {
    const label = testingLabel(card.agent?.name, card.qa?.round ?? 0, card.qa?.updatedAt, now);
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(22, h - 15, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2d3142';
    ctx.font = `600 17px ${SANS}`;
    ctx.fillText(label.who, 36, h - 14, w - 46);
    ctx.font = `600 15px ${SANS}`;
    const room = w - 12 - (14 + headerW + 12);
    const meta = label.meta.find((m) => ctx.measureText(m).width <= room);
    if (meta) {
      ctx.fillStyle = '#5c6078';
      ctx.textAlign = 'right';
      ctx.fillText(meta, w - 12, 24);
      ctx.textAlign = 'left';
    }
  } else if (card.agent) {
    ctx.fillStyle = card.agent.color;
    ctx.beginPath();
    ctx.arc(22, h - 15, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2d3142';
    ctx.font = `600 17px ${SANS}`;
    ctx.fillText(card.agent.name, 36, h - 14);
  }
  if (card.note && !card.ghost) {
    ctx.font = `500 16px ${SANS}`;
    ctx.fillStyle = '#5c6078';
    ctx.textAlign = 'right';
    ctx.fillText(card.note, w - 12, h - 14);
    ctx.textAlign = 'left';
  }
  ctx.restore();
  ctx.textBaseline = 'middle';
}

// ---------- signs and tags ----------

export function drawTag(ctx: CanvasRenderingContext2D, w: number, h: number, agent: Agent) {
  ctx.clearRect(0, 0, w, h);
  const icon =
    agent.status === 'working'
      ? agent.currentTool?.startsWith('mcp__playwright')
        ? '🌐'
        : agent.currentTool === 'Bash' || agent.currentTool === 'PowerShell'
          ? '▶️'
          : agent.currentTool
            ? '⌨️'
            : '💭'
      : agent.status === 'preparing'
        ? '📦'
        : agent.status === 'done'
          ? '✅'
          : agent.status === 'error'
            ? '❗'
            : agent.status === 'stopped'
              ? '⏸️'
              : agent.role === 'qa'
                ? '🧪'
                : agent.role === 'ceo'
                  ? '🏛️'
                  : '☕';
  roundRect(ctx, 4, 4, w - 8, h - 8, (h - 8) / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = agent.color;
  ctx.stroke();
  ctx.textBaseline = 'middle';
  ctx.font = `38px ${SANS}`;
  ctx.fillText(icon, 22, h / 2 + 2);
  ctx.fillStyle = '#23263a';
  ctx.font = `700 40px ${SANS}`;
  const busy = agent.status !== 'idle';
  let label =
    agent.role === 'ceo'
      ? `${agent.name} · CEO`
      : agent.role === 'qa'
        ? busy && agent.prNumber
          ? `${agent.name} · QA PR #${agent.prNumber}`
          : `${agent.name} · ${agent.title || 'QA'}`
        : busy && agent.task === 'fix' && agent.prNumber
          ? `${agent.name} · 🔧 PR #${agent.prNumber}`
          : busy && agent.task === 'qa' && agent.prNumber
            ? `${agent.name} · 🧪 PR #${agent.prNumber}`
            : busy && agent.issueNumber
              ? `${agent.name} · #${agent.issueNumber}`
              : agent.title
                ? `${agent.name} · ${agent.title}`
                : agent.name;
  while (label.length > 4 && ctx.measureText(label).width > w - 96) label = `${label.slice(0, -2)}…`;
  ctx.fillText(label, 78, h / 2 + 2);
}

/** Name tag for a candidate in the waiting room: who they are and the job they're up for. */
export function drawCandidateTag(ctx: CanvasRenderingContext2D, w: number, h: number, name: string, title: string, floor: number | null, color: string) {
  ctx.clearRect(0, 0, w, h);
  roundRect(ctx, 4, 4, w - 8, h - 8, 28);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = color;
  ctx.setLineDash([14, 8]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.textBaseline = 'middle';
  ctx.font = `44px ${SANS}`;
  ctx.fillText('📄', 20, h / 2 + 2);
  const fit = (text: string, max: number) => {
    let t = text;
    while (t.length > 4 && ctx.measureText(t).width > max) t = `${t.slice(0, -2)}…`;
    return t;
  };
  ctx.fillStyle = '#23263a';
  ctx.font = `700 40px ${SANS}`;
  ctx.fillText(fit(`${name} · candidate`, w - 100), 80, h * 0.36);
  ctx.fillStyle = '#5c6078';
  ctx.font = `600 28px ${SANS}`;
  ctx.fillText(fit(`${title}${floor ? ` · floor ${floor}` : ''}`, w - 100), 80, h * 0.72);
}

export function drawSign(ctx: CanvasRenderingContext2D, w: number, h: number, lines: { text: string; size: number; color?: string; weight?: number }[], bg: string, fg = '#ffffff') {
  roundRect(ctx, 0, 0, w, h, 28);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const total = lines.reduce((s, l) => s + l.size * 1.25, 0);
  let y = h / 2 - total / 2;
  for (const l of lines) {
    y += (l.size * 1.25) / 2;
    ctx.fillStyle = l.color ?? fg;
    ctx.font = `${l.weight ?? 700} ${l.size}px ${SANS}`;
    let text = l.text;
    while (text.length > 3 && ctx.measureText(text).width > w - 40) text = `${text.slice(0, -2)}…`;
    ctx.fillText(text, w / 2, y);
    y += (l.size * 1.25) / 2;
  }
  ctx.textAlign = 'left';
}

/** Window glass: a faint blue tint you see straight through, with two diagonal glints. */
export function drawGlass(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = 'rgba(205, 236, 255, 0.16)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
  for (const [x0, bw] of [[0.18, 0.07], [0.3, 0.025]] as const) {
    ctx.beginPath();
    ctx.moveTo(w * x0, h);
    ctx.lineTo(w * (x0 + bw), h);
    ctx.lineTo(w * (x0 + bw + 0.22), 0);
    ctx.lineTo(w * (x0 + 0.22), 0);
    ctx.fill();
  }
}

/**
 * One bay of the building's outside, one storey tall, for the floors above and below yours: the wall, a window,
 * and the slab between floors along the top. `wall` is the fraction of the storey that's wall (the rest is slab).
 */
export function drawFacade(ctx: CanvasRenderingContext2D, w: number, h: number, wall: number, win: { x0: number; x1: number; y0: number; y1: number }) {
  ctx.fillStyle = '#f6ecda';
  ctx.fillRect(0, 0, w, h);
  const slab = h * (1 - wall);
  ctx.fillStyle = '#dccbb0';
  ctx.fillRect(0, 0, w, slab);
  ctx.fillStyle = '#b9a68a';
  ctx.fillRect(0, slab - 3, w, 3);
  // fractions of the storey, from its floor up
  const x0 = w * win.x0;
  const x1 = w * win.x1;
  const top = h - h * win.y1;
  const bottom = h - h * win.y0;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x0 - 5, top - 5, x1 - x0 + 10, bottom - top + 12);
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, '#8fc9ef');
  g.addColorStop(1, '#c4e6fb');
  ctx.fillStyle = g;
  ctx.fillRect(x0, top, x1 - x0, bottom - top);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.beginPath();
  ctx.moveTo(x0 + (x1 - x0) * 0.15, bottom);
  ctx.lineTo(x0 + (x1 - x0) * 0.25, bottom);
  ctx.lineTo(x0 + (x1 - x0) * 0.45, top);
  ctx.lineTo(x0 + (x1 - x0) * 0.35, top);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect((x0 + x1) / 2 - 3, top, 6, bottom - top);
  ctx.fillStyle = '#1f1d2b';
  ctx.fillRect(x0 - 5, bottom + 5, x1 - x0 + 10, 2);
}

// ---------- the floor's app monitor ----------

const APP_STEPS: { status: PreviewStatus; label: string }[] = [
  { status: 'preparing', label: 'Checking out the code' },
  { status: 'installing', label: 'Installing dependencies' },
  { status: 'starting', label: 'Starting the app' },
];

const APP_BADGE: Record<PreviewStatus, { text: string; bg: string }> = {
  unconfigured: { text: 'NOT SET UP', bg: '#5c6078' },
  stopped: { text: 'STOPPED', bg: '#5c6078' },
  preparing: { text: 'STARTING', bg: '#f4a261' },
  installing: { text: 'STARTING', bg: '#f4a261' },
  starting: { text: 'STARTING', bg: '#f4a261' },
  running: { text: '● LIVE', bg: '#ef233c' },
  error: { text: 'ERROR', bg: '#e63946' },
};

/** Shorten text with an ellipsis until it fits in max pixels, in the context's current font. */
function fitText(ctx: CanvasRenderingContext2D, text: string, max: number) {
  let t = text;
  while (t.length > 2 && ctx.measureText(t).width > max) t = `${t.slice(0, -2)}…`;
  return t;
}

export interface AppScreenInfo {
  floor: number;
  name: string;
  color: string;
  preview: PreviewView;
  shot: HTMLImageElement | null; // the latest agent screenshot on the floor, shown while the app is live
  shotBy: string | null;
}

/** The wall screen at the front of an office floor: the floor's app and how it's doing. */
export function drawAppScreen(ctx: CanvasRenderingContext2D, w: number, h: number, info: AppScreenInfo) {
  const p = info.preview;
  ctx.fillStyle = TERM.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  // header: floor chip, floor name, status badge
  const headH = 118;
  ctx.fillStyle = TERM.bar;
  ctx.fillRect(0, 0, w, headH);
  ctx.fillStyle = info.color;
  ctx.fillRect(0, headH - 6, w, 6);
  ctx.font = `700 34px ${SANS}`;
  const chip = `FLOOR ${info.floor}`;
  const chipW = ctx.measureText(chip).width + 44;
  roundRect(ctx, 40, 30, chipW, 54, 27);
  ctx.fillStyle = info.color;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(chip, 62, 58);

  const badge = APP_BADGE[p.status];
  ctx.font = `700 38px ${SANS}`;
  const badgeW = ctx.measureText(badge.text).width + 52;
  roundRect(ctx, w - 40 - badgeW, 28, badgeW, 58, 29);
  ctx.fillStyle = badge.bg;
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText(badge.text, w - 40 - badgeW / 2, 58);
  ctx.textAlign = 'left';

  ctx.font = `700 50px ${SANS}`;
  const nameX = 40 + chipW + 26;
  ctx.fillText(fitText(ctx, info.name, w - 40 - badgeW - 26 - nameX), nameX, 58);

  const centred = (text: string, y: number, size: number, color: string, weight = 700) => {
    ctx.font = `${weight} ${size}px ${SANS}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(fitText(ctx, text, w - 100), w / 2, y);
    ctx.textAlign = 'left';
  };
  const footer = (text: string, color = '#8d8da8') => centred(text, h - 50, 32, color, 600);

  const bodyTop = headH;
  const midY = bodyTop + (h - headH - 100) / 2;
  const ref = p.ref ?? 'the app';

  if (p.status === 'stopped') {
    // a big play button
    const cy = midY - 70;
    ctx.fillStyle = info.color;
    ctx.beginPath();
    ctx.arc(w / 2, cy, 84, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(w / 2 - 26, cy - 42);
    ctx.lineTo(w / 2 - 26, cy + 42);
    ctx.lineTo(w / 2 + 44, cy);
    ctx.closePath();
    ctx.fill();
    centred('Press E to open the app', midY + 80, 70, '#ffffff');
    footer("The app isn't running. Start it from the viewer.");
  } else if (p.status === 'unconfigured') {
    centred('⚙️', midY - 90, 110, '#ffffff', 400);
    centred('No run command yet.', midY + 40, 66, '#ffffff');
    centred("Set one in the manager's console.", midY + 120, 44, '#b8b8cc', 600);
    footer('Press E to open the app');
  } else if (p.status === 'error') {
    const firstLine = (p.error ?? '').split(/\r?\n/).find((l) => l.trim())?.trim() || 'The app stopped unexpectedly.';
    ctx.fillStyle = '#e63946';
    ctx.fillRect(0, midY - 120, w, 130);
    ctx.font = `700 44px ${SANS}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(fitText(ctx, `⚠ ${firstLine}`, w - 100), 50, midY - 55);
    centred("The app couldn't start.", midY + 90, 52, '#ffffff');
    footer('Press E to see the log and try again', '#ffb4ba');
  } else if (p.status !== 'running') {
    const at = Math.max(0, APP_STEPS.findIndex((s) => s.status === p.status));
    centred(`Getting ${ref} ready…`, bodyTop + 80, 46, '#b8b8cc', 600);
    centred(`${APP_STEPS[at].label}…`, midY - 20, 72, '#ffffff');
    // a three-step progress bar
    const gap = 18;
    const segW = (w - 200 - gap * (APP_STEPS.length - 1)) / APP_STEPS.length;
    APP_STEPS.forEach((s, i) => {
      const x = 100 + i * (segW + gap);
      const y = midY + 90;
      roundRect(ctx, x, y, segW, 34, 17);
      ctx.fillStyle = i < at ? TERM.done : i === at ? '#f4a261' : '#3a3a52';
      ctx.fill();
      ctx.font = `600 28px ${SANS}`;
      ctx.fillStyle = i <= at ? TERM.text : '#6c6c88';
      ctx.textAlign = 'center';
      ctx.fillText(`${i < at ? '✓ ' : ''}${s.label}`, x + segW / 2, y + 70);
      ctx.textAlign = 'left';
    });
    footer(`Step ${at + 1} of ${APP_STEPS.length} · press E to watch`);
  } else {
    // running: where it's served and what's deployed, plus the latest thing an agent on this floor looked at
    const left = 56;
    const colW = info.shot ? w * 0.5 : w - 2 * left;
    ctx.font = `600 34px ${SANS}`;
    ctx.fillStyle = '#b8b8cc';
    ctx.fillText('Serving at', left, bodyTop + 72);
    ctx.font = `700 50px ${MONO}`;
    ctx.fillStyle = TERM.tool;
    ctx.fillText(fitText(ctx, (p.url ?? '').replace(/^https?:\/\//, '').replace(/\/$/, ''), colW), left, bodyTop + 140);

    ctx.font = `700 42px ${SANS}`;
    const refW = ctx.measureText(ref).width + 48;
    roundRect(ctx, left, bodyTop + 208, refW, 64, 32);
    ctx.fillStyle = info.color;
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(ref, left + 24, bodyTop + 241);
    if (p.commit) {
      ctx.font = `600 42px ${MONO}`;
      ctx.fillStyle = TERM.thinking;
      ctx.fillText(p.commit, left + refW + 24, bodyTop + 241);
    }
    if (p.startedAt) {
      ctx.font = `500 32px ${SANS}`;
      ctx.fillStyle = '#8d8da8';
      ctx.fillText(`up since ${new Date(p.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, left, bodyTop + 330);
    }

    if (info.shot) {
      const tw = w - colW - left - 70;
      const th = Math.round(tw * 0.5625);
      const tx = w - 40 - tw;
      const ty = bodyTop + 50;
      ctx.fillStyle = '#3a3a52';
      ctx.fillRect(tx - 6, ty - 6, tw + 12, th + 12);
      // cover-fit, anchored to the top left like a browser viewport
      const img = info.shot;
      const scale = Math.max(tw / img.width, th / img.height);
      ctx.drawImage(img, 0, 0, tw / scale, th / scale, tx, ty, tw, th);
      ctx.font = `500 26px ${SANS}`;
      ctx.fillStyle = '#8d8da8';
      ctx.fillText(fitText(ctx, info.shotBy ? `latest from ${info.shotBy}'s browser` : 'latest agent screenshot', tw), tx, ty + th + 36);
    }
    footer('Press E to open the app', TERM.done);
  }
}
