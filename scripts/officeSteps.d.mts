// Types for officeSteps.mjs (plain JavaScript, so the launcher runs without a build or tsx).

export interface OfficeArgs {
  dev: boolean;
  demo: boolean;
  open: boolean;
  help: boolean;
}
export function parseOfficeArgs(argv: string[]): OfficeArgs;
export function swarmHome(env?: Record<string, string | undefined>, home?: string): string;
export function clientPort(env?: Record<string, string | undefined>): number;
export function parseSymref(output: string): string | null;
export function refusal(state: { branch: string; defaultBranch: string; dirty: boolean; ahead: number }): string | null;
export function stepsFor(changedFiles: string[], opts: { startMode: boolean }): { install: boolean; build: boolean };
export function rollbackPlan(progress: { moved: boolean; installed: boolean; built: boolean }): { reset: boolean; install: boolean; build: boolean };
export function isUpdateCommand(line: string): boolean;
