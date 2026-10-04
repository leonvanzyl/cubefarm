import { describe, expect, it } from 'vitest';
import type { PrPreviewView, PullInfo } from '../../../shared/types';
import { atPath, channelLabel, channelLed, channelPulls, chipRects, comparePath, currentChannel, newPathSync, prAsPreview, qaBadge, qaShotUrl, relayPath, stripPulls } from './channels';

const pull = (number: number, state: PullInfo['state'] = 'OPEN', title = `Change ${number}`) => ({ number, state, title }) as PullInfo;

describe('PR theatre channels', () => {
  it('labels a PR channel with its number, title and QA state', () => {
    expect(channelLabel(pull(212, 'OPEN', 'Outside 5'), { status: 'passed' })).toBe('PR #212 · Outside 5 · ✅ QA passed');
    expect(channelLabel(pull(7, 'OPEN', 'Fix it'))).toBe('PR #7 · Fix it');
    expect(channelLabel(pull(8, 'OPEN', 'A very long title that goes on and on and on'), { status: 'testing' }, 12)).toBe('PR #8 · A very long… · 🔍 QA testing');
    expect(qaBadge(null)).toBe('');
  });

  it('lists open PRs only, in number order', () => {
    expect(channelPulls([pull(9), pull(3, 'MERGED'), pull(4), pull(5, 'CLOSED')]).map((p) => p.number)).toEqual([4, 9]);
  });

  it('falls back to main once the picked PR is no longer open', () => {
    const pulls = [pull(4), pull(5, 'MERGED')];
    expect(currentChannel(4, pulls)).toBe(4);
    expect(currentChannel(5, pulls)).toBeNull();
    expect(currentChannel(6, pulls)).toBeNull();
    expect(currentChannel(undefined, pulls)).toBeNull();
    expect(currentChannel(null, pulls)).toBeNull();
  });

  it('shows a PR preview like the main one, stopped until it exists', () => {
    expect(prAsPreview(undefined, 12)).toMatchObject({ status: 'stopped', url: null, ref: 'PR #12', pr: 12, logTail: [] });
    const p = { repoId: 'o/r', pr: 12, status: 'running', port: 6401, url: 'http://localhost:6401/', commit: 'abc1234', startedAt: 5, viewedAt: 6, watched: true, error: null, logTail: ['ok'] } as PrPreviewView;
    expect(prAsPreview(p, 12)).toEqual({ status: 'running', port: 6401, url: 'http://localhost:6401/', ref: 'PR #12', pr: 12, commit: 'abc1234', startedAt: 5, error: null, logTail: ['ok'] });
  });

  it('lights a chip by the preview status', () => {
    expect(channelLed('running')).toBe('live');
    expect(channelLed('installing')).toBe('busy');
    expect(channelLed('error')).toBe('bad');
    expect(channelLed('stopped')).toBe('off');
    expect(channelLed(undefined)).toBe('off');
  });
});

describe('compare paths and QA screenshots', () => {
  it('loads the same path in both frames', () => {
    expect(comparePath('about')).toBe('/about');
    expect(comparePath(' /todos?x=1#top ')).toBe('/todos?x=1#top');
    expect(comparePath('http://localhost:6401/about')).toBe('/about');
    expect(comparePath('')).toBe('/');
    expect(atPath('http://localhost:6301/', '/about')).toBe('http://localhost:6301/about');
    expect(atPath('http://localhost:51234', 'x')).toBe('http://localhost:51234/x');
  });

  it("serves a screenshot by the PR's repo, number and index", () => {
    expect(qaShotUrl('acme/app', 4, 0, 99)).toBe('/api/repos/acme%2Fapp/pulls/4/qa-shots/0?v=99');
  });
});

describe("the big screen's channel strip", () => {
  it('shows every PR up to the limit, else the newest with the one on screen', () => {
    expect(stripPulls([1, 2, 3], null)).toEqual([1, 2, 3]);
    expect(stripPulls([1, 2, 3, 4, 5, 6, 7, 8], null)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(stripPulls([1, 2, 3, 4, 5, 6, 7, 8], 1)).toEqual([1, 4, 5, 6, 7, 8]);
  });

  it('lays the chips out in a centred row inside the screen', () => {
    const rects = chipRects(4, 1280, 720);
    expect(rects).toHaveLength(4);
    const left = rects[0].x;
    const right = 1280 - (rects[3].x + rects[3].w);
    expect(Math.abs(left - right)).toBeLessThan(1e-6);
    for (const r of rects) expect(r.y + r.h).toBeLessThanOrEqual(720);
    const many = chipRects(7, 1280, 720);
    expect(many[6].x + many[6].w).toBeLessThanOrEqual(1280 - 40 + 1e-6);
    expect(many[0].x).toBeGreaterThanOrEqual(40 - 1e-6);
  });
});

describe("compare mode's path sync", () => {
  it('sends the other side along when one navigates, but not the echo', () => {
    const s = newPathSync();
    expect(relayPath(s, 'main', '/', 0)).toBe(true); // main loaded first: the PR side follows
    expect(relayPath(s, 'pr', '/', 10)).toBe(false); // the PR side arriving there
    expect(relayPath(s, 'pr', '/about', 500)).toBe(true); // a click on the PR side, right after
    expect(relayPath(s, 'main', '/about', 600)).toBe(false); // main following
    expect(relayPath(s, 'main', '/', 5000)).toBe(true); // and back
  });

  it("doesn't send a side where it already is", () => {
    const s = newPathSync();
    s.at.pr = '/x';
    expect(relayPath(s, 'main', '/x', 0)).toBe(false);
  });

  it('gives up on two apps redirecting each other around', () => {
    const s = newPathSync();
    const sent = ['/a', '/b', '/c', '/d', '/e', '/f'].map((p, i) => relayPath(s, i % 2 ? 'pr' : 'main', p, i * 100));
    expect(sent).toEqual([true, true, true, true, false, false]);
    expect(relayPath(s, 'main', '/g', 5000)).toBe(true);
  });
});
