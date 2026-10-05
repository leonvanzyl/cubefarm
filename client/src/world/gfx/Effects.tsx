// The effects chunk's entry (Graphics.tsx loads it on Medium and High): takes over drawing the frame from R3F with
// the post-processing pipeline, and adds High's contact shadows. Unmounting it hands drawing back to R3F, exactly as
// on Low. With the frame loop stopped (a panel covering the view, a hidden tab) nothing here runs.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { ContactShadows } from './ContactShadows';
import { photoActive } from '../../photo/gate';
import { createPipeline, type Pipeline } from './pipeline';
import type { Tier } from './quality';
import { gfxBlocked, gfxShown, setPipelineStats } from './useGraphics';

export default function Effects({ tier }: { tier: Exclude<Tier, 'low'> }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const [pipe, setPipe] = useState<Pipeline | null>(null);
  const shown = useRef(false);

  // Built in an effect (not during render) so it's always paired with its dispose. Errors reach Graphics.tsx's guard.
  useLayoutEffect(() => {
    const p = createPipeline(gl, scene, camera, tier);
    shown.current = false;
    setPipe(p);
    return () => {
      p.dispose();
      setPipelineStats(null);
      gfxShown('low');
    };
  }, [gl, scene, camera, tier]);

  useLayoutEffect(() => pipe?.setSize(size.width, size.height), [pipe, size, dpr]);

  // Stats for __swarmGfx, refreshed now and then rather than every frame.
  useEffect(() => {
    if (!pipe) return;
    const t = setInterval(() => setPipelineStats(pipe.stats()), 1000);
    return () => clearInterval(t);
  }, [pipe]);

  // Priority 1: R3F stops drawing the frame itself while this is mounted.
  useFrame((_, delta) => {
    if (photoActive()) return; // photo mode draws the frame from its own camera (photo/PhotoScene.tsx)
    if (!pipe) {
      gl.render(scene, camera);
      return;
    }
    try {
      pipe.render(delta);
    } catch (err) {
      // The frame loop is outside React's error handling: switch the effects off rather than throw every frame.
      gfxBlocked('they stopped with an error', err);
      gl.render(scene, camera);
      return;
    }
    if (!shown.current) {
      shown.current = true;
      setPipelineStats(pipe.stats());
      gfxShown(tier);
    }
  }, 1);

  return tier === 'high' ? <ContactShadows /> : null;
}
