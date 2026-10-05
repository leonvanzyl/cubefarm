// window.__swarmDoctor, for QA and Playwright (#262): the office doctor's findings as this tab has them, their fixes
// and Ignore, and (in the demo) its scenarios: a restart with desks gone and work finished, a stuck session, ten more
// minutes for it, an issue left open after its PR merged, and a watchdog check now.
import { api } from '../api';
import { useStore } from '../store';
import type { DoctorFix } from '../../../shared/types';

const doctor = {
  findings: () => useStore.getState().doctor,
  count: () => useStore.getState().doctor.length,
  fix: (id: string, fix: DoctorFix) => api.doctorFix(id, fix),
  ignore: (id: string) => api.doctorIgnore(id),
  demo: (action: Parameters<typeof api.demoDoctor>[0]) => api.demoDoctor(action),
};

if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmDoctor')) {
  Object.defineProperty(window, '__swarmDoctor', { value: doctor, configurable: true, enumerable: false });
}
