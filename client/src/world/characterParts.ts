import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FacialHair, Glasses, HairStyle, Headwear, Outfit } from './appearance';

// Geometry shared by every character on screen. Built once, never disposed (like the material cache): a floor of
// 15 people reuses these instead of each mesh making its own. Pieces that share a material are merged into one
// geometry, so a hairstyle, a beard or a pair of glasses costs one draw call.
// Head-space: origin at the centre of the head (radius 0.2), face toward -Z. Torso-space: origin on the seat.

type Xf = { at?: [number, number, number]; rot?: [number, number, number]; scale?: [number, number, number] };

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();

/** Bakes a transform into a geometry (scale, then rotate, then move, like a mesh would). */
function xf(g: THREE.BufferGeometry, { at = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] }: Xf = {}) {
  q.setFromEuler(e.set(...rot));
  g.applyMatrix4(m4.compose(new THREE.Vector3(...at), q, new THREE.Vector3(...scale)));
  return g;
}

/** Merges parts into one geometry. Every three.js primitive has position/normal/uv, so they merge cleanly. */
function merge(...parts: THREE.BufferGeometry[]) {
  // mergeGeometries wants all-indexed or all-non-indexed parts
  if (parts.some((p) => !p.index)) parts = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const out = mergeGeometries(parts);
  if (!out) throw new Error('could not merge character geometry');
  parts.forEach((p) => p.dispose());
  return out;
}

const sphere = (r: number, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
const capsule = (r: number, len: number, cap = 6, radial = 12) => new THREE.CapsuleGeometry(r, len, cap, radial);
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);

/** The classic short hair cap, tipped back to show the face. Most styles build on it. */
const hairCap = () => xf(new THREE.SphereGeometry(0.215, 24, 16, 0, Math.PI * 2, 0, 1.75), { at: [0, 0.02, 0.01], rot: [0.55, 0, 0] });

/** Points spread evenly over part of a sphere (golden spiral), for curls and afro bumps. */
function spiral(n: number, r: number, keep: (p: THREE.Vector3) => boolean) {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const rr = Math.sqrt(1 - y * y);
    const a = i * 2.39996;
    const p = new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr).multiplyScalar(r);
    if (keep(p)) out.push(p);
  }
  return out;
}

function hairGeometry(style: HairStyle): THREE.BufferGeometry | null {
  switch (style) {
    case 'crop':
      return hairCap();
    case 'long':
      return merge(hairCap(), xf(sphere(0.215, 20, 14), { at: [0, -0.1, 0.07], scale: [1.05, 1.25, 0.8] }));
    case 'ponytail': {
      const tie: Xf = { at: [0, 0.08, 0.2], rot: [0.45, 0, 0] };
      const tail = xf(capsule(0.075, 0.24, 6, 10), { at: [0, -0.17, 0.04] });
      return merge(hairCap(), xf(sphere(0.085, 12, 10), tie), xf(tail, tie));
    }
    case 'bun':
      return merge(hairCap(), xf(sphere(0.1, 14, 10), { at: [0, 0.18, 0.12] }));
    case 'quiff': {
      // spikes swept up and forward over the forehead
      const spikes = [-0.09, -0.045, 0, 0.045, 0.09].map((x, i) =>
        xf(new THREE.ConeGeometry(0.058, 0.19 + (i % 2) * 0.04, 8), {
          at: [x, 0.2 - Math.abs(x) * 0.45, -0.09 + Math.abs(x) * 0.35],
          rot: [-0.75, 0, -x * 3],
        }),
      );
      // and a swoop at the front for the spikes to grow out of
      spikes.push(xf(sphere(0.1, 14, 10), { at: [0, 0.17, -0.1], scale: [1.4, 0.7, 1] }));
      return merge(hairCap(), ...spikes);
    }
    case 'afro': {
      // a big round cloud, with bumps on the back and sides for a curly outline; clear of the face
      const c = new THREE.Vector3(0, 0.1, 0.06);
      const bumps = spiral(26, 0.235, (p) => p.z > -0.08 && p.y > -0.15).map((p) => xf(sphere(0.075, 10, 8), { at: [c.x + p.x, c.y + p.y, c.z + p.z] }));
      return merge(xf(sphere(0.245, 22, 16), { at: [c.x, c.y, c.z] }), ...bumps);
    }
    case 'sidePart':
      // a fringe swept over to one side, with a little lift at the parting
      return merge(
        hairCap(),
        xf(sphere(0.12, 16, 10), { at: [0.05, 0.16, -0.1], rot: [0.3, 0, -0.35], scale: [1.35, 0.5, 0.9] }),
        xf(sphere(0.07, 12, 8), { at: [-0.08, 0.2, -0.04], scale: [1, 0.6, 1.2] }),
      );
    case 'buzz':
      // hugs the scalp; drawn in a colour between hair and skin
      return xf(new THREE.SphereGeometry(0.205, 24, 14, 0, Math.PI * 2, 0, 1.6), { at: [0, 0.015, 0.012], rot: [0.5, 0, 0] });
    case 'bald':
      // just a horseshoe of hair around the back and sides
      return new THREE.SphereGeometry(0.208, 24, 6, -0.3, Math.PI + 0.6, 1.2, 0.58);
    case 'curls': {
      const bumps = spiral(60, 0.2, (p) => p.y > 0.02 && p.y + p.z * 0.9 > -0.02).map((p) =>
        xf(sphere(0.055, 8, 6), { at: [p.x * 1.02, p.y + 0.03, p.z * 1.02 + 0.01] }),
      );
      return merge(hairCap(), ...bumps);
    }
  }
}

/** Drops the triangles inside an ellipse (in x/y) on the front of the face, e.g. to leave the mouth showing. */
function cutHole(g: THREE.BufferGeometry, cx: number, cy: number, rx: number, ry: number) {
  const flat = g.toNonIndexed();
  const src = flat.attributes;
  const keep: number[] = [];
  const p = src.position;
  for (let i = 0; i < p.count; i += 3) {
    const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
    const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    if (!(z < 0 && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1)) keep.push(i, i + 1, i + 2);
  }
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const a = src[name];
    const arr = new Float32Array(keep.length * a.itemSize);
    keep.forEach((v, j) => {
      for (let k = 0; k < a.itemSize; k++) arr[j * a.itemSize + k] = a.array[v * a.itemSize + k];
    });
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  g.dispose();
  flat.dispose();
  return out;
}

/** Cheeks, jaw and chin, with a hole for the mouth (happy or sad). */
const jaw = (r: number, from: number) =>
  cutHole(new THREE.SphereGeometry(r, 28, 12, Math.PI - 0.15, Math.PI + 0.3, from, Math.PI - from), 0, -0.088, 0.07, 0.048);
const moustache = () =>
  merge(...[-1, 1].map((s) => xf(capsule(0.022, 0.05, 4, 8), { at: [s * 0.036, -0.052, -0.197], rot: [0.25, 0, s * 1.2], scale: [1, 1, 0.7] })));

function facialGeometry(kind: FacialHair): THREE.BufferGeometry | null {
  switch (kind) {
    case 'none':
      return null;
    case 'stubble':
      return jaw(0.203, 2.0);
    case 'moustache':
      return moustache();
    case 'beard':
      return merge(
        xf(jaw(0.212, 1.95), { at: [0, 0.012, -0.004], scale: [1.03, 1.12, 1.04] }),
        ...[-1, 1].map((s) => xf(capsule(0.028, 0.09, 4, 8), { at: [s * 0.188, -0.07, -0.035], rot: [0, 0, s * 0.25] })),
        moustache(),
      );
  }
}

/** Frames only (no lens): two rims, a bridge and short arms back toward the ears. */
function glassesGeometry(kind: Glasses, z = -0.215): THREE.BufferGeometry | null {
  if (kind === 'none') return null;
  const rims =
    kind === 'round'
      ? [-0.075, 0.075].map((x) => xf(new THREE.TorusGeometry(0.047, 0.01, 6, 20), { at: [x, 0.02, z] }))
      : [-0.078, 0.078].flatMap((x) => [
          xf(box(0.1, 0.018, 0.016), { at: [x, 0.058, z] }),
          xf(box(0.1, 0.014, 0.016), { at: [x, -0.02, z] }),
          xf(box(0.014, 0.09, 0.016), { at: [x - 0.045, 0.02, z] }),
          xf(box(0.014, 0.09, 0.016), { at: [x + 0.045, 0.02, z] }),
        ]);
  const arms = [-1, 1].map((s) => xf(box(0.012, 0.012, 0.19), { at: [s * 0.172, 0.035, -0.11], rot: [0, s * 0.4, 0] }));
  return merge(...rims, xf(box(0.05, 0.012, 0.012), { at: [0, 0.03, z] }), ...arms);
}

/** Headphones: band + cups in one geometry, the coloured cup covers in another. */
function headphoneGeometry() {
  const R = 0.245;
  const band = xf(new THREE.TorusGeometry(R, 0.018, 6, 28, Math.PI), { at: [0, 0, 0.01] });
  const cups = [-1, 1].map((s) => xf(new THREE.CylinderGeometry(0.072, 0.072, 0.055, 18), { at: [s * 0.235, -0.01, 0.01], rot: [0, 0, Math.PI / 2] }));
  const covers = [-1, 1].map((s) => xf(new THREE.CylinderGeometry(0.052, 0.052, 0.012, 18), { at: [s * 0.266, -0.01, 0.01], rot: [0, 0, Math.PI / 2] }));
  return { shell: merge(band, ...cups), covers: merge(...covers) };
}

function headwearGeometry(kind: Headwear): THREE.BufferGeometry | null {
  switch (kind) {
    case 'none':
      return null;
    case 'beanie': {
      // dome + turned-up cuff + pom-pom, tipped back a little
      const r = 0.228;
      const t = 1.42;
      const tip: Xf = { at: [0, 0.035, 0.02], rot: [0.35, 0, 0] };
      return merge(
        xf(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, t), tip),
        xf(xf(new THREE.TorusGeometry(r * Math.sin(t), 0.03, 8, 28), { at: [0, r * Math.cos(t), 0], rot: [Math.PI / 2, 0, 0] }), tip),
        xf(sphere(0.06, 12, 8), { at: [0, 0.035 + (r + 0.03) * Math.cos(0.35), 0.02 + (r + 0.03) * Math.sin(0.35)] }),
      );
    }
    case 'cap': {
      const r = 0.224;
      const t = 1.35;
      const tip: Xf = { at: [0, 0.02, 0.015], rot: [0.18, 0, 0] };
      return merge(
        xf(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, t), tip),
        xf(xf(new THREE.CylinderGeometry(0.14, 0.14, 0.014, 24, 1, false, Math.PI / 2, Math.PI), { at: [0, r * Math.cos(t), -0.13], rot: [-0.08, 0, 0], scale: [1, 1, 0.9] }), tip),
        xf(sphere(0.022, 8, 6), { at: [0, 0.02 + r * Math.cos(0.18), 0.015 + r * Math.sin(0.18)] }),
      );
    }
  }
}

/** Torso-space extras for developer outfits (the plain tee needs nothing but the collar). */
function outfitGeometry(kind: Outfit): { main: THREE.BufferGeometry | null; trim: THREE.BufferGeometry | null } {
  switch (kind) {
    case 'tee':
      return { main: null, trim: null };
    case 'stripe':
      // a band across the chest; trim = the stripe itself
      return { main: null, trim: new THREE.CylinderGeometry(0.204, 0.204, 0.075, 28, 1, true).translate(0, 0.32, 0) };
    case 'hoodie':
      return {
        // hood bunched behind the neck + kangaroo pocket
        main: merge(
          xf(new THREE.TorusGeometry(0.12, 0.055, 10, 24), { at: [0, 0.5, 0.03], rot: [Math.PI / 2 - 0.35, 0, 0], scale: [1.05, 1.15, 1] }),
          xf(sphere(0.11, 16, 10), { at: [0, 0.5, 0.12], scale: [1.05, 0.9, 0.55] }),
          xf(box(0.22, 0.1, 0.02), { at: [0, 0.14, -0.196] }),
        ),
        // drawstrings with little tips
        trim: merge(
          ...[-1, 1].flatMap((s) => [
            xf(capsule(0.01, 0.11, 3, 6), { at: [s * 0.045, 0.39, -0.196], rot: [-0.25, 0, s * 0.08] }),
            xf(sphere(0.016, 8, 6), { at: [s * 0.05, 0.32, -0.208] }),
          ]),
        ),
      };
    case 'sweater': {
      // thick ribbed collar, hem band and a row of knitted diamonds
      const diamonds = [-0.12, -0.06, 0, 0.06, 0.12].map((x) => {
        const z = -Math.sqrt(0.2 * 0.2 - x * x) - 0.004;
        return xf(box(0.04, 0.04, 0.012), { at: [x, 0.33, z], rot: [0, -Math.asin(x / 0.2), Math.PI / 4] });
      });
      return {
        main: null,
        trim: merge(
          xf(new THREE.TorusGeometry(0.105, 0.045, 10, 24), { at: [0, 0.505, -0.01], rot: [Math.PI / 2, 0, 0] }),
          new THREE.CylinderGeometry(0.206, 0.206, 0.05, 28, 1, true).translate(0, 0.2, 0),
          ...diamonds,
        ),
      };
    }
  }
}

function build<K extends string, V>(keys: readonly K[], make: (k: K) => V) {
  return Object.fromEntries(keys.map((k) => [k, make(k)])) as Record<K, V>;
}

export const PARTS = {
  // body
  // both legs (thighs + shins) as one mesh: legs never move, so this saves draw calls on every character
  legs: merge(
    ...[-0.11, 0.11].flatMap((x) => [xf(capsule(0.08, 0.26), { at: [x, 0.5, -0.17], rot: [Math.PI / 2, 0, 0] }), xf(capsule(0.07, 0.3), { at: [x, 0.27, -0.36] })]),
  ),
  shoes: merge(...[-0.11, 0.11].map((x) => xf(box(0.13, 0.09, 0.22), { at: [x, 0.05, -0.42] }))),
  torso: capsule(0.2, 0.24, 8, 16),
  collar: new THREE.TorusGeometry(0.1, 0.03, 8, 20),
  sleeve: capsule(0.065, 0.36, 6, 12),
  hand: sphere(0.07, 14, 10),
  head: sphere(0.2, 24, 18),
  ears: merge(...[-0.2, 0.2].map((x) => xf(sphere(0.05, 10, 8), { at: [x, -0.01, 0] }))),
  eyes: merge(...[-0.07, 0.07].map((x) => xf(sphere(0.03, 10, 8), { at: [x, 0.02, -0.18] }))),
  nose: sphere(0.028, 10, 8),
  mouth: new THREE.TorusGeometry(0.045, 0.011, 6, 16, Math.PI),
  lashes: merge(...[-1, 1].map((s) => xf(box(0.035, 0.008, 0.008), { at: [s * 0.1, 0.045, -0.172], rot: [0, 0, s * -0.6] }))),
  cheeks: merge(...[-1, 1].map((s) => xf(sphere(0.03, 10, 8), { at: [s * 0.115, -0.045, -0.165], scale: [1, 0.6, 0.3] }))),
  hairClip: box(0.07, 0.035, 0.035),
  // role details
  shirtFront: box(0.11, 0.22, 0.02),
  tie: box(0.045, 0.2, 0.012),
  tieKnot: box(0.06, 0.04, 0.02),
  coatOpening: box(0.06, 0.3, 0.02),
  badge: box(0.07, 0.05, 0.015),
  inspectorGlasses: glassesGeometry('round', -0.2)!,
  // looks
  hair: build(['crop', 'long', 'ponytail', 'bun', 'quiff', 'afro', 'sidePart', 'buzz', 'bald', 'curls'] as const, hairGeometry),
  facialHair: build(['none', 'stubble', 'beard', 'moustache'] as const, facialGeometry),
  glasses: build(['none', 'round', 'square'] as const, (k) => glassesGeometry(k)),
  headphones: headphoneGeometry(),
  headwear: build(['none', 'beanie', 'cap'] as const, headwearGeometry),
  outfit: build(['tee', 'hoodie', 'stripe', 'sweater'] as const, outfitGeometry),
};
