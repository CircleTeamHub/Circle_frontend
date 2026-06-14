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
    payload.sessionType === 'group' &&
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
