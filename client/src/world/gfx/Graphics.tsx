// The graphics tiers inside the Canvas (quality.ts says what each draws). Low mounts nothing here but, on Auto, the
// frame-rate sampler. Medium and High load the post-processing chunk (Effects.tsx) on first use, so the main bundle
// and Low never pay for it, and drive the screens' night glow. If the effects can't load or start, they're switched
// off for the session and the office draws as on Low.
import { Component, lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { FrameRateSampler } from '../../perf';
import { isTierAtLeast, type Tier } from './quality';
import { ScreenGlowDriver } from './ScreenGlow';
import { effectiveTier, gfxBlocked, gfxPaused, reportFrameRate, useGfx } from './useGraphics';

type EffectsProps = { tier: Exclude<Tier, 'low'> };
const Nothing: ComponentType<EffectsProps> = () => null;

const Effects = lazy(async (): Promise<{ default: ComponentType<EffectsProps> }> => {
  try {
    return await import('./Effects');
  } catch (err) {
    gfxBlocked('the effects failed to load', err);
    return { default: Nothing };
  }
});

class EffectsGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    gfxBlocked(err instanceof Error ? err.message : 'they failed to start', err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function Graphics({ paused }: { paused: boolean }) {
  const auto = useGfx((s) => s.preset === 'auto' && !s.blocked);
  const tier = useGfx(effectiveTier);
  return (
    <>
      {auto && <FrameRateSampler paused={paused} onSample={reportFrameRate} onPause={gfxPaused} />}
      {isTierAtLeast(tier, 'medium') && <ScreenGlowDriver />}
      {tier !== 'low' && (
        <EffectsGuard>
          <Suspense fallback={null}>
            <Effects tier={tier} />
          </Suspense>
        </EffectsGuard>
      )}
    </>
  );
}
