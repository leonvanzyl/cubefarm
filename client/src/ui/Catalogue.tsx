// The lobby kiosk's decoration catalogue (#210): a floor's coins buy decorations for it, which wait in the floor's
// decor box; and the decor box's own panel, to take one out to place, or move or put away what's placed.
import { useState } from 'react';
import { CATALOGUE, COINS, DECOR_SLOTS, priceOf, slotsOfKind, stored, type DecorItem, type DecorKind, type FloorProgressView } from '../../../shared/progress';
import { api } from '../api';
import { useStore } from '../store';
import { carry, decorName, kaching } from '../world/decor/actions';
import { SLOT_NAMES } from '../world/decor/decor';
import { Panel } from './Overlays';

const EMPTY: FloorProgressView = { coins: 0, earned: 0, merges: 0, owned: {}, placed: {}, firstPr: null };

/** How many decorations of a kind the floor owns, against how many slots it has for them. */
function room(floor: FloorProgressView, kind: DecorKind) {
  const owned = CATALOGUE.filter((c) => c.kind === kind).reduce((n, c) => n + (floor.owned[c.id] ?? 0), 0);
  return slotsOfKind(kind) - owned;
}

export function Catalogue({ repoId }: { repoId?: string }) {
  const repos = useStore((s) => s.repos);
  const floors = useStore((s) => s.progress.floors);
  const [pick, setPick] = useState(repoId ?? repos[0]?.id ?? '');
  const [busy, setBusy] = useState<DecorItem | null>(null);
  const repo = repos.find((r) => r.id === pick) ?? repos[0];
  const floor = (repo && floors[repo.id]) || EMPTY;
  const buy = async (item: DecorItem) => {
    if (!repo) return;
    setBusy(item);
    try {
      await api.buyDecor(repo.id, item);
      kaching();
      useStore.getState().pushToast('success', `🛍️ ${decorName(item)} bought for floor ${repo.floor}: it's in the 📦 decor box by their elevator`);
    } catch {
      // api toasted it
    } finally {
      setBusy(null);
    }
  };
  return (
    <Panel title="🛍️ Decoration catalogue" accent={repo?.color} className="catalogue">
      {!repo ? (
        <p className="muted">Connect a repo first: floors earn coins when their PRs merge, and spend them here.</p>
      ) : (
        <>
          <div className="tabs catalogue-floors">
            {repos.map((r) => (
              <button key={r.id} className={`tab ${r.id === repo.id ? 'tab-on' : ''}`} onClick={() => setPick(r.id)} style={{ ['--accent' as string]: r.color }}>
                <span className="floor-badge">{r.floor}</span> {r.fullName.split('/')[1]} · 🪙 {floors[r.id]?.coins ?? 0}
              </button>
            ))}
          </div>
          <div className="catalogue-purse">
            <b className="catalogue-coins">🪙 {floor.coins}</b>
            <span className="muted small">
              {floor.merges} merge{floor.merges === 1 ? '' : 's'} · {floor.earned} earned. A merge pays {COINS.merge}, plus {COINS.firstQa} if QA passed it first time, {COINS.greenCi} for green checks first time and{' '}
              {COINS.streak} for the third merge in an hour.
            </span>
          </div>
          <div className="catalogue-grid">
            {CATALOGUE.map((c) => {
              const owned = floor.owned[c.id] ?? 0;
              const price = priceOf(c.id, owned);
              const full = room(floor, c.kind) <= 0;
              const poor = floor.coins < price;
              return (
                <div key={c.id} className={`catalogue-item ${full || poor ? 'catalogue-off' : ''}`}>
                  <div className="catalogue-icon">{c.icon}</div>
                  <b>{c.name}</b>
                  <div className="muted small">{c.blurb}</div>
                  <div className="small">
                    {owned ? `${owned} owned · ${stored(floor, c.id)} in the box` : <span className="muted">{c.kind === 'wall' ? 'hangs on a wall' : c.kind === 'rug' ? 'lies on the floor' : c.kind === 'big' ? 'needs a big spot' : 'fits a corner'}</span>}
                  </div>
                  <button className="btn btn-small btn-good" disabled={full || poor || busy !== null} onClick={() => void buy(c.id)} title={full ? 'Every spot for this kind of decoration on this floor is spoken for' : poor ? 'Not enough coins yet' : undefined}>
                    {busy === c.id ? '…' : full ? 'No room' : `🪙 ${price}`}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="muted small">
            Bought decorations wait in the floor's 📦 decor box, next to its elevator. Take one out, walk to a glowing spot and press <kbd>E</kbd>: it snaps in. <kbd>E</kbd> on a placed decoration picks it up again; <kbd>G</kbd> puts it back where it was.
          </p>
        </>
      )}
    </Panel>
  );
}

export function DecorBoxPanel({ repoId }: { repoId: string }) {
  const repo = useStore((s) => s.repos.find((r) => r.id === repoId));
  const floor = useStore((s) => s.progress.floors[repoId]) ?? EMPTY;
  const [busy, setBusy] = useState(false);
  if (!repo) return null;
  const inBox = CATALOGUE.filter((c) => stored(floor, c.id) > 0);
  const placed = DECOR_SLOTS.filter((d) => floor.placed[d.id]);
  const putAway = async (slot: string, item: DecorItem) => {
    setBusy(true);
    try {
      await api.placeDecor(repo.id, { item, slot: null, from: slot });
    } catch {
      // api toasted it
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title={`📦 Decor box · floor ${repo.floor}`} accent={repo.color} className="decor-box">
      <h3>In the box</h3>
      {inBox.length === 0 ? (
        <p className="muted small">Nothing in the box. Buy decorations with this floor's coins (🪙 {floor.coins}) at the catalogue kiosk in the lobby.</p>
      ) : (
        <div className="decor-list">
          {inBox.map((c) => (
            <div key={c.id} className="decor-row">
              <span className="catalogue-icon small-icon">{c.icon}</span>
              <span className="grow">
                {c.name} {stored(floor, c.id) > 1 && <span className="muted">×{stored(floor, c.id)}</span>}
              </span>
              <button className="btn btn-small btn-good" onClick={() => carry(c.id, null)}>
                Carry it
              </button>
            </div>
          ))}
        </div>
      )}
      <h3>On the floor</h3>
      {placed.length === 0 ? (
        <p className="muted small">Nothing placed yet.</p>
      ) : (
        <div className="decor-list">
          {placed.map((d) => {
            const item = floor.placed[d.id];
            return (
              <div key={d.id} className="decor-row">
                <span className="catalogue-icon small-icon">{CATALOGUE.find((c) => c.id === item)?.icon}</span>
                <span className="grow">
                  {decorName(item)} <span className="muted small">· {SLOT_NAMES[d.id] ?? d.id}</span>
                </span>
                <button className="btn btn-small" onClick={() => carry(item, d.id)}>
                  Move
                </button>
                <button className="btn btn-small btn-ghost" disabled={busy} onClick={() => void putAway(d.id, item)}>
                  Put away
                </button>
              </div>
            );
          })}
        </div>
      )}
      <p className="muted small">
        Carrying one, glowing spots show where it fits: aim at one and press <kbd>E</kbd>. <kbd>G</kbd> puts it back where it came from.
      </p>
    </Panel>
  );
}
