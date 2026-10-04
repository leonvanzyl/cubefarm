import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useRenderPaused } from '../../perf';
import { useStore } from '../../store';
import { markBloom } from '../gfx/bloomMarks';
import { setWeatherQuiet, startWeatherSounds, stopWeatherSounds } from '../../ui/weatherSfx';
import { roofElevation, viewElevation } from '../layout';
import { Precipitation } from './Precipitation';
import { seeded } from './weatherRules';
import { weather, WeatherClock, useWeather } from './weatherState';
import { WetGlass } from './WetGlass';

// The weather (weatherState.ts runs it, Settings → Weather picks where it comes from): its clock always, and while
// there's any weather at all, the rain or snow, the wet glass and balcony, lightning bolts and the sounds. In a clear
// sky (and with the weather Off) only the clock is mounted, and it does next to nothing.

type FloorKind = 'office' | 'lobby' | 'roof';

export function Weather({ kind }: { kind: FloorKind }) {
  const { active } = useWeather();
  return (
    <>
      <WeatherClock />
      {active && <WeatherScene kind={kind} />}
    </>
  );
}

function WeatherScene({ kind }: { kind: FloorKind }) {
  const floor = useStore((s) => s.floor);
  const top = useStore((s) => s.repos.reduce((m, r) => Math.max(m, r.floor), 0));
  const elevation = viewElevation(kind === 'lobby' ? 0 : floor, top);
  return (
    <>
      <Precipitation elevation={elevation} roof={roofElevation(top) - elevation} onRoof={kind === 'roof'} />
      <WetGlass kind={kind} />
      <Bolt elevation={elevation} />
      <WeatherSounds kind={kind} />
    </>
  );
}

/** The storm's sounds, started with the weather and quiet behind a panel, the phone or the elevator like the others. */
function WeatherSounds({ kind }: { kind: FloorKind }) {
  const paused = useRenderPaused();
  const away = useStore((s) => s.travel !== null || s.overlay !== null);
  useEffect(() => setWeatherQuiet(paused || away), [paused, away]);
  useEffect(() => {
    startWeatherSounds(kind, () => weather.mix);
    return stopWeatherSounds;
  }, [kind]);
  return null;
}

// ---------- lightning ----------

const SEGMENTS = 14;
const BRANCH = 6;
const VERTS = (SEGMENTS + BRANCH) * 6;

/**
 * A jagged bolt from the clouds to the ground, far out on one side, while a flash lasts: a fresh one each strike,
 * written into one fixed buffer (no allocation), drawn additive on top of the sky. One draw call, only in a flash.
 */
function Bolt({ elevation }: { elevation: number }) {
  const stuff = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(VERTS * 3), 3));
    const mat = markBloom(new THREE.MeshBasicMaterial({ color: '#eef2ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    mesh.visible = false;
    return { geo, mat, mesh, seed: -1 };
  }, []);
  useEffect(
    () => () => {
      stuff.geo.dispose();
      stuff.mat.dispose();
    },
    [stuff],
  );

  useFrame(() => {
    const f = weather.flash;
    stuff.mesh.visible = f > 0.15;
    if (!stuff.mesh.visible) return;
    stuff.mat.opacity = Math.min(1, f * 1.4);
    if (stuff.seed === weather.boltSeed) return;
    stuff.seed = weather.boltSeed;
    // a new bolt: 130-200 m out on the strike's side, from the cloud base down to the street
    const rnd = seeded(Math.floor(weather.boltSeed * 1e9));
    const side = weather.boltSide;
    const x0 = side * (130 + rnd() * 70);
    const z0 = (rnd() - 0.5) * 220;
    const top = 110 - elevation;
    const ground = -elevation;
    const arr = stuff.geo.attributes.position.array as Float32Array;
    let v = 0;
    const quad = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number) => {
      // a ribbon facing the building (across z)
      const pts = [ax, ay, az - w, bx, by, bz - w, bx, by, bz + w, ax, ay, az - w, bx, by, bz + w, ax, ay, az + w];
      for (let i = 0; i < 18; i++) arr[v++] = pts[i];
    };
    let x = x0;
    let y = top;
    let z = z0;
    const step = (top - ground) / SEGMENTS;
    const fork = 3 + Math.floor(rnd() * 5);
    let fx = 0;
    let fy = 0;
    let fz = 0;
    for (let i = 0; i < SEGMENTS; i++) {
      const nx = x + (rnd() - 0.5) * 9;
      const nz = z + (rnd() - 0.5) * 14;
      const ny = y - step * (0.7 + rnd() * 0.6);
      quad(x, y, z, nx, Math.max(ground, ny), nz, 1.1 - i * 0.04);
      if (i === fork) [fx, fy, fz] = [x, y, z];
      x = nx;
      y = Math.max(ground, ny);
      z = nz;
    }
    // a branch off one of the upper kinks, petering out
    for (let i = 0; i < BRANCH; i++) {
      const nx = fx + (rnd() - 0.3) * 8;
      const nz = fz + (rnd() - 0.5) * 12 + side * 4;
      const ny = fy - step * 0.6;
      quad(fx, fy, fz, nx, ny, nz, 0.6 - i * 0.08);
      [fx, fy, fz] = [nx, ny, nz];
    }
    stuff.geo.attributes.position.needsUpdate = true;
  });

  return <primitive object={stuff.mesh} />;
}
