export type CallType = 'AUDIO' | 'VIDEO';
export type CallStatus =
  | 'RINGING'
  | 'ACTIVE'
  | 'ENDED'
  | 'CANCELED'
  | 'MISSED'
  | 'FAILED';
export type CallParticipantStatus = 'INVITED' | 'JOINED' | 'LEFT' | 'REJECTED' | 'MISSED';

export type CallUserLite = {
  id: string;
  nickname: string;
  avatarUrl: string | null;
};

export type CallParticipant = {
  user: CallUserLite;
  status: CallParticipantStatus;
  invitedAt: string | null;
  joinedAt: string | null;
  leftAt: string | null;
};

export type CallSession = {
  id: string;
  conversationID: string;
  sessionType: 'group' | 'single';
  callType: CallType;
  status: CallStatus;
  livekitRoomName?: string;
  initiator: CallUserLite;
  startedAt: string | null;
  endedAt: string | null;
  expiresAt: string | null;
  durationSeconds: number | null;
  endReason: string | null;
  participants: CallParticipant[];
};

export type CallInvitePayload = {
  callId: string;
  conversationID: string;
  sessionType: 'group' | 'single';
  callType: CallType;
  initiator: CallUserLite;
  invitees: CallUserLite[];
  expiresAt: string;
  createdAt: string;
};

export type CallParticipantPayload = {
  callId: string;
  user: CallUserLite;
  joinedAt?: string;
  leftAt?: string;
  rejectedAt?: string;
  missedAt?: string;
  changedAt: string;
};

export type CallStatePayload = {
  callId: string;
  status: Extract<CallStatus, 'ENDED' | 'CANCELED' | 'MISSED' | 'FAILED'>;
  endReason: string | null;
  endedAt: string | null;
  changedAt: string;
};

export type CallLiveKitCredentials = {
  url: string;
  token: string;
  expiresAt: string;
};

export type CallActionResponse = {
  call: CallSession;
  selfParticipant: CallParticipant | null;
  livekit: CallLiveKitCredentials;
};
