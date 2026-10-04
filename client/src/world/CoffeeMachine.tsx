import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { noise, tone, type Vec3 } from '../ui/sfx';
import { BREW, BREW_CUES, EMPTY, canPlace, cuesPassed, level, placeMug, pouring, pressButton, progress, takeMug, tick, type BrewState } from './coffee';
import { useInteractable } from './interact';
import { glow, toon } from './materials';
import { MUG_SIZE, MugLook, Steam, mugColor } from './toys/mugLook';
import { MUG, stowMug } from './toys/mugs';
import { Box, Cyl } from './Toon';

// The kitchenette's coffee machine: put a mug under the spout, press the button, and it grinds, hisses and pours
// for a few seconds, then beeps. The rules are in coffee.ts; this draws them and plays the sounds. There is one
// machine on screen (only the current floor is drawn), so its state lives here and a floor change starts it afresh.

let state: BrewState = EMPTY;
let brews = 0;
let cue = 0; // the next of BREW_CUES to play
const listeners = new Set<() => void>();

function set(next: BrewState) {
  if (next === state) return;
  state = next;
  for (const fn of listeners) fn();
}

// Where the machine's spout is in the world, for its sounds (filled in once it's drawn).
const spot: Vec3 = { x: 0, y: 0, z: 0 };

// ---------- sounds ----------

const SFX = { group: 'toys', pos: spot } as const;

const sounds = {
  button: () => tone({ ...SFX, name: 'coffee-button', freq: 1800, to: 1200, type: 'square', dur: 0.05, peak: 0.04 }),
  nope: () => {
    tone({ ...SFX, name: 'coffee-nope', freq: 240, to: 170, type: 'square', dur: 0.12, peak: 0.05 });
    tone({ ...SFX, name: 'coffee-nope', freq: 200, to: 140, type: 'square', at: 0.14, dur: 0.14, peak: 0.05 });
  },
  clink: () => tone({ ...SFX, name: 'coffee-mug', freq: 2400, type: 'triangle', dur: 0.08, peak: 0.04, attack: 0.003 }),
  grind: () => {
    noise({ ...SFX, name: 'coffee-grind', dur: 1.0, peak: 0.05, filter: 'bandpass', freq: 2400, to: 1500, q: 2.5, attack: 0.04 });
    tone({ ...SFX, name: 'coffee-grind', freq: 118, to: 96, type: 'sawtooth', dur: 1.0, peak: 0.025, attack: 0.04 });
  },
  hiss: () => noise({ ...SFX, name: 'coffee-hiss', dur: 1.1, peak: 0.03, filter: 'highpass', freq: 3200, q: 0.7, attack: 0.15 }),
  gurgle: () => {
    for (let i = 0; i < 3; i++) tone({ ...SFX, name: 'coffee-gurgle', freq: 210 - i * 25, to: 95, type: 'sine', at: i * 0.13 + Math.random() * 0.04, dur: 0.11, peak: 0.05 });
    noise({ ...SFX, name: 'coffee-hiss', dur: 0.7, peak: 0.02, filter: 'highpass', freq: 3000, attack: 0.1 });
  },
  done: () => {
    tone({ ...SFX, name: 'coffee-done', freq: 1318.5, type: 'triangle', dur: 0.12, peak: 0.07 });
    tone({ ...SFX, name: 'coffee-done', freq: 1760, type: 'triangle', at: 0.14, dur: 0.2, peak: 0.07 });
  },
};

// ---------- actions (Player's E / click on the machine) ----------

export type CoffeeOp = 'place' | 'brew' | 'take';

/** Aim at the machine and press E: put your mug under the spout, press the button, or take the mug. */
export function coffeeAction(op: CoffeeOp) {
  const s = useStore.getState();
  const now = performance.now();
  set(tick(state, now));
  if (op === 'place') {
    const held = s.held;
    if (held?.kind !== 'mug' || !canPlace(state, held.sips)) return;
    const mug = stowMug();
    if (!mug) return;
    set(placeMug(state, { id: mug.id, sips: mug.sips }));
    sounds.clink();
  } else if (op === 'brew') {
    const r = pressButton(state, now);
    if (r.result === 'busy') return; // already brewing: the button does nothing
    if (r.result !== 'started') {
      sounds.nope();
      s.pushToast('info', r.result === 'noMug' ? '☕ Put a mug under the machine first' : '☕ Your coffee is ready: take the mug');
      return;
    }
    set(r.state);
    cue = 0;
    brews++;
    sounds.button();
  } else {
    const r = takeMug(state, now);
    if (!r) return;
    set(r.state);
    s.setHeld({ kind: 'mug', id: r.mug.id, sips: r.mug.sips }); // whatever you held falls, as with any pickup
    sounds.clink();
  }
}

// ---------- probe ----------

/** window.__swarmCoffee: the current floor's machine, for QA and Playwright. */
export interface CoffeeSnapshot {
  state: BrewState['kind'];
  /** The mug under the spout, with the whole sips it would have if taken now. */
  mug: { id: string; sips: number } | null;
  /** 0-1 through the brew, and the coffee in the mug in (fractional) sips. */
  progress: number;
  level: number;
  /** Brews started since the machine was drawn. */
  brews: number;
}

if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmCoffee')) {
  Object.defineProperty(window, '__swarmCoffee', {
    get: (): CoffeeSnapshot => {
      const now = performance.now();
      const s = tick(state, now);
      const lvl = level(s, now);
      return { state: s.kind, mug: s.kind === 'empty' ? null : { id: s.mug.id, sips: Math.round(lvl) }, progress: progress(s, now), level: lvl, brews };
    },
    enumerable: false,
    configurable: false,
  });
  // __swarmCoffeeDo('place' | 'brew' | 'take'): act on the machine without aiming (pointer lock doesn't work headless).
  Object.defineProperty(window, '__swarmCoffeeDo', { value: (op: CoffeeOp) => coffeeAction(op), enumerable: false, configurable: false });
}

// ---------- drawing ----------

const COFFEE = '#6f4518';
// The mug sits on the drip tray in front of the machine, under the spout.
const SLOT = { x: -0.25, tray: 0.02 };
const SPOUT_Y = 0.21;
const PUFFS = [0, 1, 2, 3];
const ROT_HANDLE: [number, number, number] = [0, -Math.PI / 2, 0];

const lightOff = toon('#ced4da');
const lightBrewing = glow('#ffb703');
const lightReady = glow('#80ed99');

/** The coffee machine, standing on the counter at `position` (the counter top under its middle). */
export function CoffeeMachine({ position }: { position: [number, number, number] }) {
  const [view, setView] = useState(state);
  const heldSips = useStore((s) => (s.held?.kind === 'mug' ? s.held.sips : null));
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const steam = useRef<THREE.Group>(null);
  const stream = useRef<THREE.Mesh>(null);
  const coffee = useRef<THREE.Mesh>(null);
  const located = useRef(false);

  // A fresh floor gets a fresh machine.
  useEffect(() => {
    state = EMPTY;
    brews = 0;
    cue = 0;
    setView(state);
    const fn = () => setView(state);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
      state = EMPTY;
    };
  }, []);

  const mugIn = view.kind !== 'empty';
  const tray = useInteractable<THREE.Group>(
    mugIn
      ? { id: 'coffee:slot', label: view.kind === 'ready' ? 'Take coffee' : 'Take mug', action: { kind: 'coffee', op: 'take' } }
      : heldSips !== null && canPlace(view, heldSips)
        ? { id: 'coffee:slot', label: 'Put mug under the machine', action: { kind: 'coffee', op: 'place' } }
        : null,
    2.8,
  );
  const button = useInteractable<THREE.Group>({ id: 'coffee:button', label: 'Brew coffee', action: { kind: 'coffee', op: 'brew' } }, 2.8);

  useFrame(() => {
    const g = root.current;
    if (!g) return;
    const now = performance.now();
    if (!located.current) {
      located.current = true;
      g.updateWorldMatrix(true, false);
      const at = g.localToWorld(new THREE.Vector3(SLOT.x, SPOUT_Y, 0)); // once: the lobby's machine is turned
      spot.x = at.x;
      spot.y = at.y;
      spot.z = at.z;
    }

    if (state.kind === 'brewing') {
      const doneAt = state.start + BREW.ms;
      const next = tick(state, now);
      set(next);
      if (next.kind === 'ready' && now - doneAt < 1500) sounds.done(); // not when it finished while the view was paused
    }

    const brewing = state.kind === 'brewing';
    const p = progress(state, now);
    if (brewing) {
      // Play each sound as the brew passes it; ones missed while the view was paused are skipped.
      const upto = cuesPassed(cue, p);
      for (; cue < upto; cue++) if (p - BREW_CUES[cue].at < 0.3) sounds[BREW_CUES[cue].name]();
    }

    const t = now / 1000;
    if (body.current) {
      const shake = brewing ? (p < BREW.grind ? 0.003 : 0.0012) : 0;
      body.current.position.set(Math.sin(t * 97) * shake, Math.abs(Math.sin(t * 61)) * shake * 0.5, Math.cos(t * 83) * shake);
    }

    const lvl = level(state, now);
    const { r, rBase, h } = MUG_SIZE;
    const coffeeY = SLOT.tray + 0.008 + 0.004 + (lvl / 3) * (h - 0.026);
    if (coffee.current) {
      coffee.current.visible = lvl > 0.02;
      coffee.current.position.y = coffeeY;
      coffee.current.scale.setScalar(rBase + (r - rBase) * ((coffeeY - SLOT.tray) / h) - 0.003);
    }
    if (stream.current) {
      const on = brewing && pouring(p);
      stream.current.visible = on;
      if (on) {
        const len = SPOUT_Y - coffeeY;
        stream.current.scale.y = len;
        stream.current.position.y = coffeeY + len / 2;
        stream.current.scale.x = stream.current.scale.z = 1 + Math.sin(t * 40) * 0.25;
      }
    }
    if (steam.current) {
      steam.current.visible = brewing && p > BREW.grind;
      if (steam.current.visible) {
        const puffs = steam.current.children;
        for (let i = 0; i < puffs.length; i++) {
          const c = puffs[i] as THREE.Mesh;
          const k = (t * 0.9 + i / puffs.length) % 1;
          c.position.set(Math.sin(t * 2 + i * 1.7) * 0.02, k * 0.35, Math.cos(t * 1.6 + i) * 0.02);
          c.scale.setScalar(0.6 + k * 1.4);
          (c.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - k);
        }
      }
    }
  });

  return (
    <group ref={root} position={position}>
      {/* rumbles while it brews */}
      <group ref={body}>
        <Box size={[0.45, 0.55, 0.4]} position={[0.05, 0.28, 0]} color="#343a40" outline />
        {/* head over the drip tray, and its spout */}
        <Box size={[0.22, 0.1, 0.28]} position={[SLOT.x + 0.01, SPOUT_Y + 0.07, 0]} color="#495057" outline />
        <Cyl r={0.018} h={0.03} position={[SLOT.x, SPOUT_Y + 0.005, 0]} color="#adb5bd" />
        {/* power light */}
        <mesh position={[-0.2, 0.39, 0.13]} rotation={[0, -Math.PI / 2, 0]} material={glow('#ff6b6b')}>
          <circleGeometry args={[0.02, 12]} />
        </mesh>
        {/* the brew button: lights up while brewing, green when the coffee is ready */}
        <group ref={button} position={[-0.18, 0.42, -0.06]}>
          <Cyl r={0.045} h={0.02} rotation={[0, 0, Math.PI / 2]} color="#212529" />
          <mesh position={[-0.012, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={view.kind === 'brewing' ? lightBrewing : view.kind === 'ready' ? lightReady : lightOff}>
            <cylinderGeometry args={[0.032, 0.034, 0.018, 18]} />
          </mesh>
          <mesh visible={false}>
            <boxGeometry args={[0.08, 0.13, 0.13]} />
          </mesh>
        </group>
        <group ref={steam} position={[0.05, 0.56, -0.08]} visible={false}>
          {PUFFS.map((i) => (
            <mesh key={i}>
              <sphereGeometry args={[0.035, 8, 6]} />
              <meshBasicMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} />
            </mesh>
          ))}
        </group>
      </group>
      {/* drip tray and the mug slot */}
      <group ref={tray}>
        <Box size={[0.2, SLOT.tray, 0.26]} position={[SLOT.x, SLOT.tray / 2, 0]} color="#6c757d" outline />
        {view.kind !== 'empty' && (
          <group position={[SLOT.x, SLOT.tray + MUG_SIZE.h / 2, 0]} rotation={ROT_HANDLE}>
            <MugLook color={mugColor(view.mug.id)} sips={0} steam={false} />
            {view.kind === 'ready' && <Steam y={MUG_SIZE.h / 2} sips={MUG.maxSips} />}
          </group>
        )}
        <mesh visible={false} position={[SLOT.x, 0.09, 0]}>
          <boxGeometry args={[0.22, 0.18, 0.28]} />
        </mesh>
      </group>
      <mesh ref={coffee} position={[SLOT.x, SLOT.tray, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false} material={toon(COFFEE)}>
        <circleGeometry args={[1, 20]} />
      </mesh>
      <mesh ref={stream} position={[SLOT.x, 0.1, 0]} visible={false} material={toon(COFFEE)}>
        <cylinderGeometry args={[0.006, 0.006, 1, 6]} />
      </mesh>
    </group>
  );
}
