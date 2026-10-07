import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { agentsOnRepo, coversView, useStore } from '../../store';
import { deskPosition, deskRotation, isEastDesk } from '../layout';
import { say } from '../people';
import { deskSpot } from '../walkways';
import { addProbe, useThemeRuntime } from './active';
import { useCostumes } from './kit/costumes';
import { free, sendHome, sendTo, type Person } from './kit/crowd';
import { cyl, heart, mergeParts, paintedToonDouble, part } from './kit/geo';
import { Decor, type ItemRenderers, type Spot } from './kit/Placed';
import { StringLights } from './kit/runs';
import { chime } from './kit/sfx';
import { Tint } from './kit/Tint';
import type { ThemeProps } from './ThemeLayer';
import { THEMES } from './themes';

// Valentine's Day (12–14 Feb): pink and red lights, a heart balloon tied to every desk, heart confetti when a PR merges
// (MergeConfetti.tsx), heart boppers, and now and then someone gets up and leaves a heart sticky on a teammate's
// monitor.

const DEF = THEMES.valentines;
const HEARTS = ['#ff4d6d', '#ff8fab', '#c9184a', '#ff758f'];

/** Heart balloons on strings over the desks, bobbing: one instanced mesh, tinted per balloon. */
function HeartBalloons({ at }: { at: Spot[] }) {
  const geo = useMemo(() => mergeParts([part(heart(0.32, 0.12), '#ffffff', [0, 1.05, 0]), part(cyl(0.004, 0.004, 0.9, 4), '#dddddd', [0, 0.45, 0])]), []);
  useEffect(() => () => geo.dispose(), [geo]);
  const ref = useRef<THREE.InstancedMesh>(null);
  const st = useMemo(() => ({ o: new THREE.Object3D(), c: new THREE.Color(), next: 0 }), []);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    at.forEach((_, i) => m.setColorAt(i, st.c.set(HEARTS[i % HEARTS.length])));
  }, [at, st]);
  useFrame(({ clock }) => {
    const m = ref.current;
    const t = clock.elapsedTime;
    if (!m || t < st.next) return;
    st.next = t + 1 / 20;
    at.forEach((s, i) => {
      st.o.position.set(s.x, s.y + Math.sin(t * 1.3 + i) * 0.03, s.z);
      st.o.rotation.set(Math.sin(t * 0.9 + i * 2) * 0.05, s.rotY + Math.sin(t * 0.5 + i) * 0.3, Math.sin(t * 1.1 + i) * 0.06);
      st.o.updateMatrix();
      m.setMatrixAt(i, st.o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, paintedToonDouble(), at.length]} frustumCulled={false} castShadow />;
}

const ITEMS: ItemRenderers = { heartBalloon: HeartBalloons };

// ---------- heart stickies ----------

interface Sticky {
  to: Person;
  from: string;
}

/** The heart on a monitor: its top right corner (the QA sticky goes on the left), facing the desk's owner. */
function stickyAt(p: Person) {
  const { x, z } = deskPosition(p.desk);
  const turn = deskRotation(p.desk);
  const [lx, lz] = [0.4, -0.262];
  return { x: x + lx * Math.cos(turn) + lz * Math.sin(turn), y: 1.58, z: z - lx * Math.sin(turn) + lz * Math.cos(turn), yaw: turn };
}

function Stickies({ list }: { list: Sticky[] }) {
  const geo = useMemo(() => mergeParts([part(heart(0.1, 0.01), '#ff4d6d', [0, 0, 0])]), []);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <>
      {list.map((s, i) => {
        const p = stickyAt(s.to);
        return <mesh key={i} geometry={geo} material={paintedToonDouble()} position={[p.x, p.y, p.z]} rotation={[-0.06, p.yaw, 0.15 - (i % 3) * 0.1]} />;
      })}
    </>
  );
}

export default function Valentines({ kind, repoId }: ThemeProps) {
  useCostumes();
  const agents = useStore((s) => s.agents);
  const people = useMemo(() => (repoId ? agentsOnRepo(agents, repoId).map((a) => ({ id: a.id, role: a.role, desk: a.desk })) : []), [agents, repoId]);
  const peopleRef = useRef(people);
  peopleRef.current = people;
  const [stickies, setStickies] = useState<Sticky[]>([]);
  const busy = useRef<string | null>(null);

  /** Someone free gets up, walks over to a teammate's desk and leaves a heart on their monitor. */
  const sendHeart = useCallback((): string | null => {
    if (kind !== 'office' || busy.current) return null;
    const all = peopleRef.current;
    const givers = all.filter((p) => p.role !== 'ceo' && free(p.id));
    if (!givers.length || all.length < 2) return null;
    const giver = givers[Math.floor(Math.random() * givers.length)];
    const others = all.filter((p) => p.id !== giver.id);
    const to = others[Math.floor(Math.random() * others.length)];
    const behind = deskSpot(to.desk);
    // beside the chair, facing the monitor (the way the desk faces)
    const stand = isEastDesk(to.desk) ? { x: behind.x, z: behind.z - 0.6 } : { x: behind.x + 0.6, z: behind.z };
    busy.current = giver.id;
    sendTo('office', giver, stand, deskRotation(to.desk), 'post', () => {
      setTimeout(() => {
        setStickies((l) => [...l.filter((s) => s.to.id !== to.id), { to, from: giver.id }].slice(-8));
        say(giver.id, '💘');
        chime(undefined);
        setTimeout(() => {
          say(giver.id, null);
          sendHome('office', giver);
          busy.current = null;
        }, 1500);
      }, 700);
    });
    return `${giver.id}→${to.id}`;
  }, [kind]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const next = (ms: number) => {
      timer = setTimeout(() => {
        if (!document.hidden && !coversView(useStore.getState().overlay)) sendHeart();
        next(60_000 + Math.random() * 90_000);
      }, ms);
    };
    next(20_000 + Math.random() * 20_000);
    return () => clearTimeout(timer);
  }, [sendHeart]);

  useEffect(() => {
    useThemeRuntime.setState({ status: '💘 Happy Valentine’s Day' + (stickies.length ? ` · ${stickies.length} heart${stickies.length === 1 ? '' : 's'} on monitors here` : '') });
  }, [stickies.length]);
  useEffect(() => () => useThemeRuntime.setState({ status: null }), []);
  useEffect(() => addProbe({ heart: () => sendHeart(), hearts: () => stickies.map((s) => `${s.from}→${s.to.id}`) }), [sendHeart, stickies]);

  if (kind === 'roof') return <Tint def={DEF} />;
  return (
    <group>
      <Decor id="valentines" kind={kind} items={ITEMS} />
      <StringLights kind={kind} colors={DEF.lights!} />
      <Tint def={DEF} />
      {kind === 'office' && <Stickies list={stickies} />}
    </group>
  );
}
