import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../../../store';
import { loop, placeAt } from '../../../ui/eventSfx';
import { seeded } from '../director';
import { eyeAbove, inOut, lerp, sign, toonOut, type SceneProps } from '../kit';
import { bannerText } from '../news';

// A blimp cruising slowly across the view towing a banner with the office's own news ("PR #212 merged! 🎉", "Floor 2:
// 7 merges today"), the banner rippling in the wind behind it, its propellers turning and its engines droning.

const BANNER = { w: 46, h: 6, segments: 40 };

function bannerTexture(text: string) {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fffaf0';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#e63946';
  ctx.lineWidth = 18;
  ctx.strokeRect(9, 9, c.width - 18, c.height - 18);
  ctx.fillStyle = '#1f1d2b';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 170;
  do ctx.font = `bold ${size}px "Segoe UI", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  while (ctx.measureText(text).width > c.width - 120 && (size -= 8) > 60);
  ctx.fillText(text, c.width / 2, c.height / 2 + 8);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export default function Blimp({ run, elevation }: SceneProps) {
  const blimp = useRef<THREE.Group>(null);
  const props = useRef<THREE.Group>(null);
  const s = sign(run.side);
  const p = useMemo(() => {
    const r = seeded(run.seed);
    const st = useStore.getState();
    const text = bannerText(st.repos, Date.now(), st.settings.companyName, r());
    const dir = r() < 0.5 ? 1 : -1;
    // the banner lies along the flight, turned to face the building so it reads left to right from the windows
    const turn = (-s * dir * Math.PI) / 2;
    return { dir, x: s * (95 + r() * 20), y: eyeAbove(elevation) + 11 + r() * 5, text, turn, along: -Math.sin(turn) };
  }, [run.seed, s, elevation]);
  const banner = useMemo(() => {
    const geo = new THREE.PlaneGeometry(BANNER.w, BANNER.h, BANNER.segments, 1);
    const base = Float32Array.from(geo.attributes.position.array as Float32Array);
    const map = bannerTexture(p.text);
    const mat = new THREE.MeshToonMaterial({ map, side: THREE.DoubleSide, fog: false });
    return { geo, base, map, mat };
  }, [p.text]);
  useEffect(
    () => () => {
      banner.geo.dispose();
      banner.map.dispose();
      banner.mat.dispose();
    },
    [banner],
  );
  const sound = useMemo(() => ({ engine: null as ReturnType<typeof loop> | null }), []);
  useEffect(() => {
    sound.engine = loop('engine');
    return () => sound.engine?.stop(1.2);
  }, [sound]);

  useFrame(() => {
    const t = run.t;
    const g = blimp.current;
    if (!g) return;
    const z = lerp(-p.dir * 200, p.dir * 200, t / run.seconds);
    const y = p.y + Math.sin(t * 0.35) * 0.7;
    g.position.set(p.x, y, z);
    g.rotation.y = p.dir > 0 ? 0 : Math.PI;
    g.rotation.x = Math.sin(t * 0.3) * 0.02;
    const spin = props.current?.children;
    if (spin) for (let i = 0; i < spin.length; i++) spin[i].rotation.z = t * 14;
    // the banner ripples, more towards its tail
    const pos = banner.geo.attributes.position;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < pos.count; i++) {
      const free = 0.5 - (banner.base[i * 3] * p.along) / BANNER.w; // 0 at the tow line, 1 at the loose end
      arr[i * 3 + 2] = Math.sin(t * 3.2 - free * 7) * free * 1.1;
    }
    pos.needsUpdate = true;
    const heard = placeAt(p.x, y - elevation, z, 110);
    sound.engine?.set(heard.gain * inOut(t, run.seconds, 4), heard.pan);
  });

  const hull = toonOut('#dfe3ea');
  const stripe = toonOut('#e63946');
  return (
    <group ref={blimp}>
      <mesh material={hull} scale={[6, 6, 21]}>
        <sphereGeometry args={[1, 24, 16]} />
      </mesh>
      <mesh material={stripe} scale={[6.05, 1.1, 18]} position={[0, 0.2, 0]}>
        <sphereGeometry args={[1, 24, 8]} />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} material={stripe} position={[0, 0, -18]} rotation-z={(i * Math.PI) / 2}>
          <boxGeometry args={[0.4, 9, 4]} />
        </mesh>
      ))}
      <mesh material={toonOut('#495057')} position={[0, -6.4, 2]}>
        <boxGeometry args={[2.2, 1.6, 5]} />
      </mesh>
      <group ref={props}>
        {[-1.6, 1.6].map((x) => (
          <mesh key={x} material={toonOut('#2b2d42')} position={[x, -6.4, -0.8]}>
            <boxGeometry args={[0.2, 2.6, 0.12]} />
          </mesh>
        ))}
      </group>
      {/* the tow line and the banner, behind the tail */}
      <mesh material={toonOut('#2b2d42')} position={[0, -3, -26]} rotation-x={Math.PI / 2 - 0.25}>
        <cylinderGeometry args={[0.05, 0.05, 12, 4]} />
      </mesh>
      <mesh geometry={banner.geo} material={banner.mat} position={[0, -5, -32 - BANNER.w / 2]} rotation-y={p.turn} />
    </group>
  );
}
