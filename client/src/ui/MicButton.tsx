import { useEffect, useId, useRef } from 'react';
import { useStore } from '../store';
import { finishListening, keepListening, listen, micProblem, registerTarget, stopListening, useMic, type MicTarget, type MicView } from './mic';
import { TAP_MS } from './micKeys';
import { useKeyName } from './controls';

// The 🎙 next to a message box's Send (mic.ts does the listening). Hold it (or V) to talk; a quick tap listens until
// you stop talking; tap again to finish. The live transcript goes into the box, to edit before sending. Put it in the
// box's <form>: sending by hand stops the listening, and V talks while the caret is in that form's box.

/** What the bubble over the 🎙 says. */
function statusLine(view: MicView, mine: boolean, chiming: boolean): string {
  if (!mine) return chiming ? '🎧 Listening in a moment…' : '';
  if (view.state === 'transcribing') return 'Turning your words into text…';
  if (view.state !== 'listening') return '';
  if (!view.live) return 'Starting the mic…';
  if (view.mode === 'handsfree') return '🎧 Listening… just talk';
  return view.mode === 'tap' ? 'Listening… stop talking or tap 🎙️ to finish' : 'Listening… let go to finish';
}

interface Props {
  kind: MicTarget['kind'];
  value: string;
  onChange: (text: string) => void;
  /** Sends `text` (auto-send and the hands-free phone; Send itself stays the form's). */
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function MicButton({ kind, value, onChange, onSend, disabled }: Props) {
  const id = useId();
  const ref = useRef<HTMLButtonElement>(null);
  const latest = useRef({ value, onChange, onSend, disabled });
  latest.current = { value, onChange, onSend, disabled };
  const provider = useStore((s) => s.settings.listen?.provider ?? 'off');
  useStore((s) => s.voiceKeySet); // re-render when the key comes or goes: it changes micProblem()
  const mic = useMic();
  const press = useRef<number | null>(null);
  const talkKey = useKeyName('talk');

  useEffect(
    () =>
      registerTarget({
        id,
        kind,
        form: () => ref.current?.form ?? null,
        text: () => latest.current.value,
        setText: (t) => latest.current.onChange(t),
        send: (t) => latest.current.onSend(t),
        disabled: () => !!latest.current.disabled,
      }),
    [id, kind, provider],
  );
  // A message sent by hand ends the listening in its box, so late words don't refill it.
  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const onSubmit = () => stopListening(id);
    form.addEventListener('submit', onSubmit, true);
    return () => form.removeEventListener('submit', onSubmit, true);
  }, [id, provider]);
  useEffect(() => {
    if (disabled) stopListening(id);
  }, [disabled, id]);

  if (provider === 'off') return null;
  const why = micProblem();
  const mine = mic.target === id;
  const state = mine ? mic.state : 'idle';
  const on = state === 'listening';
  const warming = on && !mic.live; // pressed, but the mic isn't on yet: don't talk yet
  const chiming = kind === 'phone' && mic.chiming;

  const down = () => {
    if (disabled) return;
    if (why) return listen(id, 'hold'); // says why it can't, in a toast
    if (state === 'listening' || state === 'transcribing') return finishListening(id); // a tap while listening ends it
    press.current = performance.now();
    listen(id, 'hold');
  };
  const up = () => {
    const at = press.current;
    press.current = null;
    if (at === null) return;
    if (performance.now() - at < TAP_MS) keepListening(id);
    else finishListening(id);
  };

  const status = statusLine(mic, mine, chiming);
  const title = why || (on ? 'Listening: Esc stops' : `Hold to talk (or hold ${talkKey}); tap to talk until you stop`);

  return (
    <span className="mic">
      {status && (
        <span className="mic-status small" role="status">
          {status}
          {on && !warming && (
            <>
              {' '}
              · <kbd>Esc</kbd>
            </>
          )}
        </span>
      )}
      <button
        type="button"
        ref={ref}
        className={`mic-btn ${(on && !warming) || chiming ? 'mic-on' : ''} ${warming || state === 'transcribing' ? 'mic-busy' : ''} ${why ? 'mic-cant' : ''}`}
        aria-label={on ? 'Stop listening' : 'Talk instead of type'}
        aria-pressed={on}
        title={title}
        disabled={disabled}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault(); // the caret stays in the message box
          e.currentTarget.setPointerCapture?.(e.pointerId);
          down();
        }}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={(e) => {
          if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
            e.preventDefault();
            down();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            up();
          }
        }}
      >
        {state === 'transcribing' ? '⏳' : '🎙️'}
      </button>
    </span>
  );
}
