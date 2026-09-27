import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { CEO_ID } from '../../../shared/types';

// The first-run tour: a coach card in the corner that moves on by itself as you try each thing,
// with Next and Skip always there. Progress lives in settings.tutorialStep, so a refresh resumes it.

type S = ReturnType<typeof useStore.getState>;

interface Ctx {
  ceo: string;
  company: string;
  repo: string | null; // first project's short name
}

interface Step {
  title: string;
  body: (c: Ctx) => ReactNode;
  done?: (s: S) => boolean;
  minMs?: number; // show at least this long before a done() can move on
}

const STEPS: Step[] = [
  {
    title: 'Look around',
    body: () => (
      <>
        Click the view to grab the mouse and look around, then walk with <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>. Hold <kbd>Shift</kbd> to run. <kbd>Esc</kbd> gives you the mouse back.
      </>
    ),
    done: (s) => s.locked,
    minMs: 5000,
  },
  {
    title: 'Pull out your phone',
    body: (c) => (
      <>
        Press <kbd>P</kbd>. Your phone is how you talk to {c.ceo} from anywhere in the building.
      </>
    ),
    done: (s) => s.overlay?.kind === 'phone',
  },
  {
    title: 'Your phone',
    body: (c) => (
      <>
        💬 {c.ceo} texts you here, and you can text back. 📄 <b>Hires</b> shows candidates waiting for your OK. 📊 <b>Company</b> is every project at a glance. Put it away with <kbd>P</kbd>.
      </>
    ),
    done: (s) => s.overlay?.kind !== 'phone',
    minMs: 2500,
  },
  {
    title: 'Visit the CEO',
    body: (c) => (
      <>
        {c.ceo}'s corner office is at the back right of the lobby, under the purple sign. Walk in and press <kbd>E</kbd> or click the desk to see what {c.ceo} is up to.
      </>
    ),
    done: (s) => (s.overlay?.kind === 'terminal' && s.overlay.agentId === CEO_ID) || (s.overlay?.kind === 'manager' && s.overlay.tab === 'ceo'),
  },
  {
    title: 'Candidates',
    body: (c) => (
      <>
        When {c.ceo} wants to hire someone, the candidate waits on the green chairs along the east wall. Press <kbd>E</kbd> or click them to read their resume, then hire or decline. It all works from your phone too.
      </>
    ),
    done: (s) => s.requests.some((r) => r.status !== 'pending' && r.decidedBy === 'manager'),
  },
  {
    title: 'Go upstairs',
    body: (c) =>
      c.repo ? (
        <>
          {c.repo} has its own floor. Walk into the elevator in the middle of the south wall, or press <kbd>E</kbd> or click the directory beside it.
        </>
      ) : (
        <>
          Every project gets its own floor. Add one in your office (the glass room at the back left), then take the elevator in the middle of the south wall.
        </>
      ),
    done: (s) => s.floor > 0,
  },
  {
    title: 'The whiteboard',
    body: () => (
      <>
        The whiteboard at the front of every floor is its Kanban board. Press <kbd>E</kbd> or click it to hand out issues, send pull requests to QA and merge them.
      </>
    ),
    done: (s) => s.overlay?.kind === 'kanban',
  },
  {
    title: 'Watch the team',
    body: () => (
      <>
        Walk up behind anyone to watch their screen, or press <kbd>E</kbd> or click a desk for their full terminal. The testers in lab coats along the east wall check every pull request before you merge.
      </>
    ),
    done: (s) => s.overlay?.kind === 'terminal' && s.overlay.agentId !== CEO_ID,
  },
  {
    title: 'Your office',
    body: (c) => (
      <>
        Your glass office in the lobby (back left) has the manager's console: projects, the team, and the CEO's settings. Press <kbd>H</kbd> any time for help. Enjoy running {c.company}!
      </>
    ),
  },
];

export function Tutorial() {
  const step = useStore((s) => s.settings.tutorialStep);
  const setupDone = useStore((s) => s.settings.setupDone);
  const started = useStore((s) => s.started);
  const company = useStore((s) => s.settings.companyName);
  const ceo = useStore((s) => s.agents[CEO_ID]?.name ?? 'the CEO');
  const repo = useStore((s) => s.repos[0]?.fullName.split('/')[1] ?? null);
  const [cheer, setCheer] = useState(false);
  const moving = useRef(false);
  const shownAt = useRef(Date.now());

  const active = started && setupDone && step >= 0 && step < STEPS.length;
  const go = (to: number) => {
    if (moving.current) return;
    moving.current = true;
    void api
      .updateSettings({ tutorialStep: to >= STEPS.length ? -1 : to })
      .catch(() => undefined)
      .finally(() => {
        moving.current = false;
        setCheer(false);
      });
  };

  useEffect(() => {
    shownAt.current = Date.now();
    setCheer(false);
  }, [step]);

  // Move on by itself once the thing the step asks for has happened.
  useEffect(() => {
    if (!active) return;
    const s = STEPS[step];
    if (!s.done) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      if (timer || moving.current) return;
      const st = useStore.getState();
      if (!s.done!(st)) return;
      const wait = Math.max(0, (s.minMs ?? 0) - (Date.now() - shownAt.current));
      timer = setTimeout(() => {
        if (!s.done!(useStore.getState())) {
          timer = null;
          return;
        }
        setCheer(true);
        timer = setTimeout(() => go(step + 1), 900);
      }, wait);
    };
    check();
    const unsub = useStore.subscribe(check);
    const poll = setInterval(check, 1000); // locked / minMs can flip without a store change we see
    return () => {
      unsub();
      clearInterval(poll);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, step]);

  if (!active) return null;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  return (
    <div className={`tour ${cheer ? 'tour-cheer' : ''}`}>
      <div className="tour-head">
        <span className="tour-count">
          🧭 Tour · {step + 1}/{STEPS.length}
        </span>
        <span className="spacer" />
        <button className="linkish small" onClick={() => go(STEPS.length)}>
          Skip tour
        </button>
      </div>
      <div className="tour-title">{cheer ? `✅ ${s.title}` : s.title}</div>
      <div className="tour-body">{s.body({ ceo, company: company || 'the company', repo })}</div>
      <div className="tour-nav">
        {step > 0 && (
          <button className="btn btn-small btn-ghost" onClick={() => go(step - 1)}>
            ← Back
          </button>
        )}
        <span className="spacer" />
        <button className="btn btn-small btn-good" onClick={() => go(step + 1)}>
          {last ? 'Finish the tour' : s.done ? 'Skip this step' : 'Next →'}
        </button>
      </div>
    </div>
  );
}
