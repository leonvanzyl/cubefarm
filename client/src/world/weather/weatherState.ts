import { useFrame } from '@react-three/fiber';
import { create } from 'zustand';
import { liveReading, type WeatherKind } from '../../../../shared/outside';
import { useStore } from '../../store';
import { thunder } from '../../ui/weatherSfx';
import { blendMix, calmSpell, flashLevel, isClear, kindMix, newMix, nextFlashIn, parseWeatherKind, parseWeatherParam, snowStep, thunderDelay, wetStep, type Spell, type WeatherMix } from './weatherRules';

// The office's live weather: where it comes from (Settings → Weather's calm cycle, Off or the real weather the server
// reads; a world event; ?weather= or __swarmWeather.set() for QA), the mix blending towards it, lightning, and how
// wet the balcony is. A plain mutable object read in useFrame (WeatherClock moves it once per frame, so nothing
// re-renders per frame), plus a coarse store for React that changes only when the weather starts, stops or turns.

export type WeatherSource = 'off' | 'cycle' | 'real' | 'url' | 'probe' | 'event';

function urlKind(): WeatherKind | null {
  try {
    return parseWeatherParam(window.location.search);
  } catch {
    return null;
  }
}

/** The live weather. `version` goes up whenever anything visible changed this frame (the mix, a flash, the puddles). */
export const weather = {
  mix: newMix(),
  target: newMix(),
  kind: 'clear' as WeatherKind,
  intensity: 0,
  source: 'cycle' as WeatherSource,
  /** Anything to draw or hear: false once a clear sky has fully settled (and while Off), so it all sleeps. */
  active: false,
  version: 0,
  /** Seconds of weather clock (it stops with the render). */
  clock: 0,
  /** The flash's brightness this frame (0-1), when the last one struck, when the next is due and on which side. */
  flash: 0,
  flashAt: -10,
  nextFlash: Infinity,
  boltSide: 1,
  boltSeed: 0,
  /** QA: holds a flash at this brightness (__swarmWeather.strike(0.9)) until strike() is called again without one. */
  flashHold: null as number | null,
  /** How wet the balcony is and how much snow lies, 0-1. */
  wet: 0,
  snow: 0,
  url: urlKind(),
  probe: null as WeatherKind | null,
  event: null as { kind: WeatherKind; wind: number } | null,
  spell: null as Spell | null,
};

const useCoarse = create<{ active: boolean; kind: WeatherKind; source: WeatherSource }>(() => ({ active: false, kind: 'clear', source: 'cycle' }));

/** For React: whether there's any weather to draw, and what it's doing (re-renders only when those change). */
export const useWeather = () => useCoarse();

/** A world event's weather (the hurricane): held while it runs, null to let go. */
export function setEventWeather(w: { kind: WeatherKind; wind: number } | null) {
  weather.event = w;
}

const want = { kind: 'clear' as WeatherKind, intensity: 0, wind: 0, source: 'cycle' as WeatherSource };

function set(kind: WeatherKind, intensity: number, wind: number, source: WeatherSource) {
  want.kind = kind;
  want.intensity = intensity;
  want.wind = wind;
  want.source = source;
  return want;
}

/** Where the weather should be heading now, and from where (filled in place: it's asked every frame). */
function resolve(now: number) {
  if (weather.probe) return set(weather.probe, 1, 0, 'probe');
  if (weather.event) return set(weather.event.kind, 1, weather.event.wind, 'event');
  if (weather.url) return set(weather.url, 1, 0, 'url');
  const s = useStore.getState();
  const mode = s.settings.weather?.mode ?? 'cycle';
  if (mode === 'off') return set('clear', 0, 0, 'off');
  if (mode === 'real') {
    const r = liveReading(s.weather, now);
    if (r) return set(r.kind, r.intensity, Math.min(1, r.wind / 60), 'real');
  }
  if (!weather.spell || now >= weather.spell.until || now < weather.spell.from) weather.spell = calmSpell(now);
  return set(weather.spell.kind, weather.spell.intensity, 0, 'cycle');
}

function publish() {
  const c = useCoarse.getState();
  if (c.active !== weather.active || c.kind !== weather.kind || c.source !== weather.source) useCoarse.setState({ active: weather.active, kind: weather.kind, source: weather.source });
}

/** Moves the weather on by dt seconds (WeatherClock, once per frame; __swarmWeather.step for tests). */
export function stepWeather(dt: number, now = Date.now()) {
  const want = resolve(now);
  weather.kind = want.kind;
  weather.intensity = want.intensity;
  weather.source = want.source;
  kindMix(want.kind, want.intensity, want.wind, weather.target);
  weather.clock += dt;
  let changed = blendMix(weather.mix, weather.target, dt);
  const m = weather.mix;

  // Lightning: due in storms only; the thunder follows 1-4 s later.
  if (m.storm >= 0.3) {
    if (!Number.isFinite(weather.nextFlash)) weather.nextFlash = weather.clock + nextFlashIn(m.storm, Math.random()) * 0.5;
    if (weather.clock >= weather.nextFlash) strike();
  } else weather.nextFlash = Infinity;
  const flash = weather.flashHold ?? flashLevel(weather.clock - weather.flashAt);
  if (flash !== weather.flash) {
    weather.flash = flash;
    changed = true;
  }

  const wet = wetStep(weather.wet, m.rain, dt);
  const snow = snowStep(weather.snow, m.snow, m.rain, dt);
  if (Math.abs(wet - weather.wet) > 1e-5 || Math.abs(snow - weather.snow) > 1e-5) changed = true;
  weather.wet = wet;
  weather.snow = snow;

  if (changed) weather.version++;
  weather.active = !isClear(m) || weather.wet > 0.002 || weather.snow > 0.002 || flash > 0 || !isClear(weather.target);
  publish();
}

/** A lightning strike now: the flash, and its thunder on its way. */
export function strike(hold: number | null = null) {
  weather.flashHold = hold;
  weather.flashAt = weather.clock;
  weather.boltSide = Math.random() < 0.5 ? -1 : 1;
  weather.boltSeed = Math.random();
  weather.nextFlash = weather.clock + nextFlashIn(Math.max(0.3, weather.mix.storm), Math.random());
  const roll = Math.random();
  thunder(thunderDelay(roll), 1 - 0.5 * roll, weather.boltSide);
}

/** Mounted once inside the Canvas: moves the weather before the frame draws (so it stops with the render). */
export function WeatherClock() {
  useFrame((_, delta) => stepWeather(Math.min(delta, 0.1)));
  return null;
}

// For QA: __swarmWeather reads the weather (state, source, intensity), set('storm') holds one (set(null) lets go),
// flash() strikes lightning now, skip() jumps straight to the target instead of blending.
if (typeof window !== 'undefined' && !Object.getOwnPropertyDescriptor(window, '__swarmWeather')) {
  const round = (m: WeatherMix) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));
  Object.defineProperty(window, '__swarmWeather', {
    value: {
      get state() {
        return weather.kind;
      },
      get source() {
        return weather.source;
      },
      get intensity() {
        return weather.intensity;
      },
      get mix() {
        return round(weather.mix);
      },
      get target() {
        return round(weather.target);
      },
      get active() {
        return weather.active;
      },
      get wet() {
        return Math.round(weather.wet * 1000) / 1000;
      },
      get snow() {
        return Math.round(weather.snow * 1000) / 1000;
      },
      get flash() {
        return weather.flash;
      },
      get nextFlashIn() {
        return Number.isFinite(weather.nextFlash) ? Math.max(0, weather.nextFlash - weather.clock) : null;
      },
      get real() {
        return useStore.getState().weather;
      },
      /** Holds this weather (a kind or an alias: 'rain', 'storm', 'fog', 'snow', 'clear'); null lets go. False for an unknown name. */
      set(kind: string | null) {
        if (kind === null) {
          weather.probe = null;
          weather.url = null;
          return true;
        }
        const k = parseWeatherKind(kind);
        if (!k) return false;
        weather.probe = k;
        return true;
      },
      /** Strikes lightning now (with its thunder); strike(0.9) holds the flash at 0.9 for a screenshot, until strike() again. */
      strike: (hold?: number) => strike(typeof hold === 'number' ? Math.min(1, Math.max(0, hold)) : null),
      /** Jumps to where the weather is heading, without the 20 s blend (screenshots). */
      skip() {
        stepWeather(0);
        Object.assign(weather.mix, weather.target);
        weather.wet = weather.mix.rain > 0.3 ? 1 : 0;
        weather.snow = weather.mix.snow > 0.3 ? 1 : 0;
        weather.version++;
      },
    },
    enumerable: false,
    configurable: false,
  });
}
