import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { injectSync, rewriteLocation, SYNC_SCRIPT, SyncProxies, syncedHeaders } from './syncProxy.ts';

describe('the sync script goes into HTML pages', () => {
  it('lands at the top of the head', () => {
    const out = injectSync('<!doctype html><html><head lang="en"><title>x</title></head><body></body></html>');
    expect(out).toBe(`<!doctype html><html><head lang="en">${SYNC_SCRIPT}<title>x</title></head><body></body></html>`);
  });

  it('goes after the doctype, or first, when there is no head', () => {
    expect(injectSync('<!DOCTYPE html><p>hi</p>')).toBe(`<!DOCTYPE html>${SYNC_SCRIPT}<p>hi</p>`);
    expect(injectSync('<p>hi</p>')).toBe(`${SYNC_SCRIPT}<p>hi</p>`);
  });

  it('is never added twice, and leaves a <header> alone', () => {
    const once = injectSync('<head></head>');
    expect(injectSync(once)).toBe(once);
    expect(injectSync('<header>x</header>')).toBe(`${SYNC_SCRIPT}<header>x</header>`);
  });
});

describe('proxy headers', () => {
  it('keeps redirects to the app inside the proxy', () => {
    expect(rewriteLocation('http://localhost:6401/login?next=/', 6401, 51000)).toBe('http://localhost:51000/login?next=/');
    expect(rewriteLocation('http://127.0.0.1:6401', 6401, 51000)).toBe('http://localhost:51000/');
    expect(rewriteLocation('http://localhost:6402/x', 6401, 51000)).toBe('http://localhost:6402/x');
    expect(rewriteLocation('/relative', 6401, 51000)).toBe('/relative');
    expect(rewriteLocation('https://github.com/login', 6401, 51000)).toBe('https://github.com/login');
  });

  it('drops what would block the script and fixes the length', () => {
    const out = syncedHeaders({ 'content-type': 'text/html', 'content-length': '10', 'content-security-policy': "script-src 'self'", 'x-frame-options': 'DENY', 'set-cookie': ['a=1'] }, 42);
    expect(out).toEqual({ 'content-type': 'text/html', 'content-length': 42, 'set-cookie': ['a=1'] });
  });
});

describe('a sync proxy in front of an app (loopback only)', () => {
  let app: http.Server | null = null;
  const proxies = new SyncProxies();
  afterEach(async () => {
    await proxies.closeAll();
    await new Promise<void>((r) => (app ? app.close(() => r()) : r()));
    app = null;
  });

  it('adds the script to pages, passes everything else through, and closes', async () => {
    app = http.createServer((req, res) => {
      if (req.url === '/data.json') return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      if (req.url === '/away') return void res.writeHead(302, { location: `http://localhost:${(app!.address() as AddressInfo).port}/home` }).end();
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY' }).end(`<html><head></head><body>${req.url}</body></html>`);
    });
    await new Promise<void>((r) => app!.listen(0, '127.0.0.1', () => r()));
    const target = (app.address() as AddressInfo).port;
    const port = await proxies.open(target);
    expect(await proxies.open(target)).toBe(port);
    expect(proxies.has(port)).toBe(true);
    expect(proxies.has(target)).toBe(false);

    const page = await fetch(`http://127.0.0.1:${port}/about`);
    expect(page.headers.get('x-frame-options')).toBeNull();
    const html = await page.text();
    expect(html).toContain('data-cubefarm-sync');
    expect(html).toContain('<body>/about</body>');

    expect(await (await fetch(`http://127.0.0.1:${port}/data.json`)).json()).toEqual({ ok: true });
    const away = await fetch(`http://127.0.0.1:${port}/away`, { redirect: 'manual' });
    expect(away.headers.get('location')).toBe(`http://localhost:${port}/home`);

    await proxies.close(target);
    expect(proxies.has(port)).toBe(false);
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
  });
});

describe('the sync script itself', () => {
  const body = SYNC_SCRIPT.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');

  it('is valid JavaScript', () => {
    expect(() => new Function(body)).not.toThrow();
  });

  /** Runs the script in a frame at `pathname`; what it tells the viewer, and how it follows a path from the other side. */
  function frameAt(pathname: string) {
    const sent: unknown[] = [];
    const assigned: string[] = [];
    const handlers: Record<string, (e: unknown) => void> = {};
    const parent = { postMessage: (m: unknown) => sent.push(m) };
    const win: Record<string, unknown> = { parent };
    const location = { pathname, search: '', hash: '', assign: (p: string) => assigned.push(p) };
    const history = { pushState() {}, replaceState() {} };
    const run = new Function('window', 'parent', 'location', 'history', 'document', 'addEventListener', 'scrollX', 'scrollY', 'scrollTo', body);
    run(win, parent, location, history, { readyState: 'complete' }, (k: string, f: (e: unknown) => void) => (handlers[k] = f), 0, 0, () => {});
    const follow = (path: string) => handlers.message({ source: parent, data: { cubefarmSyncTo: 'path', path } });
    return { sent, assigned, follow };
  }

  it("reports and follows the app's own paths", () => {
    const f = frameAt('/todos');
    expect(f.sent).toEqual([{ cubefarmSync: 'path', x: 0, y: 0, path: '/todos' }]);
    f.follow('/about');
    expect(f.assigned).toEqual(['/about']);
  });

  it("leaves out the office's /preview/<port> prefix when shown through the gateway", () => {
    const f = frameAt('/preview/51234/todos');
    expect(f.sent).toEqual([{ cubefarmSync: 'path', x: 0, y: 0, path: '/todos' }]);
    f.follow('/about');
    expect(f.assigned).toEqual(['/preview/51234/about']);
  });
});
