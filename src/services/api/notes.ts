import { apiClient } from './client';
import type {
  CreateNoteInput,
  ListNotesParams,
  NoteDetail,
  NoteGroup,
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

export async function togglePinNote(id: string, pinned: boolean): Promise<void> {
  await apiClient<{ id: string; pinned: boolean }>(`/note/${id}/pin`, {
    method: 'PATCH',
    body: { pinned },
  });
}

export async function deleteNote(id: string): Promise<void> {
  await apiClient<void>(`/note/${id}`, { method: 'DELETE' });
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
