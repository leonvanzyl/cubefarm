import { useStore } from './store';
import { restartExpected, shouldReload } from './officeUpdate';
import type { ServerEvent } from '../../shared/types';

let retry = 0;

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
  ws.onopen = () => {
    retry = 0;
    useStore.getState().setConnected(true);
  };
  ws.onmessage = (e) => {
    try {
      const ev = JSON.parse(e.data) as ServerEvent;
      if (ev.type === 'snapshot' && ev.data.officeCommit && reloadForNewCommit(ev.data.officeCommit)) return;
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
