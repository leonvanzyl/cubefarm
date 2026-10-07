import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FACIAL_HAIR, GLASSES, HAIR_STYLES, HEADWEAR, OUTFITS } from '../../../shared/looks';
import type { FacialHair, Glasses, HairStyle, Headwear, Outfit } from './appearance';
import { MORPHS } from './face';

// Geometry shared by every character on screen. Built once, never disposed (like the material cache): a floor of
// 15 people reuses these instead of each mesh making its own. Pieces that share a material are merged into one
// geometry, so a hairstyle, a beard or a pair of glasses costs one draw call. The face (eyes, brows and mouth) carries
// morph targets for the expressions (face.ts), so every face shares it too and only the weights are per person.
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

/**
 * Puts a part made facing -Z at the origin onto the torso's front, `a` radians round from the middle (> 0: toward
 * their right hand), at height y, standing `lift` off a torso of radius r.
 */
function pin(g: THREE.BufferGeometry, a: number, y: number, lift = 0.006, r = 0.2) {
  g.rotateY(-a);
  return g.translate(Math.sin(a) * (r + lift), y, -Math.cos(a) * (r + lift));
}

/** A rod of radius r from a to b. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number) {
  const d = b.clone().sub(a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), 6);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

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
    case 'bob':
      // chin length round the back and sides, with a straight fringe
      return merge(
        hairCap(),
        xf(new THREE.SphereGeometry(0.226, 24, 12, -0.45, Math.PI + 0.9, 0.35, 1.78), { at: [0, 0, 0.015], scale: [1.08, 1, 1] }),
        xf(sphere(0.12, 16, 10), { at: [0, 0.145, -0.13], scale: [1.45, 0.45, 0.8] }),
      );
    case 'mohawk': {
      // the sides shaved close and a crest of spikes from the forehead to the back
      const crest = [-0.62, -0.31, 0, 0.31, 0.62, 0.93].map((a, i) => {
        const h = 0.12 + (i % 2) * 0.03;
        return xf(new THREE.ConeGeometry(0.05, h, 8), { at: [0, (0.2 + h / 2) * Math.cos(a), (0.2 + h / 2) * Math.sin(a)], rot: [a, 0, 0], scale: [0.5, 1, 1] });
      });
      return merge(hairGeometry('buzz')!, ...crest);
    }
    case 'locs': {
      // a curtain of locs hanging round the back and sides, splaying out a little
      const locs = Array.from({ length: 11 }, (_, i) => {
        const a = -1.75 + (i * 3.5) / 10;
        return xf(capsule(0.03, 0.2, 3, 6), { at: [Math.sin(a) * 0.19, -0.06 - (i % 3) * 0.02, Math.cos(a) * 0.17 + 0.02], rot: [-0.25 * Math.cos(a), 0, 0.25 * Math.sin(a)] });
      });
      return merge(hairCap(), ...locs);
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
function glassesGeometry(kind: Glasses): THREE.BufferGeometry | null {
  if (kind === 'none') return null;
  const z = -0.215;
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

/** Torso-space extras for the outfits (the plain tee needs nothing but the collar). */
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
    case 'cardigan':
      return {
        // the open front's edges and two pockets, a shade deeper than the knit
        main: merge(
          ...[-1, 1].map((s) => pin(box(0.03, 0.3, 0.016), s * 0.3, 0.29, 0.004)),
          ...[-1, 1].map((s) => pin(box(0.075, 0.06, 0.012), s * 0.62, 0.13, 0.002, 0.19)),
        ),
        // the T-shirt underneath, and the buttons
        trim: merge(pin(box(0.09, 0.3, 0.012), 0, 0.29, 0.0), ...[0.37, 0.29, 0.21].map((y) => pin(sphere(0.012, 8, 6), 0.3, y, 0.014))),
      };
    case 'turtleneck':
      // two rolls of collar, peeking out under the chin
      return {
        main: merge(
          xf(new THREE.TorusGeometry(0.16, 0.04, 8, 28), { at: [0, 0.49, 0], rot: [Math.PI / 2, 0, 0] }),
          xf(new THREE.TorusGeometry(0.14, 0.035, 8, 28), { at: [0, 0.54, 0], rot: [Math.PI / 2, 0, 0] }),
        ),
        trim: null,
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

// ---------- the face ----------
// Eyes, brows and mouth are one mesh in ink, so a face costs one draw call. Its morph targets (face.ts: EYES, BROWS
// and MOUTH, in that order) each move one part; Character.tsx sets the weights per person.

/** Where a point at x, y on the face sits in z: on the head (radius 0.2) or a little proud of it. */
const faceZ = (x: number, y: number, r = 0.2) => -Math.sqrt(Math.max(0, r * r - x * x - y * y));

/** A face part's targets: each moves the part's vertices (in place, from the rest shape), or is a whole new shape. */
type Targets = (((p: THREE.Vector3) => void) | Float32Array)[];

const EYE = { x: 0.07, y: 0.02, z: -0.18, r: 0.03 };
/** Squashes an eye (or its lashes) toward the eye's middle line, and bends it: bend > 0 arches it up like ^. */
function lid(p: THREE.Vector3, squash: number, lift: number, bend: number) {
  const dx = Math.min(1, Math.abs(p.x - Math.sign(p.x) * EYE.x) / EYE.r);
  p.y = EYE.y + (p.y - EYE.y) * squash + lift + bend * (1 - dx * dx);
}

/** Both eyes (with lashes for the feminine look). */
function eyesGeometry(lashes: boolean) {
  const parts = [-1, 1].map((s) => xf(sphere(EYE.r, 10, 8), { at: [s * EYE.x, EYE.y, EYE.z] }));
  if (lashes) parts.push(...[-1, 1].map((s) => xf(box(0.035, 0.008, 0.008), { at: [s * 0.1, 0.045, -0.172], rot: [0, 0, s * -0.6] })));
  return merge(...parts);
}
// closed, wide, happy
const EYE_TARGETS: Targets = [
  (p) => lid(p, 0.2, -0.006, -0.007), // a relaxed line, for blinks and sleep
  (p) => {
    const cx = Math.sign(p.x) * EYE.x;
    p.x = cx + (p.x - cx) * 1.18;
    p.y = EYE.y + (p.y - EYE.y) * 1.3 + 0.004;
  },
  (p) => lid(p, 0.22, 0.002, 0.013), // ^ ^
];

const BROW = { x: 0.072, y: 0.078 };
/** Moves a brow up by dy and tilts it (tilt > 0 lifts the end nearer the nose), keeping it on the forehead. */
function browMove(p: THREE.Vector3, dy: number, tilt: number) {
  const s = Math.sign(p.x);
  const y = p.y + dy + tilt * (s * BROW.x - p.x) * s;
  p.z += faceZ(p.x, y) - faceZ(p.x, p.y);
  p.y = y;
}

const browsGeometry = () =>
  merge(
    ...[-1, 1].map((s) =>
      xf(capsule(0.011, 0.045, 3, 8), {
        at: [s * BROW.x, BROW.y, faceZ(s * BROW.x, BROW.y) - 0.004],
        rot: [0, -s * Math.asin(BROW.x / 0.2), Math.PI / 2 - s * 0.12],
        scale: [1, 1, 0.7],
      }),
    ),
  );
// frown, worry, raise, quirk, droop
const BROW_TARGETS: Targets = [
  (p) => browMove(p, -0.007, -0.45),
  (p) => browMove(p, 0.004, 0.55),
  (p) => browMove(p, 0.024, 0.05),
  (p) => (p.x < 0 ? browMove(p, 0.02, -0.1) : browMove(p, -0.005, -0.4)), // one up, one down
  (p) => browMove(p, -0.01, 0.15),
];

/** A mouth shape: half-width w about x, middle at y; top and bottom edges as offsets along it (u: -1 to 1). */
type Lips = { w: number; x?: number; y: number; top: (u: number) => number; bottom: (u: number) => number };
/** A closed mouth along the curve c, tapering a little toward the corners. */
const line = (w: number, y: number, c: (u: number) => number, x = 0): Lips => ({
  w,
  x,
  y,
  top: (u) => c(u) + 0.0065 * (1 - 0.4 * u * u),
  bottom: (u) => c(u) - 0.0065 * (1 - 0.4 * u * u),
});
// The rest shape, then frown, flat, grin, open, wavy, skew.
const MOUTHS: Lips[] = [
  line(0.046, -0.09, (u) => 0.011 - 0.022 * (1 - u * u)), // a small smile
  line(0.04, -0.1, (u) => 0.016 * (1 - u * u) - 0.008),
  line(0.036, -0.094, () => 0),
  { w: 0.056, y: -0.08, top: (u) => -0.005 * (1 - u * u), bottom: (u) => -0.052 * (1 - u * u) ** 0.7 }, // an open D
  { w: 0.024, y: -0.1, top: (u) => 0.026 * Math.sqrt(1 - u * u), bottom: (u) => -0.026 * Math.sqrt(1 - u * u) }, // an O
  line(0.046, -0.097, (u) => 0.006 * Math.sin(u * Math.PI * 2)),
  line(0.036, -0.095, (u) => 0.011 * u, 0.012),
];
const MOUTH_SEGS = 14;

/** A mouth shape as a strip of quads between its edges, lying on the face. */
function lipPositions(l: Lips) {
  const out = new Float32Array((MOUTH_SEGS + 1) * 6);
  for (let i = 0; i <= MOUTH_SEGS; i++) {
    const u = -1 + (2 * i) / MOUTH_SEGS;
    const x = (l.x ?? 0) + u * l.w;
    const yt = l.y + l.top(u);
    const yb = l.y + l.bottom(u);
    out.set([x, yt, faceZ(x, yt, 0.2045), x, yb, faceZ(x, yb, 0.2045)], i * 6);
  }
  return out;
}

function mouthGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(lipPositions(MOUTHS[0]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((MOUTH_SEGS + 1) * 4), 2)); // for merging; unused
  const index: number[] = [];
  for (let i = 0; i < MOUTH_SEGS; i++) {
    const t = i * 2;
    index.push(t, t + 2, t + 1, t + 2, t + 3, t + 1); // wound to face -Z, out of the face
  }
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}
const MOUTH_TARGETS: Targets = MOUTHS.slice(1).map(lipPositions);

/** The face as one geometry: eyes, brows and mouth merged, each part's targets laid over the others at rest. */
function faceGeometry(lashes: boolean) {
  const parts: [THREE.BufferGeometry, Targets][] = [
    [eyesGeometry(lashes), EYE_TARGETS],
    [browsGeometry(), BROW_TARGETS],
    [mouthGeometry(), MOUTH_TARGETS],
  ];
  const counts = parts.map(([part]) => part.attributes.position.count);
  const g = merge(...parts.map(([part]) => part));
  const base = g.attributes.position;
  if (base.count !== counts.reduce((a, b) => a + b, 0)) throw new Error('face parts merged out of order');
  const p = new THREE.Vector3();
  const targets: THREE.BufferAttribute[] = [];
  let first = 0;
  parts.forEach(([, list], k) => {
    for (const t of list) {
      const out = Float32Array.from(base.array);
      for (let v = 0; v < counts[k]; v++) {
        if (t instanceof Float32Array) p.fromArray(t, v * 3);
        else t(p.fromBufferAttribute(base, first + v));
        p.toArray(out, (first + v) * 3);
      }
      targets.push(new THREE.BufferAttribute(out, 3));
    }
    first += counts[k];
  });
  if (targets.length !== MORPHS) throw new Error(`the face has ${targets.length} morph targets, face.ts expects ${MORPHS}`);
  g.morphAttributes.position = targets;
  return g;
}

// ---------- the CEO's suit (torso-space) ----------

/** The CEO's blazer over the suit: lapels, a button, and a pocket square in their colour. */
function blazerGeometry() {
  return {
    lapels: merge(...[-1, 1].map((s) => pin(box(0.065, 0.22, 0.014).rotateZ(-s * 0.36), s * 0.36, 0.36, 0.005))),
    button: pin(sphere(0.014, 10, 8), 0, 0.11, 0.004, 0.187),
    square: pin(box(0.035, 0.035, 0.01).rotateZ(Math.PI / 4), -0.55, 0.39, 0.006),
  };
}

/** The CEO's lanyard: a strap from under the chin to a card on the chest, following the torso's curve. */
function lanyardGeometry() {
  const onTorso = (x: number, y: number) => {
    const r = y > 0.42 ? Math.sqrt(0.04 - (y - 0.42) ** 2) : 0.2;
    return new THREE.Vector3(x, y, -Math.sqrt(r * r - x * x) - 0.007);
  };
  const strap = [-1, 1].flatMap((s) => {
    const pts = [0.53, 0.49, 0.45, 0.41].map((y) => onTorso(s * 0.07, y));
    pts.push(new THREE.Vector3(s * 0.012, 0.235, -0.214));
    return pts.slice(1).map((b, i) => rod(pts[i], b, 0.006));
  });
  return { strap: merge(...strap), card: xf(box(0.055, 0.075, 0.01), { at: [0, 0.195, -0.214] }) };
}

function build<K extends string, V>(keys: readonly K[], make: (k: K) => V) {
  return Object.fromEntries(keys.map((k) => [k, make(k)])) as Record<K, V>;
}

export const PARTS = {
  // body
  // both legs (thighs + shins) as one mesh while seated, when they don't move: saves draw calls on every character
  legs: merge(
    ...[-0.11, 0.11].flatMap((x) => [xf(capsule(0.08, 0.26), { at: [x, 0.5, -0.17], rot: [Math.PI / 2, 0, 0] }), xf(capsule(0.07, 0.3), { at: [x, 0.27, -0.36] })]),
  ),
  shoes: merge(...[-0.11, 0.11].map((x) => xf(box(0.13, 0.09, 0.22), { at: [x, 0.05, -0.42] }))),
  // one leg for standing and walking, the same pieces as above: a thigh hanging from the hip (hip-space), and a
  // shin and shoe hanging from the knee (knee-space, 0.32 below the hip)
  thigh: xf(capsule(0.08, 0.26), { at: [0, -0.13, 0] }),
  shin: xf(capsule(0.07, 0.3), { at: [0, -0.23, 0] }),
  shoe: xf(box(0.13, 0.09, 0.22), { at: [0, -0.45, -0.06] }),
  torso: capsule(0.2, 0.24, 8, 16),
  collar: new THREE.TorusGeometry(0.1, 0.03, 8, 20),
  sleeve: capsule(0.065, 0.36, 6, 12),
  hand: sphere(0.07, 14, 10),
  head: sphere(0.2, 24, 18),
  ears: merge(...[-0.2, 0.2].map((x) => xf(sphere(0.05, 10, 8), { at: [x, -0.01, 0] }))),
  // eyes, brows and mouth (morph targets, face.ts)
  face: faceGeometry(false),
  faceLashes: faceGeometry(true),
  nose: sphere(0.028, 10, 8),
  cheeks: merge(...[-1, 1].map((s) => xf(sphere(0.03, 10, 8), { at: [s * 0.115, -0.045, -0.165], scale: [1, 0.6, 0.3] }))),
  hairClip: box(0.07, 0.035, 0.035),
  // the CEO's suit
  shirtFront: box(0.11, 0.22, 0.02),
  tie: box(0.045, 0.2, 0.012),
  tieKnot: box(0.06, 0.04, 0.02),
  blazer: blazerGeometry(),
  lanyard: lanyardGeometry(),
  // the phone they check while idle (lying in the hand, screen up)
  phone: box(0.075, 0.014, 0.13),
  phoneScreen: xf(new THREE.PlaneGeometry(0.06, 0.105), { at: [0, 0.0075, 0], rot: [-Math.PI / 2, 0, 0] }),
  // looks
  hair: build(HAIR_STYLES, hairGeometry),
  facialHair: build(FACIAL_HAIR, facialGeometry),
  glasses: build(GLASSES, (k) => glassesGeometry(k)),
  headphones: headphoneGeometry(),
  headwear: build(HEADWEAR, headwearGeometry),
  outfit: build(OUTFITS, outfitGeometry),
};
