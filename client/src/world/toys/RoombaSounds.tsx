import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRenderPaused } from '../../perf';
import { useStore } from '../../store';
import { audio, createPanner, groupOutput, noise, recordSfx, setPannerPosition, tone, type Vec3 } from '../../ui/sfx';
import { ROOMBA_EVENT, type Roomba } from './roombaBrain';
import { bumpAllowed, humFor, humReach, type Hum } from './roombaSound';

// The roomba's sounds, all from where it is: a quiet motor-and-brush hum that follows its speed, a bonk when the
// bumper meets something, and little beeps when it leaves, heads home, docks, finishes charging or gets stuck.
// The hum is one node graph per roomba, built on first need and faded (never rebuilt); it's cut off from the mixer
// while silent so it costs nothing, and goes quiet while the tab is hidden, a panel or the phone is open, or the
// elevator travels.

const Y = 0.06; // the roomba's height, for the panner
const HUM_PEAK = 0.05;
const MOTOR_HZ = 110;
const WHINE_HZ = 1650;
const UNHOOK_AFTER = 0.8; // seconds of silence before the hum is disconnected

// ---------- one-shots ----------

const o = (name: string, pos: Vec3) => ({ name: `roomba:${name}`, group: 'toys', pos }) as const;

/** Leaving the dock: two rising beeps. */
function leaveBeeps(pos: Vec3) {
  [1046.5, 1568].forEach((freq, i) => tone({ ...o('leave', pos), freq, type: 'triangle', at: i * 0.13, dur: 0.1, peak: 0.06 }));
}

/** Heading home: a small descending trill. */
function homeTrill(pos: Vec3) {
  [1568, 1318.5, 1175, 988].forEach((freq, i) => tone({ ...o('home', pos), freq, type: 'triangle', at: i * 0.06, dur: 0.08, peak: 0.05 }));
}

/** Docked: one soft blip. */
function dockBlip(pos: Vec3) {
  tone({ ...o('dock', pos), freq: 784, to: 1175, dur: 0.14, peak: 0.07, attack: 0.01 });
}

/** Fully charged: a short happy tune. */
function fullTune(pos: Vec3) {
  [784, 988, 1175, 1568].forEach((freq, i) => tone({ ...o('full', pos), freq, type: 'triangle', at: i * 0.1, dur: i === 3 ? 0.3 : 0.12, peak: 0.055 }));
}

/** Stuck: a sad "uh-oh". */
function uhOh(pos: Vec3) {
  tone({ ...o('stuck', pos), freq: 659, type: 'triangle', dur: 0.16, peak: 0.06 });
  tone({ ...o('stuck', pos), freq: 494, to: 392, type: 'triangle', at: 0.2, dur: 0.32, peak: 0.06 });
}

/** The bumper meeting something: a soft plastic bonk. */
function bonk(pos: Vec3) {
  noise({ ...o('bump', pos), dur: 0.06, peak: 0.07, filter: 'bandpass', freq: 1100, q: 1.6, attack: 0.002 });
  tone({ ...o('bump', pos), freq: 210, to: 140, dur: 0.09, peak: 0.06, attack: 0.003 });
}

// ---------- the hum ----------

interface HumGraph {
  env: GainNode;
  panner: PannerNode;
  out: AudioNode;
  motor: OscillatorNode;
  whine: OscillatorNode;
  brush: AudioBufferSourceNode;
  hooked: boolean;
}

/** Motor (a soft sawtooth), a faint whine and the brush's hiss, into one envelope and a panner. Starts silent and unhooked. */
function buildHum(ctx: AudioContext, out: AudioNode, pos: Vec3): HumGraph {
  const env = ctx.createGain();
  env.gain.value = 0;
  const panner = createPanner(ctx, pos);
  env.connect(panner);

  const motor = ctx.createOscillator();
  motor.type = 'sawtooth';
  motor.frequency.value = MOTOR_HZ;
  const motorLp = ctx.createBiquadFilter();
  motorLp.type = 'lowpass';
  motorLp.frequency.value = 480;
  motorLp.Q.value = 0.7;
  const motorG = ctx.createGain();
  motorG.gain.value = 0.55;
  motor.connect(motorLp).connect(motorG).connect(env);

  const whine = ctx.createOscillator();
  whine.type = 'triangle';
  whine.frequency.value = WHINE_HZ;
  const whineG = ctx.createGain();
  whineG.gain.value = 0.05;
  whine.connect(whineG).connect(env);

  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const brush = ctx.createBufferSource();
  brush.buffer = buf;
  brush.loop = true;
  const brushBp = ctx.createBiquadFilter();
  brushBp.type = 'bandpass';
  brushBp.frequency.value = 2800;
  brushBp.Q.value = 0.6;
  const brushG = ctx.createGain();
  brushG.gain.value = 0.35;
  brush.connect(brushBp).connect(brushG).connect(env);

  motor.start();
  whine.start();
  brush.start();
  motor.onended = () => {
    try {
      panner.disconnect();
      env.disconnect();
    } catch {
      // already disconnected
    }
  };
  return { env, panner, out, motor, whine, brush, hooked: false };
}

/** One roomba's sounds. Lives inside the Canvas next to the roomba; unmounting (a floor change) fades the hum out. */
export function RoombaSounds({ brain }: { brain: Roomba }) {
  const paused = useRenderPaused();
  // the phone and other see-through panels too: you're busy with them, not listening to the floor
  const away = useStore((s) => s.travel !== null || s.overlay !== null);
  const quiet = paused || away;
  const s = useRef({ graph: null as HumGraph | null, level: 0, pitch: 1, silentFor: 0, lastBump: -Infinity, quiet, humming: false });
  s.current.quiet = quiet;
  const pos = useMemo<Vec3>(() => ({ x: brain.x, y: Y, z: brain.z }), [brain]);
  const hum = useMemo<Hum>(() => ({ level: 0, pitch: 1 }), []);

  // Nobody watching or the elevator moving: fade straight out (the frame loop may have stopped, so not in useFrame).
  useEffect(() => {
    const g = s.current.graph;
    const a = audio();
    if (!quiet || !g || !a) return;
    try {
      g.env.gain.cancelScheduledValues(a.ctx.currentTime);
      g.env.gain.setTargetAtTime(0, a.ctx.currentTime, 0.04);
    } catch {
      // audio is optional
    }
    s.current.level = 0;
    s.current.humming = false;
    // and once it has faded, take it off the mixer: the frame loop that would do it may not run until they're back
    const unhook = setTimeout(() => {
      if (!g.hooked || s.current.graph !== g) return;
      try {
        g.panner.disconnect();
      } catch {
        // already disconnected
      }
      g.hooked = false;
    }, 400);
    return () => clearTimeout(unhook);
  }, [quiet]);

  useEffect(
    () => () => {
      const g = s.current.graph;
      s.current.graph = null;
      if (!g) return;
      try {
        const t = g.env.context.currentTime;
        g.env.gain.cancelScheduledValues(t);
        g.env.gain.setTargetAtTime(0, t, 0.05);
        for (const n of [g.motor, g.whine, g.brush]) n.stop(t + 0.4);
      } catch {
        // audio is optional
      }
    },
    [],
  );

  useFrame(({ camera }, dt) => {
    const st = s.current;
    pos.x = brain.x;
    pos.z = brain.z;

    // ---- one-shots from the brain's flags ----
    const ev = brain.events;
    if (ev) {
      brain.events = 0;
      if (!st.quiet) {
        if (ev & ROOMBA_EVENT.leave) leaveBeeps(pos);
        if (ev & ROOMBA_EVENT.home) homeTrill(pos);
        if (ev & ROOMBA_EVENT.dock) dockBlip(pos);
        if (ev & ROOMBA_EVENT.full) fullTune(pos);
        if (ev & ROOMBA_EVENT.stuck) uhOh(pos);
        const now = performance.now() / 1000;
        if (ev & ROOMBA_EVENT.bump && bumpAllowed(st.lastBump, now)) {
          st.lastBump = now;
          bonk(pos);
        }
      }
    }

    // ---- the hum ----
    humFor(brain.state, brain.move, brain.speed, hum);
    const d = Math.hypot(camera.position.x - pos.x, camera.position.y - pos.y, camera.position.z - pos.z);
    const level = st.quiet ? 0 : hum.level * humReach(d);
    if (level > 0 && !st.humming) recordSfx('roomba:hum', { group: 'toys', pos, peak: HUM_PEAK * hum.level, played: !!audio() });
    st.humming = level > 0;

    let g = st.graph;
    if (!g) {
      if (level <= 0) return;
      const a = audio();
      const out = groupOutput('toys');
      if (!a || !out) return;
      try {
        g = st.graph = buildHum(a.ctx, out, pos);
      } catch {
        return;
      }
    }
    try {
      const t = g.env.context.currentTime;
      if (level > 0) {
        st.silentFor = 0;
        if (!g.hooked) {
          g.panner.connect(g.out);
          g.hooked = true;
        }
      } else if (g.hooked && (st.silentFor += dt) > UNHOOK_AFTER) {
        g.panner.disconnect();
        g.hooked = false;
      }
      if (!g.hooked) return;
      setPannerPosition(g.panner, pos.x, pos.y, pos.z);
      if (Math.abs(level - st.level) > 0.01) {
        st.level = level;
        g.env.gain.setTargetAtTime(HUM_PEAK * level, t, 0.12);
      }
      if (level > 0 && Math.abs(hum.pitch - st.pitch) > 0.005) {
        st.pitch = hum.pitch;
        g.motor.frequency.setTargetAtTime(MOTOR_HZ * hum.pitch, t, 0.15);
        g.whine.frequency.setTargetAtTime(WHINE_HZ * hum.pitch, t, 0.15);
      }
    } catch {
      // audio is optional
    }
  });

  return null;
}
