// The whiteboard's stickies, moved by the agents themselves: when a card moves on the floor's Kanban board, its
// developer or QA tester walks over (an errand, errands.ts) and peels, carries and slaps the sticky, while the 3D
// board holds the move back until they've placed it (never more than HOLD_MAX seconds). QA testers keep the sticky of
// the PR they're testing on their monitor. The loose stickies are one instanced mesh over a small atlas texture.
// window.__swarmStickies shows the queue, the loose stickies and what happened, for QA.

import { useEffect, useLayoutEffect, useMemo, useReducer, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { coversView, useStore, type Agent, type KanbanColumns } from '../store';
import { stickyPeel, stickySlap } from '../ui/peopleSounds';
import { angleDelta, smooth } from './body';
import { drawSticky, kanbanNoteColor } from './draw';
import { registerErrand, type Errand, type ErrandStep } from './errands';
import { bodyState, bodyTarget } from './people';
import {
  addMove,
  boardHolds,
  boardPose,
  displayColumns,
  findCard,
  firstColumn,
  HOLD_MAX,
  mayGo,
  monitorPose,
  nextJob,
  overdue,
  release,
  START_BY,
  stickyMoves,
  type Job,
  type MoveKind,
  type Pose,
} from './stickies';

const PIECES = 12; // loose stickies at once: walkers' and the QA monitors'
const ATLAS = { cols: 4, rows: 3, w: 256, h: 120 };
const SPEED = 1.6; // a brisk walk: the board shouldn't wait long
const GRACE = 5; // seconds into 'working' a tester may still fetch the PR they were just given
const LOG_KEEP = 40;

const now = () => performance.now() / 1000;
const label = (c: { prNumber?: number; number: number }) => `${c.prNumber ? 'PR ' : ''}#${c.number}`;
const newPose = (): Pose => ({ x: 0, y: -10, z: 0, yaw: 0, pitch: 0, roll: 0, w: 0, h: 0 });
const copyPose = (to: Pose, from: Pose) => Object.assign(to, from);

// ---------- the errands ----------

type Name = 'sticky-move' | 'sticky-merge' | 'sticky-take' | 'sticky-bring';

const errandFor = (k: MoveKind): Name => (k === 'take' ? 'sticky-take' : k === 'merge' ? 'sticky-merge' : k === 'toQa' ? 'sticky-move' : 'sticky-bring');

/** What the errands ask of the floor you're on (null on other floors: nobody goes). */
interface Board {
  wants(agentId: string, errand: Name): boolean;
  where(agentId: string): string[];
  target(agentId: string): string | null;
  claim(agentId: string): boolean;
  cue(agentId: string, cue: string): boolean;
  end(agentId: string, how: 'done' | 'cut'): void;
}

let board: Board | null = null;

const errand = (name: Name, steps: ErrandStep[], extra: Partial<Errand> = {}): Errand => ({
  name,
  work: true,
  speed: SPEED,
  grace: GRACE,
  spot: [],
  steps,
  when: (a) => !!board?.wants(a.id, name),
  where: (id) => board?.where(id) ?? [],
  claim: (id) => !!board?.claim(id),
  cue: (id, c) => !!board?.cue(id, c),
  end: (id, how) => board?.end(id, how),
  ...extra,
});

const toTarget = (id: string) => board?.target(id) ?? null;
// peel it off its column, walk along to the next one with it, slap it on
const moveSteps: ErrandStep[] = [
  { gesture: 'none', seconds: 0.3 },
  { gesture: 'post', seconds: 0.8, cue: 'peel' },
  { gesture: 'hold', seconds: 0.3, to: toTarget },
  { gesture: 'post', seconds: 0.7, cue: 'slap' },
];
registerErrand(errand('sticky-move', [...moveSteps, { gesture: 'none', seconds: 0.4 }]));
registerErrand(errand('sticky-merge', [...moveSteps, { gesture: 'none', seconds: 0.25 }, { gesture: 'cheer', seconds: 1.4 }]));
// a tester takes it off In QA and carries it back to their station (maybe once its developer has put it up)
registerErrand(
  errand('sticky-take', [{ gesture: 'none', seconds: 0.2 }, { gesture: 'post', seconds: 0.7, cue: 'peel' }, { gesture: 'hold', seconds: 0.3 }], {
    carry: 'hold',
    grace: GRACE + HOLD_MAX + START_BY,
  }),
);
// ...and brings it back once they're done: Ready to merge, or back to the QA column
registerErrand(errand('sticky-bring', [{ gesture: 'none', seconds: 0.2 }, { gesture: 'post', seconds: 0.7, cue: 'slap' }, { gesture: 'none', seconds: 0.4 }], { bring: 'hold' }));

// ---------- the controller ----------

type Anchor = { pose: Pose; hand: null } | { pose: null; hand: string };

interface Piece {
  /** `job:<id>` or `mon:<agentId>`; null when free. */
  owner: string | null;
  drawn: string;
  label: string;
  pose: Pose;
  from: Pose;
  to: Anchor;
  /** Seconds into the current flight (negative: waiting to go), and how long it takes. */
  t: number;
  dur: number;
  curl: number;
  land: (() => void) | null;
}

interface LogEntry {
  t: number;
  what: 'queued' | 'skipped' | 'started' | 'peeled' | 'placed' | 'late' | 'cut';
  kind: MoveKind;
  agent: string;
  card: string;
  to: string;
}

type Ctrl = ReturnType<typeof makeController>;

function makeController() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS.cols * ATLAS.w;
  canvas.height = ATLAS.rows * ATLAS.h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return {
    jobs: [] as Job[],
    nextId: 1,
    prev: null as KanbanColumns | null,
    cols: null as KanbanColumns | null,
    agents: [] as Agent[],
    pieces: Array.from({ length: PIECES }, (): Piece => ({ owner: null, drawn: '', label: '', pose: newPose(), from: newPose(), to: { pose: newPose(), hand: null }, t: 0, dur: 0, curl: 0, land: null })),
    log: [] as LogEntry[],
    canvas,
    tex,
    /** Monitor stickies need another look. */
    dirty: true,
    /** Something the board shows changed: KanbanBoard re-renders. */
    changed: () => {},
  };
}

function note(c: Ctrl, what: LogEntry['what'], j: Job) {
  c.log.push({ t: Math.round(performance.now()), what, kind: j.move.kind, agent: j.move.agentId, card: j.move.key, to: j.move.to });
  if (c.log.length > LOG_KEEP) c.log.splice(0, c.log.length - LOG_KEEP);
}

/** Looks at the latest board while rendering, so the 3D board never paints a move before it's held back. */
function observe(c: Ctrl, cols: KanbanColumns, agents: Agent[]) {
  c.agents = agents;
  if (c.cols === cols) return;
  c.prev = c.cols;
  c.cols = cols;
  c.dirty = true;
  if (!c.prev) return; // just arrived: nothing has moved yet
  const looking = typeof document !== 'undefined' && !document.hidden && !coversView(useStore.getState().overlay);
  for (const m of stickyMoves(c.prev, cols)) {
    const job: Job = { id: c.nextId++, move: m, at: now(), stage: 'waiting' };
    // nobody walks over while you can't see the floor, or for someone who isn't on it
    if (!looking || !agents.some((a) => a.id === m.agentId)) {
      note(c, 'skipped', job);
      continue;
    }
    const r = addMove(c.jobs, m, job.at, job.id);
    for (const d of r.dropped) note(c, 'skipped', d);
    note(c, r.jobs.some((j) => j.id === job.id) ? 'queued' : 'skipped', job);
    c.jobs = r.jobs;
  }
}

function pieceOf(c: Ctrl, owner: string) {
  return c.pieces.find((p) => p.owner === owner) ?? null;
}

function spawn(c: Ctrl, owner: string, text: string, color: string, pose: Pose): Piece | null {
  const i = c.pieces.findIndex((p) => !p.owner);
  if (i < 0) return null;
  const p = c.pieces[i];
  p.owner = owner;
  const look = `${text}|${color}`;
  if (p.drawn !== look) {
    const ctx = c.canvas.getContext('2d');
    if (ctx) drawSticky(ctx, (i % ATLAS.cols) * ATLAS.w, Math.floor(i / ATLAS.cols) * ATLAS.h, ATLAS.w, ATLAS.h, text, color);
    c.tex.needsUpdate = true;
    p.drawn = look;
  }
  p.label = text;
  copyPose(p.pose, pose);
  copyPose(p.from, pose);
  p.to = { pose: copyPose(p.to.pose ?? newPose(), pose), hand: null };
  p.t = p.dur = 0;
  p.land = null;
  return p;
}

function fly(p: Piece, to: { pose: Pose } | { hand: string }, dur: number, delay: number, curl: number, land: (() => void) | null = null) {
  copyPose(p.from, p.pose);
  p.to = 'hand' in to ? { pose: null, hand: to.hand } : { pose: copyPose(newPose(), to.pose), hand: null };
  p.t = -delay;
  p.dur = dur;
  p.curl = curl;
  p.land = land;
}

function free(c: Ctrl, owner: string) {
  const p = pieceOf(c, owner);
  if (p) {
    p.owner = null;
    p.land = null;
  }
}

/** The job's over: placed, given up, or late. The board shows the real state again. */
function finish(c: Ctrl, j: Job, what: LogEntry['what']) {
  if (!c.jobs.includes(j)) return;
  c.jobs = release(c.jobs.filter((x) => x !== j), [j], now()); // anyone waiting for it may go now
  note(c, what, j);
  c.dirty = true;
  c.changed();
}

const jobOf = (c: Ctrl, agentId: string, stages: Job['stage'][]) => c.jobs.find((j) => j.move.agentId === agentId && stages.includes(j.stage));

const seatOf = (c: Ctrl, agentId: string) => c.agents.find((a) => a.id === agentId) ?? { role: 'qa', desk: 0 };

const tmp = newPose();

function makeBoard(c: Ctrl): Board {
  return {
    wants(id, name) {
      const j = nextJob(c.jobs, id);
      return !!j && j.stage === 'waiting' && j.after === undefined && errandFor(j.move.kind) === name && !overdue(j, now());
    },
    where(id) {
      const j = nextJob(c.jobs, id);
      if (!j || j.stage === 'held') return [];
      return [`board-${firstColumn(j.move)}`];
    },
    target(id) {
      const j = jobOf(c, id, ['going', 'held']);
      return j && j.move.to !== 'monitor' ? `board-${j.move.to}` : null;
    },
    claim(id) {
      if (!mayGo(c.jobs, id, now())) return false;
      const j = nextJob(c.jobs, id)!;
      j.stage = 'going';
      note(c, 'started', j);
      if (j.move.kind === 'pass' || j.move.kind === 'fail') {
        // off the monitor and into their hands as they get up
        const p = pieceOf(c, `mon:${id}`) ?? spawn(c, `mon:${id}`, label(j.move.from.card), kanbanNoteColor('qa'), monitorPose(seatOf(c, id), tmp));
        if (p) {
          p.owner = `job:${j.id}`;
          fly(p, { hand: id }, 0.45, 0.3, 0.5);
          stickyPeel(p.pose, 0.3);
        }
      }
      c.dirty = true;
      c.changed();
      return true;
    },
    cue(id, cue) {
      if (cue === 'peel') {
        const j = jobOf(c, id, ['going']);
        if (!j || overdue(j, now()) || j.move.kind === 'pass' || j.move.kind === 'fail' || !c.cols) return false;
        const shown = displayColumns(c.cols, boardHolds(c.jobs));
        const from = findCard(shown, j.move.from.card.key);
        const pose = boardPose(j.move.from.col, from?.col === j.move.from.col ? from.index : j.move.from.index, j.move.from.card.number, tmp);
        const p = spawn(c, `job:${j.id}`, label(j.move.from.card), kanbanNoteColor(j.move.from.col), pose);
        if (p) fly(p, { hand: id }, 0.45, 0.25, 0.7);
        stickyPeel(pose, 0.25);
        j.stage = 'held';
        note(c, 'peeled', j);
        c.changed();
        return true;
      }
      if (cue === 'slap') {
        const j = jobOf(c, id, ['going', 'held']);
        if (!j || overdue(j, now()) || j.move.to === 'monitor' || !c.cols) return false;
        if (j.stage === 'going' && j.move.kind !== 'pass' && j.move.kind !== 'fail') return false;
        const col = j.move.to;
        // where it goes once placed: what the board shows without it, or anyone waiting for it
        const shown = displayColumns(c.cols, boardHolds(c.jobs.filter((x) => x !== j && x.after !== j.id)));
        const at = findCard(shown, j.move.key);
        const pose = copyPose(newPose(), boardPose(col, at?.col === col ? at.index : shown[col].length, at?.card.number ?? j.move.from.card.number, tmp));
        const owner = `job:${j.id}`;
        const p = pieceOf(c, owner);
        const placed = () => {
          stickySlap(pose);
          free(c, owner);
          finish(c, j, 'placed');
        };
        if (p) fly(p, { pose }, 0.32, 0.2, -0.35, placed);
        else placed();
        return true;
      }
      return true; // 'cheer' and the like
    },
    end(id, how) {
      const j = jobOf(c, id, ['going', 'held']);
      if (!j || how === 'done') return; // a slap still in the air lands by itself
      if (j.move.kind === 'take' && j.stage === 'held') return; // they carry it home all the same
      free(c, `job:${j.id}`);
      finish(c, j, 'cut');
    },
  };
}

/** Where `agentId`'s hand is, for a sticky they hold: up at the board, in front while carrying, else at their side. */
function handPose(agentId: string, out: Pose): boolean {
  const st = bodyState(agentId);
  if (!st) return false;
  const g = st.stage === 'up' ? (bodyTarget(agentId)?.gesture ?? 'none') : 'none';
  const h = st.heading;
  const fx = -Math.sin(h);
  const fz = -Math.cos(h);
  const rx = Math.cos(h);
  const rz = -Math.sin(h);
  let r = 0.3;
  let f = 0.08;
  out.y = 0.8;
  out.yaw = h + Math.PI / 2;
  out.pitch = 0;
  if (g === 'reach' || g === 'post') {
    r = 0.22;
    f = 0.42;
    out.y = 1.72;
    out.yaw = h; // facing them, as you hold a note up to a wall
  } else if (g === 'hold') {
    r = 0;
    f = 0.44;
    out.y = 1.05;
    out.yaw = h + Math.PI; // showing it to whoever they walk towards
    out.pitch = -0.6;
  }
  out.x = st.x + rx * r + fx * f;
  out.z = st.z + rz * r + fz * f;
  out.roll = 0;
  out.w = 0.36;
  out.h = 0.17;
  return true;
}

// ---------- the hook and the mesh ----------

/** The board as the 3D whiteboard should draw it now, and the controller behind it (for <StickyNotes>). */
export function useStickyBoard(cols: KanbanColumns, agents: Agent[]) {
  const ctrl = useMemo(makeController, []);
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  ctrl.changed = bump;
  observe(ctrl, cols, agents);
  const shown = useMemo(() => displayColumns(cols, boardHolds(ctrl.jobs)), [cols, version, ctrl.jobs]);
  useEffect(() => {
    const b = makeBoard(ctrl);
    board = b;
    probe.ctrl = ctrl;
    return () => {
      if (board === b) board = null;
      if (probe.ctrl === ctrl) probe.ctrl = null;
      ctrl.tex.dispose();
    };
  }, [ctrl]);
  return { shown, ctrl };
}

const SLOT_W = 1 / ATLAS.cols;
const SLOT_H = 1 / ATLAS.rows;

export function StickyNotes({ ctrl }: { ctrl: Ctrl }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const gfx = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const slots = new Float32Array(PIECES * 2);
    for (let i = 0; i < PIECES; i++) {
      slots[i * 2] = (i % ATLAS.cols) * SLOT_W;
      slots[i * 2 + 1] = 1 - (Math.floor(i / ATLAS.cols) + 1) * SLOT_H; // canvas rows run down, uv v runs up
    }
    geometry.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slots, 2));
    const material = new THREE.MeshBasicMaterial({ map: ctrl.tex, toneMapped: false, side: THREE.DoubleSide });
    // each instance reads its own slot of the atlas
    material.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aSlot;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv = vMapUv * vec2(${SLOT_W.toFixed(6)}, ${SLOT_H.toFixed(6)}) + aSlot;`);
    };
    return { geometry, material, dummy: new THREE.Object3D(), target: newPose(), was: true };
  }, [ctrl]);
  useEffect(
    () => () => {
      gfx.geometry.dispose();
      gfx.material.dispose();
    },
    [gfx],
  );

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    gfx.dummy.scale.setScalar(0);
    gfx.dummy.updateMatrix();
    for (let i = 0; i < PIECES; i++) m.setMatrixAt(i, gfx.dummy.matrix);
    m.instanceMatrix.needsUpdate = true;
  }, [gfx]);

  useFrame((_, delta) => {
    const m = mesh.current;
    if (!m) return;
    const dt = Math.min(delta, 0.1);
    const t = now();
    const c = ctrl;

    // the board never waits longer than HOLD_MAX; a stale wait is skipped
    for (const j of c.jobs) {
      if (!overdue(j, t)) continue;
      free(c, `job:${j.id}`);
      finish(c, j, j.stage === 'waiting' ? 'skipped' : 'late');
    }
    // a tester back in their chair puts the sticky on their monitor
    for (const j of c.jobs) {
      if (j.move.kind !== 'take' || j.stage !== 'held') continue;
      const st = bodyState(j.move.agentId);
      const p = pieceOf(c, `job:${j.id}`);
      if (!st || st.stage === 'up' || (p && p.land)) continue;
      const done = () => {
        if (p) p.owner = `mon:${j.move.agentId}`;
        finish(c, j, 'placed');
      };
      if (p) fly(p, { pose: monitorPose(seatOf(c, j.move.agentId), gfx.target) }, 0.45, 0.35, 0.3, done);
      else done();
    }
    if (c.dirty) syncMonitors(c);

    let any = false;
    for (let i = 0; i < PIECES; i++) {
      const p = c.pieces[i];
      if (!p.owner) continue;
      any = true;
      p.t += dt;
      const target = p.to.hand ? (handPose(p.to.hand, gfx.target) ? gfx.target : p.pose) : p.to.pose!;
      let s = 1;
      if (p.t < 0) copyPose(p.pose, p.from);
      else if (p.t < p.dur) {
        const k = smooth(p.t / p.dur);
        const arc = Math.sin(Math.PI * k);
        const f = p.from;
        p.pose.x = f.x + (target.x - f.x) * k;
        p.pose.y = f.y + (target.y - f.y) * k + arc * 0.14;
        p.pose.z = f.z + (target.z - f.z) * k;
        p.pose.yaw = f.yaw + angleDelta(f.yaw, target.yaw) * k;
        p.pose.pitch = f.pitch + (target.pitch - f.pitch) * k + p.curl * arc;
        p.pose.roll = f.roll + (target.roll - f.roll) * k;
        p.pose.w = f.w + (target.w - f.w) * k;
        p.pose.h = f.h + (target.h - f.h) * k;
      } else if (p.to.hand) {
        // in hand: keep up with it, a touch springy
        const k = 1 - Math.exp(-dt * 18);
        p.pose.x += (target.x - p.pose.x) * k;
        p.pose.y += (target.y - p.pose.y) * k;
        p.pose.z += (target.z - p.pose.z) * k;
        p.pose.yaw += angleDelta(p.pose.yaw, target.yaw) * k;
        p.pose.pitch += (target.pitch - p.pose.pitch) * k;
        p.pose.roll = target.roll;
        p.pose.w = target.w;
        p.pose.h = target.h;
      } else {
        // landed: a tiny squash-and-settle bounce, then it's handed over
        copyPose(p.pose, target);
        const b = p.t - p.dur;
        s = 1 + 0.12 * Math.sin(b * 26) * Math.exp(-b * 11);
        if (b > 0.2 && p.land) {
          const land = p.land;
          p.land = null;
          land();
        }
      }
      const d = gfx.dummy;
      d.position.set(p.pose.x, p.pose.y, p.pose.z);
      d.rotation.set(p.pose.pitch, p.pose.yaw, p.pose.roll, 'YXZ');
      d.scale.set(p.owner ? p.pose.w * s : 0, p.owner ? p.pose.h * s : 0, 1);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
    }
    if (!any && !gfx.was) return;
    if (!any) {
      gfx.dummy.scale.setScalar(0);
      gfx.dummy.updateMatrix();
      for (let i = 0; i < PIECES; i++) m.setMatrixAt(i, gfx.dummy.matrix);
    } else {
      // freed this frame: hide them
      gfx.dummy.scale.setScalar(0);
      gfx.dummy.updateMatrix();
      for (let i = 0; i < PIECES; i++) if (!c.pieces[i].owner) m.setMatrixAt(i, gfx.dummy.matrix);
    }
    gfx.was = any;
    m.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[gfx.geometry, gfx.material, PIECES]} frustumCulled={false} />;
}

/** One sticky on each tester's monitor while they have a PR's (and until they've taken it back to the board). */
function syncMonitors(c: Ctrl) {
  c.dirty = false;
  if (!c.cols) return;
  for (const a of c.agents) {
    const testing = c.cols.qa.find((card) => card.qa?.status === 'testing' && card.qa.qaAgentId === a.id);
    const fetching = c.jobs.some((j) => j.move.agentId === a.id && j.move.kind === 'take');
    const bringing = c.jobs.find((j) => j.move.agentId === a.id && (j.move.kind === 'pass' || j.move.kind === 'fail') && j.stage === 'waiting');
    const card = bringing ? bringing.move.from.card : !fetching ? testing : undefined;
    const owner = `mon:${a.id}`;
    const p = pieceOf(c, owner);
    if (!card) {
      if (p) free(c, owner);
    } else if (!p) spawn(c, owner, label(card), kanbanNoteColor('qa'), monitorPose(a, tmp));
  }
}

// ---------- the probe ----------

const round = (n: number) => Math.round(n * 100) / 100;

const probe = {
  ctrl: null as Ctrl | null,
  /** Moves waiting for (or under way with) their errand. */
  jobs() {
    const c = this.ctrl;
    const t = now();
    return (c?.jobs ?? []).map((j) => ({ kind: j.move.kind, agent: j.move.agentId, stage: j.stage, card: j.move.key, from: j.move.from.col, to: j.move.to, age: round(t - j.at) }));
  },
  /** The loose stickies: on the move, in someone's hand or on a monitor. */
  stickies() {
    return (this.ctrl?.pieces ?? [])
      .filter((p) => p.owner)
      .map((p) => ({ owner: p.owner, label: p.label, hand: p.to.hand, x: round(p.pose.x), y: round(p.pose.y), z: round(p.pose.z) }));
  },
  /** What happened lately: queued, skipped, started, peeled, placed, late or cut, oldest first. */
  log() {
    return [...(this.ctrl?.log ?? [])];
  },
};

if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__swarmStickies = probe;
