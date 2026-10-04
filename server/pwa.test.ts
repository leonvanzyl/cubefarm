import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { serviceWorkerSource, swVersion } from './pwa.ts';

describe('the service worker version', () => {
  it('changes with every office update: a new build, a new package version or a new commit', () => {
    const v = swVersion('<html>a</html>', '0.3.14', 'abc1234');
    expect(v).toMatch(/^[0-9a-f]{12}$/);
    expect(swVersion('<html>a</html>', '0.3.14', 'abc1234')).toBe(v);
    expect(swVersion('<html>b</html>', '0.3.14', 'abc1234')).not.toBe(v);
    expect(swVersion('<html>a</html>', '0.3.15', 'abc1234')).not.toBe(v);
    expect(swVersion('<html>a</html>', '0.3.14', 'def5678')).not.toBe(v);
    expect(swVersion('<html>a</html>', '0.3.14', null)).not.toBe(v);
  });
});

/** Runs the worker in a sandbox and returns its fetch handler, which reports what it would do with a request. */
function fetchHandler() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const self = { addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn), location: { origin: 'https://office.example' } };
  const caches = { match: async () => undefined, has: async () => true, open: async () => ({ put: async () => undefined, match: async () => undefined }) };
  vm.runInNewContext(serviceWorkerSource('v1'), { self, URL, caches, fetch: () => new Promise(() => undefined), Response: { error: () => null } });
  return (url: string, init: { method?: string; mode?: string } = {}) => {
    let handled = false;
    handlers.fetch({ request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors' }, respondWith: () => (handled = true), waitUntil: () => undefined });
    return handled;
  };
}

describe('the service worker', () => {
  it('names its cache by version, so an update drops the old one', () => {
    const src = serviceWorkerSource('0123456789ab');
    expect(src).toContain('const VERSION = "0123456789ab";');
    expect(src).toContain("k.startsWith('cubefarm-shell-') && k !== CACHE");
    expect(() => new vm.Script(src)).not.toThrow();
  });

  it('caches only the app shell: never the API, the websockets or anything else', () => {
    const handles = fetchHandler();
    expect(handles('https://office.example/', { mode: 'navigate' })).toBe(true);
    expect(handles('https://office.example/assets/index-abc123.js')).toBe(true);
    expect(handles('https://office.example/icons/icon-192.png')).toBe(true);
    expect(handles('https://office.example/manifest.webmanifest')).toBe(true);
    expect(handles('https://office.example/api/state')).toBe(false);
    expect(handles('https://office.example/api/voice/messages/3?cached=1')).toBe(false);
    expect(handles('https://office.example/api/agents/a1/screen')).toBe(false);
    expect(handles('https://office.example/ws')).toBe(false);
    expect(handles('https://office.example/sw.js')).toBe(false);
    expect(handles('https://office.example/assets/index-abc123.js', { method: 'POST' })).toBe(false);
    expect(handles('https://fonts.googleapis.com/css2?family=Fredoka')).toBe(false);
  });
});
