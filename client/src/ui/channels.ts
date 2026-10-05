// The PR theatre's channels, as pure helpers: a floor's big screen and app viewer show "main" (the floor's own
// preview) or one of its open PRs, each PR running in a preview of its own.

import type { PreviewStatus, PreviewView, PrPreviewView, PullInfo, QaStatus, QaView } from '../../../shared/types';

/** What a floor's screen shows: its main preview (null) or an open PR's. */
export type Channel = number | null;

export const QA_BADGE: Record<QaStatus, string> = {
  queued: '⏳ QA queued',
  testing: '🔍 QA testing',
  passed: '✅ QA passed',
  failed: '❌ QA failed',
  fixing: '🔧 being fixed',
  'needs-human': '🙋 needs you',
};

/** A PR's QA state in a few words, '' when QA hasn't seen it. */
export const qaBadge = (qa?: Pick<QaView, 'status'> | null) => (qa ? QA_BADGE[qa.status] : '');

/** Shorten to max characters with an ellipsis. */
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** "PR #212 · Outside 5 · ✅ QA passed" */
export function channelLabel(pull: Pick<PullInfo, 'number' | 'title'>, qa?: Pick<QaView, 'status'> | null, max = 32): string {
  return [`PR #${pull.number}`, clip(pull.title.trim(), max), qaBadge(qa)].filter(Boolean).join(' · ');
}

/** A floor's open PRs, in channel order (oldest first, like channel numbers). */
export const channelPulls = (pulls: PullInfo[]) => pulls.filter((p) => p.state === 'OPEN').sort((a, b) => a.number - b.number);

/** The channel on screen: the picked PR while it's still open, otherwise main. */
export function currentChannel(picked: Channel | undefined, pulls: Pick<PullInfo, 'number' | 'state'>[]): Channel {
  return picked != null && pulls.some((p) => p.number === picked && p.state === 'OPEN') ? picked : null;
}

/** A PR preview in the floor preview's shape, for the screen and the viewer's stage. None yet reads as stopped. */
export function prAsPreview(p: PrPreviewView | undefined, pr: number): PreviewView {
  return {
    status: p?.status ?? 'stopped',
    port: p?.port ?? 0,
    url: p?.url ?? null,
    ref: `PR #${pr}`,
    pr,
    commit: p?.commit ?? null,
    startedAt: p?.startedAt ?? null,
    error: p?.error ?? null,
    logTail: p?.logTail ?? [],
  };
}

/** A channel chip's light: live, getting ready, failed, or off. */
export function channelLed(status: PreviewStatus | undefined): 'live' | 'busy' | 'bad' | 'off' {
  if (status === 'running') return 'live';
  if (status === 'preparing' || status === 'installing' || status === 'starting') return 'busy';
  return status === 'error' ? 'bad' : 'off';
}

/** Where a QA screenshot is served (v: the QA record's update time, so a new round's shots aren't cached). */
export const qaShotUrl = (repoId: string, pr: number, index: number, v: number) => `/api/repos/${encodeURIComponent(repoId)}/pulls/${pr}/qa-shots/${index}?v=${v}`;

/** A path typed in compare mode, as both frames load it: always starting with "/". */
export function comparePath(input: string): string {
  const t = input.trim().replace(/^https?:\/\/[^/]+/i, '');
  return t.startsWith('/') ? t : `/${t}`;
}

/** Load `path` from a preview's address (its url ends with "/"). */
export const atPath = (url: string, path: string) => `${url.replace(/\/+$/, '')}${comparePath(path)}`;

// ---------- the big screen's channel strip ----------

/** The PRs that get a chip on the big screen: all of them up to `max`, else the newest, the one on screen always kept. */
export function stripPulls(prs: number[], current: Channel, max = 6): number[] {
  if (prs.length <= max) return prs;
  const out = prs.slice(-max);
  if (current != null && prs.includes(current) && !out.includes(current)) out[0] = current;
  return out.sort((a, b) => a - b);
}

export interface ChipRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where `count` channel chips sit on the big screen's canvas (w × h px): a centred row along the bottom. */
export function chipRects(count: number, w: number, h: number): ChipRect[] {
  const gap = 16;
  const ch = 64;
  const cw = Math.min(190, (w - 80 - gap * (count - 1)) / count);
  const x0 = (w - (count * cw + (count - 1) * gap)) / 2;
  return Array.from({ length: count }, (_, i) => ({ x: x0 + i * (cw + gap), y: h - ch - 18, w: cw, h: ch }));
}

// ---------- compare mode's path sync ----------

export type Side = 'main' | 'pr';

/** What compare mode remembers to sync paths: where each side last said it was, and where it was last sent. */
export interface PathSync {
  at: Record<Side, string | null>;
  asked: Record<Side, string | null>;
  relays: number[]; // when paths were passed on lately
}

export const newPathSync = (): PathSync => ({ at: { main: null, pr: null }, asked: { main: null, pr: null }, relays: [] });

/**
 * A side reports its path: whether to send the other side there (and note it). Not when it's the echo of where we
 * sent this side, not when the other side is already there, and at most 4 times in 3 s, so two apps that redirect
 * each other around can't bounce forever.
 */
export function relayPath(s: PathSync, from: Side, path: string, now: number): boolean {
  const to: Side = from === 'main' ? 'pr' : 'main';
  s.at[from] = path;
  if (s.asked[from] === path) {
    s.asked[from] = null;
    return false;
  }
  if (s.at[to] === path) return false;
  s.relays = s.relays.filter((t) => now - t < 3000);
  if (s.relays.length >= 4) return false;
  s.relays.push(now);
  s.asked[to] = path;
  return true;
}
