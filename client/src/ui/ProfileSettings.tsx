// The Settings tab's Profile section: how you appear to everyone else viewing the office (shared presence). Saved in
// this browser only; the server cleans the name again before anyone sees it.
import { NAME_MAX, VISITOR_COLORS } from '../../../shared/presence';
import { useProfile } from '../world/presence/profile';

export function ProfileSettings() {
  const { name, color, appear, set } = useProfile();
  return (
    <div className="card">
      <h3>👤 Profile</h3>
      <p className="muted small">Everyone else with the office open sees you walk about as a visitor, with this name and colour on your tag and lanyard. Each browser is its own visitor.</p>
      <label className="field">
        <span>Your name</span>
        <input
          key={name}
          defaultValue={name}
          maxLength={NAME_MAX}
          placeholder="Visitor"
          onBlur={(e) => e.target.value !== name && set({ name: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </label>
      <div className="field">
        <span>Your colour</span>
        <div className="row wrap">
          {VISITOR_COLORS.map((c) => (
            <button key={c} type="button" className={`swatch ${c === color ? 'swatch-on' : ''}`} style={{ background: c }} onClick={() => set({ color: c })} title={c} aria-label={`Colour ${c}`} />
          ))}
          <input type="color" value={color} onChange={(e) => set({ color: e.target.value })} title="Any colour" aria-label="Any colour" />
        </div>
      </div>
      <label className="toggle block">
        <input type="checkbox" checked={appear} onChange={(e) => set({ appear: e.target.checked })} />
        <span>
          <b>Appear to others</b>: off, you still see everyone, but nobody sees you, your emotes or your pings.
        </span>
      </label>
    </div>
  );
}
