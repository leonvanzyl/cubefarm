import { useStore } from './store';
import { restartExpected, shouldReload } from './officeUpdate';
import type { ClientEvent, ServerEvent } from '../../shared/types';

let retry = 0;
let socket: WebSocket | null = null;
// Back from the time-lapse: everything waits for the fresh snapshot asked for, so nothing applies on top of the replay.
let awaitingSnapshot = false;
// Presence too: the other visitors are live people, there in a replay as much as in the live office.
const OUTSIDE_REPLAY = new Set<ServerEvent['type']>(['notify', 'notifyChannels', 'settings', 'officeUpdate', 'clis', 'voiceKey', 'voiceCache', 'progress', 'visitors', 'visitorPose', 'visitorEmote', 'visitorPing']);
let opens = 0;
/** Characters in and out on /ws since the page loaded, and in for presence alone (its probe turns them into rates). */
export const wsTraffic = { in: 0, out: 0, presence: 0 };

/** Sends a message on /ws; false while disconnected, when it's dropped. */
export function sendWs(msg: ClientEvent) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  const text = JSON.stringify(msg);
  socket.send(text);
  wsTraffic.out += text.length;
  return true;
}

/** How many times the socket has opened: a new one means the server has forgotten this tab (presence tells it again). */
export const wsOpens = () => opens;

/** The time-lapse stopped: asks for the live office again (a reconnect brings a snapshot anyway). */
export function requestSnapshot() {
  awaitingSnapshot = true;
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resync' } satisfies ClientEvent));
}

// The commit this tab last reloaded for, so a new office commit reloads the page at most once.
const RELOAD_KEY = 'office-swarm:reloaded-for';

function reloadedFor(): string | null {
  try {
    return sessionStorage.getItem(RELOAD_KEY);
  } catch {
    return null;
  }
}

/** The server came back on a different commit: load the client that goes with it. */
function reloadForNewCommit(commit: string): boolean {
  if (!shouldReload(useStore.getState().officeCommit, commit, reloadedFor())) return false;
  try {
    sessionStorage.setItem(RELOAD_KEY, commit);
  } catch {
    return false; // without storage we can't promise a single reload, so keep the old client
  }
  location.reload();
  return true;
}

export function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  socket = ws;
  ws.onopen = () => {
    retry = 0;
    opens++;
    useStore.getState().setConnected(true);
  };
  ws.onmessage = (e) => {
    wsTraffic.in += typeof e.data === 'string' ? e.data.length : 0;
    try {
      const ev = JSON.parse(e.data) as ServerEvent;
      if (ev.type.startsWith('visitor')) wsTraffic.presence += e.data.length;
      if (ev.type === 'snapshot' && ev.data.officeCommit && reloadForNewCommit(ev.data.officeCommit)) return;
      // While the time-lapse plays it owns the office; it asks for a fresh snapshot when it stops. What isn't part of
      // the replayed office (notifications, settings, the office's own update…) still applies.
      if (!OUTSIDE_REPLAY.has(ev.type)) {
        if (useStore.getState().replaying) return;
        if (awaitingSnapshot) {
          if (ev.type !== 'snapshot') return;
          awaitingSnapshot = false;
        }
      }
      useStore.getState().apply(ev);
    } catch (err) {
      console.error('bad server event', err);
    }
  };
  ws.onclose = () => {
    const s = useStore.getState();
    s.setConnected(false);
    // A drop while the office updates itself is the restart: say so, and look for it coming back sooner.
    const restarting = s.restarting || restartExpected(s.officeUpdate);
    if (restarting !== s.restarting) s.setRestarting(restarting);
    setTimeout(connect, Math.min(restarting ? 2000 : 8000, 500 * 2 ** retry++));
  };
}
