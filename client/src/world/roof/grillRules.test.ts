import { describe, expect, it } from 'vitest';
import { doneness, emptyGrill, GRILL_TIMES, grillLabel, grillState, pressGrill, sizzle } from './grillRules.ts';

const { cook, char } = GRILL_TIMES;

describe('the grill', () => {
  it('is empty and silent until a sausage goes on', () => {
    const g = emptyGrill();
    expect(grillState(g, 100)).toBe('idle');
    expect(doneness(g, 100)).toBe(0);
    expect(sizzle(g, 100)).toBe(0);
    expect(grillLabel('idle')).toBe('Grill a sausage');
  });

  it('cooks, is ready, then chars if left on', () => {
    const { op, grill } = pressGrill(emptyGrill(), 10, false);
    expect(op).toBe('start');
    expect(grillState(grill, 10)).toBe('cooking');
    expect(doneness(grill, 10 + cook / 2)).toBeCloseTo(0.5);
    expect(sizzle(grill, 11)).toBe(1);
    expect(grillState(grill, 10 + cook)).toBe('ready');
    expect(doneness(grill, 10 + cook)).toBeCloseTo(1);
    expect(sizzle(grill, 10 + cook + 1)).toBeLessThan(1);
    expect(sizzle(grill, 10 + cook + 1)).toBeGreaterThan(0);
    expect(grillState(grill, 10 + cook + char)).toBe('charred');
    expect(doneness(grill, 10 + cook + char * 5)).toBe(2);
  });

  it('turns a cooking sausage over instead of taking it', () => {
    const on = pressGrill(emptyGrill(), 0, false).grill;
    const turned = pressGrill(on, 2, false);
    expect(turned.op).toBe('turn');
    expect(turned.grill.turns).toBe(1);
    expect(turned.grill.since).toBe(0); // turning doesn't restart the cooking
    expect(grillLabel(grillState(on, 2))).toBe('Turn the sausage');
  });

  it('hands over a cooked or charred sausage and is empty again', () => {
    const on = pressGrill(emptyGrill(), 0, false).grill;
    expect(grillLabel(grillState(on, cook + 1))).toBe('Take the sausage');
    const taken = pressGrill(on, cook + 1, false);
    expect(taken.op).toBe('take');
    expect(grillState(taken.grill, cook + 2)).toBe('idle');
    expect(pressGrill(on, cook + char + 1, false).op).toBe('take');
    expect(grillLabel('charred')).toMatch(/charred/);
  });

  it('wants empty hands to start or take one, but turns it whatever you hold', () => {
    expect(pressGrill(emptyGrill(), 0, true).op).toBe('full');
    const on = pressGrill(emptyGrill(), 0, false).grill;
    expect(pressGrill(on, 1, true).op).toBe('turn');
    const full = pressGrill(on, cook + 1, true);
    expect(full.op).toBe('full');
    expect(full.grill).toBe(on);
  });
});
