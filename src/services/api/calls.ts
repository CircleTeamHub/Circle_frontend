import { apiClient } from './client';
import type {
  CallParticipant,
  CallSession,
  CallType,
} from '@/features/call/types';
import {
  normalizeCall,
  normalizeCallActionResponse,
  normalizeParticipant,
} from './call-mappers';

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

export type CreateDirectCallInput = {
  calleeID: string;
  callType: CallType;
};

/** 1:1 呼叫（circle_be#113）。非好友/被拉黑后端回 403 CALL_NOT_FRIEND。 */
export async function createDirectCall(input: CreateDirectCallInput) {
  const response = await apiClient<unknown>('/calls/direct', {
    method: 'POST',
    body: input,
  });
  return normalizeCallActionResponse(response);
}

/**
 * 重连对账（#93）：断线恢复后问服务端「我是否仍在通话中」。
 * 不在任何通话中时返回 null。current 不签发 LiveKit 凭据 ——
 * 真正回房走 /calls/:id/join-token。
 */
export async function fetchCurrentCall(): Promise<{
  call: CallSession;
  selfParticipant: CallParticipant | null;
} | null> {
  const response = await apiClient<{
    call: unknown | null;
    selfParticipant: unknown | null;
  }>('/calls/current');
  if (!response || response.call == null) {
    return null;
  }
  return {
    call: normalizeCall(response.call),
    selfParticipant:
      response.selfParticipant == null
        ? null
        : normalizeParticipant(response.selfParticipant),
  };
}
