import { describe, expect, it } from 'vitest';
import { wantsDesktop } from './notifications';

describe('desktop notifications', () => {
  it('show only in a hidden tab, with the setting on and the browser allowing them', () => {
    expect(wantsDesktop({ enabled: true, hidden: true, permission: 'granted' })).toBe(true);
    expect(wantsDesktop({ enabled: true, hidden: false, permission: 'granted' })).toBe(false);
    expect(wantsDesktop({ enabled: false, hidden: true, permission: 'granted' })).toBe(false);
    expect(wantsDesktop({ enabled: true, hidden: true, permission: 'default' })).toBe(false);
    expect(wantsDesktop({ enabled: true, hidden: true, permission: 'denied' })).toBe(false);
    expect(wantsDesktop({ enabled: true, hidden: true, permission: 'unsupported' })).toBe(false);
  });
});
