// Photo mode's panel (lazy, shown instead of the HUD): freeze, camera, depth of field, filters, overlays, time of
// day, shots, clips, instant replay and the gallery, plus the overlay preview drawn over the 3D view.
import { useEffect, useRef, useState } from 'react';
import { repoOnFloor, useStore } from '../store';
import { bodyState } from '../world/people';
import { FILTER_LABELS, FILTERS } from './filters';
import { FOV_MAX, FOV_MIN, ROLL_MAX } from './flight';
import { removeFromGallery, saveItem, useGallery, type GalleryItem } from './gallery';
import { setReplay, usePhotoGate } from './gate';
import { drawOverlay } from './overlay';
import {
  cam,
  CLIP_SECONDS,
  focusCenter,
  GOLDEN_HOUR,
  leave,
  overlayOptions,
  requestFrame,
  setDaytime,
  setFrozen,
  takeShot,
  toggleRecording,
  update,
  usePhoto,
  type OrbitTarget,
} from './photoMode';
import { clockTime, formatBytes, SCALES, shotSize } from './shots';
import { useDayTime } from '../world/sky/useDayTime';
import { Key, MoveKeys } from '../ui/Key';
import './photo.css';

/** The overlay as it will be saved, plus the thirds guides, over the live view. */
function Preview() {
  const ref = useRef<HTMLCanvasElement>(null);
  const s = usePhoto();
  const floor = useStore((st) => st.floor);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    drawOverlay(ctx, c.width, c.height, overlayOptions(true));
  }, [s.filter, s.stamp, s.caption, s.guides, size, floor]);
  return <canvas ref={ref} className="photo-preview" aria-hidden="true" />;
}

function Recording() {
  const rec = usePhoto((s) => s.recording);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [rec]);
  if (!rec) return null;
  const secs = Math.min(rec.limit, (performance.now() - rec.started) / 1000);
  const fmt = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
  return (
    <div className="photo-rec" role="status">
      <span className="photo-rec-dot" /> REC {fmt(secs)} / {fmt(rec.limit)}
      <button className="btn btn-small" onClick={() => void toggleRecording()}>
        ■ Stop <kbd>V</kbd>
      </button>
    </div>
  );
}

function Thumb({ item }: { item: GalleryItem }) {
  if (item.kind === 'shot') return <img src={item.thumb ?? item.url} alt="" />;
  return <video src={item.url} muted preload="metadata" />;
}

function Gallery() {
  const items = useGallery((s) => s.items);
  const total = items.reduce((n, i) => n + i.bytes, 0);
  return (
    <section className="photo-section">
      <h4>
        Gallery <span className="muted small">{items.length ? `${items.length} · ${formatBytes(total)} · this tab only` : 'empty'}</span>
      </h4>
      {items.length > 0 && (
        <ul className="photo-gallery">
          {[...items].reverse().map((i) => (
            <li key={i.id} title={i.name}>
              <Thumb item={i} />
              <div className="photo-gallery-meta">
                <span>{i.kind === 'shot' ? `📸 ${i.width}×${i.height}` : `${i.kind === 'replay' ? '⏪' : '🎬'} ${Math.round(i.seconds ?? 0)} s`}</span>
                <span className="muted">{formatBytes(i.bytes)}</span>
              </div>
              <div className="photo-gallery-actions">
                <button className="btn btn-ghost btn-small" onClick={() => saveItem(i)} aria-label={`Download ${i.name}`}>
                  ⬇
                </button>
                <button className="btn btn-ghost btn-small" onClick={() => removeFromGallery(i.id)} aria-label={`Delete ${i.name}`}>
                  🗑
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** FOV and roll change every frame from the keys and the wheel, so the sliders read the camera a few times a second. */
function useCamera() {
  const [v, setV] = useState({ fov: cam.fov, roll: cam.roll });
  useEffect(() => {
    const t = setInterval(() => setV((p) => (p.fov === cam.fov && p.roll === cam.roll ? p : { fov: cam.fov, roll: cam.roll })), 150);
    return () => clearInterval(t);
  }, []);
  return v;
}

export default function PhotoPanel() {
  const s = usePhoto();
  const frozen = usePhotoGate((g) => g.frozen);
  const replay = usePhotoGate((g) => g.replay);
  const toasts = useStore((st) => st.toasts);
  const dismiss = useStore((st) => st.dismissToast);
  const floor = useStore((st) => st.floor);
  const repo = useStore((st) => (st.floor === 0 ? null : repoOnFloor(st.repos, st.floor)));
  const agents = useStore((st) => st.agents);
  const { fov, roll } = useCamera();
  const people = Object.values(agents).filter((a) => (repo ? a.repoId === repo.id : a.role === 'ceo') && bodyState(a.id));
  const size = shotSize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, s.scale);
  const sky = useDayTime().t;
  const t = s.daytime ?? sky;

  return (
    <>
      <Preview />
      <Recording />
      {!s.panel ? (
        <button className="photo-show" onClick={() => update({ panel: true })}>
          📷 <kbd>H</kbd> show the panel
        </button>
      ) : (
        <aside className="photo-panel" aria-label="Photo mode">
          <header className="photo-head">
            <b>📷 Photo mode</b>
            <button className="btn btn-small" onClick={leave} title="Back to the office (or Esc with the mouse free)">
              Leave <Key action="photo" />
            </button>
          </header>
          {s.note && (
            <p className={`photo-note ${s.note.level === 'error' ? 'photo-note-bad' : ''}`} role="status" onClick={() => update({ note: null })}>
              {s.note.text}
            </p>
          )}

          <section className="photo-section">
            <label className="toggle">
              <input type="checkbox" checked={frozen} onChange={(e) => setFrozen(e.target.checked)} /> ❄ Freeze the office <kbd>F</kbd>
            </label>
            <p className="muted small">{frozen ? 'Everyone holds still; the work carries on and catches up when you thaw.' : 'Live: people, toys and the sky move. Good for clips.'}</p>
          </section>

          <section className="photo-section">
            <h4>Camera</h4>
            <label className="photo-row">
              <span>Zoom</span>
              <input type="range" min={FOV_MIN} max={FOV_MAX} step={1} value={Math.round(fov)} onChange={(e) => ((cam.fov = Number(e.target.value)), requestFrame())} aria-label="Field of view" />
              <b>{Math.round(fov)}°</b>
            </label>
            <label className="photo-row">
              <span>Roll</span>
              <input
                type="range"
                min={-45}
                max={45}
                step={1}
                value={Math.round((roll * 180) / Math.PI)}
                onChange={(e) => ((cam.roll = Math.max(-ROLL_MAX, Math.min(ROLL_MAX, (Number(e.target.value) * Math.PI) / 180))), requestFrame())}
                aria-label="Roll"
              />
              <b>{Math.round((roll * 180) / Math.PI)}°</b>
            </label>
            <label className="toggle">
              <input type="checkbox" checked={s.dof} onChange={(e) => update({ dof: e.target.checked })} /> Depth of field
            </label>
            {s.dof && (
              <>
                <label className="photo-row">
                  <span>Focus</span>
                  <input type="range" min={0.3} max={40} step={0.1} value={s.focus} onChange={(e) => update({ focus: Number(e.target.value) })} aria-label="Focus distance" />
                  <b>{s.focus.toFixed(1)} m</b>
                </label>
                <label className="photo-row">
                  <span>Blur</span>
                  <input type="range" min={0} max={1} step={0.05} value={s.blur} onChange={(e) => update({ blur: Number(e.target.value) })} aria-label="Blur strength" />
                  <b>{Math.round(s.blur * 100)}%</b>
                </label>
              </>
            )}
            <button className="btn btn-ghost btn-small" onClick={() => focusCenter()}>
              ◎ Focus on the middle <kbd>T</kbd>
            </button>
          </section>

          <section className="photo-section">
            <h4>Filter</h4>
            <div className="photo-chips" role="radiogroup" aria-label="Filter">
              {FILTERS.map((f) => (
                <button key={f} role="radio" aria-checked={s.filter === f} className={`photo-chip ${s.filter === f ? 'on' : ''}`} onClick={() => update({ filter: f })}>
                  {FILTER_LABELS[f]}
                </button>
              ))}
            </div>
            <div className="photo-checks">
              <label className="toggle">
                <input type="checkbox" checked={s.stamp} onChange={(e) => update({ stamp: e.target.checked })} /> Logo stamp
              </label>
              <label className="toggle">
                <input type="checkbox" checked={s.caption} onChange={(e) => update({ caption: e.target.checked })} /> Floor and date
              </label>
              <label className="toggle">
                <input type="checkbox" checked={s.guides} onChange={(e) => update({ guides: e.target.checked })} /> Thirds guides
              </label>
            </div>
          </section>

          <section className="photo-section">
            <h4>
              Time of day <span className="muted small">{clockTime(t)}</span>
            </h4>
            <input type="range" min={0} max={1} step={0.002} value={t} onChange={(e) => setDaytime(Number(e.target.value))} aria-label="Time of day" aria-valuetext={clockTime(t)} />
            <div className="row wrap">
              <button className="btn btn-ghost btn-small" onClick={() => setDaytime(GOLDEN_HOUR)}>
                🌇 Golden hour
              </button>
              <button className="btn btn-ghost btn-small" onClick={() => setDaytime(0.5)}>
                ☀️ Noon
              </button>
              <button className="btn btn-ghost btn-small" onClick={() => setDaytime(0.79)}>
                🌆 Blue hour
              </button>
              <button className="btn btn-ghost btn-small" onClick={() => setDaytime(null)} disabled={s.daytime === null}>
                ↺ As it is
              </button>
            </div>
          </section>

          <section className="photo-section">
            <h4>Shot</h4>
            <div className="photo-chips" role="radiogroup" aria-label="Shot size">
              {SCALES.map((k) => (
                <button key={k} role="radio" aria-checked={s.scale === k} className={`photo-chip ${s.scale === k ? 'on' : ''}`} onClick={() => update({ scale: k })}>
                  {k}×
                </button>
              ))}
              <span className="muted small">
                {size.width}×{size.height}
              </span>
            </div>
            <button className="btn photo-big" disabled={!!s.busy} onClick={() => void takeShot()}>
              📸 {s.busy === 'Developing…' ? 'Developing…' : 'Take the shot'} <kbd>Enter</kbd>
            </button>
            <p className="muted small">Saves a PNG to your downloads and copies it.</p>
          </section>

          <section className="photo-section">
            <h4>Clip</h4>
            <div className="photo-chips">
              {CLIP_SECONDS.map((n) => (
                <button key={n} className={`photo-chip ${s.clipSeconds === n ? 'on' : ''}`} aria-pressed={s.clipSeconds === n} onClick={() => update({ clipSeconds: n })}>
                  {n} s
                </button>
              ))}
              {([30, 60] as const).map((n) => (
                <button key={n} className={`photo-chip ${s.fps === n ? 'on' : ''}`} aria-pressed={s.fps === n} onClick={() => update({ fps: n })}>
                  {n} fps
                </button>
              ))}
            </div>
            <label className="photo-row">
              <span>Camera</span>
              <select value={s.orbit} onChange={(e) => update({ orbit: e.target.value as OrbitTarget })} aria-label="Cinematic orbit">
                <option value="free">Free (fly it yourself)</option>
                {floor !== 0 && <option value="gong">Orbit the gong</option>}
                {floor !== 0 && <option value="board">Orbit the whiteboard</option>}
                {people.map((a) => (
                  <option key={a.id} value={`person:${a.id}`}>
                    Orbit {a.name}
                  </option>
                ))}
              </select>
            </label>
            <button className={`btn photo-big ${s.recording ? 'photo-recording' : ''}`} disabled={!s.recording && !!s.busy} onClick={() => void toggleRecording()}>
              {s.recording ? '■ Stop recording' : s.busy === 'Saving the clip…' ? 'Saving the clip…' : '⏺ Record'} <kbd>V</kbd>
            </button>
            <p className="muted small">A WebM with the office's sound, up to a minute{frozen ? ' (frozen: a still scene, unless the camera moves)' : ''}.</p>
          </section>

          <section className="photo-section">
            <h4>Instant replay</h4>
            <label className="toggle">
              <input type="checkbox" checked={replay} onChange={(e) => setReplay(e.target.checked)} /> Keep the last 15 s, any time
            </label>
            <p className="muted small">
              Press <Key action="saveReplay" /> to save them. Off by default: it records all the time, which takes memory.
            </p>
          </section>

          <Gallery />

          <p className="photo-keys muted small">
            Click the view to steer · <MoveKeys joined /> fly · <kbd>Space</kbd>/<kbd>C</kbd> up/down · <Key action="run" /> faster · <Key action="rotateLeft" />/<Key action="rotateRight" /> roll · wheel zoom ·{' '}
            <kbd>R</kbd> reset · <kbd>H</kbd> hide panel · <kbd>Esc</kbd> frees the mouse, then leaves
          </p>
        </aside>
      )}
      <div className="toasts photo-toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.level}`} onClick={() => dismiss(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}
