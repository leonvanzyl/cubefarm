import { useLayoutEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { attachOutline, detachOutline } from './outlineMesh';

// Ink outlines: drei's <Outlines> (an inverted hull drawn behind its parent mesh), with the parts we use and one fix.
// drei frees the outline's own geometry in a useEffect cleanup that reads its ref, which React 19 has already
// cleared by then, so every outline that unmounts (a mug put down, a floor left, someone fired) kept its GPU
// buffers for the rest of the day. Here the cleanup holds on to what it made.

const OutlinesMaterial = shaderMaterial(
  { screenspace: false, color: new THREE.Color('black'), opacity: 1, thickness: 0.05, size: new THREE.Vector2() },
  `#include <common>
   #include <morphtarget_pars_vertex>
   #include <skinning_pars_vertex>
   #include <clipping_planes_pars_vertex>
   uniform float thickness;
   uniform bool screenspace;
   uniform vec2 size;
   void main() {
     #if defined (USE_SKINNING)
	     #include <beginnormal_vertex>
       #include <morphnormal_vertex>
       #include <skinbase_vertex>
       #include <skinnormal_vertex>
       #include <defaultnormal_vertex>
     #endif
     #include <begin_vertex>
	   #include <morphtarget_vertex>
	   #include <skinning_vertex>
     #include <project_vertex>
     #include <clipping_planes_vertex>
     vec4 tNormal = vec4(normal, 0.0);
     vec4 tPosition = vec4(transformed, 1.0);
     #ifdef USE_INSTANCING
       tNormal = instanceMatrix * tNormal;
       tPosition = instanceMatrix * tPosition;
     #endif
     if (screenspace) {
       vec3 newPosition = tPosition.xyz + tNormal.xyz * thickness;
       gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
     } else {
       vec4 clipPosition = projectionMatrix * modelViewMatrix * tPosition;
       vec4 clipNormal = projectionMatrix * modelViewMatrix * tNormal;
       vec2 offset = normalize(clipNormal.xy) * thickness / size * clipPosition.w * 2.0;
       clipPosition.xy += offset;
       gl_Position = clipPosition;
     }
   }`,
  `uniform vec3 color;
   uniform float opacity;
   #include <clipping_planes_pars_fragment>
   void main(){
     #include <clipping_planes_fragment>
     gl_FragColor = vec4(color, opacity);
     #include <tonemapping_fragment>
     #include <colorspace_fragment>
   }`,
);

type OutlineMaterial = THREE.ShaderMaterial & { thickness: number; color: THREE.Color; size: THREE.Vector2 };

/** An ink outline round the mesh it's placed in, `thickness` in drei's units. */
export function Outlines({ color = 'black', thickness = 0.05, angle = Math.PI }: { color?: THREE.ColorRepresentation; thickness?: number; angle?: number }) {
  const ref = useRef<THREE.Group>(null);
  // clipping: the overview's cutaway (camera/rig.ts) takes the ink off what it cuts away too
  const [material] = useState(() => new OutlinesMaterial({ side: THREE.BackSide, clipping: true }) as OutlineMaterial);
  const gl = useThree((s) => s.gl);
  const made = useRef<{ group: THREE.Group; geometry: THREE.BufferGeometry | null; angle: number } | null>(null);

  // (Re)build when the parent's geometry or the angle changes, as drei does.
  useLayoutEffect(() => {
    const group = ref.current;
    const parent = group?.parent as THREE.Mesh | null | undefined;
    if (!group || !parent?.geometry) return;
    const m = made.current;
    if (m && m.group === group && m.geometry === parent.geometry && m.angle === angle) return;
    if (m) detachOutline(m.group, m.angle);
    attachOutline(group, parent, material, angle);
    made.current = { group, geometry: parent.geometry, angle };
  });

  useLayoutEffect(() => {
    material.thickness = thickness;
    material.color.set(color);
    gl.getDrawingBufferSize(material.size);
  });

  useLayoutEffect(
    () => () => {
      const m = made.current;
      made.current = null;
      if (m) detachOutline(m.group, m.angle);
      material.dispose();
    },
    [material],
  );

  return <group ref={ref} />;
}
