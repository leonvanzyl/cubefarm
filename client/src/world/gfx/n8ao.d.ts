// n8ao ships no types: just the parts of its postprocessing pass that pipeline.ts uses.
declare module 'n8ao' {
  import type { Pass } from 'postprocessing';
  import type { Camera, Color, Scene } from 'three';

  export interface N8AOConfiguration {
    aoSamples: number;
    aoRadius: number;
    denoiseSamples: number;
    denoiseRadius: number;
    distanceFalloff: number;
    intensity: number;
    color: Color;
    gammaCorrection: boolean;
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    screenSpaceRadius: boolean;
    transparencyAware: boolean;
    accumulate: boolean;
  }

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    /** Re-renders the scene's transparent objects every frame when it finds any (expensive); on by default. */
    autoDetectTransparency: boolean;
  }
}
