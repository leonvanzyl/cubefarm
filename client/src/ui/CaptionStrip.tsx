// The captions strip at the bottom of the screen (captions.ts decides what's on it), and the visually hidden live
// regions screen readers hear announcements through (announce.ts). Both are on in the 3D office and in pocket mode.
import { useEffect, useState } from 'react';
import { useA11y } from './a11y';
import { useAnnouncer } from './announce';
import { captionTail } from './captionRules';
import { spokenSoFar, useCaptions } from './captions';

/** About two lines of a spoken message at normal size. */
const SPEECH_CHARS = 140;

function SpeechLine() {
  const speech = useCaptions((s) => s.speech);
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!speech || speech.endedAt !== null) return;
    const t = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(t);
  }, [speech]);
  if (!speech) return null;
  const said = captionTail(speech.text, spokenSoFar(speech, now), SPEECH_CHARS);
  if (!said) return null;
  return (
    <div className="caption caption-speech">
      <b>{speech.who}:</b> {said}
    </div>
  );
}

export function Captions() {
  const on = useA11y((s) => s.prefs.captions);
  const size = useA11y((s) => s.prefs.captionSize);
  const bg = useA11y((s) => s.prefs.captionBg);
  const lines = useCaptions((s) => s.lines);
  if (!on) return null;
  return (
    // Hidden from screen readers: they hear the same things through the live regions, once.
    <div className="captions" aria-hidden style={{ ['--caption-scale' as string]: size / 100, ['--caption-bg' as string]: bg / 100 }}>
      {lines.map((l) => (
        <div key={l.id} className={`caption ${l.priority === 3 ? 'caption-alarm' : ''}`}>
          {l.text}
        </div>
      ))}
      <SpeechLine />
    </div>
  );
}

export function LiveRegions() {
  const polite = useAnnouncer((s) => s.polite);
  const assertive = useAnnouncer((s) => s.assertive);
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
    </>
  );
}
