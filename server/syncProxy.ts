import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';

// Synced scrolling for the app viewer's compare mode. A frame from another origin can't be read or scrolled, so the
// viewer shows each side through a pass-through proxy in front of the running preview, on a port of its own (the app
// keeps its root paths), that adds a small script to its HTML pages. The script tells the viewer where the page is
// scrolled and which path it's on, and follows the viewer's word, all through postMessage. Plain web apps scroll the
// page itself, so they sync; an app that scrolls an inner panel still shows, just unsynced.

/** Reports scroll and path changes to the viewer; mirrors the other side's. Ignores itself outside a frame. */
export const SYNC_SCRIPT = `<script data-cubefarm-sync>(function(){
if(window.parent===window||window.__cubefarmSync)return;window.__cubefarmSync=1;
var hold=0;
function where(){return location.pathname+location.search+location.hash}
function send(kind){try{parent.postMessage({cubefarmSync:kind,x:scrollX,y:scrollY,path:where()},'*')}catch(e){}}
addEventListener('scroll',function(){if(Date.now()>hold)send('scroll')},{passive:true});
addEventListener('message',function(e){var d=e.data;if(e.source!==parent||!d||!d.cubefarmSyncTo)return;
if(d.cubefarmSyncTo==='scroll'){hold=Date.now()+200;scrollTo(d.x,d.y)}
else if(d.cubefarmSyncTo==='path'&&typeof d.path==='string'&&d.path.charAt(0)==='/'&&d.path.charCodeAt(1)!==47&&d.path.charCodeAt(1)!==92&&d.path!==where())location.assign(d.path)});
['pushState','replaceState'].forEach(function(k){var f=history[k];history[k]=function(){var r=f.apply(this,arguments);send('path');return r}});
addEventListener('popstate',function(){send('path')});addEventListener('hashchange',function(){send('path')});
if(document.readyState==='loading')addEventListener('DOMContentLoaded',function(){send('path')});else send('path');
})();</script>`;

/** The page with the sync script at the top of its head (or of the page, when it has none). */
export function injectSync(html: string): string {
  if (html.includes('data-cubefarm-sync')) return html;
  const head = html.match(/<head(\s[^>]*)?>/i);
  if (head?.index !== undefined) return html.slice(0, head.index + head[0].length) + SYNC_SCRIPT + html.slice(head.index + head[0].length);
  const doctype = html.match(/^\s*<!doctype[^>]*>/i);
  if (doctype) return doctype[0] + SYNC_SCRIPT + html.slice(doctype[0].length);
  return SYNC_SCRIPT + html;
}

/** A redirect to the app's own address stays inside the proxy. */
export function rewriteLocation(location: string, target: number, proxy: number): string {
  const m = location.match(/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):(\d+)(.*)$/i);
  return m && Number(m[2]) === target ? `http://localhost:${proxy}${m[3] || '/'}` : location;
}

/** Headers for a page the script went into: its length changed, and a CSP or frame rule would block the script. */
export function syncedHeaders(headers: http.OutgoingHttpHeaders, length: number): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || /^(content-length|content-security-policy|x-frame-options)$/i.test(k)) continue;
    out[k] = v;
  }
  out['content-length'] = length;
  return out;
}

const HOP = /^(connection|keep-alive|transfer-encoding|proxy-connection|upgrade)$/i;

/** Response headers passed through, minus the hop-by-hop ones (Node frames the body again itself). */
function passHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(headers)) if (v !== undefined && !HOP.test(k)) out[k] = v;
  return out;
}

/** Send a request on to the app, on IPv4 loopback and then IPv6 (dev servers bind either). */
function upstream(target: number, req: http.IncomingMessage, body: Buffer, onResponse: (res: http.IncomingMessage) => void, onError: (err: Error) => void) {
  const headers: http.OutgoingHttpHeaders = { ...req.headers, host: `localhost:${target}`, 'accept-encoding': 'identity' };
  for (const k of Object.keys(headers)) if (HOP.test(k)) delete headers[k];
  const send = (host: string, retry: boolean) => {
    const up = http.request({ host, port: target, method: req.method, path: req.url, headers }, onResponse);
    up.once('error', (err: NodeJS.ErrnoException) => (retry && err.code === 'ECONNREFUSED' ? send('::1', false) : onError(err)));
    up.end(body);
  };
  send('127.0.0.1', true);
}

class SyncProxy {
  readonly server: http.Server;
  private sockets = new Set<net.Socket>();

  constructor(private target: number) {
    this.server = http.createServer((req, res) => this.forward(req, res));
    this.server.on('connection', (s) => {
      this.sockets.add(s);
      s.once('close', () => this.sockets.delete(s));
    });
    this.server.on('upgrade', (req, socket, head) => this.tunnel(req, socket as net.Socket, head));
  }

  get port() {
    return (this.server.address() as AddressInfo).port;
  }

  private forward(req: http.IncomingMessage, res: http.ServerResponse) {
    // The body is buffered first: a request retried on IPv6 has to be sent again.
    const body: Buffer[] = [];
    req.on('data', (c: Buffer) => body.push(c));
    req.once('end', () => {
      upstream(
        this.target,
        req,
        Buffer.concat(body),
        (ur) => {
          const headers = passHeaders(ur.headers);
          if (typeof headers.location === 'string') headers.location = rewriteLocation(headers.location, this.target, this.port);
          const html = /^text\/html/i.test(String(headers['content-type'] ?? '')) && !headers['content-encoding'] && req.method !== 'HEAD';
          if (!html) {
            res.writeHead(ur.statusCode ?? 502, headers);
            ur.pipe(res);
            return;
          }
          const chunks: Buffer[] = [];
          ur.on('data', (c: Buffer) => chunks.push(c));
          ur.once('end', () => {
            const page = Buffer.from(injectSync(Buffer.concat(chunks).toString('utf8')), 'utf8');
            res.writeHead(ur.statusCode ?? 200, syncedHeaders(headers, page.length));
            res.end(page);
          });
          ur.once('error', () => res.destroy());
        },
        (err) => {
          if (res.headersSent) return void res.destroy();
          res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }).end(`The app isn't answering on port ${this.target}: ${err.message}`);
        },
      );
    });
  }

  /** WebSockets (a dev server's hot reload, an app's live updates) pass straight through. */
  private tunnel(req: http.IncomingMessage, socket: net.Socket, head: Buffer) {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      lines.push(`${name}: ${/^host$/i.test(name) ? `localhost:${this.target}` : req.rawHeaders[i + 1]}`);
    }
    const connect = (host: string, retry: boolean) => {
      const up = net.connect(this.target, host, () => {
        up.write(`${lines.join('\r\n')}\r\n\r\n`);
        if (head.length) up.write(head);
        socket.pipe(up).pipe(socket);
      });
      up.once('error', (err: NodeJS.ErrnoException) => (retry && err.code === 'ECONNREFUSED' ? connect('::1', false) : socket.destroy()));
      socket.once('error', () => up.destroy());
      socket.once('close', () => up.destroy());
    };
    connect('127.0.0.1', true);
  }

  async close() {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

/** The sync proxies, one per preview port, opened when a viewer asks and closed when that preview stops. */
export class SyncProxies {
  private proxies = new Map<number, Promise<SyncProxy>>();

  /** The proxy's port for the app on `target` (on loopback, a port the OS picks). */
  async open(target: number): Promise<number> {
    let p = this.proxies.get(target);
    if (!p) {
      const proxy = new SyncProxy(target);
      p = new Promise<SyncProxy>((resolve, reject) => {
        proxy.server.once('error', reject);
        proxy.server.listen(0, '127.0.0.1', () => resolve(proxy));
      });
      this.proxies.set(target, p);
      p.catch(() => this.proxies.delete(target));
    }
    return (await p).port;
  }

  async close(target: number) {
    const p = this.proxies.get(target);
    if (!p) return;
    this.proxies.delete(target);
    await p.then((proxy) => proxy.close()).catch(() => undefined);
  }

  async closeAll() {
    await Promise.all([...this.proxies.keys()].map((t) => this.close(t)));
  }
}
