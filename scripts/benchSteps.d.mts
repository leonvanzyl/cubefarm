// Types for benchSteps.mjs (plain JavaScript, so the benchmark runs without tsx).

export interface FrameStats {
  frames: number;
  fps: number;
  frameMs: { p50: number | null; p95: number | null; p99: number | null; max: number | null };
}
export interface WsFrame {
  bytes: number;
  type: string;
}
export interface WsStats {
  bytesPerSecond: number;
  messagesPerSecond: number;
  types: Record<string, { perSecond: number; bytesPerSecond: number }>;
}
export interface CpuStats {
  mainMsPerFrame: number | null;
  scriptMsPerFrame: number | null;
  processMsPerFrame: number | null;
  mainBusy: number | null;
}
export interface BenchRun extends FrameStats {
  cpu?: CpuStats;
  renderer: { calls?: number; triangles?: number } | null;
  heapMB: number | null;
  audioNodes: number | null;
  ws: WsStats;
}
export function portProblem(port: number): string | null;
export function floorsToVisit(floors: number, wanted?: number[]): number[];
export function median(values: (number | null | undefined)[]): number | null;
export function percentile(values: number[], p: number): number | null;
export function frameStats(stamps: number[]): FrameStats;
export function parseReadout(text: string | null | undefined): { calls: number; triangles: number } | null;
export function cpuStats(before: Record<string, number> | null, after: Record<string, number> | null, frames: number): CpuStats;
export function wsStats(frames: WsFrame[], seconds: number): WsStats;
export function eventType(payload: string): string;
export function medianRun(runs: BenchRun[]): Record<string, number | null>;
