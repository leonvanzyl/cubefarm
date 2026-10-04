// The decorations' toon models (#210), each one merged geometry with vertex colours (parts.ts). Every model stands in
// its own frame: the floor at y 0, its front facing +z, its middle at the origin (wall pieces: on the wall's face,
// centred on their hanging height). Textured faces (posters, the neon, the arcade's screen) are drawn by Decorations.tsx.
import * as THREE from 'three';
import { shade } from '../materials';
import { ball, box, cone, cyl, model, torus, type Part } from './parts';

const POT = '#e07a5f';
const LEAF = ['#52b788', '#40916c', '#74c69d', '#2d6a4f'];

export const plantModel = () =>
  model('plant', () => [
    cyl(0.2, 0.16, 0.36, POT, [0, 0.18, 0]),
    cyl(0.205, 0.205, 0.05, shade(POT, -0.1), [0, 0.36, 0]),
    ball(0.26, LEAF[0], [0, 0.6, 0]),
    ball(0.2, LEAF[1], [0.14, 0.78, 0.06]),
    ball(0.18, LEAF[2], [-0.13, 0.84, -0.04]),
    ball(0.14, LEAF[0], [0.02, 0.98, 0]),
  ]);

export const figModel = () =>
  model('fig', () => {
    const parts: Part[] = [cyl(0.26, 0.2, 0.5, '#f4a261', [0, 0.25, 0]), cyl(0.265, 0.265, 0.05, '#e76f51', [0, 0.5, 0]), cyl(0.035, 0.05, 1.1, '#7f5539', [0, 1.0, 0])];
    // big glossy leaves: flattened balls tipped out from the trunk, in tiers
    const tiers = [
      [1.15, 5, 0.3],
      [1.45, 5, 0.27],
      [1.75, 4, 0.22],
      [1.98, 3, 0.15],
    ];
    tiers.forEach(([y, n, out], t) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + t * 0.7;
        parts.push({ ...ball(0.17, LEAF[(i + t) % LEAF.length], [Math.cos(a) * out, y, Math.sin(a) * out], [1.15, 0.45, 0.8]), rot: [0.35 * Math.sin(a), -a, 0.35 * Math.cos(a)] });
      }
    });
    return parts;
  });

export const beanbagModel = (color: string) =>
  model(`beanbag:${color}`, () => [
    ball(0.45, color, [0, 0.27, 0], [1, 0.6, 1], 16),
    ball(0.3, shade(color, 0.08), [0, 0.42, -0.12], [1, 0.55, 0.8], 14),
    ball(0.33, shade(color, -0.06), [0, 0.36, -0.25], [1.15, 0.8, 0.6], 14),
  ]);

/** A picture frame on the wall; the picture itself is a textured plane in front of it. */
export const frameModel = (w: number, h: number) =>
  model(`frame:${w}x${h}`, () => [box(w, h, 0.04, '#5c3d2e', [0, 0, 0.02]), box(w - 0.08, h - 0.08, 0.045, '#f8f9fa', [0, 0, 0.022])]);

export const neonBackModel = () => model('neon-back', () => [box(2.1, 0.62, 0.03, '#1f1d2b', [0, 0, 0.015]), cyl(0.01, 0.01, 0.62, '#adb5bd', [-0.9, 0.55, 0.01]), cyl(0.01, 0.01, 0.62, '#adb5bd', [0.9, 0.55, 0.01])]);

/** String lights' sagging wire: n bulbs hang along it (lightBulbs). */
function lightPoints(w: number, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return new THREE.Vector3((t - 0.5) * w, 0.18 - Math.sin(t * Math.PI) * 0.32 + (i % 2 ? -0.03 : 0), 0.06);
  });
}

export const LIGHT_BULBS = 13;
const BULB_COLORS = ['#ffd166', '#ff8fab', '#7CFFB2', '#8ecae6', '#ffb703'];

export const lightsWireModel = () =>
  model('lights-wire', () => {
    const pts = lightPoints(2.4, LIGHT_BULBS);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-1.22, 0.2, 0.02), ...pts, new THREE.Vector3(1.22, 0.2, 0.02)]);
    return [{ geo: new THREE.TubeGeometry(curve, 40, 0.008, 4), color: '#2b2d42' }, box(0.05, 0.05, 0.04, '#adb5bd', [-1.2, 0.2, 0.02]), box(0.05, 0.05, 0.04, '#adb5bd', [1.2, 0.2, 0.02])];
  });

export const lightsBulbModel = () => model('lights-bulbs', () => lightPoints(2.4, LIGHT_BULBS).map((p, i) => ball(0.035, BULB_COLORS[i % BULB_COLORS.length], [p.x, p.y - 0.04, p.z], [1, 1.3, 1], 8)));

export const TANK = { w: 1.4, d: 0.55, standH: 0.75, tankH: 0.62 };

export const tankBaseModel = () =>
  model('tank-base', () => {
    const { w, d, standH, tankH } = TANK;
    const top = standH + tankH;
    return [
      box(w, standH, d, '#6f4530', [0, standH / 2, 0]),
      box(w - 0.1, standH - 0.18, 0.02, '#8d5a3b', [0, standH / 2, d / 2 + 0.005]),
      box(w - 0.06, 0.07, d - 0.06, '#e9c46a', [0, standH + 0.04, 0]), // gravel
      box(w + 0.02, 0.05, d + 0.02, '#2b2d42', [0, top + 0.02, 0]), // lid
      box(w + 0.02, 0.03, d + 0.02, '#2b2d42', [0, standH + 0.01, 0]),
      cone(0.05, 0.3, '#2d6a4f', [-0.45, standH + 0.22, -0.1]),
      cone(0.04, 0.22, '#52b788', [-0.36, standH + 0.18, 0.05]),
      cone(0.05, 0.34, '#40916c', [0.5, standH + 0.24, -0.08]),
      ball(0.07, '#adb5bd', [0.25, standH + 0.1, 0.05], [1.3, 0.7, 1]),
      box(0.12, 0.1, 0.08, '#e63946', [0.05, standH + 0.12, -0.12]), // a little castle
    ];
  });

/** One toon fish, nose along +x. */
export const fishModel = () => model('fish', () => [ball(0.05, '#ffffff', [0, 0, 0], [1.4, 0.8, 0.55], 10), cone(0.04, 0.06, '#ffffff', [-0.085, 0, 0], [0, 0, Math.PI / 2], 6)]);

export const pingpongModel = () =>
  model('pingpong', () => {
    const parts: Part[] = [
      box(2.2, 0.05, 1.2, '#2a9d8f', [0, 0.74, 0]),
      box(2.2, 0.052, 0.02, '#ffffff', [0, 0.74, 0.59]),
      box(2.2, 0.052, 0.02, '#ffffff', [0, 0.74, -0.59]),
      box(0.02, 0.052, 1.2, '#ffffff', [1.09, 0.74, 0]),
      box(0.02, 0.052, 1.2, '#ffffff', [-1.09, 0.74, 0]),
      box(2.2, 0.053, 0.01, '#ffffff', [0, 0.74, 0]),
      box(0.015, 0.15, 1.3, '#f1f3f5', [0, 0.84, 0]), // the net
      box(0.03, 0.03, 1.3, '#2b2d42', [0, 0.92, 0]),
      cyl(0.09, 0.09, 0.015, '#e63946', [0.55, 0.775, 0.25]),
      box(0.03, 0.015, 0.12, '#8d5a3b', [0.55, 0.775, 0.38]),
      cyl(0.09, 0.09, 0.015, '#3a86ff', [-0.6, 0.775, -0.3]),
      box(0.03, 0.015, 0.12, '#8d5a3b', [-0.6, 0.775, -0.43]),
      ball(0.02, '#ffffff', [0.2, 0.785, -0.1], undefined, 8),
    ];
    for (const x of [-0.95, 0.95]) for (const z of [-0.5, 0.5]) parts.push(box(0.06, 0.72, 0.06, '#3d4152', [x, 0.36, z]));
    return parts;
  });

export const ARCADE = { w: 0.8, d: 0.75, h: 1.85, screen: { w: 0.56, h: 0.42, y: 1.32 } };

export const arcadeModel = (accent: string) =>
  model(`arcade:${accent}`, () => {
    const body = '#5a189a';
    const side = shade(body, -0.08);
    return [
      box(0.06, ARCADE.h, ARCADE.d, side, [-0.37, ARCADE.h / 2, 0]),
      box(0.06, ARCADE.h, ARCADE.d, side, [0.37, ARCADE.h / 2, 0]),
      box(0.68, 0.95, 0.6, body, [0, 0.475, -0.05]),
      box(0.68, 0.9, 0.12, '#1f1d2b', [0, 1.4, -0.3]), // behind the screen
      box(0.68, 0.06, 0.36, '#3c096c', [0, 1.0, 0.12], [0.35, 0, 0]), // control panel
      box(0.68, 0.22, 0.42, accent, [0, ARCADE.h - 0.11, -0.12]), // marquee box
      cyl(0.012, 0.012, 0.1, '#adb5bd', [-0.15, 1.08, 0.16]),
      ball(0.035, '#e63946', [-0.15, 1.14, 0.16], undefined, 8),
      cyl(0.03, 0.03, 0.02, '#ffd166', [0.05, 1.05, 0.15], [0.35, 0, 0]),
      cyl(0.03, 0.03, 0.02, '#06d6a0', [0.14, 1.06, 0.12], [0.35, 0, 0]),
      cyl(0.03, 0.03, 0.02, '#4cc9f0', [0.23, 1.07, 0.09], [0.35, 0, 0]),
      box(0.2, 0.08, 0.02, '#ffd166', [0, 0.55, 0.26]), // coin slot
    ];
  });

export const rugModel = (w: number, d: number, color: string) =>
  model(`rug:${w}x${d}:${color}`, () => [box(w, 0.008, d, shade(color, -0.12), [0, 0.004, 0]), box(w - 0.18, 0.012, d - 0.18, color, [0, 0.006, 0]), box(w - 0.5, 0.014, d - 0.5, shade(color, 0.12), [0, 0.007, 0])]);

/** The floor's decor box: a big cardboard box with its flaps open. */
export const decorBoxModel = () =>
  model('decor-box', () => [
    box(0.8, 0.55, 0.55, '#c9a46a', [0, 0.275, 0]),
    box(0.8, 0.02, 0.06, '#e9d8a6', [0, 0.555, 0]), // tape
    box(0.8, 0.02, 0.26, '#b08950', [0, 0.62, 0.36], [-0.6, 0, 0]),
    box(0.8, 0.02, 0.26, '#b08950', [0, 0.62, -0.36], [0.6, 0, 0]),
    box(0.46, 0.2, 0.3, '#ffd6a5', [-0.1, 0.62, 0]), // something poking out
    ball(0.12, '#52b788', [0.2, 0.66, 0.02]),
  ]);

/** A kiosk for the lobby: a pedestal and a tilted screen, the coin on top. */
export const kioskModel = () =>
  model('kiosk', () => [
    box(0.9, 0.08, 0.7, '#2b2d42', [0, 0.04, 0]),
    box(0.5, 1.0, 0.4, '#ff8a5b', [0, 0.56, 0]),
    box(0.86, 0.62, 0.1, '#2b2d42', [0, 1.3, 0.05], [-0.2, 0, 0]),
    cyl(0.16, 0.16, 0.05, '#ffd43b', [0, 1.72, 0.02], [Math.PI / 2, 0, 0], 20),
    torus(0.16, 0.012, '#f4a261', [0, 1.72, 0.05]),
  ]);
