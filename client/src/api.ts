import { useStore } from './store';
import type { PongResult } from '../../shared/pong';
import type { AgentStyle } from '../../shared/looks';
import type { AgentCli, AgentPromptView, AgentView, DoctorFinding, DoctorFix, EffortLevel, GhRepoSummary, NotifyChannel, NotifyChannelsView, NotifyWebhook, OfficeUpdateView, PreviewView, ProjectFolderView, PrPreviewView, RepoView, SwarmSettings, UsageView, VoiceCacheView, VoiceOption } from '../../shared/types';
import type { JournalChunk, JournalDayView } from '../../shared/journal';
import type { DecorItem, ProgressView } from '../../shared/progress';

async function call<T = unknown>(method: string, url: string, body?: unknown, toast = true): Promise<T> {
  // The time-lapse shows a recorded day: nothing in it can be acted on.
  if (method !== 'GET' && useStore.getState().replaying) {
    useStore.getState().pushToast('info', '▶ Replaying: live actions are off. Press Esc to go back to the live office.');
    throw new Error('The time-lapse is playing');
  }
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: string }).error ?? `${res.status} ${res.statusText}`;
    if (toast) useStore.getState().pushToast('error', message);
    throw new Error(message);
  }
  return data as T;
}

/** An audio clip from the office (the voice settings' Test line); errors become toasts like the rest. */
async function clip(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message = (data as { error?: string }).error ?? `${res.status} ${res.statusText}`;
    useStore.getState().pushToast('error', message);
    throw new Error(message);
  }
  return res.blob();
}

const r = (repoId: string) => `/api/repos/${encodeURIComponent(repoId)}`;

/** An agent's coding agent, model and effort ('' = the office default). */
export interface AgentSetupPatch {
  cli?: AgentCli | '';
  model?: string;
  effort?: EffortLevel | '';
}

/** Choices made when a project moves in: a brief for the CEO, and whether work starts on its own. */
export interface FloorOptions {
  mission?: string;
  autoAssign?: boolean;
}

export const api = {
  githubRepos: (owner?: string) => call<GhRepoSummary[]>('GET', `/api/github/repos${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`),
  connectRepo: (fullName: string, floor: FloorOptions = {}) => call<RepoView>('POST', '/api/repos', { fullName, ...floor }),
  createRepo: (body: FloorOptions & { name: string; description: string; visibility: 'private' | 'public'; owner?: string }) =>
    call<RepoView>('POST', '/api/repos/new', body),
  folders: (dir?: string) => call<{ root: string; folders: ProjectFolderView[] }>('GET', `/api/folders${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`),
  connectFolder: (path: string, floor: FloorOptions = {}) => call<RepoView>('POST', '/api/folders/connect', { path, ...floor }),
  publishFolder: (body: FloorOptions & { path: string; name?: string; visibility: 'private' | 'public'; description?: string }) =>
    call<RepoView>('POST', '/api/folders/publish', body),
  setup: (body: { managerName: string; companyName: string; scaling: SwarmSettings['scaling']; ceoName: string; ceoLook: 'feminine' | 'masculine'; ceoColor: string }) =>
    call<SwarmSettings>('POST', '/api/setup', body),
  updateRepo: (
    repoId: string,
    patch: {
      autoAssign?: boolean;
      autoMerge?: boolean;
      browserTesting?: boolean;
      color?: string;
      links?: string[];
      mission?: string;
      summary?: string;
      qaBrief?: string;
      previewCommand?: string | null;
      previewEnv?: Record<string, string>;
    },
  ) => call('PATCH', r(repoId), patch),
  startPreview: (repoId: string, pr?: number) => call<PreviewView>('POST', `${r(repoId)}/preview`, pr ? { pr } : {}),
  stopPreview: (repoId: string) => call<PreviewView>('DELETE', `${r(repoId)}/preview`),
  startPrPreview: (repoId: string, pr: number, restart = false) => call<PrPreviewView>('POST', `${r(repoId)}/pr-previews/${pr}`, { restart }),
  stopPrPreview: (repoId: string, pr: number) => call('DELETE', `${r(repoId)}/pr-previews/${pr}`),
  /** The app viewer's heartbeat: which PR preview it has on screen (repoId null: none). Quiet on errors. */
  watchPreview: (viewer: string, repoId: string | null, pr: number | null) => call('POST', '/api/previews/watch', { viewer, repoId, pr }, false),
  previewSync: (repoId: string, pr: number | null) => call<{ url: string }>('POST', `${r(repoId)}/preview/sync`, { pr }),
  disconnectRepo: (repoId: string) => call('DELETE', r(repoId)),
  syncRepo: (repoId: string) => call('POST', `${r(repoId)}/sync`),
  syncFolder: (repoId: string) => call<{ folderSync: string | null }>('POST', `${r(repoId)}/sync-folder`),
  createIssue: (repoId: string, title: string, body: string, assignTo?: string) => call<{ number: number }>('POST', `${r(repoId)}/issues`, { title, body, assignTo }),
  closeIssue: (repoId: string, n: number) => call('POST', `${r(repoId)}/issues/${n}/close`),
  planFloor: (repoId: string, mission?: string) => call('POST', `${r(repoId)}/plan`, { mission }),
  onboardFloor: (repoId: string) => call('POST', `${r(repoId)}/onboard`),
  mergePull: (repoId: string, n: number, method: 'squash' | 'merge' | 'rebase' = 'squash') => call('POST', `${r(repoId)}/pulls/${n}/merge`, { method }),
  closePull: (repoId: string, n: number) => call('POST', `${r(repoId)}/pulls/${n}/close`),
  /** Queues the PR for QA; with `agentId`, that (free) agent tests it now. */
  sendToQa: (repoId: string, n: number, agentId?: string) => call('POST', `${r(repoId)}/pulls/${n}/qa`, agentId ? { agentId } : {}),
  sendBack: (repoId: string, n: number, note?: string) => call('POST', `${r(repoId)}/pulls/${n}/fix`, { note }),
  /** A new agent on the floor (refused past Settings → Most agents per floor). Empty settings use the office's defaults. */
  hireAgent: (repoId: string, opts: AgentSetupPatch & { name?: string } = {}) => call<AgentView>('POST', `${r(repoId)}/agents`, opts),
  updateAgent: (id: string, patch: AgentSetupPatch & { name?: string; look?: 'feminine' | 'masculine'; style?: AgentStyle | null }) => call('PATCH', `/api/agents/${id}`, patch),
  fireAgent: (id: string) => call('DELETE', `/api/agents/${id}`),
  /** waitForDeps: refuse an issue that still waits for open ones, as the whiteboard's stickies do. */
  assign: (id: string, issueNumber: number, note?: string, waitForDeps?: boolean) => call('POST', `/api/agents/${id}/assign`, { issueNumber, note, waitForDeps }),
  stop: (id: string) => call('POST', `/api/agents/${id}/stop`),
  reset: (id: string) => call('POST', `/api/agents/${id}/reset`),
  message: (id: string, text: string) => call('POST', `/api/agents/${id}/message`, { text }),
  agentPrompt: (id: string) => call<AgentPromptView>('GET', `/api/agents/${id}/prompt`),
  updateSettings: (patch: Partial<SwarmSettings>) => call('PATCH', '/api/settings', patch),
  updateOffice: async (action: 'now' | 'later') => {
    const u = await call<OfficeUpdateView>('POST', '/api/office/update', { action });
    useStore.getState().setOfficeUpdate(u);
    return u;
  },
  /** Clears pacing after a usage warning; refused (and toasted) while paused at the limit. */
  resumeFullSpeed: () => call<UsageView>('POST', '/api/usage/resume'),
  /** The demo only: a usage warning, or the limit, as if a session had reported it. */
  simulateUsage: (kind: 'warning' | 'limit') => call<UsageView>('POST', '/api/usage/simulate', { kind }),
  /** The office doctor: a finding's one-click fix, or Ignore. */
  doctorFix: (id: string, fix: DoctorFix) => call<DoctorFinding[]>('POST', '/api/doctor/fix', { id, fix }),
  doctorIgnore: (id: string) => call<DoctorFinding[]>('POST', '/api/doctor/ignore', { id }),
  /** The demo only: the office doctor's scenarios. */
  demoDoctor: (action: 'restart' | 'stuck' | 'later' | 'unclosed' | 'check') => call<{ text: string; doctor: DoctorFinding[] }>('POST', '/api/doctor/demo', { action }),
  messageCeo: (text: string) => call('POST', '/api/ceo/message', { text }),
  ceoReview: () => call('POST', '/api/ceo/review'),
  phoneRead: (at: number) => call('POST', '/api/phone/read', { at }),
  /** A finished ping-pong game on a floor, for its leaderboard (shared/pong.ts parsePongResult). */
  pongResult: (repoId: string, result: PongResult) => call('POST', `${r(repoId)}/pong`, result),
  /** Decides a team change: a hire with the manager's changes to the new agent, if any. */
  approveRequest: (id: string, overrides: AgentSetupPatch & { name?: string; note?: string } = {}) => call('POST', `/api/requests/${id}/approve`, overrides),
  rejectRequest: (id: string, note?: string) => call('POST', `/api/requests/${id}/reject`, { note }),
  /** Demo office only: the CEO asks for a new agent (or for one to leave) on demand. */
  demoPropose: (kind: 'hire' | 'let-go', floor?: number) => call<{ text: string }>('POST', '/api/demo/proposals', { kind, floor }),
  /** Saves (or with '' removes) the ElevenLabs key. No toast: the settings show why a key was rejected. */
  setVoiceKey: (key: string) => call<{ voiceKeySet: boolean; voiceKeyHint: string }>('PUT', '/api/voice/key', { key }, false),
  voices: () => call<VoiceOption[]>('GET', '/api/voice/voices'),
  voiceSample: (voiceId: string) => clip(`/api/voice/sample?voiceId=${encodeURIComponent(voiceId)}`),
  clearVoiceCache: () => call<VoiceCacheView>('DELETE', '/api/voice/cache'),
  journalDays: () => call<JournalDayView[]>('GET', '/api/journal/days'),
  journalEvents: (from: number, to: number, seek: boolean) => call<JournalChunk>('GET', `/api/journal/events?from=${Math.floor(from)}&to=${Math.ceil(to)}${seek ? '&seek=1' : ''}`),
  journalSample: () => call<{ day: string }>('POST', '/api/journal/sample'),
  /** Saves (or with empty fields removes) a chat app's webhook. No toast: the settings show why it was refused. */
  setWebhook: (channel: NotifyWebhook, body: Record<string, string>) => call<NotifyChannelsView>('PUT', `/api/notify/webhooks/${channel}`, body, false),
  testNotify: (channel: NotifyChannel) => call<{ ok: true; sent: number }>('POST', '/api/notify/test', { channel }, false),
  pushKey: () => call<{ publicKey: string }>('GET', '/api/notify/push/key'),
  pushSubscribe: (subscription: PushSubscriptionJSON) => call<NotifyChannelsView>('POST', '/api/notify/push/devices', { subscription }),
  pushUnsubscribe: (endpoint: string) => call<NotifyChannelsView>('DELETE', '/api/notify/push/devices', { endpoint }),
  // office progression (#210)
  buyDecor: (repoId: string, item: DecorItem) => call<ProgressView>('POST', `${r(repoId)}/decor/buy`, { item }),
  placeDecor: (repoId: string, body: { item: DecorItem; slot: string | null; from: string | null }) => call<ProgressView>('POST', `${r(repoId)}/decor/place`, body),
  drankCoffee: (id: string) => call<{ coffees: number }>('POST', '/api/progress/coffee', { id }, false),
  /** Demo only: coins for a floor, or days of tenure for one agent (or everyone). */
  demoProgress: (body: { action: 'coins'; repoId: string; coins: number } | { action: 'tenure'; days: number; agentId?: string }) => call<ProgressView>('POST', '/api/progress/demo', body),
};
