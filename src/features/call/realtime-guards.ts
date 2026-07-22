import type {
  CallInvitePayload,
  CallParticipantPayload,
  CallStatePayload,
  CallUserLite,
} from './types';

function isCallUserLite(value: unknown): value is CallUserLite {
  if (!value || typeof value !== 'object') return false;
  const user = value as Partial<CallUserLite>;
  return (
    typeof user.id === 'string' &&
    typeof user.nickname === 'string' &&
    (typeof user.avatarUrl === 'string' || user.avatarUrl === null)
  );
}

export function isCallInvitePayload(value: unknown): value is CallInvitePayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<CallInvitePayload>;
  return (
    typeof payload.callId === 'string' &&
    typeof payload.conversationID === 'string' &&
    // round 2 review（P1）：1:1 呼叫的邀请 sessionType='single'，只放行
    // 'group' 会让被叫端静默丢掉全部单聊来电 —— 主叫入会、被叫永远不响铃。
    (payload.sessionType === 'group' || payload.sessionType === 'single') &&
    (payload.callType === 'AUDIO' || payload.callType === 'VIDEO') &&
    isCallUserLite(payload.initiator) &&
    Array.isArray(payload.invitees) &&
    payload.invitees.every(isCallUserLite) &&
    typeof payload.expiresAt === 'string' &&
    typeof payload.createdAt === 'string'
  );
}

export function isCallParticipantPayload(
  value: unknown,
): value is CallParticipantPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<CallParticipantPayload>;
  return (
    typeof payload.callId === 'string' &&
    typeof payload.changedAt === 'string' &&
    isCallUserLite(payload.user)
  );
}

export function isCallStatePayload(value: unknown): value is CallStatePayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<CallStatePayload>;
  return (
    typeof payload.callId === 'string' &&
    typeof payload.changedAt === 'string' &&
    ['ENDED', 'CANCELED', 'MISSED', 'FAILED'].includes(String(payload.status))
  );
}
