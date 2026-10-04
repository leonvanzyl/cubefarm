import { useEffect, useState } from 'react';
import * as THREE from 'three';
import type { RepoView } from '../../../shared/types';
import { qaKey, useStore, type Agent } from '../store';
import { loadScreenshot } from '../screenshot';
import { channelLabel, channelLed, channelPulls, chipRects, prAsPreview, qaShotUrl, stripPulls, type ChipRect } from '../ui/channels';
import { useChannel } from '../ui/theatre';
import { drawAppScreen, type ScreenChip } from './draw';
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

/** A channel chip on the screen's strip, as something to aim at: E switches the screen to that channel. */
function ChannelChip({ repoId, pr, label, rect }: { repoId: string; pr: number | null; label: string; rect: ChipRect }) {
  const s = APP_SCREEN;
  const ref = useInteractable<THREE.Mesh>({ id: `app-ch-${repoId}-${pr ?? 'main'}`, label, action: { kind: 'channel', repoId, pr } }, 6);
  const x = ((rect.x + rect.w / 2) / PX[0] - 0.5) * s.w;
  const y = (0.5 - (rect.y + rect.h / 2) / PX[1]) * s.h;
  // Invisible: the screen's texture draws the chip; this is what the crosshair finds.
  return (
    <mesh ref={ref} position={[x, y, s.depth + 0.006]} visible={false}>
      <planeGeometry args={[(rect.w / PX[0]) * s.w, (rect.h / PX[1]) * s.h]} />
    </mesh>
  );
}

/** The big screen at the front of an office floor: shows the floor's app (or one of its open PRs) and opens the viewer on E. */
export function AppMonitor({ repo, agents }: { repo: RepoView; agents: Agent[] }) {
  const channel = useChannel(repo.id);
  const prPreviews = useStore((s) => s.prPreviews);
  const qa = useStore((s) => s.qa);
  const p = channel == null ? repo.preview : prAsPreview(prPreviews[qaKey(repo.id, channel)], channel);
  const live = p.status === 'running';
  const name = repo.fullName.split('/')[1] ?? repo.fullName;

  // The channel strip: main, then the open PRs (as many as fit).
  const pulls = channelPulls(repo.pulls);
  const shown = stripPulls(
    pulls.map((x) => x.number),
    channel,
  );
  const chips: (ScreenChip & { pr: number | null; aim: string })[] = pulls.length
    ? [
        { pr: null, label: repo.defaultBranch, on: channel == null, led: channelLed(repo.preview.status), aim: `Watch ${repo.defaultBranch}` },
        ...shown.map((n) => {
          const pull = pulls.find((x) => x.number === n)!;
          return { pr: n, label: `#${n}`, on: channel === n, led: channelLed(prPreviews[qaKey(repo.id, n)]?.status), aim: `Watch ${channelLabel(pull, qa[qaKey(repo.id, n)])}` };
        }),
      ]
    : [];
  const chipKey = chips.map((c) => `${c.label}:${c.on ? 1 : 0}:${c.led}`).join('|');
  const rects = chipRects(chips.length, PX[0], PX[1]);

  // Only fetch the thumbnail while the app is live, and only when a newer screenshot arrives. A failed load keeps the last one.
  // A PR's channel shows QA's first screenshot of that PR instead of whatever an agent looked at last.
  const latest = useLatestShot(agents);
  const prQa = channel == null ? undefined : qa[qaKey(repo.id, channel)];
  const qaShot = channel != null && prQa?.shots?.length ? qaShotUrl(repo.id, channel, 0, prQa.updatedAt) : null;
  const [shot, setShot] = useState<{ img: HTMLImageElement; caption: string } | null>(null);
  useEffect(() => {
    if (!live) return setShot(null);
    if (channel != null) {
      if (!qaShot) return setShot(null);
      let alive = true;
      const img = new Image();
      img.onload = () => alive && setShot({ img, caption: `QA's screenshot of PR #${channel}` });
      img.src = qaShot;
      return () => {
        alive = false;
        img.onload = null;
      };
    }
    if (!latest) return setShot(null);
    const [id, at, by] = latest.split('|');
    return loadScreenshot(id, Number(at), (img) => setShot({ img, caption: `latest from ${by}'s browser` }));
  }, [live, latest, channel, qaShot]);

  const tex = useCanvasTexture(
    PX[0],
    PX[1],
    (ctx) => drawAppScreen(ctx, PX[0], PX[1], { floor: repo.floor, name, color: repo.color, preview: p, shot: shot?.img ?? null, shotCaption: shot?.caption ?? null, channels: chips }),
    [repo.floor, name, repo.color, p.status, p.url, p.ref, p.commit, p.startedAt, p.error, shot, chipKey],
  );
  const ref = useInteractable<THREE.Group>({ id: `app-${repo.id}`, label: channel == null ? 'Open the app' : `Open PR #${channel}`, action: { kind: 'app', repoId: repo.id, pr: channel } }, 6);

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
      {chips.map((c, i) => (
        <ChannelChip key={c.pr ?? 'main'} repoId={repo.id} pr={c.pr} label={c.aim} rect={rects[i]} />
      ))}
    </group>
  );
}
