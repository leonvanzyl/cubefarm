import { create } from 'zustand';
import { useStore } from '../../store';
import { ROOF } from '../layout';
import { aimPerch, leavePerch, perch } from '../perch';
import type { GrillState } from './grillRules';
import { roofVisits } from './roofBreaks';

// The roof's state outside the lazily loaded roof itself (Roof.tsx): what the HUD shows (sitting in a deck chair, the
// telescope's zoom, the grill), the handler for E on the roof's things, and window.__swarmRoof for QA and Playwright.
// Tiny, so floors that never see the roof pay nothing for it.

/** The telescope's magnification: the mouse wheel steps it between min and max. */
export const ZOOM = { min: 4, max: 8, start: 6, step: 0.5 };

export interface RoofView {
  /** You're on the roof (it's mounted). */
  here: boolean;
  /** The deck chair you're sitting in, or null. */
  sitting: number | null;
  /** Looking through the telescope, and at what magnification. */
  telescope: boolean;
  zoom: number;
  grill: GrillState;
}

export const useRoof = create<RoofView>(() => ({ here: false, sitting: null, telescope: false, zoom: ZOOM.start, grill: 'idle' }));

let handler: ((op: string) => void) | null = null;
let details: (() => Record<string, unknown>) | null = null;

/** The mounted roof takes E on its things (`op`: 'chair:2', 'telescope', 'grill') and reports to the probe. */
export function mountRoof(act: (op: string) => void, report: () => Record<string, unknown>) {
  handler = act;
  details = report;
  useRoof.setState({ here: true });
  return () => {
    if (handler !== act) return;
    handler = null;
    details = null;
    useRoof.setState({ here: false, sitting: null, telescope: false, grill: 'idle' });
  };
}

/** E (or a click) on one of the roof's things. */
export const roofAction = (op: string) => handler?.(op);

const deg = (r: number) => Math.round((r * 180) / Math.PI);

const probe = {
  get here() {
    return useRoof.getState().here;
  },
  /** The deck chair you're in (0-3), or null. */
  get sitting() {
    return useRoof.getState().sitting;
  },
  /** Through the telescope: whether you're looking, its zoom and where it points (degrees; yaw 0 is north, 90 west). */
  get telescope() {
    const r = useRoof.getState();
    const p = perch();
    return { on: r.telescope, zoom: r.zoom, yaw: r.telescope && p ? deg(p.yaw) : null, pitch: r.telescope && p ? deg(p.pitch) : null };
  },
  get grill() {
    return details?.().grill ?? { state: useRoof.getState().grill };
  },
  /** What you're holding (a sausage off the grill: { kind: 'sausage', bites }). */
  get held() {
    return useStore.getState().held;
  },
  /** Everything else the mounted roof reports: its visitors, the string lights, the billboards, the sky. */
  get live() {
    return details?.() ?? null;
  },
  /** Everyone who could come up: id, name, role and status. */
  get team() {
    return Object.values(useStore.getState().agents).map((a) => ({ id: a.id, name: a.name, role: a.role, status: a.status }));
  },
  /** Who is up there, riding up or down (whichever floor you're on). */
  get visits() {
    return roofVisits().map((v) => ({ ...v, in: Math.round((v.arrive - Date.now()) / 1000), for: Math.round((v.leave - Date.now()) / 1000) }));
  },
  /** Rides the elevator up to the roof (or to floor `n`). */
  go(n: number = ROOF) {
    useStore.getState().goToFloor(n);
  },
  /** Sits in deck chair i, as E on it does. */
  sit(i: number) {
    roofAction(`chair:${i}`);
  },
  /** Gets up from a deck chair or the telescope. */
  stand() {
    leavePerch();
  },
  /** Looks through the telescope, as E on it does. */
  look() {
    roofAction('telescope');
  },
  /** Aims the telescope you're looking through: degrees, yaw 0 north (90 west), pitch up from level. */
  aim(yawDeg: number, pitchDeg: number) {
    aimPerch((yawDeg * Math.PI) / 180, (pitchDeg * Math.PI) / 180);
  },
  zoom(z: number) {
    roofAction(`zoom:${z}`);
  },
  /** E at the grill: a sausage on, turned over, or taken. */
  grillE() {
    roofAction('grill');
  },
  /** Brings `agentId` up for a break (or the CEO for a call), `seconds` long; works on the roof only. */
  visit(agentId: string, seconds?: number) {
    roofAction(`visit:${agentId}:${seconds ?? ''}`);
  },
};

if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__swarmRoof = probe;
