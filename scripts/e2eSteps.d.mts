// Types for e2eSteps.mjs (plain JavaScript, so npm's pretest:e2e runs it without tsx).

type Env = Record<string, string | undefined>;
export interface InstalledBrowsers {
  chrome: boolean;
  chromium: boolean;
}
export function pickBrowser(env: Env, installed: InstalledBrowsers): { browser: 'chrome' | 'chromium'; ok: boolean; message: string | null };
export function browsersPathWarning(env: Env, cwd: string): string | null;
export function webServerCommand(env: Env): string;
export function installedBrowsers(): InstalledBrowsers;
