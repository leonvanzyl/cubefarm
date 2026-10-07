import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { CEO_ID } from '../../../shared/types';
import { Markdown } from './Markdown';
import { closeOverlay } from './Panel';
import { HireSetupFields, cliLabel, hireCli, hireOverrides, setupOf, type HireSetup } from './Phone';
import { CLAUDE_MODELS, effectiveModel } from '../../../shared/models';

// A team change face to face (#227), as an office document: a new agent waiting in the lobby (E on them, world/
// Candidates.tsx), set up here before they're created (name, coding agent, model, effort), or the CEO's let-go note in
// the envelope on someone's desk. Hire / Decline (Let go / Keep) are the same decisions as the phone's and the
// console's, with a note the CEO reads. Deciding closes it, so the person's reaction plays out in front of you.

export function Interview({ requestId }: { requestId: string }) {
  const req = useStore((s) => s.requests.find((r) => r.id === requestId));
  const repo = useStore((s) => (req ? s.repos.find((r) => r.id === req.repoId) : undefined));
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  const ceo = useStore((s) => s.agents[CEO_ID]?.name ?? 'the CEO');
  const [edited, setSetup] = useState<HireSetup | null>(null); // null: the CEO's picks, untouched
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      closeOverlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const company = settings.companyName || 'cubefarm';
  if (!req) {
    return (
      <div className="overlay interview-overlay" onMouseDown={(e) => e.target === e.currentTarget && closeOverlay()}>
        <div className="doc" role="dialog" aria-label="Team change">
          <div className="doc-head">
            <span>✻ {company} · personnel</span>
          </div>
          <p>This team change no longer exists.</p>
          <div className="doc-actions">
            <span className="spacer" />
            <button className="btn btn-small" onClick={closeOverlay}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  const hire = req.kind === 'hire';
  const pending = req.status === 'pending';
  const setup = edited ?? setupOf(req);
  const name = (hire && pending && setup.name.trim()) || req.name;
  const floor = repo ? `floor ${repo.floor} · ${repo.fullName.split('/')[1] ?? repo.fullName}` : 'a floor that has gone';
  const stamp = pending ? null : req.status === 'approved' ? (hire ? 'Hired' : 'Let go') : hire ? 'Declined' : 'Kept';
  const cli = hireCli(req.cli, settings);

  const decide = async (yes: boolean) => {
    setBusy(true);
    try {
      if (yes) await api.approveRequest(req.id, { ...(hire ? hireOverrides(req, setup) : {}), note: note.trim() });
      else await api.rejectRequest(req.id, note.trim());
      closeOverlay();
    } catch {
      setBusy(false); // api() already toasted why
    }
  };

  return (
    <div className="overlay interview-overlay" onMouseDown={(e) => e.target === e.currentTarget && closeOverlay()}>
      <div className={`doc ${hire ? '' : 'doc-letgo'}`} role="dialog" aria-label={hire ? `Setting up ${name}` : `Letting ${req.name} go`}>
        <div className="doc-head">
          <span>✻ {company} · personnel</span>
          <span>{hire ? 'New agent' : 'Confidential'}</span>
        </div>
        <div className="doc-who">
          <span className="avatar" style={{ background: req.color, width: 48, height: 48, fontSize: 22 }}>
            {name[0]}
          </span>
          <div className="grow">
            <h2 className="doc-title">{hire ? name : `Let ${req.name} go?`}</h2>
            <div className="muted">{hire ? `Joining ${floor}` : `On ${floor}`}</div>
          </div>
          <button className="panel-x" onClick={closeOverlay} aria-label="Close">
            ✕
          </button>
        </div>
        {stamp && <div className={`doc-stamp ${req.status === 'approved' ? 'doc-stamp-good' : 'doc-stamp-bad'}`}>{stamp}</div>}
        <h3 className="doc-h">{hire ? `Why ${ceo} wants to grow the team` : `${ceo}'s note`}</h3>
        <Markdown className="doc-pitch" text={req.reason || 'No reason given.'} />
        <div className="doc-sign">— {ceo}, CEO</div>
        {hire && <h3 className="doc-h">Their setup</h3>}
        {hire && pending && (
          <>
            <HireSetupFields value={setup} onChange={setSetup} disabled={busy} />
            <p className="muted small doc-tip">Hiring creates {name} and their own machine. You can change these later in their ⚙️ Setup.</p>
          </>
        )}
        {hire && !pending && (
          <dl className="doc-fields">
            <dt>Coding agent</dt>
            <dd>{cliLabel(clis, cli)}</dd>
            <dt>Model</dt>
            <dd>{effectiveModel(req.model, cli, settings, CLAUDE_MODELS[0]) || 'its default model'}</dd>
            <dt>Effort</dt>
            <dd>{req.effort || settings.defaultEffort}</dd>
          </dl>
        )}
        {pending ? (
          <>
            <h3 className="doc-h">Your note</h3>
            <textarea
              className="doc-note"
              rows={2}
              maxLength={400}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={hire ? `Optional: why, or what ${name} should start with. ${ceo} reads it.` : `Optional: why. ${ceo} reads it.`}
              aria-label="Your note for the CEO"
            />
            <div className="doc-actions">
              <button className="btn btn-bad" disabled={busy} onClick={() => void decide(false)}>
                {hire ? 'Decline' : 'Keep them'}
              </button>
              <span className="spacer" />
              <button className="btn btn-good" disabled={busy} onClick={() => void decide(true)}>
                {hire ? `Hire ${name}` : `Let ${req.name} go`}
              </button>
            </div>
          </>
        ) : (
          <div className="doc-actions">
            {req.note && <span className="muted small">Your note: “{req.note}”</span>}
            <span className="spacer" />
            <button className="btn btn-small" onClick={closeOverlay}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
