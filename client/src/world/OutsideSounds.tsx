import { useEffect } from 'react';
import { useRenderPaused } from '../perf';
import { useStore } from '../store';
import { setOutsideQuiet, startOutside, stopOutside } from '../ui/outsideSfx';

// The outside's sounds (ui/outsideSfx.ts) for the floor you're on: started with the floor, stopped with it, and quiet
// behind a panel or the phone and while the elevator travels, like the other loops. Set here rather than in the frame
// loop, which stops while the view is paused.

export function OutsideSounds({ kind }: { kind: 'office' | 'lobby' | 'roof' }) {
  const paused = useRenderPaused();
  const away = useStore((s) => s.travel !== null || s.overlay !== null);
  useEffect(() => setOutsideQuiet(paused || away), [paused, away]);
  useEffect(() => {
    startOutside(kind);
    return stopOutside;
  }, [kind]);
  return null;
}
