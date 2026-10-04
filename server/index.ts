import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { CLIP_MAX_BYTES, CLIP_TOO_BIG } from '../shared/clipLimits.ts';
import { DAY_PARTS } from '../shared/speech.ts';
import { DEMO, PORT, STATE_FILE, VERSION, WORKSPACE_ROOT } from './config.ts';
import { realBackend } from './backend.ts';
import { handleHook, handleMcp, setOfficeUrl } from './cliRunner.ts';
import { createDemoBackend } from './demo.ts';
import { parseRange } from './journal.ts';
import { underLauncher } from './officeUpdate.ts';
import { serviceWorkerSource, swVersion } from './pwa.ts';
import { screenStatus } from './screenReply.ts';
import { parseSendBackNote } from './sendBack.ts';
import { HttpError, Swarm } from './swarm.ts';

const swarm = new Swarm(DEMO ? createDemoBackend() : realBackend);
// Sessions the office picks back up while it starts need the address their CLIs call back on before it listens.
if (PORT) setOfficeUrl(`http://127.0.0.1:${PORT}`);
await swarm.init();

const app = express();
// Agent CLIs calling back: hooks (a tool result can be a large screenshot, hence the limit) and the CEO's office tools.
// The token in the path is the session's; unknown tokens get an empty answer.
app.post('/api/hooks/:token', express.json({ limit: '64mb' }), (req, res) => void res.json(handleHook(String(req.params.token), req.body)));
app.post('/api/mcp/:token', express.json({ limit: '4mb' }), (req, res, next) => void handleMcp(String(req.params.token), req, res).catch(next));
app.all('/api/mcp/:token', (_req, res) => void res.status(405).set('Allow', 'POST').end());
app.use(express.json({ limit: '1mb' }));

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
const route = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (err) {
    next(err);
  }
};
const num = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid number: ${v}`);
  return n;
};
const str = (v: unknown) => (typeof v === 'string' ? v : '');
// Repo ids contain a slash ("owner/name"), so they travel URL-encoded as a single segment.
const repoId = (req: Request) => decodeURIComponent(String(req.params.repo));

app.get('/api/state', route(() => swarm.snapshot()));

app.get('/api/github/repos', route((req) => swarm.listGithubRepos(str(req.query.owner) || undefined)));

// What happens once a project moves in: the CEO's brief, and whether work starts on its own.
const floorOptions = (req: Request) => ({ mission: str(req.body.mission), autoAssign: req.body.autoAssign === true });

app.post('/api/repos', route((req) => swarm.connectRepo(str(req.body.fullName).trim(), floorOptions(req))));

// Your projects folder
app.get('/api/folders', route((req) => swarm.listProjectFolders(str(req.query.dir) || undefined)));
app.post('/api/folders/connect', route((req) => swarm.connectFolder(str(req.body.path), floorOptions(req))));
app.post(
  '/api/folders/publish',
  route((req) =>
    swarm.publishFolder(str(req.body.path), {
      ...floorOptions(req),
      name: str(req.body.name) || undefined,
      visibility: req.body.visibility === 'public' ? 'public' : 'private',
      description: str(req.body.description),
    }),
  ),
);
app.post(
  '/api/setup',
  route((req) =>
    swarm.setup({
      managerName: str(req.body.managerName),
      companyName: str(req.body.companyName),
      hiring: str(req.body.hiring),
      ceoName: str(req.body.ceoName),
      ceoLook: str(req.body.ceoLook),
      ceoColor: str(req.body.ceoColor),
    }),
  ),
);
app.post(
  '/api/repos/new',
  route((req) =>
    swarm.createRepo(str(req.body.name).trim(), {
      ...floorOptions(req),
      description: str(req.body.description),
      visibility: req.body.visibility === 'public' ? 'public' : 'private',
      owner: str(req.body.owner).trim() || undefined,
    }),
  ),
);
app.patch('/api/repos/:repo', route((req) => swarm.updateRepo(repoId(req), req.body ?? {})));
app.delete('/api/repos/:repo', route((req) => swarm.disconnectRepo(repoId(req))));
app.post('/api/repos/:repo/sync', route((req) => swarm.syncRepo(repoId(req))));
app.post('/api/repos/:repo/sync-folder', route((req) => swarm.syncFolderNow(repoId(req))));
app.post(
  '/api/repos/:repo/issues',
  route(async (req) => ({
    number: await swarm.createIssue(repoId(req), str(req.body.title), str(req.body.body), str(req.body.assignTo) || undefined, str(req.body.specialty) || undefined),
  })),
);
app.post('/api/repos/:repo/issues/:n/close', route((req) => swarm.closeIssueByManager(repoId(req), num(req.params.n))));
app.post('/api/repos/:repo/plan', route((req) => swarm.planFloor(repoId(req), typeof req.body?.mission === 'string' ? req.body.mission : undefined)));
app.post('/api/repos/:repo/onboard', route((req) => swarm.onboardFloor(repoId(req))));
// The floor's app, for the preview monitor
app.post(
  '/api/repos/:repo/preview',
  route((req) => {
    const pr = req.body?.pr;
    if (pr !== undefined && pr !== null && (typeof pr !== 'number' || !Number.isInteger(pr) || pr <= 0)) throw new HttpError(400, 'pr must be a positive integer');
    return swarm.startPreview(repoId(req), pr ?? null);
  }),
);
app.delete('/api/repos/:repo/preview', route((req) => swarm.stopPreview(repoId(req))));
// A finished ping-pong game, for the floor's leaderboard
app.post('/api/repos/:repo/pong', route((req) => swarm.recordPong(repoId(req), req.body ?? {})));
// The PR theatre: open PRs running beside the floor's app, and what the app viewer has on screen
app.post('/api/repos/:repo/pr-previews/:n', route((req) => swarm.startPrPreview(repoId(req), num(req.params.n), req.body?.restart === true)));
app.delete('/api/repos/:repo/pr-previews/:n', route((req) => swarm.stopPrPreview(repoId(req), num(req.params.n))));
app.post(
  '/api/previews/watch',
  route((req) => {
    const viewer = str(req.body?.viewer);
    if (!/^[A-Za-z0-9-]{8,64}$/.test(viewer)) throw new HttpError(400, 'viewer must be an id of 8-64 letters, digits or dashes');
    const repo = req.body?.repoId == null ? null : str(req.body.repoId);
    const pr = req.body?.pr == null ? null : num(req.body.pr);
    return swarm.watchPreview(viewer, repo || null, repo ? pr : null);
  }),
);
app.post('/api/repos/:repo/preview/sync', route((req) => swarm.previewSyncUrl(repoId(req), req.body?.pr == null ? null : num(req.body.pr))));
app.get('/api/repos/:repo/pulls/:n/qa-shots/:i', async (req, res, next) => {
  try {
    const index = Number(req.params.i);
    const shot = Number.isInteger(index) && index >= 0 ? await swarm.qaShot(repoId(req), num(req.params.n), index) : null;
    res.setHeader('Cache-Control', 'no-store');
    if (!shot) return void res.status(404).end();
    res.setHeader('Content-Type', shot.mime);
    // Screenshots can be SVG: never let one run script as a page of the office.
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    res.end(shot.data);
  } catch (err) {
    next(err);
  }
});
app.post('/api/repos/:repo/pulls/:n/merge', route((req) => swarm.mergePull(repoId(req), num(req.params.n), req.body?.method ?? 'squash')));
app.post('/api/repos/:repo/pulls/:n/close', route((req) => swarm.closePull(repoId(req), num(req.params.n))));
app.post('/api/repos/:repo/pulls/:n/qa', route((req) => swarm.sendToQa(repoId(req), num(req.params.n))));
app.post('/api/repos/:repo/pulls/:n/fix', route((req) => swarm.sendBackToDev(repoId(req), num(req.params.n), parseSendBackNote(req.body))));
app.post(
  '/api/repos/:repo/agents',
  route((req) =>
    swarm.hireAgent(repoId(req), {
      name: str(req.body.name),
      model: str(req.body.model),
      effort: str(req.body.effort),
      role: str(req.body.role),
      look: str(req.body.look),
      title: str(req.body.title),
      specialty: str(req.body.specialty),
      brief: str(req.body.brief),
    }),
  ),
);

app.patch('/api/agents/:id', route((req) => swarm.updateAgent(String(req.params.id), req.body ?? {})));
app.delete('/api/agents/:id', route((req) => swarm.fireAgent(String(req.params.id))));
app.post('/api/agents/:id/assign', route((req) => swarm.assign(String(req.params.id), num(req.body.issueNumber), str(req.body.note) || undefined, req.body?.waitForDeps === true)));
app.post('/api/agents/:id/stop', route((req) => swarm.stopAgent(String(req.params.id))));
app.post('/api/agents/:id/reset', route((req) => swarm.resetAgent(String(req.params.id))));
app.post('/api/agents/:id/message', route((req) => swarm.message(String(req.params.id), str(req.body.text))));
app.get('/api/agents/:id/prompt', route((req) => swarm.agentPrompt(String(req.params.id))));
app.get('/api/agents/:id/screen', (req, res) => {
  const shot = swarm.screenshot(String(req.params.id));
  res.setHeader('Cache-Control', 'no-store');
  if (!shot) return void res.status(screenStatus(shot)).end();
  res.setHeader('Content-Type', shot.mime);
  res.end(shot.data);
});

app.patch('/api/settings', route((req) => swarm.updateSettings(req.body ?? {})));

// Phone messages read aloud (docs/voice.md). The key goes in and never comes back out.
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.') || 'request'}: ${i.message}`).join('; '));
  return r.data;
};
const sendAudio = (res: Response, audio: Buffer, cache = 'private, max-age=3600') => {
  // Real clips are mp3; the demo's chime is a WAV.
  res.setHeader('Content-Type', audio.subarray(0, 4).toString('latin1') === 'RIFF' ? 'audio/wav' : 'audio/mpeg');
  res.setHeader('Cache-Control', cache);
  res.end(audio);
};
app.put('/api/voice/key', route((req) => swarm.voice.setKey(parse(z.object({ key: z.string().max(400) }), req.body).key)));
app.get('/api/voice/voices', route(() => swarm.voice.voices()));
app.get(
  '/api/voice/messages/:id',
  route(async (req, res) => {
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    const q = parse(z.object({ cached: z.literal('1').optional(), part: z.coerce.number().int().min(0).max(99).default(0) }), req.query);
    if (!q.cached) return sendAudio(res, await swarm.voice.messageAudio(id));
    // The phone's ▶: a saved clip or a 404, never a new synthesis. Not kept by the browser, so "Clear saved clips" holds.
    const { audio, parts } = await swarm.voice.cachedAudio(id, q.part);
    res.setHeader('X-Voice-Parts', String(parts));
    sendAudio(res, audio, 'no-store');
  }),
);
app.delete('/api/voice/cache', route(() => swarm.voice.clearCache()));
// The 🎙 with ElevenLabs: the recorded clip as the raw body (its Content-Type, X-Clip-Ms its length). A body over the
// cap is refused before it's read, in the same words as clipProblem's.
const clipBody = express.raw({ type: () => true, limit: CLIP_MAX_BYTES });
app.post(
  '/api/voice/transcribe',
  (req, res, next) => clipBody(req, res, (err?: unknown) => next((err as { type?: unknown } | undefined)?.type === 'entity.too.large' ? new HttpError(413, CLIP_TOO_BIG) : err)),
  route(async (req) => {
    const audio = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    return { text: await swarm.voice.transcribe(audio, req.get('content-type'), Number(req.get('x-clip-ms'))) };
  }),
);
app.get(
  '/api/voice/sample',
  route(async (req, res) => sendAudio(res, await swarm.voice.sampleAudio(parse(z.object({ voiceId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'not a voice id').optional() }), req.query).voiceId))),
);
app.get(
  '/api/voice/standup',
  route(async (req, res) => {
    const q = parse(z.object({ n: z.coerce.number().int().min(1).max(99), part: z.enum(DAY_PARTS) }), req.query);
    sendAudio(res, await swarm.voice.standupAudio(q.n, q.part));
  }),
);
// Notifications (docs/pocket.md). Webhook URLs, tokens and push subscriptions go in; only hints come back out.
app.put('/api/notify/webhooks/:channel', route((req) => swarm.notifier.setWebhook(String(req.params.channel), req.body ?? {})));
app.post('/api/notify/test', route((req) => swarm.notifier.test(str(req.body?.channel))));
app.get('/api/notify/push/key', route(() => swarm.notifier.pushKey()));
app.post('/api/notify/push/devices', route((req) => swarm.notifier.subscribe(req.body?.subscription)));
app.delete('/api/notify/push/devices', route((req) => swarm.notifier.unsubscribe(str(req.body?.endpoint))));
// The office's own update: Update now / Later
app.post('/api/office/update', route((req) => swarm.updateOffice(req.body?.action)));
// Claude's usage: resume full speed after a usage warning; in the demo, a warning or the limit on demand
app.post('/api/usage/resume', route(() => swarm.resumeFullSpeed()));
app.post('/api/usage/simulate', route((req) => swarm.simulateUsage(req.body?.kind)));

// The journal, for the time-lapse replay (read-only); the demo can write itself a sample day.
app.get('/api/journal/days', route(() => swarm.journal.days()));
app.get(
  '/api/journal/events',
  route((req) => {
    const { from, to, seek } = parseRange(req.query, Date.now());
    return swarm.journal.read(from, to, seek);
  }),
);
app.post('/api/journal/sample', route(() => swarm.journalSample()));

// The CEO and the manager's phone
app.post('/api/ceo/message', route((req) => swarm.messageCeo(str(req.body.text))));
app.post('/api/ceo/review', route(() => swarm.requestReview()));
app.post('/api/phone/read', route((req) => swarm.markPhoneRead(Number(req.body?.at) || Date.now())));
app.post(
  '/api/requests/:id/approve',
  route((req) =>
    swarm.approveRequest(String(req.params.id), {
      name: str(req.body?.name) || undefined,
      model: typeof req.body?.model === 'string' ? req.body.model : undefined,
      effort: typeof req.body?.effort === 'string' ? req.body.effort : undefined,
      note: str(req.body?.note),
    }),
  ),
);
app.post('/api/requests/:id/reject', route((req) => swarm.rejectRequest(String(req.params.id), str(req.body?.note))));
// The demo office only: the CEO proposes a hire (or a let-go) on demand.
app.post('/api/demo/proposals', route((req) => swarm.demoPropose(req.body?.kind, req.body?.floor)));

// Office progression (#210): the lobby kiosk, a floor's decorations, the player's coffees, and the demo's coins and
// tenure for QA.
app.post('/api/repos/:repo/decor/buy', route((req) => swarm.buyDecoration(repoId(req), req.body?.item)));
app.post('/api/repos/:repo/decor/place', route((req) => swarm.placeDecoration(repoId(req), req.body ?? {})));
app.post('/api/progress/coffee', route((req) => swarm.drankCoffee(req.body?.id)));
app.post('/api/progress/demo', route((req) => swarm.demoProgress(req.body ?? {})));

// Serve the built client: the published package, or `npm start` after `npm run build`.
const dist = path.resolve(import.meta.dirname, '../dist');
if (fs.existsSync(dist)) {
  // The installable app's worker, versioned by the build and the office's commit so an update replaces it (server/pwa.ts).
  app.get('/sw.js', (_req, res) => {
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(serviceWorkerSource(swVersion(html, VERSION, swarm.officeCommit())));
  });
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // express.json() flags malformed bodies with a 4xx status of its own.
  const parserStatus = (err as { status?: unknown })?.status;
  const status = err instanceof HttpError ? err.status : typeof parserStatus === 'number' && parserStatus >= 400 && parserStatus < 500 ? parserStatus : 500;
  const message = err instanceof Error ? err.message : String(err);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

const server = http.createServer(app);
// Two sockets: /ws carries the office's state to every tab, /ws/term?agent=<id> one agent's terminal to whoever opened it.
const wss = new WebSocketServer({ noServer: true });
const terms = new WebSocketServer({ noServer: true });
wss.on('connection', (ws) => swarm.addClient(ws));
terms.on('connection', (ws, req) => swarm.attachTerminal(new URL(req.url ?? '', 'http://localhost').searchParams.get('agent') ?? '', ws));
server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url ?? '', 'http://localhost');
  const target = pathname === '/ws' ? wss : pathname === '/ws/term' ? terms : null;
  if (!target) return void socket.destroy();
  target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
});

server.listen(PORT, '127.0.0.1', () => {
  setOfficeUrl(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  console.log(`\n  🏢 cubefarm on http://localhost:${PORT}${DEMO ? '  (DEMO MODE: fake GitHub + fake agents)' : ''}`);
  console.log(`     state: ${STATE_FILE}`);
  console.log(`     workspaces: ${WORKSPACE_ROOT}\n`);
});

// Floors' apps don't outlive the office. (A hard kill skips this; the next start clears the orphans.) Agents' CLIs
// carry on through a restart and stop when the office quits.
let closing = false;
const shutdown = (signal: string) => {
  if (closing) return;
  closing = true;
  console.log(`\n  ${signal}: stopping floor previews…`);
  const force = setTimeout(() => process.exit(0), 15_000);
  void swarm
    .shutdown(signal === 'restart')
    .catch((err) => console.error(err))
    .finally(() => {
      clearTimeout(force);
      process.exit(0);
    });
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGHUP', () => shutdown('SIGHUP')); // its terminal window closed (macOS, Linux; Windows' console too)
// The launcher asks the office to stop: to restart it (an update, a code change) unless it says it's quitting.
if (underLauncher()) {
  process.on('message', (msg) => {
    const m = msg as { type?: unknown; restart?: unknown } | null;
    if (m?.type === 'office:shutdown') shutdown(m.restart === false ? 'stop' : 'restart');
  });
}
