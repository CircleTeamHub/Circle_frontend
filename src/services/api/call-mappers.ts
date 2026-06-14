import type {
  CallActionResponse,
  CallLiveKitCredentials,
  CallParticipant,
  CallParticipantStatus,
  CallSession,
  CallStatus,
  CallType,
  CallUserLite,
} from '@/features/call/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`无效通话数据: ${field}`);
  }
  return value;
}

function normalizeCallType(value: unknown): CallType {
  if (value === 'AUDIO' || value === 'VIDEO') return value;
  throw new Error('无效通话数据: callType');
}

function normalizeCallStatus(value: unknown): CallStatus {
  if (
    value === 'RINGING' ||
    value === 'ACTIVE' ||
    value === 'ENDED' ||
    value === 'CANCELED' ||
    value === 'MISSED' ||
    value === 'FAILED'
  ) {
    return value;
  }
  throw new Error('无效通话数据: status');
}

function normalizeParticipantStatus(value: unknown): CallParticipantStatus {
  if (
    value === 'INVITED' ||
    value === 'JOINED' ||
    value === 'LEFT' ||
    value === 'REJECTED' ||
    value === 'MISSED'
  ) {
    return value;
  }
  throw new Error('无效通话数据: participant.status');
}

function normalizeUser(value: unknown): CallUserLite {
  if (!isRecord(value)) {
    throw new Error('无效通话数据: user');
  }
  return {
    id: requiredString(value.id, 'user.id'),
    nickname: requiredString(value.nickname, 'user.nickname'),
    avatarUrl: nullableString(value.avatarUrl),
  };
}

function normalizeParticipant(value: unknown): CallParticipant {
  if (!isRecord(value)) {
    throw new Error('无效通话数据: participant');
  }
  return {
    user: normalizeUser(value.user),
    status: normalizeParticipantStatus(value.status),
    invitedAt: nullableString(value.invitedAt),
    joinedAt: nullableString(value.joinedAt),
    leftAt: nullableString(value.leftAt),
  };
}

function normalizeCall(value: unknown): CallSession {
  if (!isRecord(value)) {
    throw new Error('无效通话数据: call');
  }
  if (!Array.isArray(value.participants)) {
    throw new Error('无效通话数据: call.participants');
  }
  const sessionType = value.sessionType;
  if (sessionType !== 'group' && sessionType !== 'single') {
    throw new Error('无效通话数据: sessionType');
  }

  return {
    id: requiredString(value.id, 'call.id'),
    conversationID: requiredString(value.conversationID, 'call.conversationID'),
    sessionType,
    callType: normalizeCallType(value.callType),
    status: normalizeCallStatus(value.status),
    livekitRoomName:
      typeof value.livekitRoomName === 'string' ? value.livekitRoomName : undefined,
    initiator: normalizeUser(value.initiator),
    startedAt: nullableString(value.startedAt),
    endedAt: nullableString(value.endedAt),
    expiresAt: nullableString(value.expiresAt),
    durationSeconds:
      typeof value.durationSeconds === 'number' ? value.durationSeconds : null,
    endReason: nullableString(value.endReason),
    participants: value.participants.map(normalizeParticipant),
  };
}

function normalizeLiveKitCredentials(
  value: unknown,
  fallback: Record<string, unknown>,
): CallLiveKitCredentials {
  const livekit = isRecord(value) ? value : {};
  const url = livekit.url ?? livekit.livekitUrl ?? fallback.livekitUrl ?? fallback.url;
  const token = livekit.token ?? fallback.token;
  const expiresAt = livekit.expiresAt ?? fallback.expiresAt;
  return {
    url: requiredString(url, 'livekit.url'),
    token: requiredString(token, 'livekit.token'),
    expiresAt: requiredString(expiresAt, 'livekit.expiresAt'),
  };
}

export function normalizeCallActionResponse(value: unknown): CallActionResponse {
  if (!isRecord(value)) {
    throw new Error('无效通话数据: response');
  }
  return {
    call: normalizeCall(value.call),
    selfParticipant:
      value.selfParticipant == null
        ? null
        : normalizeParticipant(value.selfParticipant),
    livekit: normalizeLiveKitCredentials(value.livekit, value),
  };
}
