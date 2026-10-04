import { useEffect, useState, useSyncExternalStore } from 'react';
import { PONG_PLAYER } from '../../../shared/pong';
import { useStore } from '../store';
import { Key } from './Key';
import { pongView, subscribePong, type PongView } from '../world/toys/pongState';
import type { PointWhy } from '../world/toys/pongRules';

// Playing ping-pong (a paddle in hand): the score chip at the top of the screen, what's happening, and the controls.

/** What the one who lost the point did, as a phrase after their name. */
const LOST: Record<PointWhy, string> = {
  'serve-fault': 'served a fault',
  net: 'hit the net',
  'own-side': "didn't clear the net",
  out: 'hit it out',
  missed: 'missed it',
  'double-bounce': 'let it bounce twice',
};

/** The line under the score: who serves, who won the point and how, or how the game ended. */
export function pongStatus(v: PongView, name: (end: 'west' | 'east') => string, waited: number): string {
  const you = v.you;
  const other = you === 'west' ? 'east' : 'west';
  if (v.phase === 'waiting') {
    if (you && v[other]) return `${name(other)} is on the way…`;
    return waited > 20 ? "Nobody's free to play right now" : 'Waiting for someone free to come and play…';
  }
  if (v.phase === 'over' && v.last) {
    const w = v.last.winner;
    const score = `${v.score[w]}–${v.score[w === 'west' ? 'east' : 'west']}`;
    return `${w === you ? 'You win' : `${name(w)} wins`} ${score}!${you ? ' · Click for a rematch' : ''}`;
  }
  if (v.phase === 'point') {
    if (!v.last) return 'Let: serve again';
    if (v.last.why === 'game') return '';
    const loser = v.last.winner === 'west' ? 'east' : 'west';
    return `${loser === you ? 'You' : name(loser)} ${LOST[v.last.why]}${v.gamePoint ? ' · Game point' : ''}`;
  }
  if (v.phase === 'serve') {
    const lead = v.gamePoint ? 'Game point · ' : '';
    return v.server === you ? `${lead}Your serve: click to toss and hit` : `${lead}${name(v.server)} to serve`;
  }
  return v.rally >= 3 ? `Rally ${v.rally}` : '';
}

export function PongHud() {
  const v = useSyncExternalStore(subscribePong, pongView);
  const agents = useStore((s) => s.agents);
  const [waited, setWaited] = useState(0);
  const waiting = v?.phase === 'waiting';
  useEffect(() => {
    setWaited(0);
    if (!waiting) return;
    const t = setInterval(() => setWaited((w) => w + 1), 1000);
    return () => clearInterval(t);
  }, [waiting]);
  if (!v) return null;
  const name = (end: 'west' | 'east') => {
    const id = v[end];
    return !id ? '…' : id === PONG_PLAYER ? 'You' : (agents[id]?.name ?? '?');
  };
  const left = v.you ?? 'west';
  const right = left === 'west' ? 'east' : 'west';
  const status = pongStatus(v, name, waited);
  return (
    <>
      <div className="hud-pong" aria-live="polite">
        <div className="hud-pong-score">
          <span className={v.server === left && v.phase !== 'over' ? 'hud-pong-serving' : ''}>{name(left)}</span>
          <b>{v.score[left]}</b>
          <i>:</i>
          <b>{v.score[right]}</b>
          <span className={v.server === right && v.phase !== 'over' ? 'hud-pong-serving' : ''}>{name(right)}</span>
        </div>
        {status && <div className="hud-pong-status">{status}</div>}
      </div>
      <div className="hud-hint hud-pong-keys">
        <kbd>Mouse</kbd> paddle (up: towards the net) · swing through for pace and spin · <kbd>Click</kbd> / <Key action="throw" /> serve · <Key action="drop" /> / <kbd>Esc</kbd> leave
      </div>
    </>
  );
}
