// A career card's portrait (#226): the agent's character drawn flat on a canvas from the same appearance the 3D
// person is built from (world/appearance.ts): hair style and colour, skin, shirt, glasses, headphones, hats, beards.
import { appearanceFor, ACCENTS } from '../world/appearance';
import type { Agent } from '../store';

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Draws `agent` in a square canvas of side `s`. */
export function drawPortrait(ctx: CanvasRenderingContext2D, s: number, agent: Pick<Agent, 'id' | 'look' | 'role' | 'color' | 'hair' | 'skin'>) {
  const look = appearanceFor(agent);
  const accent = ACCENTS[look.accent];
  const k = s / 160;
  ctx.save();
  ctx.scale(k, k);
  ctx.clearRect(0, 0, 160, 160);
  // backdrop
  const g = ctx.createLinearGradient(0, 0, 0, 160);
  g.addColorStop(0, '#fff4e0');
  g.addColorStop(1, '#ffd6a5');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(0, 0, 160, 160, 26);
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1f1d2b';
  ctx.lineWidth = 3;

  // body: shoulders in their shirt
  const shoulders = 52 * look.shoulders;
  ctx.beginPath();
  ctx.moveTo(80 - shoulders, 162);
  ctx.quadraticCurveTo(80 - shoulders, 116, 80, 112);
  ctx.quadraticCurveTo(80 + shoulders, 116, 80 + shoulders, 162);
  ctx.closePath();
  ctx.fillStyle = agent.color;
  ctx.fill();
  ctx.stroke();
  if (look.outfit === 'stripe') {
    ctx.fillStyle = accent;
    for (const y of [132, 146]) ctx.fillRect(80 - shoulders + 6, y, shoulders * 2 - 12, 6);
  } else if (look.outfit === 'hoodie') {
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(72, 120);
    ctx.lineTo(70, 142);
    ctx.moveTo(88, 120);
    ctx.lineTo(90, 142);
    ctx.stroke();
    ctx.strokeStyle = '#1f1d2b';
  } else if (look.outfit === 'sweater') {
    ellipse(ctx, 80, 118, 18, 7, accent);
  }
  // neck and head
  ctx.fillStyle = agent.skin;
  ctx.fillRect(72, 98, 16, 18);
  const hy = 72;
  // hair behind the head
  ctx.fillStyle = agent.hair;
  if (look.hair === 'long') {
    ctx.beginPath();
    ctx.roundRect(46, 50, 68, 70, 24);
    ctx.fill();
  }
  if (look.hair === 'afro') ellipse(ctx, 80, hy - 8, 44, 40, agent.hair);
  if (look.hair === 'curls') for (let i = 0; i < 9; i++) ellipse(ctx, 80 + Math.cos((i / 8) * Math.PI) * 33, hy - 14 - Math.sin((i / 8) * Math.PI) * 20, 11, 11, agent.hair);
  ellipse(ctx, 80, hy, 30, 34, agent.skin);
  ctx.beginPath();
  ctx.ellipse(80, hy, 30, 34, 0, 0, Math.PI * 2);
  ctx.stroke();
  ellipse(ctx, 50, hy + 4, 5, 8, agent.skin);
  ellipse(ctx, 110, hy + 4, 5, 8, agent.skin);
  // hair on top
  ctx.fillStyle = agent.hair;
  const cap = (top: number) => {
    ctx.beginPath();
    ctx.ellipse(80, hy - 10, 31, top, 0, Math.PI, Math.PI * 2);
    ctx.fill();
  };
  switch (look.hair) {
    case 'crop':
    case 'curls':
    case 'long':
      cap(26);
      break;
    case 'buzz':
      cap(20);
      break;
    case 'sidePart':
      cap(25);
      ellipse(ctx, 66, hy - 18, 16, 9, agent.hair);
      break;
    case 'quiff':
      cap(24);
      ellipse(ctx, 86, hy - 34, 20, 12, agent.hair);
      break;
    case 'ponytail':
      cap(25);
      ellipse(ctx, 113, hy - 4, 9, 20, agent.hair);
      break;
    case 'bun':
      cap(25);
      ellipse(ctx, 80, hy - 40, 14, 12, agent.hair);
      break;
    case 'afro':
      cap(24);
      break;
    case 'bald':
      break;
  }
  // face
  ellipse(ctx, 69, hy + 2, 3.5, 4.5, '#1f1d2b');
  ellipse(ctx, 91, hy + 2, 3.5, 4.5, '#1f1d2b');
  ellipse(ctx, 63, hy + 13, 6, 3.5, 'rgba(255,120,120,0.35)');
  ellipse(ctx, 97, hy + 13, 6, 3.5, 'rgba(255,120,120,0.35)');
  if (look.facialHair === 'beard') {
    ctx.beginPath();
    ctx.ellipse(80, hy + 18, 26, 18, 0, 0, Math.PI);
    ctx.fillStyle = agent.hair;
    ctx.fill();
  } else if (look.facialHair === 'moustache') ellipse(ctx, 80, hy + 15, 11, 3.5, agent.hair);
  else if (look.facialHair === 'stubble') ellipse(ctx, 80, hy + 22, 20, 9, 'rgba(60,40,30,0.18)');
  ctx.beginPath();
  ctx.arc(80, hy + 13, 9, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  if (look.glasses !== 'none') {
    ctx.strokeStyle = accent === '#ffffff' ? '#2b2d42' : accent;
    ctx.lineWidth = 3;
    for (const x of [69, 91]) {
      ctx.beginPath();
      if (look.glasses === 'square') ctx.rect(x - 9, hy - 6, 18, 14);
      else ctx.arc(x, hy + 1, 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(78, hy);
    ctx.lineTo(82, hy);
    ctx.stroke();
    ctx.strokeStyle = '#1f1d2b';
  }
  if (look.headphones) {
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#2b2d42';
    ctx.beginPath();
    ctx.arc(80, hy - 2, 36, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
    ellipse(ctx, 46, hy + 2, 8, 12, accent === '#ffffff' ? '#ef476f' : accent);
    ellipse(ctx, 114, hy + 2, 8, 12, accent === '#ffffff' ? '#ef476f' : accent);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#1f1d2b';
  }
  if (look.headwear === 'beanie') {
    ctx.beginPath();
    ctx.ellipse(80, hy - 12, 32, 28, 0, Math.PI, Math.PI * 2);
    ctx.fillStyle = accent === '#ffffff' ? '#118ab2' : accent;
    ctx.fill();
    ctx.stroke();
    ellipse(ctx, 80, hy - 42, 7, 7, '#ffffff');
  } else if (look.headwear === 'cap') {
    ctx.beginPath();
    ctx.ellipse(80, hy - 14, 31, 22, 0, Math.PI, Math.PI * 2);
    ctx.fillStyle = accent === '#ffffff' ? '#ef476f' : accent;
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(80, hy - 18, 40, 7);
  }
  ctx.restore();
}
