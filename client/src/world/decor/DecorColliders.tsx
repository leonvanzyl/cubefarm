// The placed decorations (#210) as solids for the toy physics, so a ball bounces off a fish tank like any furniture.
// Its own fixed body, rebuilt when the floor's decorations change; the rest of the building never is.
import { useMemo } from 'react';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { repoOnFloor, useStore } from '../../store';
import { decorRects } from './decor';

export function DecorColliders({ groups }: { groups: number }) {
  const placed = useStore((s) => {
    const repo = repoOnFloor(s.repos, s.floor);
    return repo ? s.progress.floors[repo.id]?.placed : undefined;
  });
  const rects = useMemo(() => decorRects(placed ?? {}), [placed]);
  const key = rects.map((r) => `${r.minX},${r.minZ},${r.maxX},${r.maxZ}`).join('|');
  if (!rects.length) return null;
  return (
    <RigidBody key={key} type="fixed" colliders={false}>
      {rects.map((r, i) => {
        const h = r.h ?? 1;
        return <CuboidCollider key={i} args={[(r.maxX - r.minX) / 2, h / 2, (r.maxZ - r.minZ) / 2]} position={[(r.minX + r.maxX) / 2, h / 2, (r.minZ + r.maxZ) / 2]} friction={0.6} restitution={0.4} collisionGroups={groups} />;
      })}
    </RigidBody>
  );
}
