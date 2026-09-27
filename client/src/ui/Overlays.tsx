import { useEffect, type ReactNode } from 'react';
import { useStore } from '../store';
import { CEO_ID } from '../../../shared/types';
import { ElevatorPanel } from './ElevatorPanel';
import { KanbanView } from './KanbanView';
import { ManagerConsole } from './ManagerConsole';
import { Phone } from './Phone';
import { TerminalView } from './TerminalView';

// Closing a panel leaves the mouse free: the next click on the view only grabs it again, so it
// can't also act on whatever the crosshair lands on.
export function closeOverlay() {
  useStore.getState().openOverlay(null);
}

export function Panel({ title, children, wide, accent, onClose }: { title: ReactNode; children: ReactNode; wide?: boolean; accent?: string; onClose?: () => void }) {
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
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && closeOverlay()}>
      <div className={`panel ${wide ? 'panel-wide' : ''}`} style={{ ['--accent' as string]: accent ?? '#ff8a5b' }}>
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

function Help() {
  return (
    <Panel title="How the office works">
      <div className="help">
        <h3>Moving around</h3>
        <p>
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> walk · <kbd>Shift</kbd> run · mouse to look · <kbd>E</kbd> or left click interacts with whatever the crosshair is on (the first click only grabs the mouse) · <kbd>Esc</kbd> frees the mouse.
        </p>
        <h3>The building</h3>
        <p>
          The ground floor is the lobby: your office is the glass room at the back left, the CEO's corner office is at the back right, and candidates wait on the chairs by the entrance. Every connected GitHub repo gets its own
          floor. Walk into the elevator in the middle of the south wall to travel.
        </p>
        <h3>Your phone</h3>
        <p>
          Press <kbd>P</kbd> anywhere to pull out your phone. Text the CEO, approve or decline the people they want to hire, and see every project at a glance. The red badge counts decisions and messages waiting for you.
        </p>
        <h3>The CEO</h3>
        <p>
          The CEO studies every new floor, writes its QA brief, gives each agent a job that fits the project, turns your project briefs into issues and proposes hires. Hires wait for your approval unless you switch hiring to
          auto in the manager's console.
        </p>
        <h3>Your team</h3>
        <p>
          Each agent is its own Claude Code session (Claude Agent SDK) working in its own git worktree. Walk up behind them to read their laptop, or press <kbd>E</kbd> (or click) on a desk to open the full terminal, send them instructions, stop them or hand them another issue. Aim at an empty desk and press <kbd>E</kbd> to hire, or click it and confirm.
        </p>
        <h3>The QA lab</h3>
        <p>
          The testers in lab coats along the east wall check every pull request before it can be merged. They run the tests, click through the change in a real browser, and post a report with screenshots on the PR. If a PR
          fails, it goes back to the developer who wrote it, who fixes it and sends it back to QA.
        </p>
        <h3>The whiteboard</h3>
        <p>
          <b>Backlog</b>: open issues nobody has picked up. <b>In progress</b>: developers at work. <b>In QA</b>: being tested or fixed. <b>Ready to merge</b>: QA passed, waiting for you. Press <kbd>E</kbd> or click the board to
          assign, send to QA, merge and file new issues.
        </p>
      </div>
    </Panel>
  );
}

export function Overlays() {
  const overlay = useStore((s) => s.overlay);
  if (!overlay) return null;
  switch (overlay.kind) {
    case 'terminal':
      return overlay.agentId === CEO_ID ? <ManagerConsole initialTab="ceo" /> : <TerminalView agentId={overlay.agentId} />;
    case 'phone':
      return <Phone tab={overlay.tab} requestId={overlay.requestId} />;
    case 'kanban':
      return <KanbanView repoId={overlay.repoId} />;
    case 'elevator':
      return <ElevatorPanel />;
    case 'manager':
      return <ManagerConsole initialTab={overlay.tab} initialRepo={overlay.repoId} />;
    case 'help':
      return <Help />;
  }
}
