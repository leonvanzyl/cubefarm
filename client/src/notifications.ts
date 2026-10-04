// Desktop notifications (docs/pocket.md): the server's 'notify' events, shown by an office tab the manager can't see
// right now. Web Push (pwa.ts) covers devices without the office open; both tag a note by its id, so it shows once.
import type { NoteView } from '../../shared/types';

export interface DesktopCheck {
  enabled: boolean; // Settings → Notifications → Desktop
  hidden: boolean; // the office's tab is in the background or minimised
  permission: NotificationPermission | 'unsupported';
}

/** Whether this tab shows a note: only while it's hidden (a visible office chimes and toasts already), and only if allowed. */
export const wantsDesktop = (c: DesktopCheck) => c.enabled && c.hidden && c.permission === 'granted';

/** The notes this tab showed, for QA: window.__swarmNotify.shown. */
const shown: NoteView[] = [];
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__swarmNotify = { shown };

export function showDesktopNote(note: NoteView, enabled: boolean) {
  if (typeof document === 'undefined') return;
  const permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  if (!wantsDesktop({ enabled, hidden: document.visibilityState !== 'visible', permission })) return;
  show(note);
}

/** Settings' Test: a notification right now, tab visible or not. */
export function showTestNote() {
  show({ id: `test-${Date.now()}`, event: 'test', title: '🔔 Test from cubefarm', body: 'Desktop notifications work in this browser.', at: Date.now(), url: '/' });
}

function show(note: NoteView) {
  shown.push(note);
  const options: NotificationOptions = { body: note.body, tag: `cubefarm-${note.id}`, icon: '/icons/icon-192.png', data: { url: note.url } };
  const direct = () => {
    try {
      const n = new Notification(note.title, options);
      n.onclick = () => {
        window.focus();
        window.dispatchEvent(new CustomEvent('cubefarm:open', { detail: note.url }));
        n.close();
      };
    } catch {
      // some browsers (Android) only show notifications through a service worker
    }
  };
  // Through the service worker when there is one (the only way on Android); a tap then focuses this tab (pwa.ts).
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  if (!sw) return direct();
  sw.getRegistration()
    .then((reg) => (reg?.active ? reg.showNotification(note.title, options) : direct()))
    .catch(direct);
}
