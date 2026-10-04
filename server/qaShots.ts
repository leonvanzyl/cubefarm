import fs from 'node:fs/promises';
import path from 'node:path';
import type { QaShotView } from '../shared/types.ts';

// QA's screenshots from a PR's latest round, kept beside the office's state so the app viewer can show them next to
// the QA report (the uploaded copies on GitHub need a login, and the demo has none). One folder per PR, replaced every
// round, removed when the PR leaves QA.

/** Screenshots kept per round: the same ones that go into the QA comment. */
export const QA_SHOTS_KEPT = 8;

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

/** A PR's folder under `root`. */
export const qaShotsDir = (root: string, repoId: string, pr: number) => path.join(root, repoId.replace('/', '__'), `pr-${pr}`);

/** The file of the PR's index-th screenshot (01.png, 02.svg …). */
export const qaShotFile = (dir: string, index: number, mime: string) => path.join(dir, `${String(index + 1).padStart(2, '0')}.${EXT[mime] ?? 'img'}`);

/** Replace a PR's screenshots with this round's last QA_SHOTS_KEPT; returns what the QA record keeps about them. */
export async function saveQaShots(dir: string, shots: { data: Buffer; mime: string; caption: string; page: string | null }[]): Promise<QaShotView[]> {
  await removeQaShots(dir);
  const kept = shots.slice(-QA_SHOTS_KEPT);
  if (!kept.length) return [];
  await fs.mkdir(dir, { recursive: true });
  const out: QaShotView[] = [];
  for (const [i, s] of kept.entries()) {
    await fs.writeFile(qaShotFile(dir, i, s.mime), s.data);
    out.push({ caption: s.caption, page: s.page, mime: s.mime });
  }
  return out;
}

/** One screenshot's bytes, or null when it's gone. */
export async function readQaShot(dir: string, index: number, mime: string): Promise<Buffer | null> {
  return fs.readFile(qaShotFile(dir, index, mime)).catch(() => null);
}

export async function removeQaShots(dir: string) {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/** Remove the folders of PRs `keep` doesn't name (keys `${repoId}#${pr}`), left from PRs that closed while the office was down. */
export async function pruneQaShots(root: string, keep: Set<string>) {
  const repos = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const repo of repos.filter((e) => e.isDirectory())) {
    const repoId = repo.name.replace('__', '/');
    const prs = await fs.readdir(path.join(root, repo.name), { withFileTypes: true }).catch(() => []);
    for (const pr of prs) {
      const n = /^pr-(\d+)$/.exec(pr.name)?.[1];
      if (!n || keep.has(`${repoId}#${n}`)) continue;
      await removeQaShots(path.join(root, repo.name, pr.name)).catch(() => undefined);
    }
  }
}
