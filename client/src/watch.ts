import { CEO_ID } from '../../shared/types';
import type { Watch } from '../../shared/watch';
import type { Overlay } from './store';

// What this tab shows of the agents' terminals (shared/watch.ts), from the store: the floor it's on, the agent whose
// panel is open (the CEO's in the manager's console) and whether the workers list is out. net.ts sends it on change.

export function currentWatch(s: { floor: number; overlay: Overlay | null; workersOpen: boolean }): Watch {
  const o = s.overlay;
  const agents = o?.kind === 'terminal' ? [o.agentId] : o?.kind === 'manager' ? [CEO_ID] : [];
  return { floor: s.floor, agents, workers: s.workersOpen };
}
