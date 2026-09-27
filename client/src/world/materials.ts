import * as THREE from 'three';

// Three-step ramp gives the flat, cel-shaded cartoon look.
const ramp = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
ramp.minFilter = THREE.NearestFilter;
ramp.magFilter = THREE.NearestFilter;
ramp.generateMipmaps = false;
ramp.needsUpdate = true;

const cache = new Map<string, THREE.Material>();

export function toon(color: string, opts: { emissive?: string; emissiveIntensity?: number; transparent?: boolean; opacity?: number } = {}) {
  const key = `${color}|${opts.emissive ?? ''}|${opts.emissiveIntensity ?? ''}|${opts.opacity ?? ''}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({
      color,
      gradientMap: ramp,
      emissive: opts.emissive ?? '#000000',
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      transparent: opts.transparent ?? (opts.opacity !== undefined && opts.opacity < 1),
      opacity: opts.opacity ?? 1,
    });
    cache.set(key, m);
  }
  return m;
}

/** A toon material that shows a texture (e.g. the beach ball's stripes), cached by key. */
export function toonMap(key: string, map: THREE.Texture) {
  const k = `map|${key}`;
  let m = cache.get(k);
  if (!m) {
    m = new THREE.MeshToonMaterial({ map, gradientMap: ramp });
    cache.set(k, m);
  }
  return m;
}

export function glow(color: string) {
  const key = `glow|${color}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    cache.set(key, m);
  }
  return m;
}

export const glass = new THREE.MeshPhysicalMaterial({
  color: '#bfe8ff',
  transparent: true,
  opacity: 0.22,
  roughness: 0.05,
  metalness: 0,
  depthWrite: false,
  side: THREE.DoubleSide,
});

/** Lighten (amt > 0) or darken (amt < 0) a hex colour. */
export function shade(hex: string, amt: number) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return `#${c.getHexString()}`;
}

/** Blend two hex colours: t = 0 gives a, t = 1 gives b. */
export function mix(a: string, b: string, t: number) {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}
