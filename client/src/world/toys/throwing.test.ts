import { describe, expect, it } from 'vitest';
import { hoopRim, hoopSquare } from './hoopScore';
import { holdPoint, hoopShot, throwVelocity, type HoopAim, type View } from './throwing';

const o = () => ({ x: 0, y: 0, z: 0 });
const level: View = { eye: { x: 0, y: 1.65, z: 0 }, pitch: 0, yaw: 0 };

describe('ordinary throws', () => {
  it('holds a ball below and in front of the view', () => {
    const p = holdPoint(level, 0.4, 0, o());
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(1.65 - 0.5 - 0.36);
    expect(p.z).toBeCloseTo(-1.4);
  });

  it('throws through a point 12 m along the crosshair, from a lob to full speed, with lift and the walk added', () => {
    const from = { x: 0, y: 0.79, z: -1.4 };
    const aim = { x: 0, y: 1.65 - 0.79, z: -12 + 1.4 };
    const len = Math.hypot(aim.y, aim.z);
    const full = throwVelocity(level, from, 1, 14, { x: 1, z: 0 }, o());
    expect(full.x).toBeCloseTo(1);
    expect(full.y).toBeCloseTo((aim.y / len) * 14 + 0.9);
    expect(full.z).toBeCloseTo((aim.z / len) * 14);
    const lob = throwVelocity(level, from, 0, 14, { x: 0, z: 0 }, o());
    expect(Math.hypot(lob.x, lob.y - 1.6, lob.z)).toBeCloseTo(3.2);
  });
});

describe('the arcade hoop shot', () => {
  const hoop: HoopAim = { rim: hoopRim('office'), square: hoopSquare('office') };
  /** Standing `d` m out from the rim, looking at `at`. */
  const viewFrom = (d: number, at = hoop.square): View => {
    const eye = { x: hoop.rim.x, y: 1.65, z: hoop.rim.z - d };
    const dx = at.x - eye.x;
    const dz = at.z - eye.z;
    return { eye, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(at.y - eye.y, Math.hypot(dx, dz)) };
  };
  const shot = (view: View, power: number) => {
    const from = holdPoint(view, 0.12, 0, o());
    const v = o();
    return hoopShot(view, from, power, 10.5, hoop, v) ? v : null;
  };

  it('arcs up above the rim and towards it when aimed at the square', () => {
    const v = shot(viewFrom(4), 0.5);
    expect(v).not.toBeNull();
    expect(v!.y * v!.y / (2 * 9.81)).toBeGreaterThan(hoop.rim.y - 1);
    expect(Math.abs(v!.x)).toBeLessThan(1e-9);
    expect(v!.z).toBeGreaterThan(0);
  });

  it('throws harder the longer it was charged', () => {
    const view = viewFrom(4);
    expect(Math.hypot(...Object.values(shot(view, 0.2)!))).toBeLessThan(Math.hypot(...Object.values(shot(view, 0.8)!)));
  });

  it("leaves throws alone that aren't aimed at the hoop, are from too far away or from right under it", () => {
    expect(shot(viewFrom(4, { ...hoop.square, x: hoop.square.x + 1.2 }), 0.5)).toBeNull();
    expect(shot(viewFrom(4, { ...hoop.square, y: 0.5 }), 0.5)).toBeNull();
    expect(shot(viewFrom(12), 0.5)).toBeNull();
    expect(shot(viewFrom(0.5), 0.5)).toBeNull();
  });
});
