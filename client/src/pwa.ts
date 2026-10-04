// The installable app (docs/pocket.md): the service worker the office serves at /sw.js (server/pwa.ts), and Web Push
// for this device. Push needs a secure context: HTTPS, or localhost on the office's own PC.
import { api } from './api';

/** Registers the worker in a built office (the dev server has none). A new office version replaces it on its own. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch((err) => console.warn('no service worker:', err));
  // A tapped notification asks the open office to show what it's about.
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent<{ type?: string; url?: string }>) => {
    if (e.data?.type === 'cubefarm:open') window.dispatchEvent(new CustomEvent('cubefarm:open', { detail: e.data.url }));
  });
}

/** ok, or why this browser can't get push: no HTTPS, no Push API, or the dev server (no worker). */
export type PushSupport = 'ok' | 'insecure' | 'unsupported' | 'dev';

export function pushSupport(): PushSupport {
  if (!window.isSecureContext) return 'insecure';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') return 'unsupported';
  return import.meta.env.PROD ? 'ok' : 'dev';
}

/** This device's push subscription, if it has one. */
export async function currentPush(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

function sameKey(sub: PushSubscription, key: Uint8Array) {
  const k = sub.options.applicationServerKey;
  return !!k && new Uint8Array(k).every((b, i) => b === key[i]) && k.byteLength === key.length;
}

/** Asks to show notifications, subscribes with the office's key and tells the office. Throws why not. */
export async function enablePush(): Promise<void> {
  if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') {
    throw new Error("Notifications are blocked for the office in this browser's site settings.");
  }
  const reg = await navigator.serviceWorker.ready;
  const key = fromB64u((await api.pushKey()).publicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe(); // made for another office's key
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api.pushSubscribe(sub.toJSON());
}

export async function disablePush(): Promise<void> {
  const sub = await currentPush();
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}
