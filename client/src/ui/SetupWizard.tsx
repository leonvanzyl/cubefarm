import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { requestLook } from '../world/Player';
import { CEO_ID, type RepoView } from '../../../shared/types';
import { Key } from './Key';
import { ProjectPicker } from './ProjectPicker';

// First run: who you are, the company, your CEO and your first project. Every field has a default, so
// "Skip" (or just pressing Next) gets a working office.

const COMPANIES = ['Pixel & Pine', 'Byte Bakery', 'Night Owl Software', 'Tiny Rocket Co.', 'Moonbeam Works', 'Happy Path Inc.', 'Merge Conflict Ltd.', 'Quokka Labs', 'Blue Kettle Studio', 'Paper Plane Software'];
const CEO_NAMES = ['Morgan', 'Avery', 'Jordan', 'Riley', 'Quinn', 'Harper', 'Rowan', 'Sasha', 'Casey', 'Jamie', 'Alex', 'Robin'];
const TIES = ['#e63946', '#3a86ff', '#06d6a0', '#ffbe0b', '#9b5de5', '#fb5607'];
const STEPS = ['Welcome', 'You', 'Your CEO', 'First project', 'Ready'];

const pickOther = <T,>(list: T[], current: T) => {
  const rest = list.filter((x) => x !== current);
  return rest[Math.floor(Math.random() * rest.length)];
};

/** A little portrait of the CEO in their suit, drawn to match the 3D office. */
function CeoPortrait({ color, look }: { color: string; look: 'feminine' | 'masculine' }) {
  return (
    <svg viewBox="0 0 120 120" className="ceo-portrait" aria-hidden="true">
      <circle cx="60" cy="60" r="58" fill="#e6dcff" stroke="#1f1d2b" strokeWidth="3" />
      {look === 'feminine' && <ellipse cx="60" cy="58" rx="27" ry="32" fill="#2b2118" stroke="#1f1d2b" strokeWidth="2.5" />}
      <path d="M22 118 C24 88 40 80 60 80 C80 80 96 88 98 118 Z" fill="#2b2d42" stroke="#1f1d2b" strokeWidth="3" />
      <path d="M50 81 L60 96 L70 81 Z" fill="#f8f9fa" />
      <path d="M57 84 L63 84 L65 108 L60 113 L55 108 Z" fill={color} stroke="#1f1d2b" strokeWidth="1.5" />
      <circle cx="60" cy="52" r="22" fill="#f1c27d" stroke="#1f1d2b" strokeWidth="3" />
      <path d="M38 50 C38 30 82 30 82 50 C74 40 46 40 38 50 Z" fill="#2b2118" stroke="#1f1d2b" strokeWidth="2" />
      <circle cx="52" cy="54" r="2.6" fill="#1f1d2b" />
      <circle cx="68" cy="54" r="2.6" fill="#1f1d2b" />
      <path d="M53 62 Q60 68 67 62" fill="none" stroke="#1f1d2b" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function SetupWizard() {
  const user = useStore((s) => s.user);
  const demo = useStore((s) => s.demo);
  const ghReady = useStore((s) => s.ghReady);
  const ghError = useStore((s) => s.ghError);
  const ceoAgent = useStore((s) => s.agents[CEO_ID]);
  const maxAgents = useStore((s) => s.settings.maxAgents);
  const start = useStore((s) => s.start);

  const [step, setStep] = useState(0);
  const [managerName, setManagerName] = useState('');
  const [companyName, setCompanyName] = useState(() => COMPANIES[Math.floor(Math.random() * COMPANIES.length)]);
  const [ceoName, setCeoName] = useState(ceoAgent?.name ?? 'Morgan');
  const [ceoLook, setCeoLook] = useState<'feminine' | 'masculine'>(ceoAgent?.look ?? 'masculine');
  const [ceoColor, setCeoColor] = useState(ceoAgent?.color ?? TIES[0]);
  const [scaling, setScaling] = useState<'approve' | 'auto'>('approve');
  const [project, setProject] = useState<RepoView | null>(null);
  const [busy, setBusy] = useState(false);

  const me = managerName.trim() || user || 'Boss';
  const ceo = ceoName.trim() || 'Morgan';
  const company = companyName.trim() || COMPANIES[0];

  const save = () => api.setup({ managerName: me, companyName: company, scaling, ceoName: ceo, ceoLook, ceoColor });
  const finish = async () => {
    setBusy(true);
    try {
      await save();
      await api.updateSettings({ setupDone: true, tutorialStep: 0 });
      start();
      requestLook();
    } catch {
      setBusy(false); // api() already toasted
    }
  };
  const next = async () => {
    if (step === 2) {
      setBusy(true);
      try {
        await save(); // so the CEO already knows everyone's names when they study the first project
      } catch {
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    setStep(step + 1);
  };

  return (
    <div className="start">
      <div className="start-card wizard">
        <div className="wizard-steps">
          {STEPS.map((s, i) => (
            <span key={s} className={`wizard-dot ${i === step ? 'wizard-dot-on' : i < step ? 'wizard-dot-done' : ''}`} title={s} />
          ))}
        </div>

        {step === 0 && (
          <>
            <div className="start-logo">✻</div>
            <h1>cubefarm</h1>
            <p className="start-tag">Your own cartoon software company, staffed by AI coding agents.</p>
            <ul className="start-list">
              <li>🏢 Every project gets its own floor, with a team of coding agents building and testing its GitHub issues.</li>
              <li>🧠 A CEO studies each project, plans the work you ask for and sizes each team. You approve every new agent.</li>
              <li>📱 Your phone keeps you in the loop from anywhere in the building.</li>
            </ul>
            {!ghReady && ghError && <div className="term-error small">⚠️ {ghError}</div>}
            <button className="btn btn-big" onClick={() => setStep(1)}>
              Let's set up your company
            </button>
            <div className="start-meta">
              <button className="linkish" onClick={finish} disabled={busy}>
                Skip setup and use the defaults
              </button>
              {demo && <span className="pill pill-demo">DEMO MODE</span>}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="wizard-icon">🧑‍💼</div>
            <h2>Who's the boss?</h2>
            <p className="start-tag">That's you. You run the company; the agents do the typing.</p>
            <label className="field">
              <span>Your name</span>
              <input value={managerName} onChange={(e) => setManagerName(e.target.value)} placeholder={user ?? 'Boss'} autoFocus />
            </label>
            <label className="field">
              <span>Company name</span>
              <div className="row" style={{ margin: 0 }}>
                <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder={COMPANIES[0]} />
                <button type="button" className="btn btn-small" title="Suggest another name" onClick={() => setCompanyName(pickOther(COMPANIES, companyName))}>
                  🎲
                </button>
              </div>
            </label>
            <p className="muted small">It goes on the sign in the lobby. Change either any time in the manager's console.</p>
          </>
        )}

        {step === 2 && (
          <>
            <h2>Meet your CEO</h2>
            <div className="ceo-setup">
              <CeoPortrait color={ceoColor} look={ceoLook} />
              <div className="grow">
                <label className="field">
                  <span>Name</span>
                  <div className="row" style={{ margin: 0 }}>
                    <input value={ceoName} onChange={(e) => setCeoName(e.target.value)} placeholder="Morgan" autoFocus />
                    <button type="button" className="btn btn-small" title="Suggest another name" onClick={() => setCeoName(pickOther(CEO_NAMES, ceoName))}>
                      🎲
                    </button>
                  </div>
                </label>
                <div className="row">
                  <label className="toggle">
                    <input type="radio" checked={ceoLook === 'feminine'} onChange={() => setCeoLook('feminine')} /> 👩 She
                  </label>
                  <label className="toggle">
                    <input type="radio" checked={ceoLook === 'masculine'} onChange={() => setCeoLook('masculine')} /> 👨 He
                  </label>
                  <span className="spacer" />
                  {TIES.map((c) => (
                    <button key={c} type="button" className={`swatch ${c === ceoColor ? 'swatch-on' : ''}`} style={{ background: c }} onClick={() => setCeoColor(c)} title="Tie colour" />
                  ))}
                </div>
                <div className="muted small">Claude Opus 5.5 at xhigh effort: the thinking-hardest person in the building.</div>
              </div>
            </div>
            <p className="start-tag" style={{ margin: '12px 0 6px' }}>
              {ceo} studies every project, writes its QA checklist, turns the work you ask for into GitHub issues and decides how big each team should be.
            </p>
            <label className="toggle block">
              <input type="radio" checked={scaling === 'approve'} onChange={() => setScaling('approve')} />
              <span>
                <b>Ask me before every team change</b> (recommended). New agents wait in the lobby and on your phone.
              </span>
            </label>
            <label className="toggle block">
              <input type="radio" checked={scaling === 'auto'} onChange={() => setScaling('auto')} />
              <span>
                <b>Let {ceo} change teams</b> on their own, up to {maxAgents} agents per floor.
              </span>
            </label>
          </>
        )}

        {step === 3 && (
          <>
            <h2>Your first project</h2>
            {project ? (
              <div className="wizard-done">
                <div className="wizard-icon">🎉</div>
                <p>
                  <b>{project.fullName}</b> moved into floor {project.floor}.
                </p>
                <p className="muted">
                  {ceo} is studying it right now and will text you when they know how big the team should be. One agent is already at a desk.
                </p>
              </div>
            ) : (
              <>
                <p className="start-tag">Pick one of your project folders, a GitHub repo, or start something new. Every project needs to be on GitHub: issues and pull requests are how the team works.</p>
                <ProjectPicker onConnected={setProject} />
              </>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <div className="wizard-icon">🏢</div>
            <h2>{company} is open for business</h2>
            <ul className="start-list">
              <li>
                🧠 {ceo}{project ? ` is studying ${project.fullName.split('/')[1]}` : ' is waiting for your first project'}.{' '}
                {scaling === 'approve' ? 'Team changes wait for your OK.' : `Team changes up to ${maxAgents} agents per floor go through on their own.`}
              </li>
              <li>
                📱 Press <Key action="phone" /> anywhere for your phone: chat with {ceo}, approve team changes, and see every project at a glance.
              </li>
              <li>
                🧭 A short tour starts when you walk in. Press <Key action="help" /> any time for help.
              </li>
            </ul>
            <button className="btn btn-big" onClick={finish} disabled={busy}>
              {busy ? 'Opening the doors…' : 'Enter the office'}
            </button>
          </>
        )}

        {step > 0 && step < 4 && (
          <div className="wizard-nav">
            <button className="btn btn-ghost" onClick={() => setStep(step - 1)} disabled={busy}>
              ← Back
            </button>
            <span className="spacer" />
            {step === 3 && !project && (
              <button className="linkish" onClick={() => setStep(4)}>
                I'll add one later
              </button>
            )}
            {(step !== 3 || project) && (
              <button className="btn btn-good" onClick={() => void next()} disabled={busy}>
                Next →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
