// Settings → Cloud agents (docs/cloud.md): where new agents work, and the Upstash Box size and limit. Shared so the
// server checks what the client offers.

import type { AgentCli, BoxSize, CloudSettings, CloudView, MachineHost } from './types.ts';

export const BOX_SIZES: BoxSize[] = ['small', 'medium', 'large'];

/** Upstash's pay-as-you-go price per active CPU hour, and what each size is (upstash.com/pricing/box). */
export const BOX_SIZE_INFO: Record<BoxSize, { usdPerCpuHour: number; spec: string }> = {
  small: { usdPerCpuHour: 0.1, spec: '2 vCPU · 4 GB' },
  medium: { usdPerCpuHour: 0.2, spec: '4 vCPU · 8 GB' },
  large: { usdPerCpuHour: 0.4, spec: '8 vCPU · 16 GB' },
};

/** The free plan's most Boxes, paused ones included. */
export const FREE_BOX_LIMIT = 10;
export const MAX_BOX_LIMIT = 1000;

export const DEFAULT_CLOUD: CloudSettings = { machineKind: 'local', boxSize: 'small', boxLimit: FREE_BOX_LIMIT };

/** Before the server says otherwise: no account connected, nothing to sign in with. */
const NONE = { ready: false, source: null, hint: '' } as const;
export const EMPTY_CLOUD: CloudView = { keySet: false, keyHint: '', keyError: null, github: NONE, claude: NONE, codex: NONE, boxes: null };

/** Saved or patched cloud settings, with anything unknown replaced by `base`'s. */
export function cloudSettings(base: CloudSettings, raw: unknown): CloudSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof CloudSettings, unknown>>;
  const limit = Math.round(Number(r.boxLimit));
  return {
    machineKind: r.machineKind === 'box' || r.machineKind === 'local' ? r.machineKind : base.machineKind,
    boxSize: BOX_SIZES.includes(r.boxSize as BoxSize) ? (r.boxSize as BoxSize) : base.boxSize,
    boxLimit: Number.isFinite(limit) && limit >= 1 ? Math.min(MAX_BOX_LIMIT, limit) : base.boxLimit,
  };
}

/** A CLI that can run in a Box (OpenCode can't yet). */
export const boxCli = (cli: AgentCli) => cli !== 'opencode';

/** Where an agent works, for their card: "☁ Cloud" or "This computer". */
export const hostLabel = (host: MachineHost | '' | undefined) => (host === 'box' ? '☁ Cloud (Upstash Box)' : 'This computer');
