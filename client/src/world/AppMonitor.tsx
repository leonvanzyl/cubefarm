import { useEffect, useState } from 'react';
import * as THREE from 'three';
import type { RepoView } from '../../../shared/types';
import { useStore, type Agent } from '../store';
import { drawAppScreen } from './draw';
import { useCanvasTexture, useInteractable } from './interact';
import { APP_SCREEN, HALF_D } from './layout';
import { glow, mix } from './materials';
import { Box } from './Toon';

const PX = [1280, 720] as const;
const BEZEL = '#2b2d42';
// A soft halo around the bezel while the app is live, blended toward the wall so it stays subtle.
const LIVE_GLOW = mix('#7CFFB2', '#fbf3e4', 0.35);
const LED: Record<string, string> = { running: '#7CFFB2', error: '#ff6b6b', preparing: '#ffd166', installing: '#ffd166', starting: '#ffd166' };

/** The latest agent screenshot on this floor, as "agentId|timestamp", so the selector result stays a stable string. */
function useLatestShot(agents: Agent[]) {
  return useStore((s) => {
    let best: Agent | null = null;
    let at = 0;
    for (const a of agents) {
      const t = s.screens[a.id];
      if (t && t > at) {
        at = t;
        best = a;
      }
    }
    return best ? `${best.id}|${at}|${best.name}` : null;
  });
}

/** The big screen at the front of an office floor: shows the floor's app and opens the viewer on E. */
export function AppMonitor({ repo, agents }: { repo: RepoView; agents: Agent[] }) {
  const p = repo.preview;
  const live = p.status === 'running';
  const name = repo.fullName.split('/')[1] ?? repo.fullName;

  // Only fetch the thumbnail while the app is live, and only when a newer screenshot arrives.
  const latest = useLatestShot(agents);
  const [shot, setShot] = useState<{ img: HTMLImageElement; by: string } | null>(null);
  useEffect(() => {
    if (!live || !latest) return setShot(null);
    const [id, at, by] = latest.split('|');
    let alive = true;
    const img = new Image();
    img.onload = () => alive && setShot({ img, by });
    img.src = `/api/agents/${id}/screen?t=${at}`;
    return () => {
      alive = false;
      img.onload = null;
    };
  }, [live, latest]);

  const tex = useCanvasTexture(
    PX[0],
    PX[1],
    (ctx) => drawAppScreen(ctx, PX[0], PX[1], { floor: repo.floor, name, color: repo.color, preview: p, shot: shot?.img ?? null, shotBy: shot?.by ?? null }),
    [repo.floor, name, repo.color, p.status, p.url, p.ref, p.commit, p.startedAt, p.error, shot],
  );
  const ref = useInteractable<THREE.Group>({ id: `app-${repo.id}`, label: 'Open the app', action: { kind: 'app', repoId: repo.id } }, 6);

  const s = APP_SCREEN;
  const outerW = s.w + s.bezel * 2;
  const outerH = s.h + s.bezel * 2;
  return (
    <group ref={ref} position={[s.x, s.y, -HALF_D]}>
      {live && (
        <mesh position={[0, 0, 0.012]} material={glow(LIVE_GLOW)}>
          <planeGeometry args={[outerW + 0.18, outerH + 0.18]} />
        </mesh>
      )}
      <Box size={[outerW, outerH, s.depth]} position={[0, 0, s.depth / 2]} color={BEZEL} outline shadow={false} />
      <mesh position={[0, 0, s.depth + 0.002]}>
        <planeGeometry args={[s.w, s.h]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      <mesh position={[s.w / 2 - 0.04, -s.h / 2 - s.bezel / 2, s.depth + 0.002]} material={glow(LED[p.status] ?? '#6c7086')}>
        <circleGeometry args={[0.022, 12]} />
      </mesh>
    </group>
  );
}
