import * as THREE from 'three';

// The roof's painted surfaces, drawn once on canvases: the paving, the decking's boards, the helipad, the deck chairs'
// striped canvas and the windsock. Made on first use and kept (the roof comes and goes; its textures are small).

const made = new Map<string, THREE.CanvasTexture>();

function canvasTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat = true) {
  let t = made.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  made.set(key, t);
  return t;
}

/** A seeded wobble, so the boards and pavers vary the same way every time. */
function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

/** One 1.2 m paving slab, grout on two edges: tiles seamlessly. */
export const pavingTexture = () =>
  canvasTexture('paving', 256, 256, (ctx) => {
    ctx.fillStyle = '#d6d0c4';
    ctx.fillRect(0, 0, 256, 256);
    const r = rand(3);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(90,80,70,0.08)';
      ctx.fillRect(r() * 256, r() * 256, 2 + r() * 3, 2 + r() * 3);
    }
    ctx.fillStyle = '#b3ab9d';
    ctx.fillRect(0, 0, 256, 4);
    ctx.fillRect(0, 0, 4, 256);
  });

/** 1.2 m of decking: boards along x, 15 cm wide, with gaps, grain and staggered ends. */
export const deckingTexture = () =>
  canvasTexture('decking', 512, 512, (ctx) => {
    const r = rand(7);
    const board = 512 / 8;
    for (let i = 0; i < 8; i++) {
      const y = i * board;
      const shade = 150 + Math.floor(r() * 30);
      ctx.fillStyle = `rgb(${shade + 40},${shade - 20},${shade - 75})`;
      ctx.fillRect(0, y, 512, board);
      ctx.strokeStyle = 'rgba(80,40,10,0.18)';
      ctx.lineWidth = 2;
      for (let g = 0; g < 4; g++) {
        const gy = y + 8 + r() * (board - 16);
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(170, gy + (r() - 0.5) * 8, 340, gy + (r() - 0.5) * 8, 512, gy);
        ctx.stroke();
      }
      ctx.fillStyle = '#5b3a24';
      ctx.fillRect(0, y, 512, 4); // the gap between boards
      const seam = (i % 2 ? 0.3 : 0.75) * 512;
      ctx.fillRect(seam, y, 4, board);
    }
  });

/** The helipad: a dark disc with a yellow ring, a big white H and touchdown marks; clear outside the disc. */
export const helipadTexture = () =>
  canvasTexture(
    'helipad',
    1024,
    1024,
    (ctx) => {
      const c = 512;
      ctx.fillStyle = '#4a4f5a';
      ctx.beginPath();
      ctx.arc(c, c, 508, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 34;
      ctx.beginPath();
      ctx.arc(c, c, 440, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#f8f9fa';
      ctx.lineWidth = 10;
      ctx.setLineDash([60, 40]);
      ctx.beginPath();
      ctx.arc(c, c, 495, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#f8f9fa';
      const bar = 70;
      ctx.fillRect(c - 190, c - 230, bar, 460);
      ctx.fillRect(c + 190 - bar, c - 230, bar, 460);
      ctx.fillRect(c - 190, c - bar / 2, 380, bar);
    },
    false,
  );

/** A deck chair's canvas: wide white stripes (the chair's colour comes from its vertex colours). */
export const stripeTexture = () =>
  canvasTexture('stripes', 128, 8, (ctx) => {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#ffffff' : '#c9c9c9';
      ctx.fillRect(i * 32, 0, 32, 8);
    }
  });

/** The windsock: orange and white bands round it. */
export const windsockTexture = () =>
  canvasTexture('windsock', 8, 128, (ctx) => {
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i % 2 ? '#ffffff' : '#ff7b39';
      ctx.fillRect(0, (i * 128) / 5, 8, 128 / 5 + 1);
    }
  });
