import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { CEO_ID } from '../../../shared/types';
import { effectiveModel } from '../../../shared/models';
import { Markdown } from './Markdown';
import { closeOverlay } from './Panel';

// A proposal face to face (#227), as an office document: a candidate's interview in the lobby (E on them, world/
// Candidates.tsx), or the CEO's let-go note in the envelope on someone's desk. Hire / Decline (Let go / Keep) are the
// same decisions as the phone's and the console's, with a note the CEO reads. Deciding closes it, so the person's
// reaction plays out in front of you.

export function Interview({ requestId }: { requestId: string }) {
  const req = useStore((s) => s.requests.find((r) => r.id === requestId));
  const repo = useStore((s) => (req ? s.repos.find((r) => r.id === req.repoId) : undefined));
  const settings = useStore((s) => s.settings);
  const ceo = useStore((s) => s.agents[CEO_ID]?.name ?? 'the CEO');
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

  const decide = async (yes: boolean) => {
    if (!req) return;
    setBusy(true);
    try {
      if (yes) await api.approveRequest(req.id, { note: note.trim() });
      else await api.rejectRequest(req.id, note.trim());
      closeOverlay();
    } catch {
      setBusy(false); // api() already toasted why
    }
  };

  const company = settings.companyName || 'cubefarm';
  if (!req) {
    return (
      <div className="overlay interview-overlay" onMouseDown={(e) => e.target === e.currentTarget && closeOverlay()}>
        <div className="doc" role="dialog" aria-label="Interview">
          <div className="doc-head">
            <span>✻ {company} · personnel</span>
          </div>
          <p>This proposal no longer exists.</p>
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
  const floor = repo ? `${repo.floor} · ${repo.fullName.split('/')[1] ?? repo.fullName}` : 'a floor that has gone';
  const model = effectiveModel(req.model, settings.runtime === 'terminal' ? settings.defaultCli : 'claude', settings, 'claude-opus-5-5') || 'default model';
  const role = req.role === 'qa' ? 'QA tester' : 'Developer';
  // The CEO's reason, as the candidate would pitch it.
  const pitch = `Hi, I'm **${req.name}**, and I'd like to join floor ${repo?.floor ?? '?'} as your ${req.title}. ${req.reason}`;
  const stamp = pending ? null : req.status === 'approved' ? (hire ? 'Hired' : 'Let go') : hire ? 'Declined' : 'Kept';

  return (
    <div className="overlay interview-overlay" onMouseDown={(e) => e.target === e.currentTarget && closeOverlay()}>
      <div className={`doc ${hire ? '' : 'doc-letgo'}`} role="dialog" aria-label={hire ? `Interview with ${req.name}` : `Letting ${req.name} go`}>
        <div className="doc-head">
          <span>✻ {company} · personnel</span>
          <span>{hire ? 'Candidate interview' : 'Confidential'}</span>
        </div>
        <div className="doc-who">
          <span className="avatar" style={{ background: req.color, width: 48, height: 48, fontSize: 22 }}>
            {req.name[0]}
          </span>
          <div className="grow">
            <h2 className="doc-title">{hire ? req.name : `Let ${req.name} go?`}</h2>
            <div className="muted">{req.title}</div>
          </div>
          <button className="panel-x" onClick={closeOverlay} aria-label="Close">
            ✕
          </button>
        </div>
        {stamp && <div className={`doc-stamp ${req.status === 'approved' ? 'doc-stamp-good' : 'doc-stamp-bad'}`}>{stamp}</div>}
        <dl className="doc-fields">
          <dt>Position</dt>
          <dd>
            {req.title} <span className="muted">({role})</span>
          </dd>
          <dt>Specialty</dt>
          <dd>{req.specialty ? <code>swarm:{req.specialty}</code> : <span className="muted">generalist</span>}</dd>
          <dt>Floor</dt>
          <dd>{floor}</dd>
          <dt>Model</dt>
          <dd>
            {model} · {req.effort || settings.defaultEffort} effort
          </dd>
        </dl>
        {hire ? (
          <>
            <h3 className="doc-h">In their own words</h3>
            <Markdown className="doc-pitch" text={pitch} />
            <div className="doc-sign">Referred by {ceo}, CEO</div>
            {req.brief && (
              <>
                <h3 className="doc-h">Job description</h3>
                <Markdown className="doc-brief" text={req.brief} />
              </>
            )}
          </>
        ) : (
          <>
            <h3 className="doc-h">{ceo}'s note</h3>
            <Markdown className="doc-pitch" text={req.reason || 'No reason given.'} />
            <div className="doc-sign">— {ceo}, CEO</div>
          </>
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
              placeholder={hire ? `Optional: why, or what ${req.name} should start with. ${ceo} reads it.` : `Optional: why. ${ceo} reads it.`}
              aria-label="Your note for the CEO"
            />
            <div className="doc-actions">
              <button className="btn btn-bad" disabled={busy} onClick={() => void decide(false)}>
                {hire ? 'Decline' : 'Keep them'}
              </button>
              <span className="spacer" />
              <button className="btn btn-good" disabled={busy} onClick={() => void decide(true)}>
                {hire ? `Hire ${req.name}` : `Let ${req.name} go`}
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
