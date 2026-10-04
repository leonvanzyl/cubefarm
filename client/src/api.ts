import { useStore } from './store';
import type { AgentCli, AgentPromptView, GhRepoSummary, OfficeUpdateView, PreviewView, ProjectFolderView, RepoView, SwarmSettings } from '../../shared/types';

async function call<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: string }).error ?? `${res.status} ${res.statusText}`;
    useStore.getState().pushToast('error', message);
    throw new Error(message);
  }
  return data as T;
}

const r = (repoId: string) => `/api/repos/${encodeURIComponent(repoId)}`;

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
  setup: (body: { managerName: string; companyName: string; hiring: 'approve' | 'auto'; ceoName: string; ceoLook: 'feminine' | 'masculine'; ceoColor: string }) =>
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
  disconnectRepo: (repoId: string) => call('DELETE', r(repoId)),
  syncRepo: (repoId: string) => call('POST', `${r(repoId)}/sync`),
  syncFolder: (repoId: string) => call<{ folderSync: string | null }>('POST', `${r(repoId)}/sync-folder`),
  createIssue: (repoId: string, title: string, body: string, assignTo?: string, specialty?: string) =>
    call<{ number: number }>('POST', `${r(repoId)}/issues`, { title, body, assignTo, specialty }),
  planFloor: (repoId: string, mission?: string) => call('POST', `${r(repoId)}/plan`, { mission }),
  onboardFloor: (repoId: string) => call('POST', `${r(repoId)}/onboard`),
  mergePull: (repoId: string, n: number, method: 'squash' | 'merge' | 'rebase' = 'squash') => call('POST', `${r(repoId)}/pulls/${n}/merge`, { method }),
  closePull: (repoId: string, n: number) => call('POST', `${r(repoId)}/pulls/${n}/close`),
  sendToQa: (repoId: string, n: number) => call('POST', `${r(repoId)}/pulls/${n}/qa`),
  sendBack: (repoId: string, n: number, note?: string) => call('POST', `${r(repoId)}/pulls/${n}/fix`, { note }),
  hireAgent: (repoId: string, opts: { name?: string; model?: string; effort?: string; role?: 'dev' | 'qa'; title?: string; specialty?: string } = {}) =>
    call('POST', `${r(repoId)}/agents`, opts),
  updateAgent: (id: string, patch: { name?: string; model?: string; effort?: string; cli?: AgentCli | ''; look?: 'feminine' | 'masculine'; title?: string; specialty?: string; brief?: string }) =>
    call('PATCH', `/api/agents/${id}`, patch),
  fireAgent: (id: string) => call('DELETE', `/api/agents/${id}`),
  assign: (id: string, issueNumber: number, note?: string) => call('POST', `/api/agents/${id}/assign`, { issueNumber, note }),
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
  messageCeo: (text: string) => call('POST', '/api/ceo/message', { text }),
  ceoReview: () => call('POST', '/api/ceo/review'),
  phoneRead: (at: number) => call('POST', '/api/phone/read', { at }),
  approveRequest: (id: string, overrides: { name?: string; model?: string; effort?: string } = {}) => call('POST', `/api/requests/${id}/approve`, overrides),
  rejectRequest: (id: string, note?: string) => call('POST', `/api/requests/${id}/reject`, { note }),
};
