// The office's panel (a titled card over a dimmed backdrop) and closing it. Kept apart from Overlays.tsx, which pulls
// in the 3D world, so pocket mode can open panels without loading it. A panel is a modal dialog for the keyboard and
// screen readers (dialogFocus.ts): focus moves in, stays in, and goes back when it closes.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useStore } from '../store';
import { useDialogFocus } from './dialogFocus';

// Closing a panel grabs the mouse again right away (world/lookLock.ts; "Grab the mouse when panels
// close" in help turns that off), and mouse presses are swallowed for a moment so a double click on
// ✕ or the backdrop can't act on whatever the crosshair lands on.
export function closeOverlay() {
  useStore.getState().openOverlay(null);
}

export function Panel({
  title,
  children,
  wide,
  accent,
  className,
  onClose,
}: {
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
  accent?: string;
  className?: string;
  onClose?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(box);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose ? onClose() : closeOverlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && (onClose ? onClose() : closeOverlay())}>
      <div
        ref={box}
        className={`panel ${wide ? 'panel-wide' : ''} ${className ?? ''}`}
        style={{ ['--accent' as string]: accent ?? '#ff8a5b' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="panel-head">
          <h2 className="panel-title" id={titleId}>
            {title}
          </h2>
          <button className="panel-x" onClick={() => (onClose ? onClose() : closeOverlay())} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="panel-body">{children}</div>
      </div>
    </div>
  );
}
