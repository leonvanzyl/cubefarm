// Photo mode's picture: the office drawn to the screen exactly as usual (through the graphics tier's effects when
// they're on), then (only when a filter or depth of field is on) copied into a texture and drawn again through one
// shader that blurs by depth, grades the colours (filters.ts), inks edges and adds a vignette and grain. Working on the finished, tone-mapped picture keeps 'none' identical to the
// office, and every effect is in pixels of the whole shot, so a supersampled shot rendered in tiles has no seams.
import * as THREE from 'three';
import type { Pipeline } from '../world/gfx/pipeline';
import type { Grade } from './filters';
import { needsGrade } from './filters';

export interface PostOptions {
  grade: Grade;
  /** Depth of field: the distance in focus (m) and the strongest blur (0..1); null when off. */
  dof: { focus: number; blur: number } | null;
  /** Grain's seed: changes per frame while recording, so it moves like film. */
  seed: number;
  /** This render's place in the whole picture: its bottom-left (pixels, y up) and the picture's size. */
  origin: [number, number];
  full: [number, number];
  /** Picture pixels per CSS pixel, so lines and grain look the same at any size. */
  px: number;
  /** Objects left out of the depth pass (glass and other see-through things), so focus looks through them. */
  seeThrough: readonly THREE.Object3D[];
}

/** The widest blur as a fraction of the picture's height. */
const MAX_BLUR = 0.014;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uSize;
uniform vec2 uOrigin;
uniform vec2 uFull;
uniform float uPx;
uniform float uSeed;
uniform float uDof;
uniform float uFocus;
uniform float uBlur;
uniform float uNear;
uniform float uFar;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uGain;
uniform vec3 uLift;
uniform float uVignette;
uniform float uGrain;
uniform float uPosterize;
uniform float uInk;
varying vec2 vUv;

float distanceAt(vec2 uv) {
  float d = unpackRGBAToDepth(texture2D(tDepth, uv));
  return -perspectiveDepthToViewZ(d, uNear, uFar);
}

// How blurred a point at this distance is, 0..1 (thin-lens-like: grows with distance from the focus plane).
float coc(float dist) {
  return clamp(abs(dist - uFocus) / max(dist, 0.05) * 1.6, 0.0, 1.0);
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Flat bands of light and shade, as printed: the brightness is stepped, the hue kept (stepping each channel
// would turn smooth lighting into stripes of other colours), and each step is softened a little so faint noise in
// the lighting doesn't turn into ragged edges.
vec3 posterize(vec3 c) {
  if (uPosterize < 2.0) return c;
  float y = luma(c) * uPosterize;
  float stepped = (floor(y) + smoothstep(0.3, 0.7, fract(y))) / uPosterize;
  return c * (stepped / max(luma(c), 0.004));
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32 + uSeed);
  return fract(p.x * p.y);
}

void main() {
  vec3 c = texture2D(tColor, vUv).rgb;

  if (uDof > 0.5) {
    // Gathering what spills onto this pixel: each sample reaches as far as its own blur, and one behind this pixel
    // only as far as this pixel is blurred itself (a sharp face keeps its edge against a soft background).
    float d0 = distanceAt(vUv);
    float r0 = coc(d0) * uBlur;
    vec3 sum = c;
    float total = 1.0;
    for (int i = 1; i < 32; i++) {
      float rs = sqrt(float(i) / 31.0) * uBlur;
      float a = float(i) * 2.39996;
      vec2 uv = vUv + vec2(cos(a), sin(a)) * rs / uSize;
      float d = distanceAt(uv);
      float r = coc(d) * uBlur;
      float reach = d > d0 ? min(r, r0) : r;
      float w = clamp(reach - rs + 1.0, 0.0, 1.0);
      sum += texture2D(tColor, uv).rgb * w;
      total += w;
    }
    c = sum / total;
  }

  if (uInk > 0.0) {
    vec2 s = vec2(max(1.0, uPx)) / uSize;
    float tl = luma(texture2D(tColor, vUv + vec2(-s.x, s.y)).rgb);
    float t = luma(texture2D(tColor, vUv + vec2(0.0, s.y)).rgb);
    float tr = luma(texture2D(tColor, vUv + vec2(s.x, s.y)).rgb);
    float l = luma(texture2D(tColor, vUv + vec2(-s.x, 0.0)).rgb);
    float r = luma(texture2D(tColor, vUv + vec2(s.x, 0.0)).rgb);
    float bl = luma(texture2D(tColor, vUv + vec2(-s.x, -s.y)).rgb);
    float b = luma(texture2D(tColor, vUv + vec2(0.0, -s.y)).rgb);
    float br = luma(texture2D(tColor, vUv + vec2(s.x, -s.y)).rgb);
    float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
    float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
    float edge = smoothstep(0.18, 0.5, length(vec2(gx, gy)));
    c = posterize(c);
    c = mix(c, vec3(0.06, 0.05, 0.08), edge * uInk);
  } else {
    c = posterize(c);
  }

  float y = luma(c);
  c = mix(vec3(y), c, uSaturation);
  c = (c - 0.5) * uContrast + 0.5;
  c = c * uGain + uLift;

  vec2 full = uOrigin + gl_FragCoord.xy;
  if (uVignette > 0.0) {
    vec2 p = (full / uFull - 0.5) * vec2(uFull.x / uFull.y, 1.0);
    c *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(p));
  }
  if (uGrain > 0.0) c += (hash(floor(full / max(1.0, uPx * 0.75))) - 0.5) * uGrain;

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export class PhotoPost {
  private readonly gl: THREE.WebGLRenderer;
  private color: THREE.FramebufferTexture | null = null;
  private readonly depth = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  private readonly depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly size = new THREE.Vector2();
  private readonly clear = new THREE.Color();
  private readonly shown: boolean[] = [];
  /** Whether copying the screen into a texture works here (it can't on some multisampled canvases). */
  supported = true;

  constructor(gl: THREE.WebGLRenderer) {
    this.gl = gl;
    this.depthMaterial.blending = THREE.NoBlending;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        tColor: { value: null },
        tDepth: { value: this.depth.texture },
        uSize: { value: new THREE.Vector2(1, 1) },
        uOrigin: { value: new THREE.Vector2() },
        uFull: { value: new THREE.Vector2(1, 1) },
        uPx: { value: 1 },
        uSeed: { value: 0 },
        uDof: { value: 0 },
        uFocus: { value: 5 },
        uBlur: { value: 0 },
        uNear: { value: 0.05 },
        uFar: { value: 500 },
        uSaturation: { value: 1 },
        uContrast: { value: 1 },
        uGain: { value: new THREE.Vector3(1, 1, 1) },
        uLift: { value: new THREE.Vector3() },
        uVignette: { value: 0 },
        uGrain: { value: 0 },
        uPosterize: { value: 0 },
        uInk: { value: 0 },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** Margin (picture pixels) a tile needs round it for these effects to read their neighbours. */
  margin(o: Pick<PostOptions, 'grade' | 'dof' | 'full' | 'px'>): number {
    let m = o.grade.ink > 0 ? Math.ceil(o.px) + 2 : 0;
    if (o.dof) m = Math.max(m, Math.ceil(o.dof.blur * MAX_BLUR * o.full[1]) + 2);
    return m;
  }

  /**
   * Draws `scene` from `camera` to the screen, through the filter and depth of field when they're on. `pipeline`: the
   * graphics tier's effects (gfx/pipeline.ts) built for the same camera, or null to draw as on Low.
   */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, pipeline: Pipeline | null, delta: number, o: PostOptions) {
    const gl = this.gl;
    gl.setRenderTarget(null);
    if (pipeline) pipeline.render(delta);
    else {
      // the effects' composer turns autoClear off while it's around
      const autoClear = gl.autoClear;
      gl.autoClear = true;
      gl.render(scene, camera);
      gl.autoClear = autoClear;
    }
    if (!this.supported || (!o.dof && !needsGrade(o.grade))) return;
    gl.getDrawingBufferSize(this.size);
    const w = this.size.x;
    const h = this.size.y;
    if (!this.color || this.color.image.width !== w || this.color.image.height !== h) {
      this.color?.dispose();
      this.color = new THREE.FramebufferTexture(w, h);
      this.color.minFilter = THREE.LinearFilter;
      this.color.magFilter = THREE.LinearFilter;
    }
    try {
      gl.copyFramebufferToTexture(this.color);
    } catch {
      this.supported = false;
      return;
    }
    const u = this.material.uniforms;
    if (o.dof) {
      if (this.depth.width !== w || this.depth.height !== h) this.depth.setSize(w, h);
      this.depthPass(scene, camera, o.seeThrough);
    }
    u.tColor.value = this.color;
    (u.uSize.value as THREE.Vector2).set(w, h);
    (u.uOrigin.value as THREE.Vector2).set(o.origin[0], o.origin[1]);
    (u.uFull.value as THREE.Vector2).set(o.full[0], o.full[1]);
    u.uPx.value = o.px;
    u.uSeed.value = o.seed;
    u.uDof.value = o.dof ? 1 : 0;
    u.uFocus.value = o.dof?.focus ?? 5;
    u.uBlur.value = o.dof ? o.dof.blur * MAX_BLUR * o.full[1] : 0;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    const g = o.grade;
    u.uSaturation.value = g.saturation;
    u.uContrast.value = g.contrast;
    (u.uGain.value as THREE.Vector3).set(g.gain[0], g.gain[1], g.gain[2]);
    (u.uLift.value as THREE.Vector3).set(g.lift[0], g.lift[1], g.lift[2]);
    u.uVignette.value = g.vignette;
    u.uGrain.value = g.grain;
    u.uPosterize.value = g.posterize;
    u.uInk.value = g.ink;
    gl.render(this.quadScene, this.quadCamera);
  }

  /** The scene's depth from the same camera, without the sky, glass or shadows being redrawn. */
  private depthPass(scene: THREE.Scene, camera: THREE.Camera, seeThrough: readonly THREE.Object3D[]) {
    const gl = this.gl;
    const background = scene.background;
    const shadows = gl.shadowMap.autoUpdate;
    const alpha = gl.getClearAlpha();
    gl.getClearColor(this.clear);
    this.shown.length = 0;
    for (let i = 0; i < seeThrough.length; i++) {
      this.shown.push(seeThrough[i].visible);
      seeThrough[i].visible = false;
    }
    scene.background = null;
    scene.overrideMaterial = this.depthMaterial;
    gl.shadowMap.autoUpdate = false;
    gl.setClearColor(0xffffff, 1); // packs to the far plane
    gl.setRenderTarget(this.depth);
    gl.clear();
    gl.render(scene, camera);
    gl.setRenderTarget(null);
    gl.setClearColor(this.clear, alpha);
    gl.shadowMap.autoUpdate = shadows;
    scene.overrideMaterial = null;
    scene.background = background;
    for (let i = 0; i < seeThrough.length; i++) seeThrough[i].visible = this.shown[i];
  }

  dispose() {
    this.color?.dispose();
    this.depth.dispose();
    this.depthMaterial.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
