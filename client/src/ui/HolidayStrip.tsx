// A line at the top of the phone while a holiday theme is on: the greeting, or the theme's own count (the egg hunt's
// eggs found, the presents opened today).
import { THEME_INFO } from '../../../shared/themes';
import { useTheme, useThemeRuntime } from '../world/themes/active';

export function HolidayStrip() {
  const id = useTheme((s) => s.id);
  const status = useThemeRuntime((s) => s.status);
  if (!id) return null;
  const info = THEME_INFO[id];
  return (
    <div className="phone-holiday" role="status" style={{ margin: '0 6px 6px', padding: '5px 10px', borderRadius: 12, fontSize: 13, fontWeight: 600, textAlign: 'center', color: '#23263a', background: '#ffd6a5' }}>
      {status ?? `${info.emoji} Happy ${info.name.replace(/^Your /, '')}`}
    </div>
  );
}
