import { Component, lazy, Suspense, useEffect, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThemeId } from '../../../../shared/themes';
import { Character } from '../Character';
import { tintMug } from '../toys/mugLook';
import { setPlacedFloor, setThemeRoot, useTheme } from './active';
import { tickWalks } from './kit/walker';

// The holiday theme in the 3D view: the themes' lazy chunk (all.ts), loaded only when one is on (so nothing of it is
// downloaded, built or drawn the rest of the year), and the active theme's scene dressing the floor you're on.

export interface ThemeProps {
  /** The roof terrace gets only the theme's sky, costumes and the weather and events it holds (not the floors' slots). */
  kind: 'office' | 'lobby' | 'roof';
  /** The floor number (0 for the lobby, ROOF for the roof) and the building's top floor. */
  floor: number;
  top: number;
  /** The office floor's repo, null in the lobby. */
  repoId: string | null;
  /**
   * Office pieces the themes use, handed over rather than imported: the toys' lazy chunk shares them, and a second lazy
   * chunk importing them makes the bundler split the main bundle into extra chunks that every page load fetches.
   */
  office: { Character: typeof Character; tintMug: typeof tintMug };
}

const OFFICE: ThemeProps['office'] = { Character, tintMug };

const scene = (id: ThemeId) => lazy(() => import('./all').then((m) => ({ default: m[id] })));
const CHUNKS: Record<ThemeId, LazyExoticComponent<ComponentType<ThemeProps>>> = {
  halloween: scene('halloween'),
  christmas: scene('christmas'),
  newyear: scene('newyear'),
  valentines: scene('valentines'),
  easter: scene('easter'),
  birthday: scene('birthday'),
};

/** A theme that fails to load (offline after an update, say) leaves the office as it is. */
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn('holiday theme failed to load', err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Walks() {
  useFrame(tickWalks);
  return null;
}

export function ThemeLayer(props: Omit<ThemeProps, 'office'>) {
  const id = useTheme((s) => s.id);
  const { kind, floor } = props;
  useEffect(() => {
    setPlacedFloor(id ? { kind, floor } : null);
    return () => setPlacedFloor(null);
  }, [id, kind, floor]);
  if (!id) return null;
  const Chunk = CHUNKS[id];
  return (
    <Quiet key={id}>
      <Suspense fallback={null}>
        <Walks />
        <group ref={setThemeRoot}>
          <Chunk {...props} office={OFFICE} />
        </group>
      </Suspense>
    </Quiet>
  );
}
