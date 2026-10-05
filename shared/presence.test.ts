import { describe, expect, it } from 'vitest';
import { cleanColor, cleanHeld, cleanName, cleanText, NAME_MAX, parsePresenceEvent, wrapAngle } from './presence.ts';

describe('cleanName', () => {
  it('trims, collapses whitespace and caps the length', () => {
    expect(cleanName('  Ada \n\t Lovelace  ')).toBe('Ada Lovelace');
    const long = cleanName('x'.repeat(500));
    expect(Array.from(long)).toHaveLength(NAME_MAX);
    expect(cleanName('🦊'.repeat(40))).toBe('🦊'.repeat(NAME_MAX)); // characters, not UTF-16 units
  });

  it('falls back to Visitor for nothing, whitespace or a non-string', () => {
    expect(cleanName('')).toBe('Visitor');
    expect(cleanName('   \u200B ')).toBe('Visitor');
    expect(cleanName(42)).toBe('Visitor');
    expect(cleanName({ toString: () => 'sneaky' })).toBe('Visitor');
    expect(cleanName(null, 'Robin')).toBe('Robin');
  });

  it('drops control, bidi-override and zero-width characters', () => {
    expect(cleanName('Bob\u0000\u0007by')).toBe('Bob by');
    expect(cleanName('\u202Eevil\u202C')).toBe('evil');
    expect(cleanName('in\u200Bvisible')).toBe('in visible');
    expect(cleanName('line\u2028break')).toBe('line break');
  });

  it('cuts piles of combining marks (zalgo) to two', () => {
    const zalgo = `Z${'\u0336'.repeat(30)}a`;
    expect(cleanName(zalgo)).toBe('Z\u0336\u0336a');
  });

  it('keeps markup as plain text: rendering escapes it (names are never HTML)', () => {
    expect(cleanName('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>'.slice(0, NAME_MAX));
    expect(cleanName('"Tom" & <b>Jerry</b>')).toBe('"Tom" & <b>Jerry</b>');
  });
});

describe('cleanText, cleanColor, cleanHeld', () => {
  it('caps labels to their own length', () => {
    expect(cleanText('the whiteboard', 40)).toBe('the whiteboard');
    expect(cleanText('a'.repeat(100), 40)).toHaveLength(40);
  });

  it('accepts only #rrggbb colours', () => {
    expect(cleanColor('#AABBCC')).toBe('#aabbcc');
    expect(cleanColor('red', '#123456')).toBe('#123456');
    expect(cleanColor('#abc', '#123456')).toBe('#123456');
    expect(cleanColor('#123456; background:url(x)', '#000000')).toBe('#000000');
  });

  it('keeps balls, mugs and blasters with sane ids, and nothing else', () => {
    expect(cleanHeld({ k: 'mug', id: 'mug-3', s: 9 })).toEqual({ k: 'mug', id: 'mug-3', s: 3 });
    expect(cleanHeld({ k: 'ball', id: 'beach-ball' })).toEqual({ k: 'ball', id: 'beach-ball' });
    expect(cleanHeld({ k: 'sticky', id: 'x' })).toBeNull();
    expect(cleanHeld({ k: 'ball', id: '<script>' })).toBeNull();
    expect(cleanHeld('ball')).toBeNull();
  });
});

describe('parsePresenceEvent', () => {
  it('reads a pose, rounding and clamping its numbers', () => {
    const m = parsePresenceEvent(JSON.stringify({ type: 'pose', ts: 1234.5, f: 2, x: 1.23456, z: 999, h: 7, p: -9, held: null }));
    expect(m).toEqual({ type: 'pose', ts: 1235, f: 2, x: 1.23, z: 18, h: Math.round(wrapAngle(7) * 1000) / 1000, p: -1.6, held: null });
  });

  it('rejects bad floors, non-numbers and unknown kinds', () => {
    expect(parsePresenceEvent({ type: 'pose', ts: 1, f: -2, x: 0, z: 0, h: 0, p: 0 })).toBeNull(); // -1 is the roof
    expect(parsePresenceEvent({ type: 'pose', ts: 1, f: 1.5, x: 0, z: 0, h: 0, p: 0 })).toBeNull();
    expect(parsePresenceEvent({ type: 'pose', ts: 1, f: 1, x: 'NaN', z: 0, h: 0, p: 0 })).toBeNull();
    expect(parsePresenceEvent({ type: 'pose', f: 1, x: 0, z: 0, h: 0, p: 0 })).toBeNull(); // no timestamp
    expect(parsePresenceEvent('{"type":"pose","ts":1,"f":1,"x":1e999,"z":0,"h":0,"p":0}')).toBeNull(); // Infinity
    expect(parsePresenceEvent({ type: 'emote', e: 'dance' })).toBeNull();
    expect(parsePresenceEvent({ type: 'teleport' })).toBeNull();
    expect(parsePresenceEvent('not json')).toBeNull();
    expect(parsePresenceEvent(`{"type":"hello","name":"${'x'.repeat(5000)}"}`)).toBeNull(); // too long to bother parsing
  });

  it('cleans names and labels on the way in', () => {
    expect(parsePresenceEvent({ type: 'hello', name: `  ${'N'.repeat(60)}\u0000`, color: 'blue' })).toEqual({ type: 'hello', name: 'N'.repeat(NAME_MAX), color: '#ef476f' });
    expect(parsePresenceEvent({ type: 'ping', x: 1, y: 99, z: 2, label: ' the\nwhiteboard ' })).toEqual({ type: 'ping', x: 1, y: 5, z: 2, label: 'the whiteboard' });
  });

  it('clamps the demo fakes count', () => {
    expect(parsePresenceEvent({ type: 'fakes', n: 999 })).toEqual({ type: 'fakes', n: 16 });
    expect(parsePresenceEvent({ type: 'fakes', n: -3 })).toEqual({ type: 'fakes', n: 0 });
    expect(parsePresenceEvent({ type: 'fakes', n: 'lots' })).toBeNull();
  });
});
