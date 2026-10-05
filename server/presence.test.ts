import { describe, expect, it } from 'vitest';
import { FLOOR_CAP } from '../shared/presence.ts';
import type { ServerEvent } from '../shared/types.ts';
import { EMOTE_GAP_MS, PresenceHub, RELAY_GAP_MS, recipients, roster, visibleOn, type Peer } from './presence.ts';

// ---------- the pure rules ----------

let seq = 0;
const peer = (patch: Partial<Peer> = {}): Peer => ({
  id: `p${seq}`,
  seq: seq++,
  name: 'Visitor',
  color: '#ef476f',
  mode: 'visible',
  floor: 1,
  pose: { ts: 0, f: 1, x: 0, z: 0, h: 0, p: 0, held: null },
  relayedAt: 0,
  dirty: false,
  emoteAt: 0,
  pingAt: 0,
  send: () => undefined,
  walker: null,
  ...patch,
});

describe('interest rules', () => {
  it('a pose reaches everyone else on the same floor, and nobody elsewhere', () => {
    const a = peer();
    const b = peer();
    const watcher = peer({ mode: 'watching', pose: null });
    const upstairs = peer({ floor: 2 });
    const away = peer({ mode: 'away', floor: null, pose: null });
    expect(recipients([a, b, watcher, upstairs, away], a)).toEqual([b, watcher]);
  });

  it("someone who doesn't appear, or isn't in the office, sends nothing", () => {
    const a = peer({ mode: 'watching' });
    const b = peer();
    expect(recipients([a, b], a)).toEqual([]);
    expect(recipients([peer({ mode: 'away', floor: null }), b], peer({ mode: 'away', floor: null }))).toEqual([]);
  });

  it('caps a floor at FLOOR_CAP visitors, in join order: the rest are not relayed', () => {
    const crowd = Array.from({ length: FLOOR_CAP + 3 }, () => peer());
    expect(visibleOn(crowd, 1)).toEqual(crowd.slice(0, FLOOR_CAP));
    expect(recipients(crowd, crowd[FLOOR_CAP - 1])).toHaveLength(FLOOR_CAP + 2);
    expect(recipients(crowd, crowd[FLOOR_CAP])).toEqual([]); // 17th: drawn by nobody, so relayed to nobody
    expect(visibleOn(crowd, 2)).toEqual([]);
  });

  it('fake visitors are never sent anything', () => {
    const a = peer();
    const fake = peer({ walker: {} as Peer['walker'] });
    expect(recipients([a, fake], a)).toEqual([]);
  });

  it('the roster lists everyone appearing, on any floor, in join order', () => {
    const a = peer({ name: 'Ada', floor: 2 });
    const b = peer({ name: 'Bo', mode: 'watching' });
    const c = peer({ name: 'Cy', floor: 0 });
    expect(roster([c, b, a]).map((v) => [v.name, v.floor])).toEqual([
      ['Ada', 2],
      ['Cy', 0],
    ]);
  });
});

// ---------- the hub ----------

interface Tab {
  peer: Peer;
  got: ServerEvent[];
  say: (msg: unknown) => void;
  last: <T extends ServerEvent['type']>(type: T) => Extract<ServerEvent, { type: T }> | undefined;
  all: <T extends ServerEvent['type']>(type: T) => Extract<ServerEvent, { type: T }>[];
}

function setup(demo = false) {
  let now = 1_000;
  const hub = new PresenceHub({ demo, now: () => now, timer: false });
  const tab = (): Tab => {
    const got: ServerEvent[] = [];
    const p = hub.join((data) => got.push(JSON.parse(data) as ServerEvent));
    const all = <T extends ServerEvent['type']>(type: T) => got.filter((e) => e.type === type) as Extract<ServerEvent, { type: T }>[];
    return { peer: p, got, say: (msg) => hub.receive(p, JSON.stringify(msg)), all, last: (type) => all(type).at(-1) };
  };
  return { hub, tab, advance: (ms: number) => void (now += ms) };
}

const pose = (f: number, x = 0, z = 0, extra: object = {}) => ({ type: 'pose', ts: 1, f, x, z, h: 0, p: 0, held: null, ...extra });

describe('PresenceHub', () => {
  it('relays a pose to the other tab on the floor, with the cleaned name in the roster', () => {
    const { tab, advance } = setup();
    const a = tab();
    const b = tab();
    a.say({ type: 'hello', name: '  <b>Ada</b>\u0000 ', color: '#118AB2' });
    a.say(pose(1, 2, 3));
    b.say({ type: 'watch', f: 1 });
    expect(b.last('visitors')?.visitors).toEqual([{ id: a.peer.id, name: '<b>Ada</b>', color: '#118ab2', floor: 1 }]);
    expect(b.last('visitorPose')).toMatchObject({ id: a.peer.id, f: 1, x: 2, z: 3 }); // caught up on arrival
    advance(RELAY_GAP_MS);
    a.say(pose(1, 4, 3));
    expect(b.last('visitorPose')).toMatchObject({ x: 4 });
    expect(a.all('visitorPose')).toEqual([]); // nobody hears themselves
    expect(a.last('visitors')?.visitors).toEqual([]); // nor sees themselves in the list
  });

  it('holds back poses sent faster than the relay gap and flushes the latest on the next tick', () => {
    const { hub, tab, advance } = setup();
    const a = tab();
    const b = tab();
    b.say({ type: 'watch', f: 1 });
    a.say(pose(1, 1));
    advance(20);
    a.say(pose(1, 2));
    a.say(pose(1, 3));
    expect(b.all('visitorPose').map((e) => e.x)).toEqual([1]);
    advance(RELAY_GAP_MS);
    hub.tick();
    expect(b.all('visitorPose').map((e) => e.x)).toEqual([1, 3]);
    hub.tick();
    expect(b.all('visitorPose')).toHaveLength(2); // nothing new: nothing sent
  });

  it('drops what happens on other floors', () => {
    const { tab } = setup();
    const a = tab();
    const b = tab();
    b.say(pose(2));
    a.say(pose(1));
    a.say({ type: 'emote', e: 'wave' });
    a.say({ type: 'ping', x: 0, y: 1, z: 0, label: 'here' });
    expect(b.all('visitorPose').map((e) => e.id)).not.toContain(a.peer.id);
    expect(b.all('visitorEmote')).toEqual([]);
    expect(b.all('visitorPing')).toEqual([]);
  });

  it('changing floors tells everyone (the list) before the first pose there, and catches the mover up', () => {
    const { tab } = setup();
    const a = tab();
    const b = tab();
    b.say(pose(2, 5, 5));
    a.say(pose(1));
    a.got.length = 0;
    a.say(pose(2, 0, 10));
    const order = b.got.map((e) => e.type);
    expect(order.lastIndexOf('visitors')).toBeLessThan(order.lastIndexOf('visitorPose'));
    expect(b.last('visitors')?.visitors).toEqual([expect.objectContaining({ id: a.peer.id, floor: 2 })]);
    expect(a.last('visitorPose')).toMatchObject({ id: b.peer.id, x: 5, z: 5 });
  });

  it('turning "Appear to others" off (watch) or leaving the office removes you from the list at once', () => {
    const { hub, tab } = setup();
    const a = tab();
    const b = tab();
    a.say(pose(1));
    b.say({ type: 'watch', f: 1 });
    expect(b.last('visitors')?.visitors).toHaveLength(1);
    a.say({ type: 'watch', f: 1 });
    expect(b.last('visitors')?.visitors).toEqual([]);
    a.say(pose(1));
    expect(b.last('visitors')?.visitors).toHaveLength(1);
    hub.leave(a.peer);
    expect(b.last('visitors')?.visitors).toEqual([]);
    a.say(pose(1)); // a closed socket's late message changes nothing
    expect(b.last('visitors')?.visitors).toEqual([]);
  });

  it('when a full floor loses someone, the next in line is sent to the floor', () => {
    const { hub, tab } = setup();
    const crowd = Array.from({ length: FLOOR_CAP + 1 }, () => tab());
    crowd.forEach((t, i) => t.say(pose(1, i)));
    const watcher = tab();
    watcher.say({ type: 'watch', f: 1 });
    const last = crowd[FLOOR_CAP];
    expect(watcher.all('visitorPose').map((e) => e.id)).not.toContain(last.peer.id);
    hub.leave(crowd[0].peer);
    expect(watcher.last('visitorPose')).toMatchObject({ id: last.peer.id, x: FLOOR_CAP });
  });

  it('rate-limits emotes and pings', () => {
    const { tab, advance } = setup();
    const a = tab();
    const b = tab();
    a.say(pose(1));
    b.say(pose(1));
    a.say({ type: 'emote', e: 'wave' });
    a.say({ type: 'emote', e: 'clap' });
    expect(b.all('visitorEmote').map((e) => e.e)).toEqual(['wave']);
    advance(EMOTE_GAP_MS);
    a.say({ type: 'emote', e: 'clap' });
    expect(b.all('visitorEmote').map((e) => e.e)).toEqual(['wave', 'clap']);
    a.say({ type: 'ping', x: 0, y: 1, z: 0, label: '<the whiteboard>' });
    a.say({ type: 'ping', x: 1, y: 1, z: 0, label: 'again' });
    expect(b.all('visitorPing')).toEqual([{ type: 'visitorPing', id: a.peer.id, x: 0, y: 1, z: 0, label: '<the whiteboard>' }]);
  });

  it('ignores junk', () => {
    const { hub, tab } = setup();
    const a = tab();
    const b = tab();
    b.say({ type: 'watch', f: 1 });
    for (const junk of ['', 'null', '[1,2]', '{"type":"pose"}', '{"type":"emote","e":"<script>"}', 'x'.repeat(5000)]) hub.receive(a.peer, junk);
    expect(b.all('visitorPose')).toEqual([]);
    expect(b.all('visitorEmote')).toEqual([]);
  });

  it('keeps fakes for the demo only, and they come to the floor the real visitor is on', () => {
    const plain = setup();
    const t = plain.tab();
    t.say({ type: 'fakes', n: 4 });
    expect(plain.hub.state().filter((p) => p.fake)).toEqual([]);

    const { hub, tab, advance } = setup(true);
    expect(hub.state().filter((p) => p.fake)).toHaveLength(2);
    const me = tab();
    me.say(pose(3));
    advance(100);
    hub.tick();
    expect(me.last('visitors')?.visitors.map((v) => v.floor)).toEqual([3, 3]);
    expect(me.all('visitorPose').length).toBeGreaterThan(0);
    me.say({ type: 'fakes', n: 8 });
    advance(100);
    hub.tick();
    expect(me.last('visitors')?.visitors).toHaveLength(8);
    me.say({ type: 'fakes', n: 0 });
    expect(me.last('visitors')?.visitors).toEqual([]);
  });
});
