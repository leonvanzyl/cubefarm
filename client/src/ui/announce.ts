// What screen readers are told without moving focus: the CEO's messages and alarms, through two visually hidden live
// regions (LiveRegions in CaptionStrip.tsx). Kept free of React so the store can call it. window.__swarmAnnounce keeps
// the last 30, for QA and e2e.

import { create } from 'zustand';

export type Urgency = 'polite' | 'assertive';

interface Said {
  text: string;
  urgency: Urgency;
  at: number;
}

export const useAnnouncer = create<Record<Urgency, string>>(() => ({ polite: '', assertive: '' }));

const said: Said[] = [];
if (typeof window !== 'undefined') Object.defineProperty(window, '__swarmAnnounce', { value: said, configurable: true, enumerable: false });

const timers: Partial<Record<Urgency, ReturnType<typeof setTimeout>>> = {};
const pending: Partial<Record<Urgency, string>> = {};

/** Has screen readers say `text`: politely after what they're reading, or at once for an alarm. */
export function announce(text: string, urgency: Urgency = 'polite') {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return;
  said.push({ text: t, urgency, at: Date.now() });
  if (said.length > 30) said.splice(0, said.length - 30);
  // Emptied first, so the same words twice in a row are still read twice; things said together are read together.
  pending[urgency] = pending[urgency] ? `${pending[urgency]} ${t}` : t;
  useAnnouncer.setState({ [urgency]: '' });
  clearTimeout(timers[urgency]);
  timers[urgency] = setTimeout(() => {
    useAnnouncer.setState({ [urgency]: pending[urgency] ?? '' });
    pending[urgency] = '';
  }, 60);
}
