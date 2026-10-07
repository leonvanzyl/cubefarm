import { Fragment, useEffect, useId, useMemo, useState, type CSSProperties } from 'react';
import { api } from '../api';
import { isBusy, useStore, type Agent } from '../store';
import type { AgentCli, AgentPromptView, CliView, EffortLevel } from '../../../shared/types';
import { ACCENT_COLORS, BUILDS, FACIAL_HAIR, GLASSES, HAIR_COLORS, HAIR_STYLES, HEADWEAR, OUTFITS, SKIN_TONES, type AgentStyle, type HairStyle, type Outfit } from '../../../shared/looks';
import { CLAUDE_MODELS, effectiveModel, modelSuggestions } from '../../../shared/models';
import { TALL_HAIR, appearanceFor, randomStyle } from '../world/appearance';
import { LookPreview } from '../world/LookPreview';
import { workerCli } from './floorRows';

// One agent's setup (name, look, coding agent, model, effort), edited in place: the Team tab's row cells and the
// ⚙️ Setup section of their panel share these. Every change is a PATCH; the `agent` event updates all views.

export const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export const cliName = (clis: CliView[], id: AgentCli) => clis.find((c) => c.id === id)?.label ?? id;

type Patch = Parameters<typeof api.updateAgent>[1];

async function save(id: string, patch: Patch) {
  try {
    await api.updateAgent(id, patch);
  } catch {
    // api() already toasted the error
  }
}

/** The coding agents to pick from, installed ones first, each saying if it's missing on this machine. */
export function CliOptions({ clis }: { clis: CliView[] }) {
  return (
    <>
      {[...clis].sort((a, b) => Number(b.installed) - Number(a.installed)).map((c) => (
        <option key={c.id} value={c.id} disabled={!c.installed}>
          {c.label}
          {c.installed ? '' : ' (not installed)'}
        </option>
      ))}
    </>
  );
}

interface FieldProps {
  agent: Agent;
  id?: string;
  className?: string;
  style?: CSSProperties;
}

export function NameInput({ agent, id, className = 'inline', style }: FieldProps) {
  return (
    <input
      id={id}
      key={`n-${agent.name}`}
      className={className}
      style={style}
      defaultValue={agent.name}
      maxLength={24}
      aria-label={id ? undefined : 'Name'}
      onBlur={(e) => e.target.value.trim() && e.target.value !== agent.name && void save(agent.id, { name: e.target.value })}
    />
  );
}

export function CliSelect({ agent, id, style }: FieldProps) {
  const settings = useStore((s) => s.settings);
  const clis = useStore((s) => s.clis);
  return (
    <select id={id} value={agent.cli} title="Their coding agent" aria-label={id ? undefined : 'Coding agent'} style={style} onChange={(e) => void save(agent.id, { cli: e.target.value as AgentCli | '' })}>
      <option value="">{cliName(clis, settings.defaultCli)} (default)</option>
      <CliOptions clis={clis} />
    </select>
  );
}

export function ModelInput({ agent, id, className = 'inline', style }: FieldProps) {
  const settings = useStore((s) => s.settings);
  const listId = useId();
  const cli = workerCli(agent, settings);
  return (
    <>
      <input
        id={id}
        key={`m-${agent.model}-${cli}`}
        className={className}
        style={style}
        list={listId}
        defaultValue={agent.model}
        placeholder={(agent.role === 'ceo' ? CLAUDE_MODELS[0] : effectiveModel('', cli, settings, CLAUDE_MODELS[0])) || 'agent default'}
        title={agent.role === 'ceo' ? "The CEO's model" : "Their model ('' = the default for their coding agent)"}
        aria-label={id ? undefined : 'Model'}
        onBlur={(e) => e.target.value !== agent.model && void save(agent.id, { model: e.target.value })}
      />
      <datalist id={listId}>
        {modelSuggestions(cli).map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </>
  );
}

export function EffortSelect({ agent, id, style }: FieldProps) {
  const defaultEffort = useStore((s) => s.settings.defaultEffort);
  return (
    <select id={id} value={agent.effort} title={agent.role === 'ceo' ? "The CEO's effort" : 'Their effort'} aria-label={id ? undefined : 'Effort'} style={style} onChange={(e) => void save(agent.id, { effort: e.target.value as EffortLevel | '' })}>
      {(agent.role !== 'ceo' || !agent.effort) && <option value="">default ({defaultEffort})</option>}
      {EFFORTS.map((x) => (
        <option key={x} value={x}>
          {x}
        </option>
      ))}
    </select>
  );
}

export function LookSelect({ agent, id }: FieldProps) {
  return (
    <select id={id} value={agent.look} title="Character look" aria-label={id ? undefined : 'Drawn as'} style={{ width: 'auto' }} onChange={(e) => void save(agent.id, { look: e.target.value as 'feminine' | 'masculine' })}>
      <option value="feminine">👩 She</option>
      <option value="masculine">👨 He</option>
    </select>
  );
}

const HAIR_LABEL: Record<HairStyle, string> = {
  crop: 'Short crop',
  long: 'Long',
  ponytail: 'Ponytail',
  bun: 'Bun',
  quiff: 'Quiff',
  afro: 'Afro',
  sidePart: 'Side part',
  buzz: 'Buzz cut',
  bald: 'Bald',
  curls: 'Curls',
  bob: 'Bob',
  mohawk: 'Mohawk',
  locs: 'Locs',
};
const OUTFIT_LABEL: Record<Outfit, string> = { tee: 'T-shirt', hoodie: 'Hoodie', stripe: 'Striped tee', sweater: 'Sweater', cardigan: 'Cardigan', turtleneck: 'Turtleneck' };
const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

function Swatches({ label, colors, value, onPick }: { label: string; colors: readonly string[]; value: string; onPick: (c: string) => void }) {
  const all = colors.includes(value) ? colors : [value, ...colors];
  return (
    <div className="field">
      <span>{label}</span>
      <div className="swatches" role="radiogroup" aria-label={label}>
        {all.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={c === value} aria-label={c} title={c} className={`swatch ${c === value ? 'swatch-on' : ''}`} style={{ background: c }} onClick={() => onPick(c)} />
        ))}
      </div>
    </div>
  );
}

function PickSelect<T extends string>({ label, value, options, labels, onPick, disabled, title }: { label: string; value: T; options: readonly T[]; labels?: Record<T, string>; onPick: (v: T) => void; disabled?: boolean; title?: string }) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} disabled={disabled} title={title} onChange={(e) => onPick(e.target.value as T)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {labels?.[o] ?? capital(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * How they're drawn: a live 3D preview and the picks, each saved straight onto the agent (agent.style), over the
 * look seeded from their id. Their character in the office follows at once.
 */
export function LookEditor({ agent }: { agent: Agent }) {
  const look = useMemo(() => appearanceFor(agent), [agent]);
  const pick = (patch: AgentStyle) => void save(agent.id, { style: { ...agent.style, ...patch } });
  const tall = TALL_HAIR.includes(look.hair);
  return (
    <fieldset className="look-editor">
      <legend>Look</legend>
      <div className="look-body">
        <LookPreview id={agent.id} label={`${agent.name} as they'll look`} />
        <div className="look-fields">
          <PickSelect label="Hair" value={look.hair} options={HAIR_STYLES} labels={HAIR_LABEL} onPick={(hair) => pick({ hair })} />
          <PickSelect label="Facial hair" value={look.facialHair} options={FACIAL_HAIR} onPick={(facialHair) => pick({ facialHair })} />
          <PickSelect label="Glasses" value={look.glasses} options={GLASSES} onPick={(glasses) => pick({ glasses })} />
          <PickSelect
            label="Headwear"
            value={look.headwear}
            options={HEADWEAR}
            disabled={tall}
            title={tall ? `A hat doesn't fit over ${HAIR_LABEL[look.hair].toLowerCase()} hair` : undefined}
            onPick={(headwear) => pick({ headwear })}
          />
          {agent.role === 'ceo' ? (
            <div className="field">
              <span>Outfit</span>
              <span className="muted small">Blazer and lanyard (uniform)</span>
            </div>
          ) : (
            <PickSelect label="Outfit" value={look.outfit} options={OUTFITS} labels={OUTFIT_LABEL} onPick={(outfit) => pick({ outfit })} />
          )}
          <PickSelect label="Build" value={look.build} options={BUILDS} onPick={(build) => pick({ build })} />
          <Swatches label="Hair colour" colors={HAIR_COLORS} value={look.hairColor} onPick={(hairColor) => pick({ hairColor })} />
          <Swatches label="Skin tone" colors={SKIN_TONES} value={look.skin} onPick={(skin) => pick({ skin })} />
          <Swatches label="Accent colour" colors={ACCENT_COLORS} value={ACCENT_COLORS[look.accent]} onPick={(c) => pick({ accent: ACCENT_COLORS.indexOf(c as (typeof ACCENT_COLORS)[number]) })} />
        </div>
      </div>
      <div className="row wrap">
        <button type="button" className="btn btn-small" onClick={() => void save(agent.id, { style: randomStyle(agent) })}>
          🎲 Shuffle
        </button>
        <button type="button" className="btn btn-small btn-ghost" disabled={!agent.style} onClick={() => void save(agent.id, { style: null })}>
          ↺ Back to their seeded look
        </button>
        <span className="muted small">Accent: glasses frames, hats and the stripe.</span>
      </div>
    </fieldset>
  );
}

/**
 * "What they're told": what the office gives them on each kind of task (the CEO: its one prompt), read-only, with
 * <placeholders> for each task's details. Fetched when opened and again whenever something in it changes.
 */
export function PromptPreview({ agent }: { agent: Agent }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState<AgentPromptView | null>(null);
  const [failed, setFailed] = useState(false);
  // The floor's (or, for the CEO, the office's) settings that appear in the prompt: changing one refreshes it.
  const context = useStore((s) => {
    const r = s.repos.find((x) => x.id === agent.repoId);
    const o = s.settings;
    return JSON.stringify(r ? [r.fullName, r.defaultBranch, r.autoMerge, r.browserTesting, r.links, r.mission, r.summary, r.qaBrief] : [o.companyName, o.managerName, o.sessionLimit, o.maxAgents, o.scaling]);
  });
  useEffect(() => {
    if (!open) return;
    let live = true;
    api.agentPrompt(agent.id).then(
      (p) => {
        if (!live) return;
        setPrompt(p);
        setFailed(false);
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [open, agent.id, agent.name, context]);
  return (
    <details className="prompt-preview" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>What they're told</summary>
      {failed && !prompt && <p className="muted small">Couldn't load their prompt.</p>}
      {!prompt && !failed && <p className="muted small">Loading…</p>}
      {prompt && (
        <>
          <p className="muted small">
            {prompt.kind === 'ceo'
              ? "The CEO's instructions for every job. They're all the office's own."
              : "The office's workflow and safety rules for each kind of task, the same for every agent and sent with every session; <placeholders> are filled in per task."}
          </p>
          {prompt.parts.map((p) => (
            <Fragment key={p.label}>
              <p className="small">
                <b>{p.label}</b> <span className="muted">· {p.text.length.toLocaleString()} characters</span>
              </p>
              <pre className="prompt-text" tabIndex={0} aria-label={`${agent.name}'s prompt: ${p.label}`}>
                {p.text}
              </pre>
            </Fragment>
          ))}
        </>
      )}
    </details>
  );
}

/** The ⚙️ Setup section of an agent's panel. The CEO always runs Claude Code, so they only get model and effort. */
export function AgentSetup({ agent }: { agent: Agent }) {
  const terminal = useStore((s) => s.settings.runtime === 'terminal');
  const id = useId();
  const ceo = agent.role === 'ceo';
  return (
    <section className="card agent-setup" aria-label={`${agent.name}'s setup`}>
      <div className="row wrap">
        <h3 className="grow">⚙️ Setup</h3>
        {isBusy(agent) && (
          <span className="chip chip-warn" role="status">
            Applies from their next task
          </span>
        )}
      </div>
      <div className="setup-grid">
        {!ceo && (
          <label className="field" htmlFor={`${id}-name`}>
            <span>Name</span>
            <NameInput agent={agent} id={`${id}-name`} className="" />
          </label>
        )}
        {!ceo && (
          <label className="field" htmlFor={`${id}-look`}>
            <span>Drawn as</span>
            <LookSelect agent={agent} id={`${id}-look`} />
          </label>
        )}
        {!ceo && terminal && (
          <label className="field" htmlFor={`${id}-cli`}>
            <span>Coding agent</span>
            <CliSelect agent={agent} id={`${id}-cli`} />
          </label>
        )}
        <label className="field" htmlFor={`${id}-model`}>
          <span>Model</span>
          <ModelInput agent={agent} id={`${id}-model`} className="" />
        </label>
        <label className="field" htmlFor={`${id}-effort`}>
          <span>Effort</span>
          <EffortSelect agent={agent} id={`${id}-effort`} />
        </label>
      </div>
      <LookEditor agent={agent} />
      <PromptPreview agent={agent} />
      <p className="muted small">Name and model save when you leave them; the rest, and looks, as you pick them. Running sessions aren't restarted.</p>
    </section>
  );
}
