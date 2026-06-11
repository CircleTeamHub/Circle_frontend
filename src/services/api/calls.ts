import { apiClient } from './client';
import type { CallActionResponse, CallType } from '@/features/call/types';

export type CreateGroupCallInput = {
  conversationID: string;
  callType: CallType;
  inviteeIDs: string[];
};

export async function createGroupCall(input: CreateGroupCallInput) {
  return apiClient<CallActionResponse>('/calls/group', {
    method: 'POST',
    body: input,
  });
}

export async function acceptCall(callId: string) {
  return apiClient<CallActionResponse>(`/calls/${callId}/accept`, {
    method: 'POST',
  });
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
  return apiClient<CallActionResponse>(`/calls/${callId}/join-token`, {
    method: 'POST',
  });
}
