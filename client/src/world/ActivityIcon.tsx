import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ACTIVITY_ICONS } from '../../../shared/activity';
import type { AgentActivity } from '../../../shared/types';
import { isBusy, type Agent } from '../store';
import { reportSign, trackSign } from './activityProbe';
import { SIGN_SIZE, signHeight } from './activitySign';
import { SANS, roundRect } from './draw';
import { bodyState, saying } from './people';

// The little sign over a busy agent's head: an icon for what they're doing (📖 reading, ✏️ editing, 🧪 testing…) and
// a short detail ("store.ts", "npm test"), straight from the server's redacted activity (shared/activity.ts).
// Mounted per agent by the floor rather than drawn by Character.tsx: it follows their live body (people.ts), at the
// height activitySign.ts picks. It looks for a change at most twice a second and fades between signs. Each sign's
// texture is drawn once and shared, so a frame allocates nothing.

const SIGN = { ...SIGN_SIZE, px: 640, py: 120 };
const INK = '#1f1d2b';
const CHECK_MS = 500;
const FADE_S = 0.16;
const KEEP = 64; // sign textures kept; the least recently shown go first

const geometry = new THREE.PlaneGeometry(SIGN.w, SIGN.h);
const textures = new Map<string, THREE.CanvasTexture>();
const keyOf = (a: AgentActivity | null) => (a ? `${a.kind}|${a.detail}` : '');

function drawSign(ctx: CanvasRenderingContext2D, icon: string, detail: string) {
  const { px: w, py: h } = SIGN;
  const font = `600 44px ${SANS}`;
  ctx.clearRect(0, 0, w, h);
  ctx.font = font;
  const room = w - 130;
  const text = detail ? Math.min(ctx.measureText(detail).width, room) : 0;
  const bw = 92 + (detail ? text + 26 : 0);
  const x0 = (w - bw) / 2;
  roundRect(ctx, x0, 8, bw, h - 16, (h - 16) / 2);
  ctx.fillStyle = 'rgba(255,253,245,0.96)';
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = `54px ${SANS}`;
  ctx.fillText(icon, x0 + 49, h / 2 + 3);
  if (!detail) return;
  ctx.textAlign = 'left';
  ctx.font = font;
  ctx.fillStyle = INK;
  ctx.fillText(detail, x0 + 88, h / 2 + 3, room);
}

/** The texture for a sign, drawn on first use. */
function signTexture(a: AgentActivity) {
  const key = keyOf(a);
  let tex = textures.get(key);
  if (tex) {
    textures.delete(key); // most recently used last
    textures.set(key, tex);
    return tex;
  }
  const canvas = document.createElement('canvas');
  canvas.width = SIGN.px;
  canvas.height = SIGN.py;
  drawSign(canvas.getContext('2d')!, ACTIVITY_ICONS[a.kind], a.detail);
  tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textures.set(key, tex);
  if (textures.size > KEEP) {
    const [oldest, old] = textures.entries().next().value!;
    textures.delete(oldest);
    old.dispose();
  }
  return tex;
}

export const ActivityIcon = memo(function ActivityIcon({ agent }: { agent: Agent }) {
  const g = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }), []);
  useEffect(() => () => material.dispose(), [material]);
  // What the server says now; the frame loop picks it up at its next check.
  const wanted = useRef<AgentActivity | null>(null);
  wanted.current = isBusy(agent) ? (agent.activity ?? null) : null;
  const name = useRef(agent.name);
  name.current = agent.name;
  const st = useMemo(() => ({ shown: '', next: null as AgentActivity | null, nextKey: '', checked: -1e9, fade: 0, y: 0 }), []);
  useEffect(() => {
    reportSign(agent.id, { name: name.current, icon: '', kind: null, detail: '' });
    const r = (n: number) => Math.round(n * 100) / 100;
    const untrack = trackSign(agent.id, () => {
      const p = g.current?.position;
      return { shown: !!g.current?.visible, x: r(p?.x ?? 0), y: r(p?.y ?? 0), z: r(p?.z ?? 0) };
    });
    return () => {
      untrack();
      reportSign(agent.id, null);
    };
  }, [agent.id]);

  useFrame((_, delta) => {
    const grp = g.current;
    if (!grp) return;
    const dt = Math.min(delta, 0.1);
    const now = performance.now();
    if (now - st.checked >= CHECK_MS) {
      st.checked = now;
      st.next = wanted.current;
      st.nextKey = keyOf(st.next);
      if (st.shown && st.nextKey === st.shown) signTexture(st.next!); // still on show: keep its texture
    }
    // Fade the old sign out before the new one fades in.
    if (st.shown !== st.nextKey) {
      st.fade = Math.max(0, st.fade - dt / FADE_S);
      if (st.fade === 0) {
        st.shown = st.nextKey;
        if (st.next) {
          material.map = signTexture(st.next);
          material.needsUpdate = true;
        }
        reportSign(agent.id, { name: name.current, icon: st.next ? ACTIVITY_ICONS[st.next.kind] : '', kind: st.next?.kind ?? null, detail: st.next?.detail ?? '' });
      }
    } else if (st.shown) st.fade = Math.min(1, st.fade + dt / FADE_S);

    const body = bodyState(agent.id);
    grp.visible = st.fade > 0 && !!body;
    if (!grp.visible || !body) return;
    const target = signHeight(body.sit, !!saying(agent.id));
    st.y = st.y === 0 ? target : st.y + (target - st.y) * Math.min(1, dt * 10);
    grp.position.set(body.x, st.y + Math.sin(now / 600 + body.x) * 0.012, body.z);
    grp.quaternion.copy(camera.quaternion);
    grp.scale.setScalar(0.8 + 0.2 * st.fade);
    material.opacity = st.fade;
  });

  return (
    <group ref={g} visible={false}>
      <mesh geometry={geometry} material={material} renderOrder={3} />
    </group>
  );
});
