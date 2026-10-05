import { describe, expect, it } from 'vitest';
import { contrastRatio, hexToRgb, rgbToHex } from './colorMath';

// The HUD floats over the 3D view, whose colours change with the room and the time of day, so its text never sits on
// the view itself: each piece has its own backing. These are the pairs styles.css uses (kept in step by hand), checked
// against WCAG AA: 4.5:1 for text, 3:1 for large text.
const INK = '#1f1d2b';
const PAPER = '#fffdf6';
const MUTED = '#62667b';
const MUTED_HIGH_CONTRAST = '#3d3f52';

/** A translucent colour over a background, as the eye sees it. */
function over(rgb: string, alpha: number, bg: string) {
  const [a, b] = [hexToRgb(rgb), hexToRgb(bg)];
  return rgbToHex([0, 1, 2].map((i) => a[i] * alpha + b[i] * (1 - alpha)) as [number, number, number]);
}

describe('HUD text against what is behind it', () => {
  it('reads on the paper cards (floor card, workers list, hints, phone button)', () => {
    expect(contrastRatio(INK, PAPER)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(MUTED, PAPER)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(MUTED, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(MUTED_HIGH_CONTRAST, '#ffffff')).toBeGreaterThanOrEqual(7);
  });

  it('reads on the key hints, even where the 3D view behind them is at its darkest or brightest', () => {
    // .hud-help: paper at 85% over the view
    for (const view of ['#000000', '#ffffff', '#bfe3ff', '#5c677d']) expect(contrastRatio(INK, over(PAPER, 0.85, view))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps captions readable at the default background, over any view', () => {
    // .caption: white on rgba(10, 10, 16, 0.75)
    for (const view of ['#000000', '#ffffff', '#ffe066', '#bfe3ff']) expect(contrastRatio('#ffffff', over('#0a0a10', 0.75, view))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ffe066', over('#0a0a10', 0.75, '#ffffff'))).toBeGreaterThanOrEqual(4.5); // alarms
  });

  it('keeps the active tab and the floor number readable on the accent colour', () => {
    expect(contrastRatio(INK, '#ff8a5b')).toBeGreaterThanOrEqual(4.5); // .tab-on, .picker-tab-on, .pk-chip-on
    expect(contrastRatio('#ffffff', '#ff8a5b')).toBeLessThan(3); // why they no longer use white
  });
});
