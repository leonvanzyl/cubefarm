// Colour arithmetic for the accessibility settings: WCAG contrast, CIE Lab distance, and how a colour looks with each
// kind of colour blindness (Machado, Oliveira & Fernandes 2009, full severity). Pure, so palettes are tested, not guessed.

export type Rgb = [number, number, number];

/** '#rrggbb' (or '#rgb') as 0-255 channels. */
export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbToHex = ([r, g, b]: Rgb) => `#${[r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')}`;

const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (l: number) => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1 to 21. Body text needs 4.5, large text and icons 3. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Dark ink or white, whichever reads better on `bg`. */
export const inkOn = (bg: string, dark = '#1f1d2b', light = '#ffffff') => (contrastRatio(dark, bg) >= contrastRatio(light, bg) ? dark : light);

export type Cvd = 'protanopia' | 'deuteranopia' | 'tritanopia';

// Linear-RGB simulation matrices, severity 1.0.
const CVD: Record<Cvd, number[]> = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

/** How `hex` looks to someone with `cvd`. */
export function simulateCvd(hex: string, cvd: Cvd): string {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const m = CVD[cvd];
  const out = [0, 1, 2].map((i) => Math.max(0, Math.min(1, m[i * 3] * r + m[i * 3 + 1] * g + m[i * 3 + 2] * b)));
  return rgbToHex(out.map(fromLinear) as Rgb);
}

/** CIE L*a*b* (D65). */
export function toLab(hex: string): Rgb {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIE76 colour difference: about 2.3 is just noticeable, 10+ is clearly different at a glance. */
export function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}
