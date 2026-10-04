import type * as THREE from 'three';
import type { Focus } from '../../store';
import { interactables } from '../interact';
import { isCut, type ViewMode } from './rig';

// What a click in the overview or the building view lands on: a status chip, a floor's slice of the tower, or (in the
// overview) anything you could press E on that opens a panel. Range doesn't matter from up here; what the cutaway
// hides can't be clicked through.

export type Pick =
  | { kind: 'agent'; agentId: string; label: string }
  | { kind: 'floor'; floor: number; label: string }
  | { kind: 'focus'; focus: Focus; label: string };

/** Chips and floor slices: objects with a `userData.pick` (a Pick) that clicks find. */
export const pickables = new Set<THREE.Object3D>();

/** The building view's slice under the mouse (-1: none), which BuildingView.tsx lights up. */
export const hovered = { floor: -1 };

/** Things you can open from the overview by clicking them: panels, and hiring at an empty desk or resuming full speed (which ask first). */
const OPENS = new Set<Focus['action']['kind']>(['terminal', 'kanban', 'app', 'elevator', 'manager', 'phone', 'help', 'hire', 'resume', 'catalogue', 'decor-box']);

const roots: THREE.Object3D[] = [];
const hits: THREE.Intersection[] = [];

/** The first thing under `ray`: chips and slices (drawn over everything) before the rest. */
export function pickAt(ray: THREE.Raycaster, mode: ViewMode): Pick | null {
  roots.length = 0;
  for (const o of pickables) roots.push(o);
  if (mode === 'overview') for (const o of interactables.keys()) roots.push(o);
  hits.length = 0;
  ray.intersectObjects(roots, true, hits);
  let found: Pick | null = null;
  for (const h of hits) {
    let o: THREE.Object3D | null = h.object;
    let shown = o.visible;
    while (o && !o.userData.pick && !interactables.has(o)) {
      o = o.parent;
      shown &&= !o || o.visible;
    }
    if (!o || !shown || !o.visible) continue;
    if (o.userData.pick) return o.userData.pick as Pick;
    if (found || isCut(h.point.x, h.point.y, h.point.z)) continue;
    const info = interactables.get(o)!;
    if (OPENS.has(info.action.kind)) found = { kind: 'focus', focus: { id: info.id, label: info.label, action: info.action }, label: info.label };
  }
  return found;
}
