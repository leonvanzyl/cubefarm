// A throw simulation for the basketball: stand somewhere, aim at something, charge for so long, and see whether it
// scores. It runs the real physics engine (Rapier) with the real numbers: the hoop's colliders (hoopColliders), the
// basketball, the hold point and throw velocity (throwing.ts), the charge curve (hands.ts) and the scoring rule
// (stepHoop). For tests and tuning only: nothing in the client imports it, so it adds nothing to any bundle.

import RAPIER from '@dimforge/rapier3d-compat';
import { EYE_HEIGHT, HALF_D, WALL_H } from '../layout';
import { HOOP, HOOP_X, hoopColliders, hoopRim, hoopSquare, newTrack, stepHoop, type Vec3 } from './hoopScore';
import { CHARGE, chargePower, HOLD, holdPoint, hoopShot, THROW, throwVelocity, type View } from './throwing';

const STEP = 1 / 60;
const GRAVITY = { x: 0, y: -9.81, z: 0 };
const NO_WALK = { x: 0, z: 0 };

export interface Shot {
  /** Horizontal distance from the player's eye to the rim's centre, in metres. */
  distance: number;
  /** Where round the hoop: 0 straight in front, positive towards +x, in degrees. */
  angle: number;
  /** How long the throw button was held, in ms. */
  chargeMs: number;
  /** Where the crosshair points; defaults to the middle of the painted square. */
  aim?: Vec3;
  /** Throw it as an ordinary ball, without the arcade shot (hoopShot): how the basketball was thrown before it. */
  plain?: boolean;
}

export interface ShotResult {
  scored: boolean;
  /** Touched the rim, its plate or the backboard before scoring or falling away. */
  touched: boolean;
}

/** Where the player stands for `shot`, looking at its aim point. */
export function shotView(shot: Pick<Shot, 'distance' | 'angle' | 'aim'>): View {
  const rim = hoopRim('office');
  const a = (shot.angle * Math.PI) / 180;
  const eye = { x: rim.x + shot.distance * Math.sin(a), y: EYE_HEIGHT, z: rim.z - shot.distance * Math.cos(a) };
  const aim = shot.aim ?? hoopSquare('office');
  const dx = aim.x - eye.x;
  const dz = aim.z - eye.z;
  return { eye, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(aim.y - eye.y, Math.hypot(dx, dz)) };
}

let ready: Promise<void> | null = null;
/** Loads the physics engine; await it once before shooting. */
export const loadPhysics = () => (ready ??= RAPIER.init());

/** Throws the basketball (after loadPhysics) and follows it for up to 3 s. */
export function shoot(shot: Shot): ShotResult {
  const world = new RAPIER.World(GRAVITY);
  world.timestep = STEP;
  world.numSolverIterations = 8;
  try {
    const at = { x: HOOP_X.office, y: 0, z: HALF_D };
    const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const hoop = new Set<number>();
    for (const c of hoopColliders()) {
      const desc = c.box ? RAPIER.ColliderDesc.cuboid(...c.box) : RAPIER.ColliderDesc.ball(c.ball ?? 0);
      desc.setTranslation(at.x + c.at[0], c.at[1], at.z + c.at[2]).setRestitution(c.restitution).setFriction(c.friction);
      hoop.add(world.createCollider(desc, fixed).handle);
    }
    // the floor, the ceiling and the south wall, as in ToyWorld's Building
    world.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.5, 30).setTranslation(at.x, -0.5, at.z).setRestitution(0.5).setFriction(0.8), fixed);
    world.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.5, 30).setTranslation(at.x, WALL_H + 0.5, at.z), fixed);
    world.createCollider(RAPIER.ColliderDesc.cuboid(30, 5, 0.5).setTranslation(at.x, 5, at.z + 0.5).setRestitution(0.5).setFriction(0.6), fixed);

    const view = shotView(shot);
    const ballDef = HOOP.ball;
    const power = chargePower(shot.chargeMs);
    const from = holdPoint(view, ballDef.r, power * HOLD.windUp, { x: 0, y: 0, z: 0 });
    const v = { x: 0, y: 0, z: 0 };
    if (shot.plain || !hoopShot(view, from, power, ballDef.throwSpeed, { rim: hoopRim('office'), square: hoopSquare('office') }, v)) throwVelocity(view, from, power, ballDef.throwSpeed, NO_WALK, v);
    const ball = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(from.x, from.y, from.z).setLinvel(v.x, v.y, v.z).setLinearDamping(THROW.flightDamping).setAngularDamping(ballDef.damping).setCcdEnabled(true),
    );
    world.createCollider(
      RAPIER.ColliderDesc.ball(ballDef.r).setRestitution(ballDef.restitution).setFriction(0.7).setDensity(ballDef.density).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      ball,
    );

    const rim = hoopRim('office');
    const track = newTrack();
    stepHoop(track, ball.translation(), rim);
    const events = new RAPIER.EventQueue(true);
    let touched = false;
    let landed = false;
    for (let i = 0; i < 180; i++) {
      world.step(events);
      events.drainCollisionEvents((a, b, started) => {
        if (!started) return;
        // the first touch of anything ends the low-drag flight, as ToyWorld's `landed` does
        if (!landed) ball.setLinearDamping(ballDef.damping);
        landed = true;
        if (hoop.has(a) || hoop.has(b)) touched = true;
      });
      const p = ball.translation();
      if (stepHoop(track, p, rim)) return { scored: true, touched };
      if (p.y < rim.y - 1 && ball.linvel().y < 0) break;
    }
    events.free();
    return { scored: false, touched };
  } finally {
    world.free();
  }
}

export interface ChargeWindow {
  /** Every charge time (ms, in `step` ms steps from 0 to a full charge) that scores. */
  scoring: number[];
  /** The longest unbroken run of scoring charge times, and its width in ms (0 when nothing scores). */
  from: number;
  to: number;
  width: number;
}

/** Sweeps the charge time for a shot from 0 to a full charge and reports which times score. */
export function chargeWindow(shot: Omit<Shot, 'chargeMs'>, step = 5): ChargeWindow {
  const scoring: number[] = [];
  let best = { from: 0, to: 0, width: 0 };
  let runFrom = -1;
  for (let ms = 0; ms <= CHARGE.full; ms += step) {
    if (shoot({ ...shot, chargeMs: ms }).scored) {
      scoring.push(ms);
      if (runFrom < 0) runFrom = ms;
      // a sample stands for the `step` ms around it
      const width = ms - runFrom + step;
      if (width > best.width) best = { from: runFrom, to: ms, width };
    } else runFrom = -1;
  }
  return { scoring, ...best };
}
