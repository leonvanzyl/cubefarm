// Run with `npm test` (Vitest).
import { describe, expect, it } from 'vitest';
import type { AgentLook, AgentRole } from '../../../shared/types';
import { ACCENTS, appearanceFor, type Appearance } from './appearance';
import { PARTS } from './characterParts';

const ids = Array.from({ length: 400 }, (_, i) => `${i.toString(16).padStart(4, '0')}-${(i * 2654435761) % 1e9}`);
const all = (look: AgentLook, role: AgentRole = 'dev') => ids.map((id) => appearanceFor({ id, look, role }));

describe('appearanceFor', () => {
  it('is deterministic for an agent id', () => {
    const agent = { id: 'b3c1f0de-7d2a-4d6e-9f5b-0a1b2c3d4e5f', look: 'masculine' as const, role: 'dev' as const };
    expect(appearanceFor(agent)).toEqual(appearanceFor({ ...agent }));
  });

  it('keeps build within ±6% height and ±8% shoulders', () => {
    for (const a of [...all('masculine'), ...all('feminine')]) {
      expect(a.height).toBeGreaterThanOrEqual(0.94);
      expect(a.height).toBeLessThanOrEqual(1.06);
      expect(a.shoulders).toBeGreaterThanOrEqual(0.92);
      expect(a.shoulders).toBeLessThanOrEqual(1.08);
      expect(a.accent).toBeGreaterThanOrEqual(0);
      expect(a.accent).toBeLessThan(ACCENTS.length);
    }
  });

  it('uses every hairstyle, facial hair, accessory and outfit', () => {
    const m = all('masculine');
    const f = all('feminine');
    const seen = (key: keyof Appearance, list: Appearance[]) => new Set(list.map((a) => String(a[key])));
    expect(seen('hair', m).size).toBe(10);
    expect([...seen('hair', f)].sort()).toEqual(['afro', 'bun', 'buzz', 'curls', 'long', 'ponytail', 'sidePart']);
    expect(seen('facialHair', m)).toEqual(new Set(['none', 'stubble', 'beard', 'moustache']));
    expect(seen('glasses', m)).toEqual(new Set(['none', 'round', 'square']));
    expect(seen('headwear', m)).toEqual(new Set(['none', 'beanie', 'cap']));
    expect(seen('outfit', f)).toEqual(new Set(['tee', 'hoodie', 'stripe', 'sweater']));
    expect(seen('headphones', f)).toEqual(new Set(['true', 'false']));
  });

  it('makes neighbours look different', () => {
    const key = (a: Appearance) => [a.hair, a.facialHair, a.glasses, a.headphones, a.headwear, a.outfit].join();
    const looks = all('masculine').map(key);
    expect(new Set(looks).size).toBeGreaterThan(looks.length / 2);
    const same = looks.filter((k, i) => i > 0 && k === looks[i - 1]).length;
    expect(same).toBeLessThan(looks.length * 0.05);
  });

  it('never stacks things on the head that would clip', () => {
    for (const a of [...all('masculine'), ...all('feminine')]) {
      if (a.headphones) expect(a.headwear).toBe('none');
      if (a.headphones) expect(a.hair).not.toBe('afro');
      if (a.headwear !== 'none') expect(['quiff', 'afro', 'bun', 'curls']).not.toContain(a.hair);
    }
  });

  it('gives feminine looks no facial hair', () => {
    for (const a of all('feminine')) expect(a.facialHair).toBe('none');
  });

  it('keeps QA and the CEO in uniform', () => {
    for (const look of ['masculine', 'feminine'] as const) {
      for (const a of all(look, 'qa')) {
        expect(a).toMatchObject({ glasses: 'none', headphones: false, headwear: 'none', outfit: 'tee' });
      }
      for (const a of all(look, 'ceo')) expect(a).toMatchObject({ headphones: false, headwear: 'none', outfit: 'tee' });
    }
  });
});

describe('character parts', () => {
  it('builds every shared geometry with finite positions', () => {
    const geos = [
      ...Object.values(PARTS).filter((v) => v && 'attributes' in v),
      ...Object.values(PARTS.hair),
      ...Object.values(PARTS.facialHair),
      ...Object.values(PARTS.glasses),
      ...Object.values(PARTS.headwear),
      ...Object.values(PARTS.outfit).flatMap((o) => [o.main, o.trim]),
      PARTS.headphones.shell,
      PARTS.headphones.covers,
    ].filter((g) => g !== null);
    expect(geos.length).toBeGreaterThan(30);
    for (const g of geos) {
      const pos = g.attributes.position;
      expect(pos.count).toBeGreaterThan(0);
      expect(g.attributes.normal.count).toBe(pos.count);
      for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i])).toBe(true);
    }
  });

  it('leaves the mouth uncovered by beards and stubble', () => {
    // mouth centre (happy or sad) sits at about (0, -0.09, -0.19) in head space
    for (const g of [PARTS.facialHair.beard, PARTS.facialHair.stubble]) {
      const p = g!.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const near = Math.abs(p.getX(i)) < 0.03 && Math.abs(p.getY(i) + 0.09) < 0.02 && p.getZ(i) < -0.15;
        expect(near).toBe(false);
      }
    }
  });
});
