import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pruneQaShots, qaShotFile, qaShotsDir, QA_SHOTS_KEPT, readQaShot, saveQaShots } from './qaShots.ts';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cubefarm-qashots-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const shot = (n: number, mime = 'image/png') => ({ data: Buffer.from(`shot ${n}`), mime, caption: `Step ${n}`, page: `http://localhost:5600/${n}` });

describe("QA's screenshots on disk", () => {
  it('names one folder per PR and one file per screenshot', () => {
    expect(qaShotsDir(root, 'acme/app', 12)).toBe(path.join(root, 'acme__app', 'pr-12'));
    expect(path.basename(qaShotFile('x', 0, 'image/png'))).toBe('01.png');
    expect(path.basename(qaShotFile('x', 9, 'image/svg+xml'))).toBe('10.svg');
  });

  it("keeps the round's last screenshots, replacing the round before", async () => {
    const dir = qaShotsDir(root, 'acme/app', 12);
    await saveQaShots(dir, [shot(1), shot(2, 'image/svg+xml')]);
    const saved = await saveQaShots(dir, Array.from({ length: QA_SHOTS_KEPT + 2 }, (_, i) => shot(i + 1)));
    expect(saved).toHaveLength(QA_SHOTS_KEPT);
    expect(saved[0]).toEqual({ caption: 'Step 3', page: 'http://localhost:5600/3', mime: 'image/png' });
    expect(fs.readdirSync(dir)).toHaveLength(QA_SHOTS_KEPT);
    expect((await readQaShot(dir, 0, 'image/png'))?.toString()).toBe('shot 3');
    expect(await readQaShot(dir, QA_SHOTS_KEPT, 'image/png')).toBeNull();
  });

  it('leaves no folder for a round without screenshots', async () => {
    const dir = qaShotsDir(root, 'acme/app', 3);
    await saveQaShots(dir, [shot(1)]);
    expect(await saveQaShots(dir, [])).toEqual([]);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("prunes the folders of PRs that aren't in QA any more", async () => {
    await saveQaShots(qaShotsDir(root, 'acme/app', 1), [shot(1)]);
    await saveQaShots(qaShotsDir(root, 'acme/app', 2), [shot(1)]);
    await pruneQaShots(root, new Set(['acme/app#2']));
    expect(fs.readdirSync(path.join(root, 'acme__app'))).toEqual(['pr-2']);
  });
});
