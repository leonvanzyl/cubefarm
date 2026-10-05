// What the blimp's banner and the skywriter say: real, recent news from the office (the last merge, a busy floor's
// merges today, the PRs in flight), or a friendly line when there's none. Pure, so it's tested without a browser.

import type { PullInfo, RepoView } from '../../../../shared/types';

type Floor = Pick<RepoView, 'floor' | 'fullName'> & { pulls: readonly Pick<PullInfo, 'number' | 'state' | 'mergedAt'>[] };

const DAY_MS = 86_400_000;

/** The banner's candidates, most newsworthy first. `now` is epoch ms; "today" is the viewer's own day. */
export function bannerLines(floors: readonly Floor[], now: number, company = ''): string[] {
  const lines: string[] = [];
  const start = new Date(now);
  const midnight = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const merged = floors.flatMap((f) =>
    f.pulls.filter((p) => p.mergedAt && Number.isFinite(Date.parse(p.mergedAt))).map((p) => ({ floor: f.floor, number: p.number, at: Date.parse(p.mergedAt!) })),
  );
  const latest = merged.filter((m) => now - m.at < DAY_MS && m.at <= now + 60_000).sort((a, b) => b.at - a.at)[0];
  if (latest) lines.push(`PR #${latest.number} merged! 🎉`);
  const busiest = floors
    .map((f) => ({ floor: f.floor, n: merged.filter((m) => m.floor === f.floor && m.at >= midnight && m.at <= now + 60_000).length }))
    .filter((x) => x.n >= 2)
    .sort((a, b) => b.n - a.n)[0];
  if (busiest) lines.push(`Floor ${busiest.floor}: ${busiest.n} merges today`);
  const open = floors.reduce((n, f) => n + f.pulls.filter((p) => p.state === 'OPEN').length, 0);
  if (open > 0) lines.push(`${open} PR${open === 1 ? '' : 's'} in flight 🚀`);
  lines.push(`${company.trim() || 'cubefarm'} ♥ its team`);
  return lines;
}

/** One line for this blimp: usually the freshest news, sometimes the next (`roll` in [0, 1)). */
export function bannerText(floors: readonly Floor[], now: number, company: string, roll: number): string {
  const lines = bannerLines(floors, now, company);
  const real = lines.length > 1 ? lines.slice(0, -1) : lines;
  return real[Math.min(real.length - 1, Math.floor(Math.max(0, roll) * Math.min(real.length, 2)))];
}

/** What the skywriter spells: the floor's repo name (or the company's in the lobby), short enough for the sky. */
export function skyText(repoFullName: string | null, company: string): string {
  const name = repoFullName ? (repoFullName.split('/').pop() ?? repoFullName) : company.trim() || 'cubefarm';
  const clean = name.replace(/[^\p{L}\p{N} .!&+-]/gu, ' ').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (clean || 'hello').slice(0, 14).toUpperCase();
}
