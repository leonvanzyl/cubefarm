// Window-shaped patches of sunlight on the floor (windowLight.ts), long and warm at golden hour and faint and cool
// under the moon. One shared additive material that DayLights colours, and one mesh per floor whose corners move only
// when the light does. The key light still lights the whole room and casts every desk's and person's shadow: making
// the ceiling block it would leave the office in shade all day.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PATCH_MAX, apertures, sunPatch } from './windowLight';

type FloorKind = 'office' | 'lobby';

/** How much the patches add to the floor, per unit of the key light's intensity. */
const PATCH = 0.2;
/** Just over the floor and its rugs (polygon offset keeps it there at a distance). */
const Y = 0.012;

const sunPatchMaterial = new THREE.MeshBasicMaterial({
  color: 0,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -4,
  side: THREE.DoubleSide,
  fog: false,
  visible: false,
});

const light = { dir: [0, 1, 0] as [number, number, number], version: 0 };

/** The key light's direction, colour and intensity: called by DayLights when the time of day moves. */
export function setSunPatches(dir: readonly [number, number, number], color: number, intensity: number) {
  light.dir[0] = dir[0];
  light.dir[1] = dir[1];
  light.dir[2] = dir[2];
  light.version++;
  sunPatchMaterial.color.setHex(color).multiplyScalar(intensity * PATCH);
  sunPatchMaterial.visible = intensity > 0.01;
}

const corners = new Float32Array(PATCH_MAX * 2);

/** The sunlight through floor `kind`'s windows and doors: one draw call. */
export function SunPatches({ kind }: { kind: FloorKind }) {
  const panes = useMemo(() => apertures(kind), [kind]);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(panes.length * PATCH_MAX * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const index: number[] = [];
    for (let p = 0; p < panes.length; p++) for (let i = 1; i < PATCH_MAX - 1; i++) index.push(p * PATCH_MAX, p * PATCH_MAX + i, p * PATCH_MAX + i + 1);
    g.setIndex(index);
    return g;
  }, [panes]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const seen = useRef(-1);

  useFrame(() => {
    if (seen.current === light.version) return;
    seen.current = light.version;
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    for (let p = 0; p < panes.length; p++) {
      const n = sunPatch(panes[p], light.dir, corners);
      // unused corners sit on the first one, so their triangles have no area
      for (let i = 0; i < PATCH_MAX; i++) {
        const k = (p * PATCH_MAX + i) * 3;
        const c = i < n ? i : 0;
        a[k] = n ? corners[c * 2] : 0;
        a[k + 1] = Y;
        a[k + 2] = n ? corners[c * 2 + 1] : 0;
      }
    }
    pos.needsUpdate = true;
  });

  return <mesh geometry={geometry} material={sunPatchMaterial} frustumCulled={false} renderOrder={1} />;
}
