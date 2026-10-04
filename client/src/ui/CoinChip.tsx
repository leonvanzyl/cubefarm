// The HUD's coins (#210): this floor's (the whole office's in the lobby), counting a merge's coins in as they land.
// A merge on another floor plings softly from here; the floor's own coin burst plings where it happens.
import { useEffect, useState } from 'react';
import { repoOnFloor, useStore } from '../store';
import { pling, watchCoffees } from '../world/decor/actions';
import { onReward } from '../world/decor/rewards';

const SHOW_MS = 1800;

export function CoinChip() {
  const coins = useStore((s) => {
    const repo = s.floor === 0 ? null : repoOnFloor(s.repos, s.floor);
    return repo ? (s.progress.floors[repo.id]?.coins ?? 0) : Object.values(s.progress.floors).reduce((n, f) => n + f.coins, 0);
  });
  const openOverlay = useStore((s) => s.openOverlay);
  const [gain, setGain] = useState<{ n: number; at: number } | null>(null);
  useEffect(() => watchCoffees(), []);
  useEffect(
    () =>
      onReward((r) => {
        const s = useStore.getState();
        const here = s.floor === 0 ? null : repoOnFloor(s.repos, s.floor);
        if (here?.id !== r.repoId) pling(undefined, 0.45);
        if (!here || here.id === r.repoId) setGain({ n: r.coins, at: Date.now() });
      }),
    [],
  );
  useEffect(() => {
    if (!gain) return;
    const t = setTimeout(() => setGain(null), SHOW_MS);
    return () => clearTimeout(t);
  }, [gain]);
  return (
    <button className="pill coin-pill" title="Coins: merges earn them, the lobby kiosk spends them on decorations" onClick={() => openOverlay({ kind: 'catalogue', repoId: repoOnFloor(useStore.getState().repos, useStore.getState().floor)?.id })}>
      🪙 {coins}
      {gain && (
        <span key={gain.at} className="coin-gain">
          +{gain.n}
        </span>
      )}
    </button>
  );
}
