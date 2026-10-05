// A bare Rapier world with the ping-pong table, its net and the floor, to run the match runner (pongRunner.ts) on in
// tests: what the toy world does in PingPong.tsx, minus the rest of the office. For tests and tuning only: nothing in
// the client imports it, so it adds nothing to any bundle.

import RAPIER from '@dimforge/rapier3d-compat';
import type { PongResult } from '../../../../shared/pong';
import { airStep, netBox, PONG, type BallState, type V3 } from './pongPhysics';
import { PongRunner } from './pongRunner';

let ready: Promise<void> | null = null;
/** Loads the physics engine; await it once before building a world. */
export const loadPhysics = () => (ready ??= RAPIER.init());

export interface PongSim {
  world: RAPIER.World;
  ball: RAPIER.RigidBody;
  runner: PongRunner;
  /** Games the runner reported. */
  reports: PongResult[];
  /** One physics step, as the toy world takes it: the runner, the world, the runner again. */
  step(): void;
  free(): void;
}

function fixedWorld() {
  const world = new RAPIER.World({ x: 0, y: -PONG.gravity, z: 0 });
  world.timestep = PONG.step;
  world.numSolverIterations = PONG.substeps;
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  // the floor; the table top is the runner's own (the ball passes through it in Rapier, as in PingPong.tsx)
  world.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.5, 30).setTranslation(0, -0.5, 0).setRestitution(0.5).setFriction(0.8), fixed);
  const net = netBox();
  world.createCollider(RAPIER.ColliderDesc.cuboid(...net.half).setTranslation(...net.at).setRestitution(PONG.netBody.restitution).setFriction(PONG.netBody.friction), fixed);
  return world;
}

function ballBody(world: RAPIER.World, at: V3) {
  const ball = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y, at.z).setCcdEnabled(true));
  const m = PONG.body;
  world.createCollider(RAPIER.ColliderDesc.ball(PONG.ball.r).setRestitution(m.restitution).setFriction(m.friction).setDensity(m.density), ball);
  return ball;
}

/** A world with the runner on its ball (after loadPhysics). Agents are taken to be wherever they're sent. */
export function pongSim(rand?: () => number): PongSim {
  const world = fixedWorld();
  const ball = ballBody(world, { x: 0, y: -1, z: 0 });
  const reports: PongResult[] = [];
  const runner = new PongRunner(ball, { bodyAt: () => null, report: (r) => reports.push(r), rand });
  return {
    world,
    ball,
    runner,
    reports,
    step() {
      runner.before();
      world.step();
      runner.after();
    },
    free: () => world.free(),
  };
}

/**
 * Flies a ball from `b` through the Rapier world for `seconds`, adding the air's pull before every step as the toy
 * world does (no table bounce of our own: for the flight alone). Returns where it was after each step.
 */
export function flyRapier(b: BallState, seconds: number): V3[] {
  const world = fixedWorld();
  try {
    const ball = ballBody(world, b.p);
    ball.setLinvel(b.v, true);
    const s: BallState = { p: { ...b.p }, v: { ...b.v }, w: { ...b.w } };
    const out: V3[] = [];
    for (let t = 0; t < seconds; t += PONG.step) {
      const v = ball.linvel();
      s.v = { x: v.x, y: v.y, z: v.z };
      airStep(s, PONG.step); // as PongRunner.inPlay does
      ball.setLinvel(s.v, true);
      world.step();
      const p = ball.translation();
      out.push({ x: p.x, y: p.y, z: p.z });
    }
    return out;
  } finally {
    world.free();
  }
}

