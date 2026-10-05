import { describe, expect, it } from 'vitest';
import { contrastRatio, deltaE, inkOn, simulateCvd } from './colorMath';
import { CVD_PALETTES, KIND_ICON, kindStrong, paletteVars, PALETTE_VAR_NAMES, PALETTES, STATUS_KIND, STATUS_KINDS, statusFill, toneFill, TONE_KIND } from './statusLook';

const INK = '#1f1d2b';
const PAPER = '#fffdf6';

/** The smallest colour difference between any two kinds, as someone with `cvd` sees them (null: typical vision). */
function closest(colors: string[], cvd: 'protanopia' | 'deuteranopia' | 'tritanopia' | null) {
  let min = Infinity;
  for (let i = 0; i < colors.length; i++)
    for (let j = i + 1; j < colors.length; j++) {
      const [a, b] = cvd ? [simulateCvd(colors[i], cvd), simulateCvd(colors[j], cvd)] : [colors[i], colors[j]];
      min = Math.min(min, deltaE(a, b));
    }
  return min;
}

describe('the colour-blind palettes', () => {
  for (const [palette, kinds] of Object.entries(CVD_PALETTES) as [keyof typeof CVD_PALETTES, (typeof CVD_PALETTES)[keyof typeof CVD_PALETTES]][]) {
    it(`keeps every kind apart for ${palette}, and for typical vision`, () => {
      const fills = STATUS_KINDS.map((k) => kinds[k].fill);
      const strongs = STATUS_KINDS.map((k) => kinds[k].strong);
      // ΔE 15 is plainly different at a glance; the shapes carry the meaning on top of that.
      expect(closest(fills, palette)).toBeGreaterThan(15);
      expect(closest(strongs, palette)).toBeGreaterThan(15);
      expect(closest(fills, null)).toBeGreaterThan(15);
      expect(closest(strongs, null)).toBeGreaterThan(15);
    });

    it(`keeps dark text readable on every ${palette} fill, and badges' icons readable on their colour`, () => {
      for (const k of STATUS_KINDS) {
        expect(contrastRatio(INK, kinds[k].fill)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(inkOn(kinds[k].strong), kinds[k].strong)).toBeGreaterThanOrEqual(3);
      }
    });

    it(`keeps --good and --bad readable as text on paper for ${palette}`, () => {
      expect(contrastRatio(kinds.ok.strong, PAPER)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(kinds.bad.strong, PAPER)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("shows the Kanban's three tones apart on cards and stickies for every palette", () => {
    for (const p of PALETTES) {
      for (const surface of ['card', 'board'] as const) {
        const tones = (['good', 'warn', 'bad'] as const).map((t) => toneFill(t, p, surface));
        expect(new Set(tones).size).toBe(3);
        if (p !== 'standard') expect(closest(tones, p)).toBeGreaterThan(15);
      }
    }
  });
});

describe('the standard palette', () => {
  it('is the office’s own colours, so the default changes nothing', () => {
    expect(statusFill('working', 'standard')).toBe('#74c0fc');
    expect(statusFill('error', 'standard')).toBe('#ffa8a8');
    expect(statusFill('idle', 'standard')).toBe('#e9ecef');
    expect(toneFill('warn', 'standard', 'card')).toBe('#fff3d6');
    expect(toneFill('bad', 'standard', 'board')).toBe('#ffc9c9');
    expect(kindStrong('ok', 'standard')).toBe('#2dc653');
    expect(paletteVars('standard')).toEqual({});
  });
});

describe('statuses, kinds and shapes', () => {
  it('gives every kind its own shape', () => {
    expect(new Set(Object.values(KIND_ICON)).size).toBe(STATUS_KINDS.length);
    expect([KIND_ICON.ok, KIND_ICON.bad, KIND_ICON.attention, KIND_ICON.waiting]).toEqual(['✓', '✕', '!', '⏳']);
  });

  it('sorts agent, preview and QA statuses into kinds', () => {
    expect(STATUS_KIND.error).toBe('bad');
    expect(STATUS_KIND.failed).toBe('bad');
    expect(STATUS_KIND['needs-human']).toBe('attention');
    expect(STATUS_KIND.preparing).toBe('waiting');
    expect(STATUS_KIND.queued).toBe('waiting');
    expect(STATUS_KIND.working).toBe('busy');
    expect(STATUS_KIND.passed).toBe('ok');
    expect(TONE_KIND).toEqual({ good: 'ok', warn: 'attention', bad: 'bad' });
  });

  it('sets every status, tone and the shared colours as CSS variables for a colour-blind palette', () => {
    const vars = paletteVars('tritanopia');
    expect(vars['--st-working']).toBe(CVD_PALETTES.tritanopia.busy.fill);
    expect(vars['--tone-bad']).toBe(CVD_PALETTES.tritanopia.bad.fill);
    expect(vars['--good']).toBe(CVD_PALETTES.tritanopia.ok.strong);
    expect(Object.keys(vars).sort()).toEqual([...PALETTE_VAR_NAMES].sort());
  });
});

describe('colour maths', () => {
  it('measures WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('simulates colour blindness: red and green collapse for deuteranopia, not for typical vision', () => {
    expect(deltaE('#d62728', '#2ca02c')).toBeGreaterThan(50);
    expect(deltaE(simulateCvd('#ff0000', 'deuteranopia'), simulateCvd('#00a000', 'deuteranopia'))).toBeLessThan(deltaE('#ff0000', '#00a000') / 2);
    expect(simulateCvd('#ffffff', 'tritanopia')).toBe('#ffffff');
  });
});
