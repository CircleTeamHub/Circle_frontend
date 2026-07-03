import { apiClient } from './client';
import type {
  CollectNoteSource,
  CreateNoteInput,
  CreateNoteExportInput,
  CreateNoteShareLinkInput,
  ListNotesParams,
  NoteDetail,
  NoteExportResult,
  NoteGroup,
  NoteShareLink,
  NoteSummary,
} from '@/features/notes/types';

export async function fetchNotes(params?: ListNotesParams): Promise<NoteSummary[]> {
  const q = new URLSearchParams();
  if (params?.status) q.set('status', params.status);
  if (params?.groupId) q.set('groupId', params.groupId);
  if (params?.search) q.set('search', params.search);
  const qs = q.toString();
  return apiClient<NoteSummary[]>(`/note${qs ? `?${qs}` : ''}`);
}

export async function fetchNoteDetail(id: string): Promise<NoteDetail> {
  return apiClient<NoteDetail>(`/note/${id}`);
}

export async function createNote(input: CreateNoteInput): Promise<NoteDetail> {
  return apiClient<NoteDetail>('/note', { method: 'POST', body: input });
}

export async function updateNote(id: string, input: CreateNoteInput): Promise<NoteDetail> {
  return apiClient<NoteDetail>(`/note/${id}`, { method: 'PATCH', body: input });
}

// 仅替换 note 的 group 归属。批量调整分组成员时使用 —— 避免对每条 note 先 fetch 详情再
// 用 updateNote 整体替换（参考 review #59，N+1 解决方案）。
export async function updateNoteGroupIds(
  id: string,
  groupIds: string[],
): Promise<{ id: string; groupIds: string[] }> {
  return apiClient<{ id: string; groupIds: string[] }>(`/note/${id}/groups`, {
    method: 'PATCH',
    body: { groupIds },
  });
}

export type CollectNoteResult = {
  note: NoteDetail;
  /** true = 本来就是自己的笔记，或此前已收藏过（幂等，不产生新副本） */
  alreadyCollected: boolean;
};

// 聊天里收藏他人笔记 → 服务端快照复制成一条自己的笔记（带来源名片），
// 取代旧的 createCollection(type: NOTE) 收藏页方案。
export async function collectNote(
  noteId: string,
  source: CollectNoteSource,
): Promise<CollectNoteResult> {
  return apiClient<CollectNoteResult>('/note/collect', {
    method: 'POST',
    body: { noteId, source },
  });
}

export async function togglePinNote(id: string, pinned: boolean): Promise<void> {
  await apiClient<{ id: string; pinned: boolean }>(`/note/${id}/pin`, {
    method: 'PATCH',
    body: { pinned },
  });
}

export async function deleteNote(id: string): Promise<void> {
  await apiClient<void>(`/note/${id}`, { method: 'DELETE' });
}

export async function createNoteShareLink(
  input: CreateNoteShareLinkInput,
): Promise<NoteShareLink> {
  return apiClient<NoteShareLink>('/note/share-links', {
    method: 'POST',
    body: input,
  });
}

export async function createNoteExport(
  noteId: string,
  input: CreateNoteExportInput,
): Promise<NoteExportResult> {
  return apiClient<NoteExportResult>(`/note/${noteId}/exports`, {
    method: 'POST',
    body: input,
  });
}

export async function fetchNoteGroups(): Promise<NoteGroup[]> {
  return apiClient<NoteGroup[]>('/note/group');
}

export async function createNoteGroup(name: string): Promise<NoteGroup> {
  return apiClient<NoteGroup>('/note/group', { method: 'POST', body: { name } });
}

export async function updateNoteGroup(id: string, name: string): Promise<NoteGroup> {
  return apiClient<NoteGroup>(`/note/group/${id}`, { method: 'PATCH', body: { name } });
}

export async function deleteNoteGroup(id: string): Promise<void> {
  await apiClient<void>(`/note/group/${id}`, { method: 'DELETE' });
}

export async function reorderNoteGroups(groupIds: string[]): Promise<NoteGroup[]> {
  return apiClient<NoteGroup[]>('/note/group/order', {
    method: 'PATCH',
    body: { groupIds },
  });
}
