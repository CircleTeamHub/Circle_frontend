import { apiClient } from './client';
import { generateIdempotencyKey } from '@/utils/idempotency-key';
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

// 每次发起一个键:apiClient 内部 401→刷新后的重放沿用同一 options,服务端按键
// 认出是同一通,不会再响一次铃。用户再点一次是新的一通,换新键。
export async function createGroupCall(input: CreateGroupCallInput) {
  const response = await apiClient<unknown>('/calls/group', {
    method: 'POST',
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
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

// 不带挂断原因:结束原因由服务端状态机推导(NORMAL / ALL_LEFT / NO_ANSWER …),
// 客户端自报的 reason 服务端从不读取(为已装机旧版本继续接受)。
export async function leaveCall(callId: string) {
  return apiClient<void>(`/calls/${callId}/leave`, {
    method: 'POST',
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
    headers: { 'Idempotency-Key': generateIdempotencyKey() },
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
