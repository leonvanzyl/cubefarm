import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanName } from '../../../shared/presence';
import { VisitorRow } from './VisitorRow';

const row = (raw: string) => renderToStaticMarkup(<VisitorRow v={{ id: 'v1', name: cleanName(raw), color: '#ef476f', floor: 1 }} where="here" following={false} onFollow={() => undefined} />);

describe('a visitor in the people list', () => {
  it('shows a hostile name as text, escaped and capped, never as markup', () => {
    const html = row('<img src=x onerror=alert(1)>');
    expect(html).toContain('<span class="wk-name">&lt;img src=x onerror=alert</span>'); // 24 characters
    expect(html).not.toContain('<img');
  });

  it('escapes quotes in the button title too', () => {
    const html = row('"><script>x</script>');
    expect(html).toContain('title="Follow &quot;&gt;&lt;script&gt;x&lt;/script&gt; with the camera"');
    expect(html).not.toContain('<script');
  });
});
