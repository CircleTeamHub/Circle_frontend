import { apiClient } from './client';
import type { CallType } from '@/features/call/types';
import { normalizeCallActionResponse } from './call-mappers';

export { normalizeCallActionResponse } from './call-mappers';

export type CreateGroupCallInput = {
  conversationID: string;
  callType: CallType;
  inviteeIDs: string[];
};

export async function createGroupCall(input: CreateGroupCallInput) {
  const response = await apiClient<unknown>('/calls/group', {
    method: 'POST',
    body: input,
  });
  return normalizeCallActionResponse(response);
}

export async function acceptCall(callId: string) {
  const response = await apiClient<unknown>(`/calls/${callId}/accept`, {
    method: 'POST',
  });
  return normalizeCallActionResponse(response);
}

export async function rejectCall(callId: string) {
  return apiClient<void>(`/calls/${callId}/reject`, {
    method: 'POST',
  });
}

export async function leaveCall(callId: string) {
  return apiClient<void>(`/calls/${callId}/leave`, {
    method: 'POST',
    body: { reason: 'NORMAL' },
  });
}

export async function cancelCall(callId: string) {
  return apiClient<void>(`/calls/${callId}/cancel`, {
    method: 'POST',
  });
}

export async function requestJoinToken(callId: string) {
  const response = await apiClient<unknown>(`/calls/${callId}/join-token`, {
    method: 'POST',
  });
  return normalizeCallActionResponse(response);
}
