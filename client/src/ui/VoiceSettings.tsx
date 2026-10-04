// The Settings tab's Voice section: who reads messages aloud, the ElevenLabs key (write-only), the voice, and a Test.
// The key lives on the server; the browser only ever sees its last 4 characters.
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { SAMPLE_LINE } from '../../../shared/speech';
import { cacheLabel, clampKeepDays, KEEP_DAYS_MAX, KEEP_DAYS_MIN } from '../../../shared/voiceClips';
import type { VoiceOption, VoiceProvider, VoiceSettings as Voice } from '../../../shared/types';
import { confirmDialog } from './Confirm';
import { getAudioPrefs } from './sfx';
import { browserVoices, searchVoices, voiceLabels, type BrowserVoice } from './voicePicker';
import { playClip, speakLine, stopVoice } from './voicePlayback';

const DOCS = 'https://github.com/leonvanzyl/cubefarm/blob/main/docs/voice.md';

const PROVIDERS: [VoiceProvider, string, string][] = [
  ['off', 'Off', ''],
  ['browser', 'Browser voice', 'free, built in'],
  ['elevenlabs', 'ElevenLabs', 'natural voices, with your own key'],
];

type Save = (patch: Partial<Voice>) => void;

/** What's playing: a voice's preview (its id), the Test line, or nothing. */
type Playing = string | null;

function hintMuted() {
  if (getAudioPrefs().muted) useStore.getState().pushToast('info', '🔇 Sound is off: press M to hear it');
}

/** The browser's voices, which arrive asynchronously; null where the browser can't speak. */
function useBrowserVoices(): BrowserVoice[] | null {
  const read = () => (typeof speechSynthesis === 'undefined' ? null : browserVoices(speechSynthesis.getVoices(), navigator.language));
  const [voices, setVoices] = useState(read);
  useEffect(() => {
    if (typeof speechSynthesis === 'undefined') return;
    const update = () => setVoices(read());
    speechSynthesis.addEventListener('voiceschanged', update);
    update();
    return () => speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);
  return voices;
}

function ElevenLabsKey() {
  const keySet = useStore((s) => s.voiceKeySet);
  const hint = useStore((s) => s.voiceKeyHint);
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const errorId = useId();
  const save = async (value: string) => {
    setBusy(true);
    setError('');
    try {
      await api.setVoiceKey(value);
      setKey(''); // the key is never kept or shown again once it's saved
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  if (keySet && !editing)
    return (
      <div className="row wrap">
        <span className="grow">
          🔑 Key saved <code>••••{hint}</code>
        </span>
        <button className="btn btn-small" onClick={() => setEditing(true)}>
          Replace
        </button>
        <button
          className="btn btn-small btn-ghost"
          disabled={busy}
          onClick={() =>
            void confirmDialog({ tone: 'danger', title: 'Remove the ElevenLabs key?', body: 'It is deleted from this PC. Messages are not read aloud by ElevenLabs until you add a key again.', confirm: 'Remove' }).then(
              (ok) => {
                if (ok) void save('');
              },
            )
          }
        >
          Remove
        </button>
      </div>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (key.trim()) void save(key.trim());
      }}
    >
      <label className="field">
        <span>ElevenLabs API key</span>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder={keySet ? 'Paste the new key' : 'Paste your key'}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
        />
      </label>
      {error && (
        <div id={errorId} className="term-error small" role="alert">
          {error}
        </div>
      )}
      <div className="row">
        <button className="btn btn-small btn-good" disabled={busy || !key.trim()}>
          {busy ? 'Checking…' : 'Save key'}
        </button>
        {editing && (
          <button
            type="button"
            className="btn btn-small btn-ghost"
            onClick={() => {
              setEditing(false);
              setKey('');
              setError('');
            }}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function VoiceRow({ v, chosen, playing, onChoose, onPreview }: { v: VoiceOption; chosen: boolean; playing: boolean; onChoose: () => void; onPreview: () => void }) {
  const labels = voiceLabels(v);
  return (
    <div className={`voice-row ${chosen ? 'voice-row-on' : ''}`}>
      <label className="toggle grow">
        <input type="radio" name="elevenlabs-voice" checked={chosen} onChange={onChoose} />
        <span>
          <b>{v.name}</b>
          {v.labels?.description && <span className="muted"> · {v.labels.description}</span>}
          {labels && <span className="muted small voice-labels">{labels}</span>}
        </span>
      </label>
      <button
        type="button"
        className="btn btn-small btn-ghost"
        aria-label={playing ? `Stop the preview of ${v.name}` : `Preview ${v.name}`}
        title={v.previewUrl ? undefined : 'Says the test line in this voice'}
        onClick={onPreview}
      >
        {playing ? '■ Stop' : '▶ Preview'}
      </button>
    </div>
  );
}

function ElevenLabsVoices({ voice, save, playing, setPlaying }: { voice: Voice; save: Save; playing: Playing; setPlaying: (p: Playing) => void }) {
  const hint = useStore((s) => s.voiceKeyHint);
  const [list, setList] = useState<VoiceOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    setList(null);
    setFailed(false);
    api.voices().then(
      (l) => live && setList(l),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [hint]);
  // Show the chosen voice when the list arrives, even when it's far down.
  useEffect(() => {
    const el = listRef.current;
    const row = el?.querySelector<HTMLElement>('.voice-row-on');
    if (el && row) el.scrollTop = row.offsetTop - el.clientHeight / 2 + row.offsetHeight / 2;
  }, [list]);
  const preview = async (v: VoiceOption) => {
    if (playing === v.id) return stopVoice();
    hintMuted();
    setPlaying(v.id);
    try {
      // Library voices may have no preview of their own: then it's the test line, made once and cached.
      const ok = await playClip(v.previewUrl ?? (await api.voiceSample(v.id)));
      if (!ok) useStore.getState().pushToast('error', `Couldn't play ${v.name}'s preview`);
    } catch {
      // api already toasted the error
    } finally {
      setPlaying(null);
    }
  };
  if (failed) return <p className="muted small">Couldn't load the voices.</p>;
  if (!list) return <p className="muted small">Loading the voices…</p>;
  const { recommended, others } = searchVoices(list, query);
  const row = (v: VoiceOption) => (
    <VoiceRow key={v.id} v={v} chosen={voice.voiceId === v.id} playing={playing === v.id} onChoose={() => save({ voiceId: v.id, voiceName: v.name })} onPreview={() => void preview(v)} />
  );
  return (
    <>
      <label className="field">
        <span>
          Voice{voice.voiceName && <span className="muted"> · {voice.voiceName}</span>}
        </span>
        <input type="search" aria-label="Search voices" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, accent, age…" />
      </label>
      <div ref={listRef} className="voice-list" role="radiogroup" aria-label="ElevenLabs voices">
        {recommended.length > 0 && <div className="voice-group">⭐ Recommended</div>}
        {recommended.map(row)}
        {others.length > 0 && <div className="voice-group">All voices</div>}
        {others.map(row)}
        {recommended.length + others.length === 0 && <div className="muted small">No voice matches “{query}”.</div>}
      </div>
    </>
  );
}

function BrowserVoices({ voice, save }: { voice: Voice; save: Save }) {
  const voices = useBrowserVoices();
  if (!voices) return <p className="muted small">This browser can't speak. Try Chrome or Edge, or pick ElevenLabs.</p>;
  const chosen = voices.some((v) => v.name === voice.voiceName) ? voice.voiceName : '';
  return (
    <label className="field">
      <span>Browser voice</span>
      <select value={chosen} onChange={(e) => save({ voiceName: e.target.value })}>
        <option value="">The browser's default</option>
        {voices.map((v) => (
          <option key={v.name} value={v.name}>
            {v.name}
            {v.lang && ` (${v.lang})`}
          </option>
        ))}
      </select>
      {voices.length === 0 && <span className="muted small">The browser hasn't listed its voices yet; its default voice is used.</span>}
    </label>
  );
}

/** How long ElevenLabs clips are kept for the phone's ▶, how much is saved now, and a way to clear it. */
function SavedClips({ voice, save }: { voice: Voice; save: Save }) {
  const cache = useStore((s) => s.voiceCache);
  const [days, setDays] = useState(String(voice.keepDays));
  const [busy, setBusy] = useState(false);
  useEffect(() => setDays(String(voice.keepDays)), [voice.keepDays]);
  const commit = () => {
    const n = clampKeepDays(days);
    setDays(String(n));
    if (n !== voice.keepDays) save({ keepDays: n });
  };
  const clear = async () => {
    const ok = await confirmDialog({
      tone: 'danger',
      title: 'Clear saved clips?',
      body: "Messages read by ElevenLabs can't be replayed from the phone after this. New messages are saved again as they arrive.",
      confirm: 'Clear',
    });
    if (!ok) return;
    setBusy(true);
    await api.clearVoiceCache().catch(() => undefined);
    setBusy(false);
  };
  return (
    <div className="voice-clips">
      <label className="field">
        <span>Keep voice clips for</span>
        <span className="row">
          <input
            type="number"
            min={KEEP_DAYS_MIN}
            max={KEEP_DAYS_MAX}
            step={1}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
            style={{ width: '5em' }}
          />
          <span>days</span>
        </span>
      </label>
      <div className="row wrap">
        <span className="grow small">
          💾 {cacheLabel(cache.clips, cache.bytes)}
          <span className="muted"> · the newest 20 CEO messages always keep theirs, so ▶ on the phone replays them for free</span>
        </span>
        <button className="btn btn-small btn-ghost" disabled={busy || cache.clips === 0} onClick={() => void clear()}>
          Clear saved clips
        </button>
      </div>
    </div>
  );
}

export function VoiceSettings() {
  const voice = useStore((s) => s.settings.voice);
  const keySet = useStore((s) => s.voiceKeySet);
  const cache = useStore((s) => s.voiceCache);
  const [playing, setPlaying] = useState<Playing>(null);
  const radioName = useId();
  useEffect(() => stopVoice, []); // closing the console stops a preview
  const save: Save = (patch) => void api.updateSettings({ voice: { ...voice, ...patch } }).catch(() => undefined);
  const eleven = voice.provider === 'elevenlabs';
  const canTest = voice.provider === 'browser' || (eleven && keySet && !!voice.voiceId);
  const test = async () => {
    if (playing === 'test') return stopVoice();
    hintMuted();
    setPlaying('test');
    try {
      const ok = eleven ? await playClip(await api.voiceSample(voice.voiceId)) : await speakLine(SAMPLE_LINE, voice.voiceName);
      if (!ok) useStore.getState().pushToast('error', eleven ? "Couldn't play the test" : "The browser couldn't speak the test line");
    } catch {
      // api already toasted the error
    } finally {
      setPlaying(null);
    }
  };
  return (
    <div className="card">
      <h3>🔊 Voice</h3>
      <p className="muted small">Hear the CEO's messages read aloud the moment they arrive, without opening the phone.</p>
      <div role="radiogroup" aria-labelledby={`${radioName}-label`}>
        <div id={`${radioName}-label`} className="field">
          Speak messages
        </div>
        {PROVIDERS.map(([p, label, note]) => (
          <label key={p} className="toggle block">
            <input type="radio" name={radioName} checked={voice.provider === p} onChange={() => save({ provider: p })} />
            <span>
              <b>{label}</b>
              {note && ` (${note})`}
            </span>
          </label>
        ))}
      </div>
      {eleven && (
        <>
          <p className="muted small">
            Get a key at{' '}
            <a href="https://elevenlabs.io" target="_blank" rel="noreferrer">
              elevenlabs.io
            </a>{' '}
            (Developers → API Keys). It stays on this PC and is never shown again. Costs and voice tips are in{' '}
            <a href={DOCS} target="_blank" rel="noreferrer">
              docs/voice.md
            </a>
            .
          </p>
          <ElevenLabsKey />
          {keySet && <ElevenLabsVoices voice={voice} save={save} playing={playing} setPlaying={setPlaying} />}
        </>
      )}
      {voice.provider === 'browser' && <BrowserVoices voice={voice} save={save} />}
      {voice.provider !== 'off' && (
        <>
          <label className="toggle">
            <input type="checkbox" checked={voice.speakOffice} onChange={(e) => save({ speakOffice: e.target.checked })} /> Also speak office alerts
          </label>
          <div className="row">
            <button className="btn btn-small" disabled={!canTest} onClick={() => void test()} title={canTest ? undefined : 'Save a key and pick a voice first'}>
              {playing === 'test' ? '■ Stop' : '🔈 Test'}
            </button>
            <span className="muted small">Previews and tests play at your volume; M mutes them.</span>
          </div>
        </>
      )}
      {(eleven || cache.clips > 0) && <SavedClips voice={voice} save={save} />}
    </div>
  );
}
