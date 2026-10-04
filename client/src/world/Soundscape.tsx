import { useEffect } from 'react';
import { useRenderPaused } from '../perf';
import { useStore } from '../store';
import { startRoom, stopRoom } from '../ui/roomSfx';
import { setScoreQuiet, setScoreState, startScore, stopScore } from '../ui/score';
import { officeState } from '../ui/scoreMood';

// The building's soundscape for the floor you're on: its room acoustics (ui/roomSfx.ts) and the adaptive score
// (ui/score.ts), fed what's happening on this floor (the lobby hears every floor). Started with the floor and stopped
// with it; the score is quiet behind a panel or the phone and while the elevator travels, like the jukebox. Set here
// rather than in the frame loop, which stops while the view is paused.

export function Soundscape({ kind, repoId }: { kind: 'office' | 'lobby'; repoId: string | null }) {
  const paused = useRenderPaused();
  const away = useStore((s) => s.travel !== null || s.overlay !== null);
  useEffect(() => setScoreQuiet(paused || away), [paused, away]);
  useEffect(() => {
    startRoom(kind);
    startScore();
    return () => {
      stopRoom();
      stopScore();
    };
  }, [kind]);
  useEffect(() => {
    let last = '';
    const feed = (s: ReturnType<typeof useStore.getState>) => {
      const st = officeState(repoId, s.agents, s.repos, s.qa);
      const key = `${st.working}:${st.red}`;
      if (key === last) return;
      last = key;
      setScoreState(st);
    };
    feed(useStore.getState());
    return useStore.subscribe(feed);
  }, [repoId]);
  return null;
}
