import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { BOOT_SCRIPT, escapedTo, gatewayLocation, handleGateway, injectBoot, parseMount, WORKER_SOURCE } from './previewGateway.ts';

describe('gateway paths', () => {
  it("reads the preview's port and the app's own path", () => {
    expect(parseMount('/preview/6301/')).toEqual({ port: 6301, path: '/', slash: false });
    expect(parseMount('/preview/6301/todos?x=1')).toEqual({ port: 6301, path: '/todos?x=1', slash: false });
    expect(parseMount('/preview/6301')).toEqual({ port: 6301, path: '/', slash: true });
    expect(parseMount('/preview/6301?x=1')).toEqual({ port: 6301, path: '/?x=1', slash: true });
    expect(parseMount('/preview/6301abc')).toBeNull();
    expect(parseMount('/preview/sw.js')).toBeNull();
    expect(parseMount('/preview/0/')).toBeNull();
    expect(parseMount('/preview/70000/')).toBeNull();
    expect(parseMount('/assets/app.js')).toBeNull();
  });

  it("keeps the app's redirects under its mount", () => {
    expect(gatewayLocation('http://localhost:6301/login?next=/', 6301)).toBe('/preview/6301/login?next=/');
    expect(gatewayLocation('http://127.0.0.1:6301', 6301)).toBe('/preview/6301/');
    expect(gatewayLocation('/login', 6301)).toBe('/preview/6301/login');
    expect(gatewayLocation('http://localhost:6302/x', 6301)).toBe('http://localhost:6302/x');
    expect(gatewayLocation('//cdn.example.com/x', 6301)).toBe('//cdn.example.com/x');
    expect(gatewayLocation('next', 6301)).toBe('next');
    expect(gatewayLocation('https://github.com/login', 6301)).toBe('https://github.com/login');
  });

  it('sends a page load that left its preview back under it, and nothing else', () => {
    const live = (p: number) => p === 6301;
    const load = (url: string, referer: string, more: http.IncomingHttpHeaders = {}) =>
      escapedTo({ method: 'GET', url, headers: { referer, 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin', ...more } }, live);
    expect(load('/about?x=1', 'https://office.ts.net/preview/6301/')).toBe('/preview/6301/about?x=1');
    expect(load('/', 'https://office.ts.net/preview/6301/todos', { 'sec-fetch-dest': 'document' })).toBe('/preview/6301/');
    expect(load('/about', 'https://office.ts.net/preview/6301/', { 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'navigate' })).toBe('/preview/6301/about'); // through the office's worker
    expect(load('/about', 'https://office.ts.net/preview/6302/')).toBeNull(); // not running
    expect(load('/about', 'https://office.ts.net/')).toBeNull(); // the office's own page
    expect(load('/about', 'https://office.ts.net/preview/6301/', { 'sec-fetch-dest': 'script' })).toBeNull();
    expect(load('/about', 'https://office.ts.net/preview/6301/', { 'sec-fetch-site': 'cross-site' })).toBeNull();
    expect(load('/api/state', 'https://office.ts.net/preview/6301/')).toBeNull();
    expect(load('/preview/6301/x', 'https://office.ts.net/preview/6301/')).toBeNull();
    expect(load('/about', 'not a url')).toBeNull();
  });
});

describe('the boot script', () => {
  const body = BOOT_SCRIPT.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');

  it('goes at the very top of the head, once', () => {
    const out = injectBoot('<!doctype html><html><head><script data-cubefarm-sync></script></head></html>');
    expect(out).toBe(`<!doctype html><html><head>${BOOT_SCRIPT}<script data-cubefarm-sync></script></head></html>`);
    expect(injectBoot(out)).toBe(out);
    expect(injectBoot('<!DOCTYPE html><p>hi</p>')).toBe(`<!DOCTYPE html>${BOOT_SCRIPT}<p>hi</p>`);
  });

  /** Runs the script on a page; what it did. */
  function boot(controller: string | null, tries = 0, sw = true) {
    const store = new Map<string, string>(tries ? [['cubefarm-preview-boot', String(tries)]] : []);
    const did = { stopped: false, registered: null as null | [string, unknown] };
    const navigator = sw
      ? {
          serviceWorker: {
            controller: controller && { scriptURL: controller },
            register: (url: string, opts: unknown) => {
              did.registered = [url, opts];
              return new Promise(() => {});
            },
          },
        }
      : {};
    const sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
    new Function('navigator', 'sessionStorage', 'window', 'location', body)(navigator, sessionStorage, { stop: () => (did.stopped = true) }, { reload() {} });
    return { ...did, tries: store.get('cubefarm-preview-boot') ?? null };
  }

  it('lets a page the preview worker controls load', () => {
    expect(boot('https://office.ts.net/preview/sw.js', 1)).toEqual({ stopped: false, registered: null, tries: null });
  });

  it('stops any other page and puts the worker in first', () => {
    expect(boot(null)).toEqual({ stopped: true, registered: ['/preview/sw.js', { scope: '/preview/' }], tries: '1' });
    expect(boot('https://office.ts.net/sw.js', 1)).toMatchObject({ stopped: true, tries: '2' });
  });

  it('gives up after two tries, and without service workers', () => {
    expect(boot(null, 2)).toEqual({ stopped: false, registered: null, tries: null });
    expect(boot(null, 0, false)).toEqual({ stopped: false, registered: null, tries: null });
  });

  it('the worker is valid JavaScript', () => {
    expect(() => new Function(WORKER_SOURCE)).not.toThrow();
  });
});

describe('the gateway in front of an app (loopback only)', () => {
  const servers: http.Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  });
  const listen = async (s: http.Server) => {
    servers.push(s);
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
    return (s.address() as AddressInfo).port;
  };

  it('passes requests on to running previews only, under their mount', async () => {
    const seen: string[] = [];
    const app = http.createServer((req, res) => {
      seen.push(`${req.method} ${req.url} ${req.headers.host}`);
      if (req.url === '/away') return void res.writeHead(302, { location: '/home' }).end();
      if (req.url === '/data.json') return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      if (req.method === 'POST') return void req.pipe(res);
      res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "script-src 'self'" }).end('<html><head><title>app</title></head></html>');
    });
    const target = await listen(app);
    const office = http.createServer((req, res) => {
      if (!handleGateway(req, res, (p) => p === target)) res.writeHead(200).end('the office');
    });
    const at = `http://127.0.0.1:${await listen(office)}`;

    const page = await fetch(`${at}/preview/${target}/todos?x=1`);
    expect(page.headers.get('content-security-policy')).toBeNull();
    expect(await page.text()).toBe(`<html><head>${BOOT_SCRIPT}<title>app</title></head></html>`);
    expect(seen).toEqual([`GET /todos?x=1 localhost:${target}`]);

    expect(await (await fetch(`${at}/preview/${target}/data.json`)).json()).toEqual({ ok: true });
    expect(await (await fetch(`${at}/preview/${target}/echo`, { method: 'POST', body: 'hello' })).text()).toBe('hello');
    expect((await fetch(`${at}/preview/${target}/away`, { redirect: 'manual' })).headers.get('location')).toBe(`/preview/${target}/home`);
    expect((await fetch(`${at}/preview/${target}`, { redirect: 'manual' })).headers.get('location')).toBe(`/preview/${target}/`);

    const worker = await fetch(`${at}/preview/sw.js`);
    expect(worker.headers.get('content-type')).toMatch(/javascript/);
    expect(await worker.text()).toBe(WORKER_SOURCE);

    const other = await fetch(`${at}/preview/${target + 1}/`);
    expect(other.status).toBe(404);
    expect(await (await fetch(`${at}/`)).text()).toBe('the office');
  });
});
