import { useEffect, useState, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { EMOTE_EMOJI, EMOTE_LABEL } from '../../../shared/presence';
import type { EmoteId } from '../../../shared/types';
import { useStore } from '../store';
import { photoActive } from '../photo/gate';
import { cameraMode } from '../world/camera/rig';
import { emote, myLastEmote, presenceVersion, subscribePresence } from '../world/presence/presenceState';
import { EMOTE_MS, WHEEL, wheelPick, wheelSpot } from '../world/presence/presenceMath';
import { isConfirmOpen } from './Confirm';
import { isKey, useKeyName } from './controls';

// The social bits of shared presence on the HUD: the emote wheel (hold its key, T unless rebound: point and let go; a
// quick tap waves; 1–5 pick straight away) and your own emote popping up, so you know it went.

const TAP_MS = 250;
const RADIUS = 92;

interface Wheel {
  open: boolean;
  pick: EmoteId | null;
}

const useWheel = create<Wheel>(() => ({ open: false, pick: null }));
const drag = { x: 0, y: 0, at: 0 };

function ready() {
  const s = useStore.getState();
  return s.started && !s.overlay && !s.travel && !s.replaying && cameraMode() === 'first' && !photoActive() && !isConfirmOpen();
}

const typing = (e: Event) => !!(e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');

function close(play: EmoteId | null) {
  if (!useWheel.getState().open) return;
  useWheel.setState({ open: false, pick: null });
  if (play) emote(play);
}

/** Listens for the emote key while you're on foot in the office. */
function useWheelKeys() {
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const w = useWheel.getState();
      if (w.open && /^Digit[1-5]$/.test(e.code)) {
        e.preventDefault();
        close(WHEEL[Number(e.code.slice(5)) - 1]);
        return;
      }
      if (!isKey('emote', e.code) || e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e) || !ready()) return;
      drag.x = drag.y = 0;
      drag.at = performance.now();
      useWheel.setState({ open: true, pick: null });
    };
    const onUp = (e: KeyboardEvent) => {
      if (!isKey('emote', e.code)) return;
      const { open, pick } = useWheel.getState();
      if (!open) return;
      close(pick ?? (performance.now() - drag.at < TAP_MS ? 'wave' : null));
    };
    // While the wheel is open the mouse points at a slice instead of turning your head: caught before Player.tsx.
    const onMove = (e: MouseEvent) => {
      if (!useWheel.getState().open) return;
      if (document.pointerLockElement) {
        e.stopPropagation();
        drag.x += e.movementX;
        drag.y += e.movementY;
        const len = Math.hypot(drag.x, drag.y);
        if (len > RADIUS) {
          drag.x *= RADIUS / len;
          drag.y *= RADIUS / len;
        }
      } else {
        drag.x = e.clientX - window.innerWidth / 2;
        drag.y = e.clientY - window.innerHeight / 2;
      }
      const pick = wheelPick(drag.x, drag.y);
      if (pick !== useWheel.getState().pick) useWheel.setState({ pick });
    };
    const onBlur = () => close(null);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('blur', onBlur);
    const unsub = useStore.subscribe((s) => {
      if (s.overlay || s.travel) close(null);
    });
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('blur', onBlur);
      unsub();
    };
  }, []);
}

function EmoteWheel() {
  const { open, pick } = useWheel();
  const key = useKeyName('emote');
  if (!open) return null;
  return (
    <div className="emote-wheel" role="menu" aria-label="Emotes">
      <div className="emote-hub">{pick ? EMOTE_LABEL[pick] : `Point, then let go of ${key}`}</div>
      {WHEEL.map((e, i) => {
        const at = wheelSpot(i, RADIUS);
        return (
          <button
            key={e}
            role="menuitem"
            className={`emote-slice ${pick === e ? 'emote-on' : ''}`}
            style={{ transform: `translate(${at.x}px, ${at.y}px)` }}
            onMouseEnter={() => useWheel.setState({ pick: e })}
            onClick={() => close(e)}
            title={`${EMOTE_LABEL[e]} (${i + 1})`}
          >
            <span className="emote-emoji">{EMOTE_EMOJI[e]}</span>
            <kbd>{i + 1}</kbd>
          </button>
        );
      })}
    </div>
  );
}

/** Your own emote, for a moment: you can't see yourself wave. */
function MyEmote() {
  useSyncExternalStore(subscribePresence, presenceVersion);
  const mine = myLastEmote();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!mine) return;
    const t = setTimeout(() => tick((n) => n + 1), Math.max(0, EMOTE_MS - (performance.now() - mine.at)) + 20);
    return () => clearTimeout(t);
  }, [mine]);
  if (!mine || performance.now() - mine.at > EMOTE_MS) return null;
  return (
    <div className="my-emote" key={mine.at} aria-live="polite">
      {EMOTE_EMOJI[mine.e]} <span>{EMOTE_LABEL[mine.e]}</span>
    </div>
  );
}

export function PresenceHud() {
  useWheelKeys();
  const started = useStore((s) => s.started);
  if (!started) return null;
  return (
    <>
      <EmoteWheel />
      <MyEmote />
    </>
  );
}
