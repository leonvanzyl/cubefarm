// window.__swarmPong: the ping-pong match for QA and Playwright (pointer lock doesn't work headless). `state` is a
// fresh snapshot each read: the phase, who is at each end, the score and serve, the ball's position, speed and spin,
// the last shot, and the player's paddle. Helpers pick up a paddle, serve, play the player's side on autopilot, force
// a long rally, feed a drill of balls at the player (each return checked), and start a game between two agents.

import { PONG_PLAYER } from '../../../../shared/pong';
import { repoOnFloor, useStore } from '../../store';
import { isFree } from '../errands';
import { invitePong } from '../pongErrands';
import type { Swing } from './pongPhysics';
import { autopilot, joinPong, leavePong, paddle, pongClick, pongMatch, pongRunner, pongView, type PongRunnerProbe } from './pongState';

type DrillBall = Parameters<PongRunnerProbe['drill']>[0][number];

/** A spread of balls to feed: slow to quick, chopped to topspun, left, middle and right, short and deep. */
export function drillBalls(n = 12): DrillBall[] {
  const out: DrillBall[] = [];
  const speeds = [4.4, 6, 7.8];
  const tops = [-200, 0, 260];
  const lats = [-0.5, 0, 0.5];
  for (let i = 0; i < n; i++) {
    const lat = lats[i % 3];
    out.push({ speed: speeds[Math.floor(i / 3) % 3], top: tops[(i + Math.floor(i / 3)) % 3], side: lat > 0 ? -100 : 80, lat, depth: 0.6 + (i % 4) * 0.15 });
  }
  return out;
}

function state() {
  const v = pongView();
  const r = pongRunner();
  const live = r?.liveView() ?? null;
  const you = v?.you ?? null;
  const opponent = you ? (you === 'west' ? v?.east : v?.west) : null;
  return {
    ...(v ?? { phase: null }),
    opponent: opponent && opponent !== PONG_PLAYER ? opponent : null,
    ball: live?.ball ?? null,
    lastShot: live?.lastShot ?? null,
    returns: live?.returns ?? { tried: 0, landed: 0 },
    drill: live?.drill ?? null,
    forced: live?.forced ?? 0,
    paddle: { lat: paddle.lat, back: paddle.back, y: paddle.y },
    autopilot: autopilot.on,
    loaded: !!r,
  };
}

const probe = {
  get state() {
    return state();
  },
  /** Pick up the paddle at `end` (as E at that end does). */
  join: (end: 'west' | 'east' = 'east') => joinPong(end),
  /** Put it down (as G or Esc does). */
  leave: () => leavePong(),
  /** A click while playing: the toss for the player's serve, or a rematch after a game. */
  click: () => pongClick(),
  /** Serve now: the player's serve (toss and hit), or hurry the agent's. */
  serve: () => pongRunner()?.serveNow() ?? false,
  /** Play the player's side: meet every ball with this swing (forward m/s towards the net, right m/s). */
  autoplay(on = true, swing: Partial<Swing> = {}) {
    autopilot.on = on;
    autopilot.swing = { forward: swing.forward ?? 1.2, right: swing.right ?? 0 };
    return on;
  },
  /** Force a rally: the autopilot plays the player's side and the agent returns the next `hits` balls cleanly. */
  rally(hits = 12) {
    const r = pongRunner();
    if (!r) return false;
    probe.autoplay(true);
    r.forced = hits;
    return true;
  },
  /** Feed balls at the player one at a time (they need to be at the table) and check each return lands; see state.drill. */
  feed(balls: number | DrillBall[] = 12) {
    const r = pongRunner();
    if (!r || !pongMatch()) return false;
    probe.autoplay(true, autopilot.swing);
    return r.drill(typeof balls === 'number' ? drillBalls(balls) : balls);
  },
  /** Two agents (by id; default: two free people on this floor) start a game with each other as soon as they can. */
  npcMatch(a?: string, b?: string) {
    const s = useStore.getState();
    const repo = repoOnFloor(s.repos, s.floor);
    const ids = Object.values(s.agents)
      .filter((x) => x.repoId === repo?.id && x.role !== 'ceo' && isFree(x.status))
      .map((x) => x.id);
    const first = a ?? ids[0];
    const second = b ?? ids.find((id) => id !== first);
    if (!first || !second) return false;
    invitePong(first, second);
    return [first, second];
  },
};

if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__swarmPong = probe;
