// The office's panel (a titled card over a dimmed backdrop) and closing it. Kept apart from Overlays.tsx, which pulls
// in the 3D world, so pocket mode can open panels without loading it.
import { useEffect, type ReactNode } from 'react';
import { useStore } from '../store';

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
      <div className={`panel ${wide ? 'panel-wide' : ''} ${className ?? ''}`} style={{ ['--accent' as string]: accent ?? '#ff8a5b' }}>
        <div className="panel-head">
          <div className="panel-title">{title}</div>
          <button className="panel-x" onClick={() => (onClose ? onClose() : closeOverlay())} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="panel-body">{children}</div>
      </div>
    </div>
  );
}
