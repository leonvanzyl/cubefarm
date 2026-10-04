import { Component, lazy, memo, Suspense, type ComponentType, type ReactNode } from 'react';
import type { ToyFloor } from './balls';
import './dogState';
import './pongProbe';
import './probe';

// The physics engine is a WASM module, so the toys live in their own chunk behind their own Suspense:
// the floor renders straight away and the toys drop in once Rapier is ready. If it can't load, toys stay off; an
// error while they run only takes this floor's toys away (each floor remounts them, so the next one has them again).

let broken = false;
function giveUp(err: unknown) {
  if (broken) return;
  broken = true;
  console.warn('Office toys are switched off: the physics engine failed to load.', err);
}

const Nothing: ComponentType<{ floor: ToyFloor }> = () => null;

const ToyWorld = lazy(async (): Promise<{ default: ComponentType<{ floor: ToyFloor }> }> => {
  try {
    const [world, rapier] = await Promise.all([import('./ToyWorld'), import('@dimforge/rapier3d-compat')]);
    await rapier.init(); // idempotent; doing it here lets us catch a failure instead of it reaching React
    return world;
  } catch (err) {
    giveUp(err);
    return { default: Nothing };
  }
});

class ToyGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error('Office toys stopped on this floor after an error (the next floor gets fresh ones):', err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Physics toys for one floor. Remounting (a floor change) builds a fresh world with every toy back at its start. */
export const Toys = memo(function Toys({ floor }: { floor: ToyFloor }) {
  if (broken) return null;
  return (
    <ToyGuard>
      <Suspense fallback={null}>
        <ToyWorld floor={floor} />
      </Suspense>
    </ToyGuard>
  );
});
