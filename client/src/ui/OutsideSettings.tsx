// The Settings tab's Outside section: where the weather comes from (the calm cycle, off, or the manager's own local
// weather, which the office's server reads from Open-Meteo) and how often something happens outside (world events),
// both saved on the server for every viewer.
import { useId } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { EventFrequency, WeatherKind, WeatherMode, WeatherSettings, WorldEventSettings } from '../../../shared/outside';

const MODES: [WeatherMode, string, string][] = [
  ['cycle', 'Calm cycle', 'a gentle, mostly fair day of its own, different every date'],
  ['off', 'Off', 'always clear'],
  ['real', 'My real weather', "your city's current weather"],
];

const FREQUENCIES: [EventFrequency, string][] = [
  ['off', 'Off'],
  ['rare', 'Rare (every half hour or so)'],
  ['normal', 'Normal (every 6–20 minutes)'],
  ['chaos', 'Chaos (every minute or two)'],
];

export const WEATHER_LABELS: Record<WeatherKind, string> = {
  clear: '☀️ clear',
  cloudy: '☁️ cloudy',
  'light-rain': '🌦️ light rain',
  'heavy-rain': '🌧️ heavy rain',
  storm: '⛈️ thunderstorm',
  fog: '🌫️ fog',
  snow: '🌨️ snow',
};

function ago(at: number) {
  const min = Math.round((Date.now() - at) / 60_000);
  return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
}

export function OutsideSettings() {
  const weather = useStore((s) => s.settings.weather);
  const events = useStore((s) => s.settings.worldEvents);
  const view = useStore((s) => s.weather);
  const radioName = useId();
  const saveWeather = (patch: Partial<WeatherSettings>) => void api.updateSettings({ weather: { ...weather, ...patch } }).catch(() => undefined);
  const saveEvents = (patch: Partial<WorldEventSettings>) => void api.updateSettings({ worldEvents: { ...events, ...patch } }).catch(() => undefined);
  const real = weather.mode === 'real';
  return (
    <div className="card">
      <h3>🌦️ Weather</h3>
      <div role="radiogroup" aria-label="Where the weather comes from">
        {MODES.map(([m, label, note]) => (
          <label key={m} className="toggle block">
            <input type="radio" name={radioName} checked={weather.mode === m} onChange={() => saveWeather({ mode: m })} />
            <span>
              <b>{label}</b> ({note})
            </span>
          </label>
        ))}
      </div>
      {real && (
        <>
          <label className="field">
            <span>Your city</span>
            <input
              key={weather.city}
              defaultValue={weather.city}
              placeholder="Cape Town, South Africa (or -33.92, 18.42)"
              maxLength={80}
              onBlur={(e) => e.target.value.trim() !== weather.city && saveWeather({ city: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </label>
          <p className="small" aria-live="polite">
            {view.place && <b>{view.place.name}</b>}
            {view.place && view.reading && `: ${WEATHER_LABELS[view.reading.kind]}, read ${ago(view.reading.at)}`}
            {view.place && !view.reading && !view.error && ': looking it up…'}
            {view.error && <span className="muted"> {view.error}</span>}
          </p>
          <p className="muted small">
            The office's server looks the city up once with Open-Meteo's free geocoder, then sends only its coordinates (to about a kilometre) every 15 minutes. While it's offline the office
            shows the calm cycle.
          </p>
        </>
      )}
      <h3>🛸 World events</h3>
      <p className="muted small">Now and then something happens outside: a plane, a blimp with the office's news, fireworks at night, a UFO… and very rarely a friendly kaiju. Idle agents run to the windows to watch.</p>
      <label className="field">
        <span>How often</span>
        <select value={events.frequency} onChange={(e) => saveEvents({ frequency: e.target.value as EventFrequency })}>
          {FREQUENCIES.map(([f, label]) => (
            <option key={f} value={f}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="toggle block">
        <input type="checkbox" checked={events.calm} onChange={(e) => saveEvents({ calm: e.target.checked })} />
        <span>
          <b>Keep it calm</b>: no kaiju, giant rubber duck, whale airship or hurricane
        </span>
      </label>
    </div>
  );
}
