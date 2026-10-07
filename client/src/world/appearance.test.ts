// Run with `npm test` (Vitest).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { AgentLook, AgentRole } from '../../../shared/types';
import { HAIR_STYLES, OUTFITS, cleanStyle } from '../../../shared/looks';
import { ACCENTS, BUILD_SHAPE, TALL_HAIR, appearanceFor, randomStyle, seededAppearance, type Appearance } from './appearance';
import { PARTS } from './characterParts';
import { EYES, MORPHS, MORPH_AT, MOUTH } from './face';

const ids = Array.from({ length: 400 }, (_, i) => `${i.toString(16).padStart(4, '0')}-${(i * 2654435761) % 1e9}`);
const all = (look: AgentLook, role: AgentRole = 'agent') => ids.map((id) => appearanceFor({ id, look, role }));

describe('appearanceFor', () => {
  it('is deterministic for an agent id', () => {
    const agent = { id: 'b3c1f0de-7d2a-4d6e-9f5b-0a1b2c3d4e5f', look: 'masculine' as const, role: 'agent' as const };
    expect(appearanceFor(agent)).toEqual(appearanceFor({ ...agent }));
  });

  it('keeps the body within ±10% height and ±5% shoulders, over three builds', () => {
    const builds = new Set<string>();
    for (const a of [...all('masculine'), ...all('feminine')]) {
      expect(a.height).toBeGreaterThanOrEqual(0.9);
      expect(a.height).toBeLessThanOrEqual(1.1);
      expect(a.shoulders).toBeGreaterThanOrEqual(0.95);
      expect(a.shoulders).toBeLessThanOrEqual(1.05);
      expect(a.accent).toBeGreaterThanOrEqual(0);
      expect(a.accent).toBeLessThan(ACCENTS.length);
      builds.add(a.build);
    }
    expect([...builds].sort()).toEqual(['average', 'broad', 'slim']);
    expect(BUILD_SHAPE.slim.width).toBeLessThan(BUILD_SHAPE.average.width);
    expect(BUILD_SHAPE.broad.width).toBeGreaterThan(BUILD_SHAPE.average.width);
  });

  it('uses every hairstyle, facial hair, glasses, hat and outfit', () => {
    const m = all('masculine');
    const f = all('feminine');
    const seen = (key: keyof Appearance, list: Appearance[]) => new Set(list.map((a) => String(a[key])));
    expect(seen('hair', m).size).toBe(HAIR_STYLES.length);
    expect([...seen('hair', f)].sort()).toEqual(['afro', 'bob', 'bun', 'buzz', 'curls', 'locs', 'long', 'mohawk', 'ponytail', 'sidePart']);
    expect(seen('facialHair', m)).toEqual(new Set(['none', 'stubble', 'beard', 'moustache']));
    expect(seen('glasses', m)).toEqual(new Set(['none', 'round', 'square']));
    expect(seen('headwear', m)).toEqual(new Set(['none', 'beanie', 'cap']));
    expect(seen('outfit', f)).toEqual(new Set(OUTFITS));
    expect(seen('headphones', f)).toEqual(new Set(['true', 'false']));
  });

  it('keeps most people the style they had before the new ones', () => {
    const newcomers = all('masculine').filter((a) => ['bob', 'mohawk', 'locs'].includes(a.hair)).length;
    expect(newcomers).toBeLessThan(ids.length * 0.3);
    expect(newcomers).toBeGreaterThan(ids.length * 0.1);
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
      if (a.headphones) expect(['afro', 'mohawk']).not.toContain(a.hair);
      if (a.headwear !== 'none') expect(TALL_HAIR).not.toContain(a.hair);
    }
  });

  it('gives feminine looks no facial hair', () => {
    for (const a of all('feminine')) expect(a.facialHair).toBe('none');
  });

  it('keeps the CEO in their suit, bare-headed; glasses are for anyone', () => {
    for (const look of ['masculine', 'feminine'] as const) {
      const ceo = all(look, 'ceo');
      for (const a of ceo) expect(a).toMatchObject({ headphones: false, headwear: 'none', outfit: 'tee' });
      expect(new Set(ceo.map((a) => a.glasses))).toEqual(new Set(['none', 'round', 'square']));
    }
  });

  it('takes their colours from the agent', () => {
    const a = appearanceFor({ id: 'x', look: 'feminine', role: 'agent', hair: '#123456', skin: '#654321' });
    expect(a).toMatchObject({ hairColor: '#123456', skin: '#654321' });
  });
});

describe('the look editor over the seeded look', () => {
  const agent = { id: 'c0ffee', look: 'masculine' as const, role: 'agent' as const, hair: '#2b2118', skin: '#ffdbac' };

  it('lays the picks over the seeded look', () => {
    const seeded = seededAppearance(agent);
    const a = appearanceFor({ ...agent, style: { hair: 'bob', hairColor: '#e8e2d0', skin: '#5c3a21', outfit: 'cardigan', build: 'broad', accent: 2, glasses: 'square' } });
    expect(a).toMatchObject({ hair: 'bob', hairColor: '#e8e2d0', skin: '#5c3a21', outfit: 'cardigan', build: 'broad', accent: 2, glasses: 'square' });
    expect(a.height).toBe(seeded.height);
    expect(a.facialHair).toBe(seeded.facialHair);
    expect(appearanceFor({ ...agent, style: null })).toEqual(seeded);
  });

  it('still never clips: no hat on tall hair, no headphones under a hat', () => {
    expect(appearanceFor({ ...agent, style: { hair: 'afro', headwear: 'cap' } }).headwear).toBe('none');
    for (const id of ids) {
      const a = appearanceFor({ ...agent, id, style: { headwear: 'beanie', hair: 'crop' } });
      expect(a.headwear).toBe('beanie');
      expect(a.headphones).toBe(false);
    }
  });

  it('keeps the CEO in their blazer', () => {
    expect(appearanceFor({ ...agent, style: { glasses: 'square', outfit: 'hoodie' } })).toMatchObject({ glasses: 'square', outfit: 'hoodie' });
    expect(appearanceFor({ ...agent, role: 'ceo', style: { outfit: 'hoodie', glasses: 'round' } })).toMatchObject({ glasses: 'round', outfit: 'tee' });
  });

  it('falls back to the seeded look for anything the server dropped as corrupt', () => {
    const style = cleanStyle({ hair: 'mullet', build: 7, outfit: 'stripe' });
    const a = appearanceFor({ ...agent, style });
    expect(a).toEqual({ ...seededAppearance(agent), outfit: 'stripe' });
  });

  it('shuffles to valid, wearable looks', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 200; i++) {
      for (const role of ['agent', 'ceo'] as const) {
        const s = randomStyle({ look: i % 2 ? 'feminine' : 'masculine', role }, rand);
        expect(cleanStyle(s)).toEqual(s);
        if (s.headwear !== 'none') expect(TALL_HAIR).not.toContain(s.hair);
        if (i % 2) expect(s.facialHair).toBe('none');
        if (role === 'ceo') expect(s.outfit).toBeUndefined();
      }
    }
  });
});


describe('character parts', () => {
  it('builds every shared geometry with finite positions', () => {
    const isGeo = (v: unknown): v is THREE.BufferGeometry => v instanceof THREE.BufferGeometry;
    const geos = [
      ...Object.values(PARTS).filter(isGeo),
      ...Object.values(PARTS.hair),
      ...Object.values(PARTS.facialHair),
      ...Object.values(PARTS.glasses),
      ...Object.values(PARTS.headwear),
      ...Object.values(PARTS.outfit).flatMap((o) => [o.main, o.trim]),
      ...Object.values(PARTS.blazer),
      ...Object.values(PARTS.lanyard),
      PARTS.headphones.shell,
      PARTS.headphones.covers,
    ].filter((g) => g !== null);
    expect(geos.length).toBeGreaterThan(50);
    for (const g of geos) {
      const pos = g.attributes.position;
      expect(pos.count).toBeGreaterThan(0);
      expect(g.attributes.normal.count).toBe(pos.count);
      for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i])).toBe(true);
    }
  });

  it('gives the face one morph target per face.ts slot, each moving only its own part', () => {
    for (const g of [PARTS.face, PARTS.faceLashes]) {
      const base = g.attributes.position;
      const targets = g.morphAttributes.position ?? [];
      expect(targets).toHaveLength(MORPHS);
      const moved = targets.map((t) => {
        expect(t.count).toBe(base.count);
        const which: number[] = [];
        for (let i = 0; i < t.count; i++) {
          expect(Number.isFinite(t.getX(i) + t.getY(i) + t.getZ(i))).toBe(true);
          if (Math.hypot(t.getX(i) - base.getX(i), t.getY(i) - base.getY(i), t.getZ(i) - base.getZ(i)) > 1e-6) which.push(i);
        }
        return which;
      });
      // every target moves something, and the eyes', brows' and mouth's targets move different vertices
      for (const w of moved) expect(w.length).toBeGreaterThan(0);
      const range = (from: number, to: number) => new Set(moved.slice(from, to).flat());
      const eyes = range(MORPH_AT.eyes, MORPH_AT.brows);
      const brows = range(MORPH_AT.brows, MORPH_AT.mouth);
      const mouth = range(MORPH_AT.mouth, MORPHS);
      for (const v of eyes) expect(brows.has(v) || mouth.has(v)).toBe(false);
      for (const v of brows) expect(mouth.has(v)).toBe(false);
    }
  });

  it('closes the eyes to a thin line and keeps the mouth on the face', () => {
    const g = PARTS.face;
    const base = g.attributes.position;
    const closed = g.morphAttributes.position![MORPH_AT.eyes + EYES.closed];
    const eyeHeight = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < a.count; i++) {
        if (Math.abs(base.getY(i) - 0.02) > 0.035 || base.getZ(i) > -0.14) continue; // the eyes, at rest
        lo = Math.min(lo, a.getY(i));
        hi = Math.max(hi, a.getY(i));
      }
      return hi - lo;
    };
    expect(eyeHeight(closed)).toBeLessThan(eyeHeight(base) * 0.6);
    const open = g.morphAttributes.position![MORPH_AT.mouth + MOUTH.open];
    let mouthVerts = 0;
    for (let i = 0; i < base.count; i++) {
      if (base.getY(i) > -0.06) continue; // only the mouth sits this low
      mouthVerts++;
      for (const a of [base, open]) {
        expect(Math.hypot(a.getX(i), a.getY(i), a.getZ(i))).toBeCloseTo(0.2045, 3); // on the head, just proud of it
        expect(a.getZ(i)).toBeLessThan(-0.15); // on the front
      }
    }
    expect(mouthVerts).toBe(30);
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
