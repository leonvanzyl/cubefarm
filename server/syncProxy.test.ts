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

    const page = await fetch(`http://127.0.0.1:${port}/about`);
    expect(page.headers.get('x-frame-options')).toBeNull();
    const html = await page.text();
    expect(html).toContain('data-cubefarm-sync');
    expect(html).toContain('<body>/about</body>');

    expect(await (await fetch(`http://127.0.0.1:${port}/data.json`)).json()).toEqual({ ok: true });
    const away = await fetch(`http://127.0.0.1:${port}/away`, { redirect: 'manual' });
    expect(away.headers.get('location')).toBe(`http://localhost:${port}/home`);

    await proxies.close(target);
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
  });
});

describe('the sync script itself', () => {
  it('is valid JavaScript', () => {
    const body = SYNC_SCRIPT.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    expect(() => new Function(body)).not.toThrow();
  });
});
