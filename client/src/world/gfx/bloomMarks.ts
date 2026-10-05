// Which things glow under Medium and High's bloom (Effects.tsx). A material marked here blooms wherever it's drawn,
// so marking costs nothing on Low: the effects chunk puts every mesh drawn with a marked material on a bloom layer and
// draws only those layers into the bloom. 'night' things (the moon, the city's windows, the lamps) join after dusk.
import type * as THREE from 'three';

export type BloomWhen = 'always' | 'night';

/** userData for a material in JSX: <meshBasicMaterial userData={BLOOM} />. */
export const BLOOM = { bloom: 'always' } as const satisfies { bloom: BloomWhen };
export const BLOOM_AT_NIGHT = { bloom: 'night' } as const satisfies { bloom: BloomWhen };

/** Marks a material as glowing and returns it. */
export function markBloom<M extends THREE.Material>(material: M, when: BloomWhen = 'always'): M {
  material.userData.bloom = when;
  return material;
}

/** When a material blooms, or null if it never does. */
export function bloomOf(material: THREE.Material | THREE.Material[] | undefined): BloomWhen | null {
  if (!material) return null;
  if (Array.isArray(material)) {
    let found: BloomWhen | null = null;
    for (const m of material) {
      const w = bloomOf(m);
      if (w === 'always') return w;
      found ??= w;
    }
    return found;
  }
  const w = material.userData?.bloom;
  return w === 'always' || w === 'night' ? w : null;
}
