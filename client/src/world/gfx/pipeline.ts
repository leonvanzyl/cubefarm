// Medium and High's post-processing (pmndrs postprocessing, plus N8AO for ambient occlusion), in the effects chunk
// that Graphics.tsx loads lazily, so Low never downloads any of it:
//   the scene → N8AO (High) → one pass: the glowing things' bloom, then the colour grade (High) → the screen.
// The scene pass leaves exactly Low's pixels in its buffer. three tone-maps and sRGB-encodes only when it draws to
// the screen (or to an XR target), so the buffer is flagged as an XR target while the scene draws into it: the same
// shader programs as Low (changing tier compiles nothing for the scene), transparent things blend as they do on
// screen, and every pass after works on display-ready colours, which the last writes out unchanged. HTML overlays are
// DOM above the canvas, so nothing here can blur or tint them.
import * as THREE from 'three';
import { BlendFunction, BloomEffect, Effect, EffectAttribute, EffectComposer, EffectPass, RenderPass, type EffectMaterial } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { nightFactor } from '../sky/time';
import { dayTime } from '../sky/useDayTime';
import { bloomOf } from './bloomMarks';
import { bloomAt, gradeAt, NIGHT_BLOOM_FROM, type BloomLook, type Grade } from './grading';
import type { Tier } from './quality';

/** Meshes drawn with a material marked in bloomMarks.ts sit on these layers as well as layer 0. */
export const GLOW_LAYER = 20;
export const NIGHT_GLOW_LAYER = 21;
/** How often the layers are brought up to date with what's mounted (a new desk's screen blooms within this). */
const SYNC_MS = 500;

/** Draws into `target` the way three draws to the screen: tone mapped and sRGB-encoded. */
function asScreen(target: THREE.WebGLRenderTarget, draw: () => void) {
  const t = target as THREE.WebGLRenderTarget & { isXRRenderTarget?: boolean };
  const tex = target.texture;
  const colorSpace = tex.colorSpace;
  t.isXRRenderTarget = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  try {
    draw();
  } finally {
    t.isXRRenderTarget = false;
    tex.colorSpace = colorSpace;
  }
}

class ScreenLookPass extends RenderPass {
  render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget, deltaTime?: number, stencilTest?: boolean) {
    asScreen(inputBuffer, () => super.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest));
  }
}

// Fills the glow buffer's depth with the scene's, pushed a few centimetres back, so the glowing things draw only
// where they're the nearest thing: a screen behind a wall or a person doesn't bloom through them.
const PREFILL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const PREFILL_FRAG = /* glsl */ `
#include <packing>
uniform sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
varying vec2 vUv;
void main() {
  float d = texture2D(tDepth, vUv).r;
  if (d < 1.0) {
    float z = perspectiveDepthToViewZ(d, cameraNear, cameraFar);
    z -= max(0.03, -z * 0.004);
    d = min(viewZToPerspectiveDepth(z, cameraNear, cameraFar), 1.0);
  }
  gl_FragDepth = d;
  gl_FragColor = vec4(0.0);
}`;

/**
 * Bloom from the glowing things only. Instead of thresholding the whole picture (sunlit walls would haze over), the
 * meshes on the glow layers are drawn again, as they look on screen, into a half-size buffer, and that is what
 * blooms. The toon outlines and everything else stay as crisp as on Low.
 */
class GlowBloomEffect extends BloomEffect {
  readonly glow = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
  private readonly prefill: FullScreenQuad;
  private readonly prefillMaterial: THREE.ShaderMaterial;
  private readonly clearColor = new THREE.Color();
  /** Whether the night-only things (moon, city windows, lamps) are in the glow. */
  night = false;

  constructor(
    private readonly world: THREE.Scene,
    private readonly view: THREE.Camera,
  ) {
    super({ blendFunction: BlendFunction.SCREEN, mipmapBlur: true, radius: 0.75, levels: 7 });
    this.setAttributes(this.getAttributes() | EffectAttribute.DEPTH);
    this.glow.texture.name = 'Glow';
    this.prefillMaterial = new THREE.ShaderMaterial({
      vertexShader: PREFILL_VERT,
      fragmentShader: PREFILL_FRAG,
      uniforms: { tDepth: { value: null }, cameraNear: { value: 0.1 }, cameraFar: { value: 1000 } },
      depthTest: true,
      depthWrite: true,
      depthFunc: THREE.AlwaysDepth,
      colorWrite: false,
    });
    this.prefill = new FullScreenQuad(this.prefillMaterial);
  }

  setDepthTexture(depthTexture: THREE.Texture) {
    this.prefillMaterial.uniforms.tDepth.value = depthTexture;
  }

  update(renderer: THREE.WebGLRenderer, _inputBuffer: THREE.WebGLRenderTarget, deltaTime?: number) {
    this.drawGlow(renderer);
    super.update(renderer, this.glow, deltaTime);
  }

  private drawGlow(renderer: THREE.WebGLRenderer) {
    const { world, view, glow } = this;
    const mask = view.layers.mask;
    const background = world.background;
    const shadows = renderer.shadowMap.autoUpdate;
    const clearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);

    renderer.setRenderTarget(glow);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    const cam = view as THREE.PerspectiveCamera;
    this.prefillMaterial.uniforms.cameraNear.value = cam.near;
    this.prefillMaterial.uniforms.cameraFar.value = cam.far;
    this.prefill.render(renderer);

    view.layers.set(GLOW_LAYER);
    if (this.night) view.layers.enable(NIGHT_GLOW_LAYER);
    world.background = null;
    // The shadow map is already up to date from the scene pass.
    renderer.shadowMap.autoUpdate = false;
    try {
      asScreen(glow, () => renderer.render(world, view));
    } finally {
      view.layers.mask = mask;
      world.background = background;
      renderer.shadowMap.autoUpdate = shadows;
      renderer.setClearColor(this.clearColor, clearAlpha);
    }
  }

  setSize(width: number, height: number) {
    super.setSize(width, height);
    // Half size is plenty for something about to be blurred, and a quarter of the pixels to fill.
    const w = Math.max(1, Math.ceil(width / 2));
    const h = Math.max(1, Math.ceil(height / 2));
    this.glow.setSize(w, h);
    this.luminancePass.setSize(w, h);
    this.mipmapBlurPass.setSize(w, h);
  }

  look(b: BloomLook) {
    this.intensity = b.intensity;
    this.luminanceMaterial.threshold = b.threshold;
    this.luminanceMaterial.smoothing = b.smoothing;
  }

  dispose() {
    super.dispose();
    this.glow.dispose();
    this.prefill.dispose();
    this.prefillMaterial.dispose();
  }
}

const GRADE_FRAG = /* glsl */ `
uniform vec3 gradeShadows;
uniform vec3 gradeHighlights;
uniform float gradeSaturation;
uniform float gradeContrast;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
  vec3 c = inputColor.rgb;
  c *= mix(gradeShadows, gradeHighlights, smoothstep(0.05, 0.8, dot(c, LUMA)));
  c = mix(vec3(dot(c, LUMA)), c, gradeSaturation);
  c = (c - 0.5) * gradeContrast + 0.5;
  outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
}`;

/** High's time-of-day grade (grading.ts), on the finished, display-ready picture. */
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', GRADE_FRAG, {
      uniforms: new Map<string, THREE.Uniform>([
        ['gradeShadows', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['gradeHighlights', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['gradeSaturation', new THREE.Uniform(1)],
        ['gradeContrast', new THREE.Uniform(1)],
      ]),
    });
  }

  look(g: Grade) {
    const { shadows: s, highlights: h } = g;
    (this.uniforms.get('gradeShadows')!.value as THREE.Vector3).set(s.r, s.g, s.b);
    (this.uniforms.get('gradeHighlights')!.value as THREE.Vector3).set(h.r, h.g, h.b);
    this.uniforms.get('gradeSaturation')!.value = g.saturation;
    this.uniforms.get('gradeContrast')!.value = g.contrast;
  }
}

/**
 * Puts every mesh drawn with a bloom-marked material on the glow layers (and takes it off when it no longer is). The
 * lights join both layers: with the same lights in both passes, three never sees the scene's lighting change between
 * them, so the lit materials don't look their shader programs up again twice a frame.
 */
function syncGlowLayers(scene: THREE.Scene) {
  let always = 0;
  let night = 0;
  scene.traverse((o) => {
    if ((o as THREE.Light).isLight) {
      o.layers.enable(GLOW_LAYER);
      o.layers.enable(NIGHT_GLOW_LAYER);
      return;
    }
    const when = bloomOf((o as THREE.Mesh).material);
    if (when === 'always') {
      o.layers.enable(GLOW_LAYER);
      o.layers.disable(NIGHT_GLOW_LAYER);
      always++;
    } else if (when === 'night') {
      o.layers.enable(NIGHT_GLOW_LAYER);
      o.layers.disable(GLOW_LAYER);
      night++;
    } else if (o.layers.mask & ((1 << GLOW_LAYER) | (1 << NIGHT_GLOW_LAYER))) {
      o.layers.disable(GLOW_LAYER);
      o.layers.disable(NIGHT_GLOW_LAYER);
    }
  });
  return { always, night };
}

export interface Pipeline {
  render(delta: number): void;
  setSize(width: number, height: number): void;
  dispose(): void;
  stats(): Record<string, unknown>;
}

/** Builds the effects for `tier` on this renderer. Throws if the browser can't render to floating-point buffers. */
export function createPipeline(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, tier: Exclude<Tier, 'low'>): Pipeline {
  if (!gl.extensions.has('EXT_color_buffer_float') && !gl.extensions.has('EXT_color_buffer_half_float')) {
    throw new Error('this browser cannot render to floating-point buffers');
  }
  // The composer turns autoClear off for good; Low (R3F's own render) needs it back when the effects go.
  const autoClear = gl.autoClear;
  const autoReset = gl.info.autoReset;
  const samples = Math.min(4, gl.capabilities.maxSamples);
  const composer = new EffectComposer(gl, { frameBufferType: THREE.HalfFloatType, multisampling: samples });
  composer.addPass(new ScreenLookPass(scene, camera));

  let ao: N8AOPostPass | null = null;
  if (tier === 'high') {
    ao = new N8AOPostPass(scene, camera);
    // Never re-render the scene's transparent things for the AO (it would draw the floor twice more every frame).
    ao.autoDetectTransparency = false;
    const c = ao.configuration;
    c.halfRes = true;
    c.aoSamples = 16;
    c.denoiseSamples = 8;
    c.denoiseRadius = 8;
    c.aoRadius = 0.8;
    c.distanceFalloff = 0.6;
    c.intensity = 2.2;
    // The buffer already holds display-ready colours.
    c.gammaCorrection = false;
    composer.addPass(ao);
  }

  const bloom = new GlowBloomEffect(scene, camera);
  const grade = tier === 'high' ? new GradeEffect() : null;
  const finish = new EffectPass(camera, ...(grade ? [bloom, grade] : [bloom]));
  // The colours are already sRGB-encoded (the scene pass drew them as for the screen).
  (finish.fullscreenMaterial as EffectMaterial).encodeOutput = false;
  composer.addPass(finish);
  gl.info.autoReset = false;

  const looks = { t: -1, bloom: {} as BloomLook, grade: gradeAt(0.5) };
  let synced = 0;
  let glowing = { always: 0, night: 0 };
  let frames = 0;

  return {
    render(delta) {
      // Counted across every pass, so ?stats shows what a frame really costs.
      gl.info.reset();
      const now = performance.now();
      if (now - synced > SYNC_MS) {
        synced = now;
        glowing = syncGlowLayers(scene);
      }
      if (dayTime.t !== looks.t) {
        looks.t = dayTime.t;
        bloom.look(bloomAt(looks.t, looks.bloom));
        bloom.night = nightFactor(looks.t) > NIGHT_BLOOM_FROM;
        grade?.look(gradeAt(looks.t, looks.grade));
      }
      composer.render(delta);
      frames++;
    },
    setSize(width, height) {
      composer.setSize(width, height);
    },
    dispose() {
      composer.dispose();
      gl.autoClear = autoClear;
      gl.info.autoReset = autoReset;
      gl.setRenderTarget(null);
    },
    stats() {
      return {
        tier,
        passes: composer.passes.map((p) => p.name),
        effects: grade ? ['bloom', 'grade'] : ['bloom'],
        msaa: composer.multisampling,
        glowing,
        night: bloom.night,
        bloom: { ...looks.bloom },
        grade: grade ? structuredClone(looks.grade) : null,
        frames,
      };
    },
  };
}
